import { supabase } from '../lib/supabase';

export type OrderItemCatalogueCandidate = {
  id: string;
  orderItemId: string;
  customerWording: string;
  status: 'pending' | 'matched_existing' | 'created_product' | 'one_off' | 'dismissed';
  resolutionCatalogItemId: string | null;
  learnedAlias: string | null;
  createdAt: string;
};

export async function loadOrderItemCatalogueCandidates(
  tenantId: string,
  orderId: string,
): Promise<OrderItemCatalogueCandidate[]> {
  const { data, error } = await supabase.rpc('sellertray_list_order_item_catalogue_candidates', {
    p_tenant_id: tenantId,
    p_order_id: orderId,
  });

  if (error) throw error;
  if (!Array.isArray(data)) return [];

  return data.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (
      typeof row.id !== 'string' ||
      typeof row.order_item_id !== 'string' ||
      typeof row.customer_wording !== 'string' ||
      !['pending','matched_existing','created_product','one_off','dismissed'].includes(String(row.status))
    ) return [];

    return [{
      id: row.id,
      orderItemId: row.order_item_id,
      customerWording: row.customer_wording,
      status: row.status as OrderItemCatalogueCandidate['status'],
      resolutionCatalogItemId: stringOrNull(row.resolution_catalog_item_id),
      learnedAlias: stringOrNull(row.learned_alias),
      createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    }];
  });
}

export async function matchOrderItemToCatalogue(input: {
  tenantId: string;
  orderItemId: string;
  catalogItemId: string;
  learnAlias: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('sellertray_match_order_item_to_catalogue', {
    p_tenant_id: input.tenantId,
    p_order_item_id: input.orderItemId,
    p_catalog_item_id: input.catalogItemId,
    p_learn_alias: input.learnAlias,
  });
  if (error) throw error;
}

export async function createCatalogueFromOrderItem(input: {
  tenantId: string;
  orderItemId: string;
  name: string;
  price: number;
  sku?: string | null;
  category?: string | null;
  learnAlias: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('sellertray_create_catalogue_from_order_item', {
    p_tenant_id: input.tenantId,
    p_order_item_id: input.orderItemId,
    p_name: input.name.trim(),
    p_price: input.price,
    p_sku: input.sku?.trim() || null,
    p_category: input.category?.trim() || null,
    p_learn_alias: input.learnAlias,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('SellerTray did not return the new catalogue item.');
  return data;
}

export async function keepOrderItemOneOff(input: {
  tenantId: string;
  orderItemId: string;
  price: number;
  name?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('sellertray_keep_order_item_one_off', {
    p_tenant_id: input.tenantId,
    p_order_item_id: input.orderItemId,
    p_price: input.price,
    p_name: input.name?.trim() || null,
  });
  if (error) throw error;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
