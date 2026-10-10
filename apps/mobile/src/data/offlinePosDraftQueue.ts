import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PosDraftLine } from './commerceRepository';

const KEY_PREFIX = 'sellertray.sync.pos-draft.v1';
const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingPosDraftSync = {
  version: 1;
  tenantId: string;
  branchId: string;
  requestId: string;
  items: PosDraftLine[];
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  lastError: string | null;
};

export async function savePendingPosDraft(input: {
  tenantId: string;
  branchId: string;
  requestId: string;
  items: PosDraftLine[];
  lastError?: string | null;
}): Promise<void> {
  if (!isUuid(input.tenantId) || !isUuid(input.branchId) || !isUuid(input.requestId)) {
    throw new Error('Pending sale identity is invalid.');
  }
  if (!isLines(input.items)) throw new Error('Pending sale items are invalid.');

  const key = queueKey(input.tenantId, input.requestId);
  const existing = await readEnvelope(key);
  const now = new Date().toISOString();
  const envelope: PendingPosDraftSync = {
    version: 1,
    tenantId: input.tenantId,
    branchId: input.branchId,
    requestId: input.requestId,
    items: input.items.map((item) => ({ ...item })),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    lastError: cleanError(input.lastError),
  };
  await AsyncStorage.setItem(key, JSON.stringify(envelope));
}

export async function removePendingPosDraft(tenantId: string, requestId: string): Promise<void> {
  if (!tenantId || !requestId) return;
  await AsyncStorage.removeItem(queueKey(tenantId, requestId));
}

export async function listPendingPosDrafts(
  tenantId: string,
  branchId?: string | null,
): Promise<PendingPosDraftSync[]> {
  if (!tenantId) return [];
  const prefix = tenantPrefix(tenantId);
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (!keys.length) return [];

  const entries = await AsyncStorage.multiGet(keys);
  const valid: PendingPosDraftSync[] = [];
  const invalidKeys: string[] = [];
  const now = Date.now();

  for (const [key, raw] of entries) {
    if (!raw) {
      invalidKeys.push(key);
      continue;
    }
    const envelope = parseEnvelope(raw);
    if (!envelope || envelope.tenantId !== tenantId) {
      invalidKeys.push(key);
      continue;
    }
    const createdAt = new Date(envelope.createdAt).getTime();
    if (!Number.isFinite(createdAt) || now - createdAt > MAX_PENDING_AGE_MS) {
      invalidKeys.push(key);
      continue;
    }
    if (!branchId || envelope.branchId === branchId) valid.push(envelope);
  }

  if (invalidKeys.length) await AsyncStorage.multiRemove(invalidKeys);
  return valid.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function clearPendingPosDraftsForTenant(tenantId: string): Promise<void> {
  if (!tenantId) return;
  const prefix = tenantPrefix(tenantId);
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

function parseEnvelope(raw: string): PendingPosDraftSync | null {
  try {
    const row = JSON.parse(raw) as Partial<PendingPosDraftSync>;
    if (
      row.version !== 1
      || !isUuid(row.tenantId)
      || !isUuid(row.branchId)
      || !isUuid(row.requestId)
      || !isLines(row.items)
      || typeof row.createdAt !== 'string'
      || typeof row.updatedAt !== 'string'
      || typeof row.attemptCount !== 'number'
      || !Number.isInteger(row.attemptCount)
      || row.attemptCount < 1
      || (row.lastError !== null && typeof row.lastError !== 'string')
    ) return null;
    return row as PendingPosDraftSync;
  } catch {
    return null;
  }
}

async function readEnvelope(key: string): Promise<PendingPosDraftSync | null> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? parseEnvelope(raw) : null;
}

function isLines(value: unknown): value is PosDraftLine[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return false;
  return value.every((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const row = candidate as Record<string, unknown>;
    return isUuid(row.catalogItemId)
      && isUuid(row.uomId)
      && typeof row.quantity === 'number'
      && Number.isFinite(row.quantity)
      && row.quantity > 0
      && row.quantity <= 9999;
  });
}

function cleanError(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().slice(0, 240) || null;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function tenantPrefix(tenantId: string): string {
  return `${KEY_PREFIX}:${tenantId}:`;
}

function queueKey(tenantId: string, requestId: string): string {
  return `${tenantPrefix(tenantId)}${requestId}`;
}
