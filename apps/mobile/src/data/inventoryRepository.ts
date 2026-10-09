import { supabase } from '../lib/supabase';

export type BranchStockRow = {
  catalogItemId: string;
  itemName: string;
  sku: string | null;
  category: string | null;
  stockUom: string;
  quantityOnHand: number;
  lastMovementAt: string | null;
};

export type StockMovementRow = {
  id: string;
  catalogItemId: string;
  itemName: string;
  movementType: string;
  quantityDelta: number;
  stockUom: string;
  sourceUom: string;
  sourceQuantity: number;
  conversionFactor: number;
  referenceType: string;
  referenceId: string;
  businessAt: string;
  reason: string | null;
  createdAt: string;
};

export type InventoryCapabilities = {
  canReceiveStock: boolean;
  canAdjustStock: boolean;
};

export type InventoryOperation = 'receive' | 'adjust';
export type InventoryAdjustmentDirection = 'increase' | 'decrease';

export type InventoryOperationInput = {
  tenantId: string;
  branchId: string;
  productId: string;
  uomId: string;
  operation: InventoryOperation;
  quantity: number;
  adjustmentDirection?: InventoryAdjustmentDirection | null;
  reference: string;
  reason: string;
};

export type InventoryOperationResult = {
  movementId: string;
  operation: InventoryOperation;
  productId: string;
  productName: string;
  sourceUom: string;
  sourceQuantity: number;
  conversionFactor: number;
  stockUom: string;
  quantityDelta: number;
  quantityOnHand: number;
  reference: string;
  idempotentReplay: boolean;
};

type StockRpcRow = {
  catalog_item_id: string;
  item_name: string;
  sku: string | null;
  category: string | null;
  stock_uom: string;
  quantity_on_hand: number | string;
  last_movement_at: string | null;
};

type MovementRpcRow = {
  id: string;
  catalog_item_id: string;
  item_name: string;
  movement_type: string;
  quantity_delta: number | string;
  stock_uom: string;
  source_uom: string;
  source_quantity: number | string;
  conversion_factor: number | string;
  reference_type: string;
  reference_id: string;
  business_at: string;
  reason: string | null;
  created_at: string;
};

type CapabilityRpcRow = {
  can_receive_stock: boolean;
  can_adjust_stock: boolean;
};

export async function loadBranchStock(
  tenantId: string,
  branchId: string,
): Promise<BranchStockRow[]> {
  if (!tenantId || !branchId) return [];

  const { data, error } = await supabase.rpc('get_sellertray_branch_stock', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });

  if (error) throw error;

  return ((data ?? []) as StockRpcRow[]).map((row) => ({
    catalogItemId: row.catalog_item_id,
    itemName: row.item_name,
    sku: row.sku,
    category: row.category,
    stockUom: row.stock_uom,
    quantityOnHand: toNumber(row.quantity_on_hand),
    lastMovementAt: row.last_movement_at,
  }));
}

export async function loadStockMovements(
  tenantId: string,
  branchId: string,
  catalogItemId?: string | null,
  limit = 100,
): Promise<StockMovementRow[]> {
  if (!tenantId || !branchId) return [];

  const { data, error } = await supabase.rpc('get_sellertray_stock_movements', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_catalog_item_id: catalogItemId ?? null,
    p_limit: limit,
  });

  if (error) throw error;

  return ((data ?? []) as MovementRpcRow[]).map((row) => ({
    id: row.id,
    catalogItemId: row.catalog_item_id,
    itemName: row.item_name,
    movementType: row.movement_type,
    quantityDelta: toNumber(row.quantity_delta),
    stockUom: row.stock_uom,
    sourceUom: row.source_uom,
    sourceQuantity: toNumber(row.source_quantity),
    conversionFactor: toNumber(row.conversion_factor),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    businessAt: row.business_at,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

export async function loadInventoryCapabilities(
  tenantId: string,
  branchId: string,
): Promise<InventoryCapabilities> {
  if (!tenantId || !branchId) {
    return { canReceiveStock: false, canAdjustStock: false };
  }

  const { data, error } = await supabase.rpc('get_sellertray_inventory_capabilities', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });

  if (error) throw error;
  const row = ((data ?? []) as CapabilityRpcRow[])[0];
  return {
    canReceiveStock: row?.can_receive_stock === true,
    canAdjustStock: row?.can_adjust_stock === true,
  };
}

export async function applyInventoryOperation(
  input: InventoryOperationInput,
): Promise<InventoryOperationResult> {
  if (!input.tenantId) throw new Error('Business is required.');
  if (!input.branchId) throw new Error('Branch is required.');
  if (!input.productId) throw new Error('Product is required.');
  if (!input.uomId) throw new Error('Unit is required.');
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('Quantity must be greater than zero.');
  }
  if (input.operation === 'adjust' && !input.adjustmentDirection) {
    throw new Error('Choose whether stock should increase or decrease.');
  }
  if (!input.reference.trim()) throw new Error('Reference is required.');
  if (!input.reason.trim()) throw new Error('Reason is required.');

  const { data, error } = await supabase.functions.invoke('inventory-operation', {
    body: {
      tenantId: input.tenantId,
      branchId: input.branchId,
      productId: input.productId,
      uomId: input.uomId,
      operation: input.operation,
      quantity: input.quantity,
      adjustmentDirection: input.operation === 'adjust' ? input.adjustmentDirection : null,
      reference: input.reference.trim(),
      reason: input.reason.trim(),
    },
  });

  if (error) {
    throw new Error(await functionErrorMessage(error, 'Unable to post this stock movement.'));
  }
  if (!isInventoryOperationResult(data)) {
    throw new Error('SellerTray returned an invalid stock result.');
  }
  return data;
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

function isInventoryOperationResult(value: unknown): value is InventoryOperationResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.movementId === 'string'
    && (row.operation === 'receive' || row.operation === 'adjust')
    && typeof row.productId === 'string'
    && typeof row.productName === 'string'
    && typeof row.sourceUom === 'string'
    && typeof row.sourceQuantity === 'number'
    && typeof row.conversionFactor === 'number'
    && typeof row.stockUom === 'string'
    && typeof row.quantityDelta === 'number'
    && typeof row.quantityOnHand === 'number'
    && typeof row.reference === 'string'
    && typeof row.idempotentReplay === 'boolean';
}

function toNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}