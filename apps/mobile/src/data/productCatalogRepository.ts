import { supabase } from '../lib/supabase';

export type ProductCapabilities = {
  canManageProducts: boolean;
};

export type ProductBarcodeMatch = {
  productId: string;
  uomId: string;
  productName: string;
  sku: string | null;
  category: string | null;
  stockUom: string;
  uomName: string;
  conversionFactor: number;
  sellingPrice: number | null;
  allowFractional: boolean;
  itemActive: boolean;
};

export type QuickProductInput = {
  tenantId: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  stockUom: string;
  sellingPrice: number;
  barcode: string;
  allowFractionalStock?: boolean;
};

export type QuickProductResult = {
  productId: string;
  uomId: string;
  barcode: string;
};

export async function loadProductCapabilities(tenantId: string): Promise<ProductCapabilities> {
  const { data, error } = await supabase.rpc('get_sellertray_product_capabilities', {
    p_tenant_id: tenantId,
  });
  if (error) throw error;
  const row = isRecord(data) ? data : {};
  return { canManageProducts: row.canManageProducts === true };
}

export async function resolveProductBarcode(
  tenantId: string,
  barcode: string,
): Promise<ProductBarcodeMatch | null> {
  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) return null;
  const { data, error } = await supabase.rpc('resolve_sellertray_product_barcode', {
    p_tenant_id: tenantId,
    p_barcode: cleanBarcode,
  });
  if (error) throw error;
  const first = Array.isArray(data) ? data[0] : null;
  if (!isRecord(first)) return null;
  return {
    productId: text(first.product_id),
    uomId: text(first.uom_id),
    productName: text(first.product_name, 'Product'),
    sku: nullableText(first.sku),
    category: nullableText(first.category),
    stockUom: text(first.stock_uom, 'Each'),
    uomName: text(first.uom_name, 'Each'),
    conversionFactor: numberValue(first.conversion_factor, 1),
    sellingPrice: first.selling_price === null || first.selling_price === undefined
      ? null
      : numberValue(first.selling_price, 0),
    allowFractional: first.allow_fractional === true,
    itemActive: first.item_active === true,
  };
}

export async function createProductFromBarcode(input: QuickProductInput): Promise<QuickProductResult> {
  const { data, error } = await supabase.rpc('create_sellertray_product_from_barcode', {
    p_tenant_id: input.tenantId,
    p_name: input.name.trim(),
    p_sku: cleanOptional(input.sku),
    p_category: cleanOptional(input.category),
    p_stock_uom: input.stockUom.trim(),
    p_selling_price: input.sellingPrice,
    p_barcode: input.barcode.trim(),
    p_allow_fractional_stock: input.allowFractionalStock === true,
  });
  if (error) throw error;
  if (!isRecord(data)) throw new Error('SellerTray did not return the new product.');
  const productId = text(data.productId);
  const uomId = text(data.uomId);
  if (!productId || !uomId) throw new Error('SellerTray did not return the new product identity.');
  return { productId, uomId, barcode: text(data.barcode, input.barcode.trim()) };
}

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = value?.trim() ?? '';
  return cleaned || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableText(value: unknown): string | null {
  const valueText = text(value).trim();
  return valueText || null;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
