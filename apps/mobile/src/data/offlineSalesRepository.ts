import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CommerceProduct, PosPaymentMethod, PosPaymentMethodType } from './commerceRepository';
import { PosDraftRequestError } from './commerceRepository';
import type { MerchantCustomer } from './customerRepository';
import type { BranchStockRow } from './inventoryRepository';
import type { PosPaymentPolicy } from './posPaymentRepository';
import type { SellerTrayTaxContext } from './taxRepository';

const OUTBOX_KEY = 'sellertray.offline.pos-sales.v2';
const LEGACY_OUTBOX_KEY = 'sellertray.offline.pos-drafts.v1';
const CATALOG_KEY_PREFIX = 'sellertray.offline.catalog.v1:';
const STOCK_KEY_PREFIX = 'sellertray.offline.stock.v1:';
const PAYMENT_KEY_PREFIX = 'sellertray.offline.payment-methods.v1:';
const POLICY_KEY_PREFIX = 'sellertray.offline.pos-policy.v1:';
const CUSTOMER_KEY_PREFIX = 'sellertray.offline.customers.v1:';
const TAX_KEY_PREFIX = 'sellertray.offline.tax-context.v1:';
const MAX_OPEN_INTENTS = 50;
const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PAYMENT_REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/;
const PAYMENT_EPSILON = 0.005;

export type OfflineSaleStatus = 'pending' | 'syncing' | 'needs_review' | 'failed' | 'synced';
export type OfflineCompletionIntent = 'draft' | 'cash' | 'bank' | 'payment';

export type OfflinePaymentMethodSnapshot = {
  paymentMethodId: string | null;
  methodType: PosPaymentMethodType;
  displayName: string;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  instructions: string | null;
};

export type OfflinePaymentAllocation = {
  paymentMethodId: string | null;
  amount: number;
  confirmNow: boolean;
  providerReference: string | null;
  capturedAt: string;
  methodSnapshot: OfflinePaymentMethodSnapshot;
};

export type OfflinePaymentPlan = {
  checkoutCommandId: string;
  payLater: boolean;
  allocations: OfflinePaymentAllocation[];
};

// Kept for schema-v5 outbox compatibility. New offline payment capture uses OfflinePaymentPlan.
export type OfflineBankPaymentEvidence = {
  checkoutCommandId: string;
  paymentMethodId: string;
  providerReference: string;
  capturedAt: string;
  methodSnapshot: {
    paymentMethodId: string;
    methodType: 'bank_transfer';
    displayName: string;
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
    instructions: string | null;
  };
};

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
  schemaVersion: 6;
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
  subtotal: number;
  taxConfigurationId: string | null;
  taxConfigurationRevision: number | null;
  taxApplied: boolean;
  taxRatePercent: number;
  taxAmount: number;
  taxDisplayBreakdown: boolean;
  taxContextLegacy: boolean;
  total: number;
  completionIntent: OfflineCompletionIntent;
  bankPayment: OfflineBankPaymentEvidence | null;
  paymentPlan: OfflinePaymentPlan | null;
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
  subtotal: number;
  taxContext: SellerTrayTaxContext;
  taxAmount: number;
  total: number;
  completionIntent?: OfflineCompletionIntent;
  bankPayment?: OfflineBankPaymentEvidence | null;
  paymentPlan?: OfflinePaymentPlan | null;
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
  if (
    !Number.isFinite(input.subtotal) || input.subtotal < 0
    || !Number.isFinite(input.taxAmount) || input.taxAmount < 0
    || !Number.isFinite(input.total) || input.total < 0
    || Math.abs(input.total - (input.subtotal + input.taxAmount)) > 0.01
  ) {
    throw new Error('Offline sale tax totals are invalid.');
  }
  if (
    !Number.isFinite(input.taxContext.revision) || input.taxContext.revision < 0
    || (input.taxContext.revision === 0 && input.taxContext.configurationId !== null)
    || (input.taxContext.revision > 0 && !input.taxContext.configurationId)
  ) {
    throw new Error('Reconnect once to refresh SellerTray tax settings before selling offline.');
  }

  const completionIntent = input.completionIntent ?? 'draft';
  const bankPayment = input.bankPayment ?? null;
  const paymentPlan = input.paymentPlan ?? null;
  if (completionIntent === 'bank') {
    if (!bankPayment || !isValidBankPaymentEvidence(bankPayment) || paymentPlan) {
      throw new Error('A governed Bank method and valid transfer reference are required for an offline Bank sale.');
    }
  } else if (completionIntent === 'payment') {
    if (!paymentPlan || !isValidPaymentPlan(paymentPlan, input.total) || bankPayment) {
      throw new Error('The offline payment plan is invalid. Review the payment methods and amounts.');
    }
  } else if (bankPayment || paymentPlan) {
    throw new Error('Payment evidence can only be attached to an offline payment sale.');
  }

  const now = new Date().toISOString();
  const next: OfflinePosSale = {
    schemaVersion: 6,
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
    subtotal: input.subtotal,
    taxConfigurationId: input.taxContext.configurationId,
    taxConfigurationRevision: input.taxContext.revision,
    taxApplied: input.taxContext.taxApplied,
    taxRatePercent: input.taxContext.ratePercent,
    taxAmount: input.taxAmount,
    taxDisplayBreakdown: input.taxContext.displayTaxBreakdown,
    taxContextLegacy: false,
    total: input.total,
    completionIntent,
    bankPayment,
    paymentPlan,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastAttemptAt: null,
    lastError: null,
    orderId: null,
  };

  await writeOutbox(pruneSynced([next, ...rows]));
  if (shouldReserveCachedStock(next)) await reserveCachedStock(next);
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
  if (row && row.completionIntent !== 'draft') {
    throw new Error('An offline sale with payment intent cannot be discarded. Sync or review it instead.');
  }
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
export async function saveCustomerCache(tenantId: string, rows: MerchantCustomer[]): Promise<void> { await writeCache(`${CUSTOMER_KEY_PREFIX}${tenantId}`, rows); }
export async function loadCustomerCache(tenantId: string): Promise<OfflineCache<MerchantCustomer[]> | null> { return readCache(`${CUSTOMER_KEY_PREFIX}${tenantId}`); }
export async function saveTaxContextCache(tenantId: string, context: SellerTrayTaxContext): Promise<void> { await writeCache(`${TAX_KEY_PREFIX}${tenantId}`, context); }
export async function loadTaxContextCache(tenantId: string): Promise<OfflineCache<SellerTrayTaxContext> | null> { return readCache(`${TAX_KEY_PREFIX}${tenantId}`); }

export function isLikelyConnectivityError(error: unknown): boolean {
  if (error instanceof PosDraftRequestError) return error.kind === 'network';
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string' ? String((error as { message: string }).message) : String(error ?? '');
  if (/network request failed|failed to fetch|fetch failed|networkerror|unknownhost|unable to resolve host|connection.*failed|failed to send a request to the edge function/i.test(message)) return true;
  return false;
}

function shouldReserveCachedStock(sale: OfflinePosSale): boolean {
  if (sale.completionIntent === 'cash') return true;
  if (sale.completionIntent !== 'payment' || !sale.paymentPlan) return false;

  const plan = sale.paymentPlan;
  if (plan.payLater) return true;

  const allocated = roundMoney(plan.allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  const confirmedAllocated = roundMoney(plan.allocations.reduce(
    (sum, allocation) => sum + (allocation.confirmNow ? allocation.amount : 0),
    0,
  ));
  const isPartial = allocated > PAYMENT_EPSILON && allocated < sale.total - PAYMENT_EPSILON;
  if (isPartial) return confirmedAllocated > PAYMENT_EPSILON;
  return allocated >= sale.total - PAYMENT_EPSILON && confirmedAllocated >= sale.total - PAYMENT_EPSILON;
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
  if (/permission|access|stock|price|unit|uom|branch|shift|register|read-only|customer|override|tax|bank|card|terminal|payment|evidence|reference|verification/i.test(message)) return { status: 'needs_review', message };
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
  const schema = Number(row.schemaVersion);
  if (![1, 2, 3, 4, 5, 6].includes(schema) || typeof row.clientReference !== 'string' || typeof row.actorUserId !== 'string' || typeof row.tenantId !== 'string' || typeof row.branchId !== 'string' || typeof row.branchName !== 'string' || typeof row.currency !== 'string' || !Array.isArray(row.lines) || typeof row.total !== 'number' || !isOfflineStatus(row.status) || typeof row.attempts !== 'number' || typeof row.createdAt !== 'string' || typeof row.updatedAt !== 'string') return [];
  const lines = (row.lines as Array<Record<string, unknown>>).flatMap((line) => {
    const expected = Number(line.expectedSellingPrice);
    const selling = schema >= 3 ? Number(line.sellingPrice) : expected;
    const conversion = Number(line.expectedConversionFactor);
    const quantity = Number(line.quantity);
    if (typeof line.catalogItemId !== 'string' || typeof line.uomId !== 'string' || typeof line.productName !== 'string' || typeof line.uomName !== 'string' || !Number.isFinite(expected) || !Number.isFinite(selling) || !Number.isFinite(conversion) || !Number.isFinite(quantity)) return [];
    return [{ catalogItemId: line.catalogItemId, uomId: line.uomId, quantity, expectedSellingPrice: expected, sellingPrice: selling, expectedConversionFactor: conversion, productName: line.productName, uomName: line.uomName }];
  });
  if (!lines.length) return [];

  const legacyTax = schema < 4 || row.taxContextLegacy === true;
  const subtotal = legacyTax ? row.total : Number(row.subtotal);
  const taxAmount = legacyTax ? 0 : Number(row.taxAmount);
  const ratePercent = legacyTax ? 0 : Number(row.taxRatePercent);
  const revision = legacyTax ? null : Number(row.taxConfigurationRevision);
  const configurationId = legacyTax ? null : nullableString(row.taxConfigurationId);
  if (!Number.isFinite(subtotal) || !Number.isFinite(taxAmount) || !Number.isFinite(ratePercent)) return [];
  if (!legacyTax && (
    revision === null || !Number.isFinite(revision) || revision < 0
    || (revision === 0 && configurationId !== null)
    || (revision > 0 && configurationId === null)
  )) return [];

  let completionIntent: OfflineCompletionIntent = 'draft';
  if (schema >= 6 && row.completionIntent === 'payment') completionIntent = 'payment';
  else if (schema >= 5 && row.completionIntent === 'bank') completionIntent = 'bank';
  else if (schema >= 3 && row.completionIntent === 'cash') completionIntent = 'cash';

  const bankPayment = completionIntent === 'bank' ? parseBankPaymentEvidence(row.bankPayment) : null;
  const paymentPlan = completionIntent === 'payment' ? parsePaymentPlan(row.paymentPlan, Number(row.total)) : null;
  if (completionIntent === 'bank' && !bankPayment) return [];
  if (completionIntent === 'payment' && !paymentPlan) return [];

  return [{
    schemaVersion: 6,
    clientReference: row.clientReference,
    actorUserId: row.actorUserId,
    tenantId: row.tenantId,
    branchId: row.branchId,
    branchName: row.branchName,
    customerId: schema >= 2 ? nullableString(row.customerId) : null,
    customerName: schema >= 2 ? nullableString(row.customerName) : null,
    customerPhone: schema >= 2 ? nullableString(row.customerPhone) : null,
    currency: row.currency,
    lines,
    subtotal,
    taxConfigurationId: configurationId,
    taxConfigurationRevision: revision,
    taxApplied: legacyTax ? false : row.taxApplied === true,
    taxRatePercent: ratePercent,
    taxAmount,
    taxDisplayBreakdown: legacyTax ? false : row.taxDisplayBreakdown === true,
    taxContextLegacy: legacyTax,
    total: row.total,
    completionIntent,
    bankPayment,
    paymentPlan,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastAttemptAt: nullableString(row.lastAttemptAt),
    lastError: nullableString(row.lastError),
    orderId: nullableString(row.orderId),
  }];
}

function parsePaymentPlan(value: unknown, total: number): OfflinePaymentPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.checkoutCommandId !== 'string' || typeof row.payLater !== 'boolean' || !Array.isArray(row.allocations)) return null;
  const allocations = row.allocations.flatMap(parsePaymentAllocation);
  if (allocations.length !== row.allocations.length) return null;
  const plan: OfflinePaymentPlan = { checkoutCommandId: row.checkoutCommandId, payLater: row.payLater, allocations };
  return isValidPaymentPlan(plan, total) ? plan : null;
}

function parsePaymentAllocation(value: unknown): OfflinePaymentAllocation[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  const snapshot = parseMethodSnapshot(row.methodSnapshot);
  if (!snapshot) return [];
  const allocation: OfflinePaymentAllocation = {
    paymentMethodId: nullableString(row.paymentMethodId),
    amount: Number(row.amount),
    confirmNow: row.confirmNow === true,
    providerReference: nullableString(row.providerReference),
    capturedAt: typeof row.capturedAt === 'string' ? row.capturedAt : '',
    methodSnapshot: snapshot,
  };
  return isValidPaymentAllocation(allocation) ? [allocation] : [];
}

function parseMethodSnapshot(value: unknown): OfflinePaymentMethodSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.methodType !== 'cash' && row.methodType !== 'bank_transfer' && row.methodType !== 'card_terminal') return null;
  if (typeof row.displayName !== 'string' || !row.displayName.trim()) return null;
  return {
    paymentMethodId: nullableString(row.paymentMethodId),
    methodType: row.methodType,
    displayName: row.displayName,
    bankName: nullableString(row.bankName),
    bankAccountName: nullableString(row.bankAccountName),
    bankAccountNumber: nullableString(row.bankAccountNumber),
    instructions: nullableString(row.instructions),
  };
}

function isValidPaymentPlan(plan: OfflinePaymentPlan, total: number): boolean {
  if (!isUuid(plan.checkoutCommandId) || plan.allocations.length > 10) return false;
  if (plan.payLater ? plan.allocations.length !== 0 : plan.allocations.length === 0) return false;
  if (!plan.allocations.every(isValidPaymentAllocation)) return false;
  const allocated = roundMoney(plan.allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  return allocated <= roundMoney(total) + PAYMENT_EPSILON;
}

function isValidPaymentAllocation(value: OfflinePaymentAllocation): boolean {
  if (!Number.isFinite(value.amount) || value.amount <= 0 || !Number.isFinite(Date.parse(value.capturedAt))) return false;
  const snapshot = value.methodSnapshot;
  if (snapshot.paymentMethodId !== value.paymentMethodId || !snapshot.displayName.trim()) return false;
  if (snapshot.methodType === 'cash') {
    return value.paymentMethodId === null && value.providerReference === null && value.confirmNow;
  }
  if (!value.paymentMethodId || !isUuid(value.paymentMethodId)) return false;
  if (!value.providerReference || value.providerReference.length > 128 || !PAYMENT_REFERENCE_PATTERN.test(value.providerReference)) return false;
  if (snapshot.methodType === 'bank_transfer' && value.confirmNow) return false;
  return snapshot.methodType === 'bank_transfer' || snapshot.methodType === 'card_terminal';
}

function parseBankPaymentEvidence(value: unknown): OfflineBankPaymentEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const snapshot = row.methodSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const method = snapshot as Record<string, unknown>;
  const evidence: OfflineBankPaymentEvidence = {
    checkoutCommandId: typeof row.checkoutCommandId === 'string' ? row.checkoutCommandId : '',
    paymentMethodId: typeof row.paymentMethodId === 'string' ? row.paymentMethodId : '',
    providerReference: typeof row.providerReference === 'string' ? row.providerReference : '',
    capturedAt: typeof row.capturedAt === 'string' ? row.capturedAt : '',
    methodSnapshot: {
      paymentMethodId: typeof method.paymentMethodId === 'string' ? method.paymentMethodId : '',
      methodType: 'bank_transfer',
      displayName: typeof method.displayName === 'string' ? method.displayName : '',
      bankName: nullableString(method.bankName),
      bankAccountName: nullableString(method.bankAccountName),
      bankAccountNumber: nullableString(method.bankAccountNumber),
      instructions: nullableString(method.instructions),
    },
  };
  if (method.methodType !== 'bank_transfer' || !isValidBankPaymentEvidence(evidence)) return null;
  return evidence;
}

function isValidBankPaymentEvidence(value: OfflineBankPaymentEvidence): boolean {
  return isUuid(value.checkoutCommandId)
    && isUuid(value.paymentMethodId)
    && value.methodSnapshot.paymentMethodId === value.paymentMethodId
    && value.methodSnapshot.methodType === 'bank_transfer'
    && Boolean(value.methodSnapshot.displayName.trim())
    && value.providerReference.length <= 128
    && PAYMENT_REFERENCE_PATTERN.test(value.providerReference)
    && Number.isFinite(Date.parse(value.capturedAt));
}

function isOfflineStatus(value: unknown): value is OfflineSaleStatus { return value === 'pending' || value === 'syncing' || value === 'needs_review' || value === 'failed' || value === 'synced'; }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim()); }
function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function cleanNullable(value: string | null | undefined): string | null { const clean = value?.trim() ?? ''; return clean || null; }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
async function writeCache<T>(key: string, data: T): Promise<void> { await AsyncStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), data } satisfies OfflineCache<T>)); }
async function readCache<T>(key: string): Promise<OfflineCache<T> | null> { const raw = await AsyncStorage.getItem(key); if (!raw) return null; try { const parsed = JSON.parse(raw) as Partial<OfflineCache<T>>; return typeof parsed.savedAt === 'string' && parsed.data !== undefined ? { savedAt: parsed.savedAt, data: parsed.data as T } : null; } catch { return null; } }
