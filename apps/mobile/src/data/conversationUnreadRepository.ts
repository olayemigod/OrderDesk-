import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';

export type ConversationUnreadState = {
  customerId: string;
  unreadCount: number;
  latestReceivedAt: string | null;
};

type ConversationUnreadRow = {
  customer_id: string;
  unread_count: number | string;
  latest_received_at: string | null;
};

export async function loadConversationUnreadCounts(
  tenantId: string,
  branchId?: string | null,
): Promise<ConversationUnreadState[]> {
  if (!tenantId) return [];

  const args = branchId
    ? { p_tenant_id: tenantId, p_branch_id: branchId }
    : { p_tenant_id: tenantId };
  const { data, error } = await supabase.rpc('sellertray_conversation_unread_counts', args);
  if (error) throw error;

  return ((data ?? []) as ConversationUnreadRow[]).map((row) => ({
    customerId: row.customer_id,
    unreadCount: Number(row.unread_count) || 0,
    latestReceivedAt: row.latest_received_at,
  }));
}

export async function markConversationRead(
  tenantId: string,
  customerId: string,
  through: string | null,
  branchId?: string | null,
): Promise<void> {
  const args = branchId
    ? {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_customer_id: customerId,
        p_through: through ?? new Date().toISOString(),
      }
    : {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
        p_through: through ?? new Date().toISOString(),
      };
  const { error } = await supabase.rpc('sellertray_mark_conversation_read', args);
  if (error) throw error;
}

export function subscribeToConversationActivity(
  tenantId: string,
  onChange: () => void,
  branchId?: string | null,
): RealtimeChannel {
  const channelKey = branchId ? `${tenantId}-${branchId}` : tenantId;
  const filter = branchId ? `branch_id=eq.${branchId}` : `tenant_id=eq.${tenantId}`;
  return supabase
    .channel(`merchant-conversation-unread-${channelKey}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'inbound_messages', filter },
      onChange,
    )
    .subscribe();
}

export async function unsubscribeFromConversationActivity(channel: RealtimeChannel): Promise<void> {
  await supabase.removeChannel(channel);
}
