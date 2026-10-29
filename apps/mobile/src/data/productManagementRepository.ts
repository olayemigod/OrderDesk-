import { supabase } from '../lib/supabase';
import { loadCommerceProducts, type CommerceProduct } from './commerceRepository';

export type MobileProductDraft = {
  name: string;
  sku: string | null;
  category: string | null;
  stockUom: string;
  allowFractionalStock: boolean;
  sellingPrice: number;
};

export type CatalogueMasterOption = {
  id: string;
  name: string;
};

export type CatalogueMasterData = {
  categories: CatalogueMasterOption[];
  uoms: CatalogueMasterOption[];
};

export async function loadManagedProducts(tenantId: string): Promise<CommerceProduct[]> {
  return loadCommerceProducts(tenantId, { includeInactive: true });
}

export async function loadCatalogueMasterData(tenantId: string): Promise<CatalogueMasterData> {
  const { data, error } = await supabase.rpc('get_sellertray_catalogue_master_data', {
    p_tenant_id: tenantId,
  });
  if (error) throw error;
  const root = object(data);
  return {
    categories: masterOptions(root.categories),
    uoms: masterOptions(root.uoms),
  };
}

export async function createProductCategory(tenantId: string, name: string): Promise<string> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Category name is required.');
  const { data, error } = await supabase.rpc('create_sellertray_product_category', {
    p_tenant_id: tenantId,
    p_name: cleanName,
  });
  if (error) throw error;
  if (typeof data !== 'string' || !data) throw new Error('SellerTray did not return the category reference.');
  return data;
}

export async function createBusinessUom(tenantId: string, name: string): Promise<string> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Unit name is required.');
  const { data, error } = await supabase.rpc('create_sellertray_business_uom', {
    p_tenant_id: tenantId,
    p_name: cleanName,
  });
  if (error) throw error;
  if (typeof data !== 'string' || !data) throw new Error('SellerTray did not return the unit reference.');
  return data;
}

export async function saveManagedProduct(
  tenantId: string,
  productId: string | null,
  input: MobileProductDraft,
): Promise<string> {
  const clean = validateProduct(input);
  const { data, error } = await supabase.rpc('save_sellertray_product', {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_name: clean.name,
    p_sku: clean.sku,
    p_category: clean.category,
    p_stock_uom: clean.stockUom,
    p_allow_fractional_stock: clean.allowFractionalStock,
    p_selling_price: clean.sellingPrice,
  });
  if (error) throw error;
  const savedId = typeof data === 'string' ? data : productId;
  if (!savedId) throw new Error('SellerTray did not return the product reference.');
  return savedId;
}

export async function setManagedProductActive(tenantId: string, productId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_sellertray_product_active', {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_is_active: isActive,
  });
  if (error) throw error;
}

export async function assignStockUomBarcode(
  tenantId: string,
  product: CommerceProduct,
  barcode: string,
): Promise<void> {
  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) throw new Error('Barcode is required.');
  const stockUom = product.uoms.find((uom) => uom.isStockUom)
    ?? product.uoms.find((uom) => uom.name.trim().toLowerCase() === product.stockUom.trim().toLowerCase());
  if (!stockUom) throw new Error('The Stock UOM is not available for barcode assignment.');

  const { error } = await supabase.rpc('save_sellertray_product_uom', {
    p_tenant_id: tenantId,
    p_product_id: product.id,
    p_uom_id: stockUom.id,
    p_uom_name: stockUom.name,
    p_conversion_factor: stockUom.conversionFactor,
    p_selling_price: stockUom.sellingPrice,
    p_barcode: cleanBarcode,
    p_allow_fractional: stockUom.allowFractional,
    p_is_default_selling: stockUom.isDefaultSelling,
    p_is_default_purchase: stockUom.isDefaultPurchase,
  });
  if (error) throw error;
}

function validateProduct(input: MobileProductDraft): MobileProductDraft {
  const name = input.name.trim();
  const stockUom = input.stockUom.trim();
  if (!name) throw new Error('Product name is required.');
  if (!stockUom) throw new Error('Stock unit is required.');
  if (!Number.isFinite(input.sellingPrice) || input.sellingPrice < 0) throw new Error('Enter a valid selling price.');
  return {
    name,
    sku: cleanOptional(input.sku),
    category: cleanOptional(input.category),
    stockUom,
    allowFractionalStock: input.allowFractionalStock,
    sellingPrice: input.sellingPrice,
  };
}

function masterOptions(value: unknown): CatalogueMasterOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => object(entry))
    .map((entry) => ({ id: String(entry.id ?? ''), name: String(entry.name ?? '').trim() }))
    .filter((entry) => entry.id && entry.name);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanOptional(value: string | null): string | null {
  const clean = value?.trim() ?? '';
  return clean || null;
}
