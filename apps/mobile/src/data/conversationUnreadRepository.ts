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
): Promise<ConversationUnreadState[]> {
  if (!tenantId) return [];

  const { data, error } = await supabase.rpc('sellertray_conversation_unread_counts', {
    p_tenant_id: tenantId,
  });
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
): Promise<void> {
  const { error } = await supabase.rpc('sellertray_mark_conversation_read', {
    p_tenant_id: tenantId,
    p_customer_id: customerId,
    p_through: through ?? new Date().toISOString(),
  });
  if (error) throw error;
}

export function subscribeToConversationActivity(
  tenantId: string,
  onChange: () => void,
): RealtimeChannel {
  return supabase
    .channel(`merchant-conversation-unread-${tenantId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'conversation_activity_events',
        filter: `tenant_id=eq.${tenantId}`,
      },
      onChange,
    )
    .subscribe();
}

export async function unsubscribeFromConversationActivity(channel: RealtimeChannel): Promise<void> {
  await supabase.removeChannel(channel);
}
