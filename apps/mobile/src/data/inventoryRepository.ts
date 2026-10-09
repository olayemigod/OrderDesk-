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
  canCountStock?: boolean;
  canApplyStockCount?: boolean;
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

export type StockCountStatus = 'counting' | 'review' | 'applied' | 'cancelled';

export type StockCountItem = {
  itemId: string;
  productId: string;
  productName: string;
  stockUom: string;
  captured: boolean;
  selectedUom: string | null;
  countedQuantity: number | null;
  conversionFactor: number | null;
  countedStockQuantity: number | null;
  expectedStockQuantity: number | null;
  varianceQuantity: number | null;
  capturedAt: string | null;
};

export type StockCountDetail = {
  countId: string;
  branchId: string;
  reference: string;
  reason: string;
  status: StockCountStatus;
  startedAt: string;
  submittedAt: string | null;
  appliedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  totalItems: number;
  capturedItems: number;
  items: StockCountItem[];
};

export type StockCountActionResult = {
  countId: string;
  status: StockCountStatus;
  idempotentReplay?: boolean;
  totalItems?: number;
  capturedItems?: number;
  varianceItems?: number;
  inventoryMovementCount?: number;
};

export type StartStockCountInput = {
  tenantId: string;
  branchId: string;
  reference: string;
  reason: string;
};

export type CaptureStockCountInput = {
  tenantId: string;
  countId: string;
  productId: string;
  uomId: string;
  quantity: number;
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
  can_count_stock: boolean;
  can_apply_stock_count: boolean;
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
    return {
      canReceiveStock: false,
      canAdjustStock: false,
      canCountStock: false,
      canApplyStockCount: false,
    };
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
    canCountStock: row?.can_count_stock === true,
    canApplyStockCount: row?.can_apply_stock_count === true,
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

export async function loadActiveStockCount(
  tenantId: string,
  branchId: string,
): Promise<StockCountDetail | null> {
  if (!tenantId || !branchId) return null;
  const { data, error } = await supabase.rpc('get_sellertray_active_stock_count', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });
  if (error) throw error;
  if (data === null) return null;
  return parseStockCountDetail(data);
}

export async function loadStockCount(
  tenantId: string,
  countId: string,
): Promise<StockCountDetail | null> {
  if (!tenantId || !countId) return null;
  const { data, error } = await supabase.rpc('get_sellertray_stock_count', {
    p_tenant_id: tenantId,
    p_stock_count_id: countId,
  });
  if (error) throw error;
  if (data === null) return null;
  return parseStockCountDetail(data);
}

export async function startStockCount(
  input: StartStockCountInput,
): Promise<StockCountActionResult> {
  if (!input.tenantId || !input.branchId) throw new Error('Business and branch are required.');
  if (!input.reference.trim()) throw new Error('Reference is required.');
  if (!input.reason.trim()) throw new Error('Reason is required.');
  return invokeStockCount({
    action: 'start',
    tenantId: input.tenantId,
    branchId: input.branchId,
    reference: input.reference.trim(),
    reason: input.reason.trim(),
  }, 'Unable to start this stock count.');
}

export async function captureStockCountItem(
  input: CaptureStockCountInput,
): Promise<StockCountActionResult> {
  if (!input.tenantId || !input.countId || !input.productId || !input.uomId) {
    throw new Error('Stock count, product and unit are required.');
  }
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new Error('Counted quantity cannot be negative.');
  }
  return invokeStockCount({
    action: 'capture',
    tenantId: input.tenantId,
    countId: input.countId,
    productId: input.productId,
    uomId: input.uomId,
    quantity: input.quantity,
  }, 'Unable to save this counted quantity.');
}

export async function submitStockCount(
  tenantId: string,
  countId: string,
): Promise<StockCountActionResult> {
  return invokeStockCount(
    { action: 'submit', tenantId, countId },
    'Unable to submit this stock count for review.',
  );
}

export async function applyStockCount(
  tenantId: string,
  countId: string,
): Promise<StockCountActionResult> {
  return invokeStockCount(
    { action: 'apply', tenantId, countId },
    'Unable to apply this stock count.',
  );
}

export async function cancelStockCount(
  tenantId: string,
  countId: string,
  reason: string,
): Promise<StockCountActionResult> {
  if (!reason.trim()) throw new Error('Cancellation reason is required.');
  return invokeStockCount(
    { action: 'cancel', tenantId, countId, reason: reason.trim() },
    'Unable to cancel this stock count.',
  );
}

async function invokeStockCount(
  body: Record<string, unknown>,
  fallback: string,
): Promise<StockCountActionResult> {
  const { data, error } = await supabase.functions.invoke('stock-count', { body });
  if (error) throw new Error(await functionErrorMessage(error, fallback));
  if (!isStockCountActionResult(data)) {
    throw new Error('SellerTray returned an invalid stock count result.');
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

function isStockCountActionResult(value: unknown): value is StockCountActionResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.countId === 'string'
    && (row.status === 'counting' || row.status === 'review'
      || row.status === 'applied' || row.status === 'cancelled');
}

function parseStockCountDetail(value: unknown): StockCountDetail {
  if (!value || typeof value !== 'object') {
    throw new Error('SellerTray returned an invalid stock count.');
  }
  const row = value as Record<string, unknown>;
  if (typeof row.countId !== 'string'
      || typeof row.branchId !== 'string'
      || typeof row.reference !== 'string'
      || typeof row.reason !== 'string'
      || (row.status !== 'counting' && row.status !== 'review'
        && row.status !== 'applied' && row.status !== 'cancelled')
      || typeof row.startedAt !== 'string'
      || !Array.isArray(row.items)) {
    throw new Error('SellerTray returned an invalid stock count.');
  }

  const items = row.items.map((raw) => parseStockCountItem(raw));
  return {
    countId: row.countId,
    branchId: row.branchId,
    reference: row.reference,
    reason: row.reason,
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: typeof row.submittedAt === 'string' ? row.submittedAt : null,
    appliedAt: typeof row.appliedAt === 'string' ? row.appliedAt : null,
    cancelledAt: typeof row.cancelledAt === 'string' ? row.cancelledAt : null,
    cancelReason: typeof row.cancelReason === 'string' ? row.cancelReason : null,
    totalItems: typeof row.totalItems === 'number' ? row.totalItems : items.length,
    capturedItems: typeof row.capturedItems === 'number'
      ? row.capturedItems
      : items.filter((item) => item.captured).length,
    items,
  };
}

function parseStockCountItem(value: unknown): StockCountItem {
  if (!value || typeof value !== 'object') {
    throw new Error('SellerTray returned an invalid stock count item.');
  }
  const row = value as Record<string, unknown>;
  if (typeof row.itemId !== 'string'
      || typeof row.productId !== 'string'
      || typeof row.productName !== 'string'
      || typeof row.stockUom !== 'string'
      || typeof row.captured !== 'boolean') {
    throw new Error('SellerTray returned an invalid stock count item.');
  }

  return {
    itemId: row.itemId,
    productId: row.productId,
    productName: row.productName,
    stockUom: row.stockUom,
    captured: row.captured,
    selectedUom: typeof row.selectedUom === 'string' ? row.selectedUom : null,
    countedQuantity: toNullableNumber(row.countedQuantity),
    conversionFactor: toNullableNumber(row.conversionFactor),
    countedStockQuantity: toNullableNumber(row.countedStockQuantity),
    expectedStockQuantity: toNullableNumber(row.expectedStockQuantity),
    varianceQuantity: toNullableNumber(row.varianceQuantity),
    capturedAt: typeof row.capturedAt === 'string' ? row.capturedAt : null,
  };
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}