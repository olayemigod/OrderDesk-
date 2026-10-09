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
  }> | null;
};

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

export async function loadCommerceProducts(tenantId: string): Promise<CommerceProduct[]> {
  if (!tenantId) return [];

  const { data, error } = await supabase
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
        is_default_selling
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('name', { ascending: true });

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
      }))
      .sort((left, right) => {
        if (left.isDefaultSelling !== right.isDefaultSelling) return left.isDefaultSelling ? -1 : 1;
        if (left.conversionFactor !== right.conversionFactor) return left.conversionFactor - right.conversionFactor;
        return left.name.localeCompare(right.name);
      }),
  }));
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
