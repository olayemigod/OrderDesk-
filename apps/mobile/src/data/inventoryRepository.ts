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

function toNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
