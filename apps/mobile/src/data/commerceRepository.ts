import { supabase } from '../lib/supabase';
import {
  markPendingPosDraftError,
  removePendingPosDraft,
  savePendingPosDraft,
} from './offlinePosDraftQueue';

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

export type PosDraftLine = {
  catalogItemId: string;
  uomId: string;
  quantity: number;
};

export type CreatePosDraftInput = {
  tenantId: string;
  branchId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  requestId?: string | null;
  items: PosDraftLine[];
};

export type PosCashCheckoutResult = {
  orderId: string;
  paymentId: string;
  status: 'completed';
  paymentStatus: 'paid';
  fulfillmentStatus: 'collected';
  inventoryMovementCount: number;
  idempotentReplay: boolean;
};

type BranchRow = {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
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

const pendingPosDraftRequestIds = new Map<string, string>();

export async function loadAccessibleBranches(tenantId: string): Promise<CommerceBranch[]> {
  if (!tenantId) return [];

  const { data, error } = await supabase.rpc('get_sellertray_accessible_branches', {
    p_tenant_id: tenantId,
  });

  if (error) throw error;

  return ((data ?? []) as BranchRow[]).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    isDefault: row.is_default,
  }));
}

export async function loadCommerceProducts(
  tenantId: string,
  options?: { includeInactive?: boolean },
): Promise<CommerceProduct[]> {
  if (!tenantId) return [];

  let query = supabase
    .from('catalog_items')
    .select(`
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
    `)
    .eq('tenant_id', tenantId);

  if (!options?.includeInactive) {
    query = query.eq('is_active', true);
  }

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

  const body = {
    mode: 'pos' as const,
    tenantId: input.tenantId,
    branchId: input.branchId,
    customerName: cleanOptional(input.customerName),
    customerPhone: cleanOptional(input.customerPhone),
    note: cleanOptional(input.note),
    items: input.items.map((item) => ({
      catalogItemId: item.catalogItemId,
      uomId: item.uomId,
      quantity: item.quantity,
    })),
  };
  const retryKey = JSON.stringify(body);
  const requestId = input.requestId
    ?? pendingPosDraftRequestIds.get(retryKey)
    ?? createSellerTrayRequestId();
  if (!input.requestId) pendingPosDraftRequestIds.set(retryKey, requestId);

  const canPersistForSync = body.customerName === null
    && body.customerPhone === null
    && body.note === null;
  if (canPersistForSync) {
    await savePendingPosDraft({
      tenantId: input.tenantId,
      branchId: input.branchId,
      requestId,
      items: body.items,
    }).catch(() => undefined);
  }

  const { data, error } = await supabase.functions.invoke('merchant-order', {
    body: { ...body, requestId },
  });

  if (error) {
    const message = await functionErrorMessage(error, 'Unable to prepare this sale.');
    if (canPersistForSync) {
      await markPendingPosDraftError(input.tenantId, requestId, message).catch(() => undefined);
    }
    throw new Error(message);
  }

  const orderId =
    data && typeof data === 'object' && 'orderId' in data && typeof data.orderId === 'string'
      ? data.orderId
      : null;

  if (!orderId) {
    const message = 'SellerTray returned an invalid sale reference.';
    if (canPersistForSync) {
      await markPendingPosDraftError(input.tenantId, requestId, message).catch(() => undefined);
    }
    throw new Error(message);
  }

  if (!input.requestId) pendingPosDraftRequestIds.delete(retryKey);
  if (canPersistForSync) {
    await removePendingPosDraft(input.tenantId, requestId).catch(() => undefined);
  }
  return orderId;
}

export async function completePosCashSale(
  tenantId: string,
  orderId: string,
): Promise<PosCashCheckoutResult> {
  if (!tenantId) throw new Error('Business is required.');
  if (!orderId) throw new Error('Sale is required.');

  const { data, error } = await supabase.functions.invoke('pos-checkout', {
    body: {
      tenantId,
      orderId,
      paymentMethod: 'cash',
    },
  });

  if (error) throw new Error(await functionErrorMessage(error, 'Unable to complete this cash sale.'));

  if (!isPosCashCheckoutResult(data)) {
    throw new Error('SellerTray returned an invalid checkout result.');
  }

  return data;
}

export function createSellerTrayRequestId(): string {
  const runtimeCrypto = (globalThis as typeof globalThis & {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: (array: Uint8Array) => Uint8Array;
    };
  }).crypto;
  const generated = runtimeCrypto?.randomUUID?.();
  if (generated && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generated)) {
    return generated;
  }

  const bytes = new Uint8Array(16);
  if (runtimeCrypto?.getRandomValues) {
    runtimeCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  let message = error instanceof Error && error.message ? error.message : fallback;
  if (!error || typeof error !== 'object' || !('context' in error)) return message;

  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('clone' in context)) return message;

  try {
    const payload = await (context as Response).clone().json() as { error?: string };
    if (payload?.error) message = payload.error;
  } catch {
    // Keep the SDK message.
  }
  return message;
}

function isPosCashCheckoutResult(value: unknown): value is PosCashCheckoutResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.orderId !== undefined
    && typeof row.orderId === 'string'
    && typeof row.paymentId === 'string'
    && row.status === 'completed'
    && row.paymentStatus === 'paid'
    && row.fulfillmentStatus === 'collected'
    && typeof row.inventoryMovementCount === 'number'
    && typeof row.idempotentReplay === 'boolean';
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