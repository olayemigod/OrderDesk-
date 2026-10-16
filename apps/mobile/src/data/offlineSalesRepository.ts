import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CommerceProduct, PosPaymentMethod } from './commerceRepository';
import { PosDraftRequestError } from './commerceRepository';
import type { BranchStockRow } from './inventoryRepository';
import type { PosPaymentPolicy } from './posPaymentRepository';

const OUTBOX_KEY = 'sellertray.offline.pos-sales.v2';
const LEGACY_OUTBOX_KEY = 'sellertray.offline.pos-drafts.v1';
const CATALOG_KEY_PREFIX = 'sellertray.offline.catalog.v1:';
const STOCK_KEY_PREFIX = 'sellertray.offline.stock.v1:';
const PAYMENT_KEY_PREFIX = 'sellertray.offline.payment-methods.v1:';
const POLICY_KEY_PREFIX = 'sellertray.offline.pos-policy.v1:';
const MAX_OPEN_INTENTS = 50;
const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineSaleStatus = 'pending' | 'syncing' | 'needs_review' | 'failed' | 'synced';
export type OfflineCompletionIntent = 'draft' | 'cash';

export type OfflineSaleLine = {
  catalogItemId: string;
  uomId: string;
  quantity: number;
  expectedSellingPrice: number;
  sellingPrice: number;
  expectedConversionFactor: number;
  productName: string;
  uomName: string;
};

export type OfflinePosSale = {
  schemaVersion: 3;
  clientReference: string;
  actorUserId: string;
  tenantId: string;
  branchId: string;
  branchName: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  currency: string;
  lines: OfflineSaleLine[];
  total: number;
  completionIntent: OfflineCompletionIntent;
  status: OfflineSaleStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  orderId: string | null;
};

export type OfflineCache<T> = { savedAt: string; data: T };
export type OfflineSyncSummary = { attempted: number; synced: number; pending: number; needsReview: number; failed: number };
type OfflineSaleExecutor = (sale: OfflinePosSale) => Promise<string>;

export async function queueOfflinePosSale(input: {
  clientReference: string;
  actorUserId: string;
  tenantId: string;
  branchId: string;
  branchName: string;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  currency: string;
  lines: OfflineSaleLine[];
  total: number;
  completionIntent?: OfflineCompletionIntent;
}): Promise<OfflinePosSale> {
  const rows = await readOutbox();
  const existing = rows.find((row) => row.clientReference === input.clientReference);
  if (existing) return existing;
  if (rows.filter((row) => row.status !== 'synced').length >= MAX_OPEN_INTENTS) {
    throw new Error('Sync older offline sales before recording another one.');
  }
  if (!input.lines.length || input.lines.some((line) => !Number.isFinite(line.sellingPrice) || line.sellingPrice < 0)) {
    throw new Error('Every offline sale line needs a valid selling price.');
  }

  const now = new Date().toISOString();
  const next: OfflinePosSale = {
    schemaVersion: 3,
    clientReference: input.clientReference,
    actorUserId: input.actorUserId,
    tenantId: input.tenantId,
    branchId: input.branchId,
    branchName: input.branchName,
    customerId: cleanNullable(input.customerId),
    customerName: cleanNullable(input.customerName),
    customerPhone: cleanNullable(input.customerPhone),
    currency: input.currency,
    lines: input.lines,
    total: input.total,
    completionIntent: input.completionIntent ?? 'draft',
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastAttemptAt: null,
    lastError: null,
    orderId: null,
  };

  await writeOutbox(pruneSynced([next, ...rows]));
  if (next.completionIntent === 'cash') await reserveCachedStock(next);
  return next;
}

export async function loadOfflinePosSales(actorUserId?: string | null): Promise<OfflinePosSale[]> {
  const rows = pruneSynced(await readOutbox());
  return actorUserId ? rows.filter((row) => row.actorUserId === actorUserId) : rows;
}

export async function syncOfflinePosSales(actorUserId: string, executor: OfflineSaleExecutor): Promise<OfflineSyncSummary> {
  let rows = pruneSynced(await readOutbox());
  const candidates = rows.filter((row) => row.actorUserId === actorUserId && (row.status === 'pending' || row.status === 'failed'));
  let synced = 0;

  for (const candidate of candidates) {
    const startedAt = new Date().toISOString();
    rows = replaceIntent(rows, candidate.clientReference, { ...candidate, status: 'syncing', attempts: candidate.attempts + 1, lastAttemptAt: startedAt, updatedAt: startedAt, lastError: null });
    await writeOutbox(rows);
    try {
      const orderId = await executor(candidate);
      const completedAt = new Date().toISOString();
      rows = replaceIntent(rows, candidate.clientReference, { ...candidate, status: 'synced', attempts: candidate.attempts + 1, lastAttemptAt: startedAt, updatedAt: completedAt, lastError: null, orderId });
      synced += 1;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const classified = classifySyncFailure(error);
      rows = replaceIntent(rows, candidate.clientReference, { ...candidate, status: classified.status, attempts: candidate.attempts + 1, lastAttemptAt: startedAt, updatedAt: failedAt, lastError: classified.message, orderId: candidate.orderId });
      await writeOutbox(rows);
      if (classified.status === 'pending') break;
      continue;
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
  await writeOutbox(replaceIntent(rows, clientReference, { ...row, status: 'pending', updatedAt: now, lastError: null }));
}

export async function discardOfflinePosSale(clientReference: string, actorUserId: string): Promise<void> {
  const rows = await readOutbox();
  const row = rows.find((item) => item.clientReference === clientReference && item.actorUserId === actorUserId);
  if (row?.completionIntent === 'cash') throw new Error('A completed offline cash sale cannot be discarded. Sync or review it instead.');
  await writeOutbox(rows.filter((item) => item.clientReference !== clientReference || item.actorUserId !== actorUserId));
}

export async function saveCommerceProductCache(tenantId: string, rows: CommerceProduct[]): Promise<void> { await writeCache(`${CATALOG_KEY_PREFIX}${tenantId}`, rows); }
export async function loadCommerceProductCache(tenantId: string): Promise<OfflineCache<CommerceProduct[]> | null> { return readCache(`${CATALOG_KEY_PREFIX}${tenantId}`); }
export async function saveBranchStockCache(tenantId: string, branchId: string, rows: BranchStockRow[]): Promise<void> { await writeCache(`${STOCK_KEY_PREFIX}${tenantId}:${branchId}`, rows); }
export async function loadBranchStockCache(tenantId: string, branchId: string): Promise<OfflineCache<BranchStockRow[]> | null> { return readCache(`${STOCK_KEY_PREFIX}${tenantId}:${branchId}`); }
export async function savePosPaymentMethodsCache(tenantId: string, branchId: string, rows: PosPaymentMethod[]): Promise<void> { await writeCache(`${PAYMENT_KEY_PREFIX}${tenantId}:${branchId}`, rows); }
export async function loadPosPaymentMethodsCache(tenantId: string, branchId: string): Promise<OfflineCache<PosPaymentMethod[]> | null> { return readCache(`${PAYMENT_KEY_PREFIX}${tenantId}:${branchId}`); }
export async function savePosPolicyCache(tenantId: string, policy: PosPaymentPolicy): Promise<void> { await writeCache(`${POLICY_KEY_PREFIX}${tenantId}`, policy); }
export async function loadPosPolicyCache(tenantId: string): Promise<OfflineCache<PosPaymentPolicy> | null> { return readCache(`${POLICY_KEY_PREFIX}${tenantId}`); }

export function isLikelyConnectivityError(error: unknown): boolean {
  if (error instanceof PosDraftRequestError) return error.kind === 'network';
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string' ? String((error as { message: string }).message) : String(error ?? '');
  if (/network request failed|failed to fetch|fetch failed|networkerror|unknownhost|unable to resolve host|connection.*failed|failed to send a request to the edge function/i.test(message)) return true;
  return false;
}

async function reserveCachedStock(sale: OfflinePosSale): Promise<void> {
  const cached = await loadBranchStockCache(sale.tenantId, sale.branchId);
  if (!cached) return;
  const required = new Map<string, number>();
  for (const line of sale.lines) required.set(line.catalogItemId, (required.get(line.catalogItemId) ?? 0) + line.quantity * line.expectedConversionFactor);
  const next = cached.data.map((row) => {
    const amount = required.get(row.catalogItemId) ?? 0;
    return amount > 0 ? { ...row, quantityOnHand: Math.max(0, row.quantityOnHand - amount) } : row;
  });
  await saveBranchStockCache(sale.tenantId, sale.branchId, next);
}

function classifySyncFailure(error: unknown): { status: 'pending' | 'needs_review' | 'failed'; message: string } {
  if (error instanceof PosDraftRequestError) {
    if (error.kind === 'network') return { status: 'pending', message: 'Waiting for a connection.' };
    if (error.kind === 'conflict' || error.kind === 'rejected') return { status: 'needs_review', message: error.message || 'Sale details need review before syncing.' };
    return { status: 'failed', message: error.message || 'SellerTray could not sync this offline sale.' };
  }
  if (isLikelyConnectivityError(error)) return { status: 'pending', message: 'Waiting for a connection.' };
  const message = error instanceof Error && error.message ? error.message : 'SellerTray could not sync this offline sale.';
  if (/permission|access|stock|price|unit|uom|branch|shift|register|read-only|customer|override/i.test(message)) return { status: 'needs_review', message };
  return { status: 'failed', message };
}

function replaceIntent(rows: OfflinePosSale[], clientReference: string, next: OfflinePosSale): OfflinePosSale[] { return rows.map((row) => row.clientReference === clientReference ? next : row); }
function pruneSynced(rows: OfflinePosSale[]): OfflinePosSale[] { const cutoff = Date.now() - SYNCED_RETENTION_MS; return rows.filter((row) => row.status !== 'synced' || !Number.isFinite(new Date(row.updatedAt).getTime()) || new Date(row.updatedAt).getTime() >= cutoff); }

async function readOutbox(): Promise<OfflinePosSale[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY) ?? await AsyncStorage.getItem(LEGACY_OUTBOX_KEY);
  if (!raw) return [];
  try { const parsed = JSON.parse(raw) as unknown; return Array.isArray(parsed) ? parsed.flatMap(parseOfflineSale) : []; } catch { return []; }
}
async function writeOutbox(rows: OfflinePosSale[]): Promise<void> { await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(rows)); }

function parseOfflineSale(value: unknown): OfflinePosSale[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  if (![1, 2, 3].includes(Number(row.schemaVersion)) || typeof row.clientReference !== 'string' || typeof row.actorUserId !== 'string' || typeof row.tenantId !== 'string' || typeof row.branchId !== 'string' || typeof row.branchName !== 'string' || typeof row.currency !== 'string' || !Array.isArray(row.lines) || typeof row.total !== 'number' || !isOfflineStatus(row.status) || typeof row.attempts !== 'number' || typeof row.createdAt !== 'string' || typeof row.updatedAt !== 'string') return [];
  const schema = Number(row.schemaVersion);
  const lines = (row.lines as Array<Record<string, unknown>>).flatMap((line) => {
    const expected = Number(line.expectedSellingPrice);
    const selling = schema >= 3 ? Number(line.sellingPrice) : expected;
    const conversion = Number(line.expectedConversionFactor);
    const quantity = Number(line.quantity);
    if (typeof line.catalogItemId !== 'string' || typeof line.uomId !== 'string' || typeof line.productName !== 'string' || typeof line.uomName !== 'string' || !Number.isFinite(expected) || !Number.isFinite(selling) || !Number.isFinite(conversion) || !Number.isFinite(quantity)) return [];
    return [{ catalogItemId: line.catalogItemId, uomId: line.uomId, quantity, expectedSellingPrice: expected, sellingPrice: selling, expectedConversionFactor: conversion, productName: line.productName, uomName: line.uomName }];
  });
  if (!lines.length) return [];
  return [{ schemaVersion: 3, clientReference: row.clientReference, actorUserId: row.actorUserId, tenantId: row.tenantId, branchId: row.branchId, branchName: row.branchName, customerId: schema >= 2 ? nullableString(row.customerId) : null, customerName: schema >= 2 ? nullableString(row.customerName) : null, customerPhone: schema >= 2 ? nullableString(row.customerPhone) : null, currency: row.currency, lines, total: row.total, completionIntent: schema >= 3 && row.completionIntent === 'cash' ? 'cash' : 'draft', status: row.status, attempts: row.attempts, createdAt: row.createdAt, updatedAt: row.updatedAt, lastAttemptAt: nullableString(row.lastAttemptAt), lastError: nullableString(row.lastError), orderId: nullableString(row.orderId) }];
}
function isOfflineStatus(value: unknown): value is OfflineSaleStatus { return value === 'pending' || value === 'syncing' || value === 'needs_review' || value === 'failed' || value === 'synced'; }
function cleanNullable(value: string | null | undefined): string | null { const clean = value?.trim() ?? ''; return clean || null; }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
async function writeCache<T>(key: string, data: T): Promise<void> { await AsyncStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), data } satisfies OfflineCache<T>)); }
async function readCache<T>(key: string): Promise<OfflineCache<T> | null> { const raw = await AsyncStorage.getItem(key); if (!raw) return null; try { const parsed = JSON.parse(raw) as Partial<OfflineCache<T>>; return typeof parsed.savedAt === 'string' && parsed.data !== undefined ? { savedAt: parsed.savedAt, data: parsed.data as T } : null; } catch { return null; } }
