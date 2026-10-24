import { supabase } from '../lib/supabase';

export type LowStockRow = {
  catalogItemId: string;
  itemName: string;
  sku: string | null;
  category: string | null;
  stockUom: string;
  quantityOnHand: number;
  lowStockThreshold: number;
  reorderTarget: number | null;
  suggestedReorderQuantity: number | null;
  isOutOfStock: boolean;
};

type LowStockRpcRow = {
  catalog_item_id: string;
  item_name: string;
  sku: string | null;
  category: string | null;
  stock_uom: string;
  quantity_on_hand: number | string;
  low_stock_threshold: number | string;
  reorder_target: number | string | null;
  suggested_reorder_quantity: number | string | null;
  is_out_of_stock: boolean;
};

export async function loadLowStock(
  tenantId: string,
  branchId: string,
): Promise<LowStockRow[]> {
  if (!tenantId || !branchId) return [];

  const { data, error } = await supabase.rpc('get_sellertray_low_stock', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });
  if (error) throw error;

  return ((data ?? []) as LowStockRpcRow[]).map((row) => ({
    catalogItemId: row.catalog_item_id,
    itemName: row.item_name,
    sku: row.sku,
    category: row.category,
    stockUom: row.stock_uom,
    quantityOnHand: toNumber(row.quantity_on_hand),
    lowStockThreshold: toNumber(row.low_stock_threshold),
    reorderTarget: toNullableNumber(row.reorder_target),
    suggestedReorderQuantity: toNullableNumber(row.suggested_reorder_quantity),
    isOutOfStock: row.is_out_of_stock === true,
  }));
}

function toNullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}