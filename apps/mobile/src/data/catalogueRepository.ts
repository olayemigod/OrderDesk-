import { supabase } from '../lib/supabase';

export type CatalogueItem = {
  id: string;
  tenantId: string;
  name: string;
  sku: string | null;
  category: string | null;
  imageUrl: string | null;
  price: number | null;
  isActive: boolean;
  aliases: string[];
  whatsappCatalogId: string | null;
  whatsappProductRetailerId: string | null;
  whatsappMappingSource: 'manual' | 'meta_import' | null;
};

export type CatalogueItemInput = {
  name: string;
  sku: string | null;
  category: string | null;
  imageUrl: string | null;
  price: number;
  aliases: string[];
};

type CatalogueRow = {
  id: string;
  tenant_id: string;
  name: string;
  sku: string | null;
  category: string | null;
  image_url: string | null;
  price_ngn: number | string | null;
  is_active: boolean;
  catalog_item_aliases: Array<{ alias: string }> | null;
  whatsapp_catalog_id: string | null;
  whatsapp_product_retailer_id: string | null;
  whatsapp_mapping_source: 'manual' | 'meta_import' | null;
};

export async function loadCatalogue(tenantId: string): Promise<CatalogueItem[]> {
  const { data, error } = await supabase
    .from('catalog_items')
    .select(`
      id,
      tenant_id,
      name,
      sku,
      category,
      image_url,
      price_ngn,
      is_active,
      whatsapp_catalog_id,
      whatsapp_product_retailer_id,
      whatsapp_mapping_source,
      catalog_item_aliases(alias)
    `)
    .eq('tenant_id', tenantId)
    .order('is_active', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw error;

  return ((data ?? []) as unknown as CatalogueRow[]).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    imageUrl: row.image_url,
    price: toNumber(row.price_ngn),
    isActive: row.is_active,
    aliases: (row.catalog_item_aliases ?? [])
      .map((entry) => entry.alias)
      .sort((left, right) => left.localeCompare(right)),
    whatsappCatalogId: row.whatsapp_catalog_id,
    whatsappProductRetailerId: row.whatsapp_product_retailer_id,
    whatsappMappingSource: row.whatsapp_mapping_source,
  }));
}

export async function createCatalogueItem(
  tenantId: string,
  input: CatalogueItemInput,
): Promise<string> {
  const clean = validateInput(input);
  const { data, error } = await supabase.rpc('save_sellertray_catalogue_item', {
    p_tenant_id: tenantId,
    p_product_id: null,
    p_name: clean.name,
    p_sku: clean.sku,
    p_category: clean.category,
    p_image_url: clean.imageUrl,
    p_selling_price: clean.price,
    p_aliases: clean.aliases,
  });

  if (error) throw error;
  if (typeof data !== 'string' || !data) {
    throw new Error('SellerTray could not create the catalogue item.');
  }
  return data;
}

export async function updateCatalogueItem(
  itemId: string,
  tenantId: string,
  input: CatalogueItemInput,
): Promise<void> {
  const clean = validateInput(input);
  const { data, error } = await supabase.rpc('save_sellertray_catalogue_item', {
    p_tenant_id: tenantId,
    p_product_id: itemId,
    p_name: clean.name,
    p_sku: clean.sku,
    p_category: clean.category,
    p_image_url: clean.imageUrl,
    p_selling_price: clean.price,
    p_aliases: clean.aliases,
  });

  if (error) throw error;
  if (typeof data !== 'string' || data !== itemId) {
    throw new Error('SellerTray could not confirm the catalogue item update.');
  }
}

export async function uploadCatalogueImage(
  tenantId: string,
  uri: string,
  mimeType = 'image/jpeg',
): Promise<string> {
  const safeMime = ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ? mimeType : 'image/jpeg';
  const extension = safeMime === 'image/png' ? 'png' : safeMime === 'image/webp' ? 'webp' : 'jpg';
  const response = await fetch(uri);
  if (!response.ok) throw new Error('SellerTray could not read the selected image.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error('The selected product image is empty.');
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('Choose a product image smaller than 5 MB.');

  const objectPath = `${tenantId}/${Date.now()}-${makeUploadToken()}.${extension}`;
  const { error } = await supabase.storage
    .from('catalogue-images')
    .upload(objectPath, bytes, {
      contentType: safeMime,
      cacheControl: '3600',
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage.from('catalogue-images').getPublicUrl(objectPath);
  if (!data.publicUrl) throw new Error('SellerTray could not create the product image URL.');
  return data.publicUrl;
}

export async function setCatalogueItemActive(
  itemId: string,
  tenantId: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_sellertray_product_active', {
    p_tenant_id: tenantId,
    p_product_id: itemId,
    p_is_active: isActive,
  });

  if (error) throw error;
}

function validateInput(input: CatalogueItemInput): CatalogueItemInput {
  const name = input.name.trim();
  if (!name) throw new Error('Product name is required.');
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new Error('Enter a valid selling price.');
  }

  const aliases = Array.from(
    new Map(
      input.aliases
        .map((alias) => alias.trim())
        .filter(Boolean)
        .map((alias) => [alias.toLocaleLowerCase(), alias] as const),
    ).values(),
  );

  return {
    name,
    sku: cleanOptional(input.sku),
    category: cleanOptional(input.category),
    imageUrl: cleanOptional(input.imageUrl),
    price: input.price,
    aliases,
  };
}

function makeUploadToken(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function cleanOptional(value: string | null): string | null {
  const clean = value?.trim() ?? '';
  return clean || null;
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
