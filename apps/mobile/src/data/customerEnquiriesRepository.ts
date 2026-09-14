import { supabase } from '../lib/supabase';

export type CustomerEnquiry = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  enquiryType: 'price' | 'availability' | 'product' | 'general';
  status: 'open' | 'replied' | 'converted' | 'dismissed';
  originalText: string;
  productQuery: string | null;
  matchedCatalogItemId: string | null;
  matchedItemName: string | null;
  quotedPrice: number | null;
  currency: string;
  responseText: string | null;
  convertedOrderId: string | null;
  createdAt: string;
};

export async function loadCustomerEnquiries(
  tenantId: string,
  status: CustomerEnquiry['status'] | null = null,
  limit = 100,
): Promise<CustomerEnquiry[]> {
  const { data, error } = await supabase.rpc('sellertray_list_customer_enquiries', {
    p_tenant_id: tenantId,
    p_status: status,
    p_limit: limit,
  });
  if (error) throw error;
  if (!Array.isArray(data)) return [];

  return data.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const enquiryType = row.enquiry_type;
    const enquiryStatus = row.status;
    if (
      typeof row.id !== 'string' ||
      typeof row.customer_id !== 'string' ||
      typeof row.customer_name !== 'string' ||
      typeof row.original_text !== 'string' ||
      !['price','availability','product','general'].includes(String(enquiryType)) ||
      !['open','replied','converted','dismissed'].includes(String(enquiryStatus))
    ) {
      return [];
    }

    return [{
      id: row.id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: stringOrNull(row.customer_phone),
      enquiryType: enquiryType as CustomerEnquiry['enquiryType'],
      status: enquiryStatus as CustomerEnquiry['status'],
      originalText: row.original_text,
      productQuery: stringOrNull(row.product_query),
      matchedCatalogItemId: stringOrNull(row.matched_catalog_item_id),
      matchedItemName: stringOrNull(row.matched_item_name),
      quotedPrice: numberOrNull(row.quoted_price),
      currency: typeof row.currency === 'string' && row.currency ? row.currency : 'NGN',
      responseText: stringOrNull(row.response_text),
      convertedOrderId: stringOrNull(row.converted_order_id),
      createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    }];
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
