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


export async function convertCustomerEnquiryToOrder(
  tenantId: string,
  enquiryId: string,
  quantity: number,
): Promise<{ orderId: string; publicOrderId: string | null }> {
  const data = await invokeEnquiryAction({
    tenantId,
    enquiryId,
    action: 'convert_to_order',
    quantity,
  });
  const orderId = typeof data.orderId === 'string' ? data.orderId : null;
  if (!orderId) throw new Error('SellerTray did not return the created order.');
  return {
    orderId,
    publicOrderId: typeof data.publicOrderId === 'string' ? data.publicOrderId : null,
  };
}

export async function replyToCustomerEnquiry(
  tenantId: string,
  enquiryId: string,
  message: string,
): Promise<void> {
  await invokeEnquiryAction({ tenantId, enquiryId, action: 'reply', message });
}

export async function dismissCustomerEnquiry(
  tenantId: string,
  enquiryId: string,
): Promise<void> {
  await invokeEnquiryAction({ tenantId, enquiryId, action: 'dismiss' });
}

async function invokeEnquiryAction(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('merchant-enquiry-action', { body });
  if (error) {
    let message = error.message || 'Unable to complete enquiry action.';
    if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
      try {
        const payload = await (error.context as Response).clone().json() as { error?: string };
        if (payload?.error) message = payload.error;
      } catch {
        // Keep the SDK message.
      }
    }
    throw new Error(message);
  }
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
