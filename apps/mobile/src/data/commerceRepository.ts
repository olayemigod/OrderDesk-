import { supabase } from '../lib/supabase';

export type CommerceBranch = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
};

export type CommerceUom = {
  id: string;
  name: string;
  conversionFactor: number;
  sellingPrice: number | null;
  barcode: string | null;
  allowFractional: boolean;
  isDefaultSelling: boolean;
  isDefaultPurchase: boolean;
  isStockUom: boolean;
};

export type CommerceProduct = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  imageUrl: string | null;
  stockUom: string;
  allowFractionalStock: boolean;
  isActive: boolean;
  uoms: CommerceUom[];
};

export type PosPaymentMethodType = 'cash' | 'bank_transfer' | 'card_terminal';

export type PosPaymentMethod = {
  paymentMethodId: string | null;
  methodType: PosPaymentMethodType;
  displayName: string;
  sortOrder: number;
  isDefault: boolean;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  instructions: string | null;
};

export type PosDraftLine = {
  catalogItemId: string;
  uomId: string;
  quantity: number;
  expectedSellingPrice: number;
  expectedConversionFactor: number;
};

export type CreatePosDraftInput = {
  tenantId: string;
  branchId: string;
  clientReference?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  expectedTaxConfigurationId?: string | null;
  expectedTaxConfigurationRevision?: number | null;
  items: PosDraftLine[];
};

export type PosDraftFailureKind = 'network' | 'conflict' | 'rejected' | 'server';

export class PosDraftRequestError extends Error {
  readonly kind: PosDraftFailureKind;
  readonly status: number | null;

  constructor(message: string, kind: PosDraftFailureKind, status: number | null = null) {
    super(message);
    this.name = 'PosDraftRequestError';
    this.kind = kind;
    this.status = status;
  }
}

type PosCheckoutResultBase = {
  orderId: string;
  paymentId: string;
  paymentMethodId: string | null;
  methodType: PosPaymentMethodType;
  inventoryMovementCount: number;
  idempotentReplay: boolean;
};

export type PosSettledCheckoutResult = PosCheckoutResultBase & {
  status: 'completed';
  paymentStatus: 'paid';
  fulfillmentStatus: 'collected';
};

export type PosPendingPaymentCheckoutResult = PosCheckoutResultBase & {
  methodType: 'bank_transfer';
  status: 'awaiting_payment_confirmation';
  paymentStatus: 'unpaid';
  fulfillmentStatus: string;
  inventoryMovementCount: 0;
};

export type PosCheckoutResult = PosSettledCheckoutResult | PosPendingPaymentCheckoutResult;
export type PosCashCheckoutResult = PosSettledCheckoutResult;

type BranchRow = {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
};

type PosPaymentMethodRow = {
  payment_method_id: string | null;
  method_type: PosPaymentMethodType;
  display_name: string;
  sort_order: number;
  is_default: boolean;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  instructions: string | null;
};

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  image_url: string | null;
  stock_uom: string;
  allow_fractional_stock: boolean;
  is_active: boolean;
  catalog_item_uoms: Array<{
    id: string;
    uom_name: string;
    conversion_factor: number | string;
    selling_price: number | string | null;
    barcode: string | null;
    allow_fractional: boolean;
    is_default_selling: boolean;
    is_default_purchase: boolean;
  }> | null;
};

export async function loadAccessibleBranches(tenantId: string): Promise<CommerceBranch[]> {
  if (!tenantId) return [];
  const { data, error } = await supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId });
  if (error) throw error;
  return ((data ?? []) as BranchRow[]).map((row) => ({ id: row.id, code: row.code, name: row.name, isDefault: row.is_default }));
}

export async function loadBranchPosPaymentMethods(tenantId: string, branchId: string): Promise<PosPaymentMethod[]> {
  if (!tenantId || !branchId) return [];
  const { data, error } = await supabase.rpc('get_sellertray_branch_pos_payment_methods', { p_tenant_id: tenantId, p_branch_id: branchId });
  if (error) throw error;
  return ((data ?? []) as PosPaymentMethodRow[]).map((row) => ({
    paymentMethodId: row.payment_method_id,
    methodType: row.method_type,
    displayName: row.display_name,
    sortOrder: Number(row.sort_order ?? 100),
    isDefault: row.is_default === true,
    bankName: row.bank_name,
    bankAccountName: row.bank_account_name,
    bankAccountNumber: row.bank_account_number,
    instructions: row.instructions,
  }));
}

export async function loadCommerceProducts(tenantId: string, options?: { includeInactive?: boolean }): Promise<CommerceProduct[]> {
  if (!tenantId) return [];
  let query = supabase.from('catalog_items').select(`
      id,
      name,
      sku,
      category,
      image_url,
      stock_uom,
      allow_fractional_stock,
      is_active,
      catalog_item_uoms(
        id,
        uom_name,
        conversion_factor,
        selling_price,
        barcode,
        allow_fractional,
        is_default_selling,
        is_default_purchase
      )
    `).eq('tenant_id', tenantId);
  if (!options?.includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query.order('name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as ProductRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    imageUrl: row.image_url,
    stockUom: row.stock_uom,
    allowFractionalStock: row.allow_fractional_stock,
    isActive: row.is_active,
    uoms: (row.catalog_item_uoms ?? [])
      .map((uom) => ({
        id: uom.id,
        name: uom.uom_name,
        conversionFactor: toNumber(uom.conversion_factor) ?? 1,
        sellingPrice: toNumber(uom.selling_price),
        barcode: uom.barcode,
        allowFractional: uom.allow_fractional,
        isDefaultSelling: uom.is_default_selling,
        isDefaultPurchase: uom.is_default_purchase,
        isStockUom: uom.uom_name.trim().toLowerCase() === row.stock_uom.trim().toLowerCase(),
      }))
      .sort((left, right) => {
        if (left.isDefaultSelling !== right.isDefaultSelling) return left.isDefaultSelling ? -1 : 1;
        if (left.isDefaultPurchase !== right.isDefaultPurchase) return left.isDefaultPurchase ? -1 : 1;
        if (left.conversionFactor !== right.conversionFactor) return left.conversionFactor - right.conversionFactor;
        return left.name.localeCompare(right.name);
      }),
  }));
}

export async function createPosDraft(input: CreatePosDraftInput): Promise<string> {
  if (!input.tenantId) throw new Error('Business is required.');
  if (!input.branchId) throw new Error('Branch is required.');
  if (input.items.length === 0) throw new Error('Add at least one product.');

  const clientReference = cleanOptional(input.clientReference);
  const hasTaxContext = input.expectedTaxConfigurationRevision !== undefined
    && input.expectedTaxConfigurationRevision !== null;
  if (hasTaxContext) {
    const revision = input.expectedTaxConfigurationRevision!;
    const configurationId = cleanOptional(input.expectedTaxConfigurationId);
    if (!Number.isInteger(revision) || revision < 0) throw new Error('Queued sale tax context is invalid.');
    if ((revision === 0 && configurationId !== null) || (revision > 0 && !configurationId)) {
      throw new Error('Queued sale tax context is invalid.');
    }
    if (!clientReference) throw new Error('Queued sale tax context requires a stable sale reference.');
  }

  const { data, error } = await supabase.functions.invoke('merchant-order', {
    body: {
      mode: 'pos',
      tenantId: input.tenantId,
      branchId: input.branchId,
      clientReference,
      customerId: cleanOptional(input.customerId),
      customerName: cleanOptional(input.customerName),
      customerPhone: cleanOptional(input.customerPhone),
      note: cleanOptional(input.note),
      ...(hasTaxContext ? {
        expectedTaxConfigurationId: cleanOptional(input.expectedTaxConfigurationId),
        expectedTaxConfigurationRevision: input.expectedTaxConfigurationRevision,
      } : {}),
      items: input.items.map((item) => ({
        catalogItemId: item.catalogItemId,
        uomId: item.uomId,
        quantity: item.quantity,
        expectedSellingPrice: item.expectedSellingPrice,
        expectedConversionFactor: item.expectedConversionFactor,
      })),
    },
  });

  if (error) throw await posDraftError(error, 'Unable to prepare this sale.');

  const row = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const orderId = typeof row.orderId === 'string' ? row.orderId : null;
  if (!orderId) throw new PosDraftRequestError('SellerTray returned an invalid sale reference.', 'server');
  if (clientReference && row.clientReference !== clientReference) throw new PosDraftRequestError('SellerTray returned a different sale reference.', 'server');
  return orderId;
}

export async function completePosSale(tenantId: string, orderId: string, paymentMethodId: string | null): Promise<PosCheckoutResult> {
  if (!tenantId) throw new Error('Business is required.');
  if (!orderId) throw new Error('Sale is required.');
  const { data, error } = await supabase.functions.invoke('pos-checkout', { body: { tenantId, orderId, paymentMethodId } });
  if (error) throw new Error(await functionErrorMessage(error, 'Unable to process this payment.'));
  if (!isPosCheckoutResult(data)) throw new Error('SellerTray returned an invalid checkout result.');
  return data;
}

export async function completePosCashSale(tenantId: string, orderId: string): Promise<PosCashCheckoutResult> {
  const result = await completePosSale(tenantId, orderId, null);
  if (result.status !== 'completed') throw new Error('SellerTray cash checkout did not settle the sale.');
  return result;
}

export function createPosClientReference(): string {
  const bytes = new Uint8Array(16);
  const now = Date.now();
  for (let index = 0; index < bytes.length; index += 1) {
    const timeByte = index < 6 ? (now / (2 ** (index * 8))) & 0xff : 0;
    bytes[index] = (Math.floor(Math.random() * 256) ^ timeByte) & 0xff;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isPosDraftNetworkError(error: unknown): boolean {
  return error instanceof PosDraftRequestError && error.kind === 'network';
}

async function posDraftError(error: unknown, fallback: string): Promise<PosDraftRequestError> {
  const baseMessage = error instanceof Error && error.message ? error.message : fallback;
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const status = context.status;
      let message = baseMessage;
      try {
        const payload = await context.clone().json() as { error?: string };
        if (payload?.error) message = payload.error;
      } catch {}
      if (status === 409) return new PosDraftRequestError(message, 'conflict', status);
      if (status >= 500) return new PosDraftRequestError(message, 'server', status);
      return new PosDraftRequestError(message, 'rejected', status);
    }
  }
  if (/network request failed|failed to fetch|fetch failed|networkerror|failed to send a request to the edge function/i.test(baseMessage)) {
    return new PosDraftRequestError('SellerTray could not reach the server.', 'network');
  }
  return new PosDraftRequestError(baseMessage || fallback, 'server');
}

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  let message = error instanceof Error && error.message ? error.message : fallback;
  if (!error || typeof error !== 'object' || !('context' in error)) return message;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('clone' in context)) return message;
  try {
    const payload = await (context as Response).clone().json() as { error?: string };
    if (payload?.error) message = payload.error;
  } catch {}
  return message;
}

function isPosCheckoutResult(value: unknown): value is PosCheckoutResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const common = typeof row.orderId === 'string'
    && typeof row.paymentId === 'string'
    && (row.paymentMethodId === null || row.paymentMethodId === undefined || typeof row.paymentMethodId === 'string')
    && (row.methodType === 'cash' || row.methodType === 'bank_transfer' || row.methodType === 'card_terminal')
    && typeof row.fulfillmentStatus === 'string'
    && typeof row.inventoryMovementCount === 'number'
    && typeof row.idempotentReplay === 'boolean';
  if (!common) return false;

  const settled = row.status === 'completed'
    && row.paymentStatus === 'paid'
    && row.fulfillmentStatus === 'collected';
  const awaitingBankTransfer = row.methodType === 'bank_transfer'
    && row.status === 'awaiting_payment_confirmation'
    && row.paymentStatus === 'unpaid'
    && row.inventoryMovementCount === 0;
  return settled || awaitingBankTransfer;
}

function cleanOptional(value: string | null | undefined): string | null {
  const clean = value?.trim() ?? '';
  return clean || null;
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
