import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CommerceProduct, CreatePosDraftInput, PosDraftLine } from './commerceRepository';
import { PosDraftRequestError } from './commerceRepository';
import type { BranchStockRow } from './inventoryRepository';

const OUTBOX_KEY = 'sellertray.offline.pos-drafts.v1';
const CATALOG_KEY_PREFIX = 'sellertray.offline.catalog.v1:';
const STOCK_KEY_PREFIX = 'sellertray.offline.stock.v1:';
const MAX_OPEN_INTENTS = 50;
const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineSaleStatus = 'pending' | 'syncing' | 'needs_review' | 'failed' | 'synced';

export type OfflineSaleLine = PosDraftLine & {
  productName: string;
  uomName: string;
};

export type OfflinePosSale = {
  schemaVersion: 1;
  clientReference: string;
  actorUserId: string;
  tenantId: string;
  branchId: string;
  branchName: string;
  currency: string;
  lines: OfflineSaleLine[];
  total: number;
  status: OfflineSaleStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  orderId: string | null;
};

export type OfflineCache<T> = {
  savedAt: string;
  data: T;
};

export type OfflineSyncSummary = {
  attempted: number;
  synced: number;
  pending: number;
  needsReview: number;
  failed: number;
};

type PosDraftExecutor = (input: CreatePosDraftInput) => Promise<string>;

export async function queueOfflinePosSale(input: {
  clientReference: string;
  actorUserId: string;
  tenantId: string;
  branchId: string;
  branchName: string;
  currency: string;
  lines: OfflineSaleLine[];
  total: number;
}): Promise<OfflinePosSale> {
  const rows = await readOutbox();
  const existing = rows.find((row) => row.clientReference === input.clientReference);
  if (existing) return existing;

  const openCount = rows.filter((row) => row.status !== 'synced').length;
  if (openCount >= MAX_OPEN_INTENTS) {
    throw new Error('Sync or discard older held sales before saving another offline sale.');
  }

  const now = new Date().toISOString();
  const next: OfflinePosSale = {
    schemaVersion: 1,
    clientReference: input.clientReference,
    actorUserId: input.actorUserId,
    tenantId: input.tenantId,
    branchId: input.branchId,
    branchName: input.branchName,
    currency: input.currency,
    lines: input.lines,
    total: input.total,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastAttemptAt: null,
    lastError: null,
    orderId: null,
  };

  await writeOutbox(pruneSynced([next, ...rows]));
  return next;
}

export async function loadOfflinePosSales(actorUserId?: string | null): Promise<OfflinePosSale[]> {
  const rows = pruneSynced(await readOutbox());
  if (actorUserId) return rows.filter((row) => row.actorUserId === actorUserId);
  return rows;
}

export async function syncOfflinePosSales(
  actorUserId: string,
  executor: PosDraftExecutor,
): Promise<OfflineSyncSummary> {
  let rows = pruneSynced(await readOutbox());
  const candidates = rows.filter(
    (row) => row.actorUserId === actorUserId && (row.status === 'pending' || row.status === 'failed'),
  );

  let synced = 0;
  for (const candidate of candidates) {
    const startedAt = new Date().toISOString();
    rows = replaceIntent(rows, candidate.clientReference, {
      ...candidate,
      status: 'syncing',
      attempts: candidate.attempts + 1,
      lastAttemptAt: startedAt,
      updatedAt: startedAt,
      lastError: null,
    });
    await writeOutbox(rows);

    try {
      const orderId = await executor({
        tenantId: candidate.tenantId,
        branchId: candidate.branchId,
        clientReference: candidate.clientReference,
        items: candidate.lines.map((line) => ({
          catalogItemId: line.catalogItemId,
          uomId: line.uomId,
          quantity: line.quantity,
          expectedSellingPrice: line.expectedSellingPrice,
          expectedConversionFactor: line.expectedConversionFactor,
        })),
      });
      const completedAt = new Date().toISOString();
      rows = replaceIntent(rows, candidate.clientReference, {
        ...candidate,
        status: 'synced',
        attempts: candidate.attempts + 1,
        lastAttemptAt: startedAt,
        updatedAt: completedAt,
        lastError: null,
        orderId,
      });
      synced += 1;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const classified = classifySyncFailure(error);
      rows = replaceIntent(rows, candidate.clientReference, {
        ...candidate,
        status: classified.status,
        attempts: candidate.attempts + 1,
        lastAttemptAt: startedAt,
        updatedAt: failedAt,
        lastError: classified.message,
        orderId: null,
      });
      if (classified.status === 'pending') {
        await writeOutbox(rows);
        break;
      }
    }
    await writeOutbox(rows);
  }

  rows = pruneSynced(rows);
  await writeOutbox(rows);
  const mine = rows.filter((row) => row.actorUserId === actorUserId);
  return {
    attempted: candidates.length,
    synced,
    pending: mine.filter((row) => row.status === 'pending' || row.status === 'syncing').length,
    needsReview: mine.filter((row) => row.status === 'needs_review').length,
    failed: mine.filter((row) => row.status === 'failed').length,
  };
}

export async function retryOfflinePosSale(clientReference: string, actorUserId: string): Promise<void> {
  const rows = await readOutbox();
  const row = rows.find((item) => item.clientReference === clientReference && item.actorUserId === actorUserId);
  if (!row || row.status === 'synced' || row.status === 'needs_review') return;
  const now = new Date().toISOString();
  await writeOutbox(replaceIntent(rows, clientReference, {
    ...row,
    status: 'pending',
    updatedAt: now,
    lastError: null,
  }));
}

export async function discardOfflinePosSale(clientReference: string, actorUserId: string): Promise<void> {
  const rows = await readOutbox();
  await writeOutbox(rows.filter(
    (row) => row.clientReference !== clientReference || row.actorUserId !== actorUserId,
  ));
}

export async function saveCommerceProductCache(tenantId: string, rows: CommerceProduct[]): Promise<void> {
  await writeCache(`${CATALOG_KEY_PREFIX}${tenantId}`, rows);
}

export async function loadCommerceProductCache(tenantId: string): Promise<OfflineCache<CommerceProduct[]> | null> {
  return readCache<CommerceProduct[]>(`${CATALOG_KEY_PREFIX}${tenantId}`);
}

export async function saveBranchStockCache(
  tenantId: string,
  branchId: string,
  rows: BranchStockRow[],
): Promise<void> {
  await writeCache(`${STOCK_KEY_PREFIX}${tenantId}:${branchId}`, rows);
}

export async function loadBranchStockCache(
  tenantId: string,
  branchId: string,
): Promise<OfflineCache<BranchStockRow[]> | null> {
  return readCache<BranchStockRow[]>(`${STOCK_KEY_PREFIX}${tenantId}:${branchId}`);
}

export function isLikelyConnectivityError(error: unknown): boolean {
  if (error instanceof PosDraftRequestError) return error.kind === 'network';
  if (error instanceof TypeError) return true;
  if (error && typeof error === 'object' && 'code' in error) return false;
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? String((error as { message: string }).message)
      : String(error ?? '');
  return /network request failed|failed to fetch|fetch failed|networkerror|connection.*failed|failed to send a request to the edge function/i.test(message);
}

function classifySyncFailure(error: unknown): { status: 'pending' | 'needs_review' | 'failed'; message: string } {
  if (error instanceof PosDraftRequestError) {
    if (error.kind === 'network') {
      return { status: 'pending', message: 'Waiting for a connection.' };
    }
    if (error.kind === 'conflict' || error.kind === 'rejected') {
      return { status: 'needs_review', message: error.message || 'Sale details need review before syncing.' };
    }
    return { status: 'failed', message: error.message || 'SellerTray could not sync this held sale.' };
  }
  if (isLikelyConnectivityError(error)) {
    return { status: 'pending', message: 'Waiting for a connection.' };
  }
  return {
    status: 'failed',
    message: error instanceof Error && error.message ? error.message : 'SellerTray could not sync this held sale.',
  };
}

function replaceIntent(rows: OfflinePosSale[], clientReference: string, next: OfflinePosSale): OfflinePosSale[] {
  return rows.map((row) => row.clientReference === clientReference ? next : row);
}

function pruneSynced(rows: OfflinePosSale[]): OfflinePosSale[] {
  const cutoff = Date.now() - SYNCED_RETENTION_MS;
  return rows.filter((row) => {
    if (row.status !== 'synced') return true;
    const time = new Date(row.updatedAt).getTime();
    return !Number.isFinite(time) || time >= cutoff;
  });
}

async function readOutbox(): Promise<OfflinePosSale[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(parseOfflineSale);
  } catch {
    return [];
  }
}

async function writeOutbox(rows: OfflinePosSale[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(rows));
}

function parseOfflineSale(value: unknown): OfflinePosSale[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const row = value as Partial<OfflinePosSale>;
  if (
    row.schemaVersion !== 1
    || typeof row.clientReference !== 'string'
    || typeof row.actorUserId !== 'string'
    || typeof row.tenantId !== 'string'
    || typeof row.branchId !== 'string'
    || typeof row.branchName !== 'string'
    || typeof row.currency !== 'string'
    || !Array.isArray(row.lines)
    || typeof row.total !== 'number'
    || !isOfflineStatus(row.status)
    || typeof row.attempts !== 'number'
    || typeof row.createdAt !== 'string'
    || typeof row.updatedAt !== 'string'
  ) return [];
  return [row as OfflinePosSale];
}

function isOfflineStatus(value: unknown): value is OfflineSaleStatus {
  return value === 'pending'
    || value === 'syncing'
    || value === 'needs_review'
    || value === 'failed'
    || value === 'synced';
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  const value: OfflineCache<T> = { savedAt: new Date().toISOString(), data };
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function readCache<T>(key: string): Promise<OfflineCache<T> | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OfflineCache<T>>;
    if (typeof parsed.savedAt !== 'string' || parsed.data === undefined) return null;
    return { savedAt: parsed.savedAt, data: parsed.data as T };
  } catch {
    return null;
  }
}
