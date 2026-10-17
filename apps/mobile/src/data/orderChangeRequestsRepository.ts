import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';

export type CustomerOrderChangeRequest = {
  id: string;
  orderId: string | null;
  requestKind: 'add_items' | 'remove_items' | 'change_items' | 'cancel_order' | 'other';
  requestText: string;
  parsedItems: Array<{
    catalogItemId: string | null;
    itemName: string;
    originalItemName: string | null;
    quantity: number;
    unitPrice: number | null;
    matchSource: string;
    matchConfidence: number | null;
  }>;
  status: 'pending' | 'reviewed' | 'resolved' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
};

type Row = {
  id: string;
  order_id: string | null;
  request_kind: CustomerOrderChangeRequest['requestKind'];
  request_text: string;
  parsed_items: unknown;
  status: CustomerOrderChangeRequest['status'];
  created_at: string;
  resolved_at: string | null;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseItems(value: unknown): CustomerOrderChangeRequest['parsedItems'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const itemName = typeof row.item_name === 'string' ? row.item_name : '';
    const quantity = toNumber(row.quantity);
    if (!itemName || quantity === null) return [];

    return [{
      catalogItemId: typeof row.catalog_item_id === 'string' ? row.catalog_item_id : null,
      itemName,
      originalItemName: typeof row.original_item_name === 'string' ? row.original_item_name : null,
      quantity,
      unitPrice: toNumber(row.unit_price),
      matchSource: typeof row.match_source === 'string' ? row.match_source : 'unmatched',
      matchConfidence: toNumber(row.match_confidence),
    }];
  });
}

export async function loadCustomerOrderChangeRequests(
  tenantId: string,
): Promise<CustomerOrderChangeRequest[]> {
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from('customer_order_change_requests')
    .select('id,order_id,request_kind,request_text,parsed_items,status,created_at,resolved_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    orderId: row.order_id,
    requestKind: row.request_kind,
    requestText: row.request_text,
    parsedItems: parseItems(row.parsed_items),
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }));
}

export async function runCustomerOrderChangeRequestAction(
  requestId: string,
  action: 'apply' | 'resolve' | 'reject',
): Promise<void> {
  const { error } = await supabase.functions.invoke('order-change-request', {
    body: { requestId, action },
  });

  if (!error) return;

  let message = error.message || 'Unable to update customer request.';
  if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
    try {
      const payload = await (error.context as Response).clone().json() as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // Keep SDK message.
    }
  }
  throw new Error(message);
}

export function subscribeToCustomerOrderChangeRequests(
  tenantId: string,
  onChange: () => void,
): RealtimeChannel {
  return supabase
    .channel(`customer-order-changes-${tenantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'customer_order_change_requests', filter: `tenant_id=eq.${tenantId}` },
      onChange,
    )
    .subscribe();
}

export async function unsubscribeFromCustomerOrderChangeRequests(channel: RealtimeChannel): Promise<void> {
  await supabase.removeChannel(channel);
}
