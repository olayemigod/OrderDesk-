import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';

export type MerchantNotification = {
  id: string;
  eventKey: 'new_whatsapp_order' | 'order_change_request';
  severity: 'info' | 'attention' | 'urgent';
  title: string;
  body: string;
  orderId: string | null;
  changeRequestId: string | null;
  sourceInboundMessageId: string | null;
  isRead: boolean;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  event_key: MerchantNotification['eventKey'];
  severity: MerchantNotification['severity'];
  title: string;
  body: string;
  order_id: string | null;
  change_request_id: string | null;
  source_inbound_message_id: string | null;
  is_read: boolean;
  created_at: string;
};

export async function loadMerchantNotifications(
  tenantId: string,
  limit = 50,
): Promise<MerchantNotification[]> {
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from('merchant_notifications')
    .select('id,event_key,severity,title,body,order_id,change_request_id,source_inbound_message_id,is_read,created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as NotificationRow[]).map((row) => ({
    id: row.id,
    eventKey: row.event_key,
    severity: row.severity,
    title: row.title,
    body: row.body,
    orderId: row.order_id,
    changeRequestId: row.change_request_id,
    sourceInboundMessageId: row.source_inbound_message_id,
    isRead: row.is_read,
    createdAt: row.created_at,
  }));
}

export async function markMerchantNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('merchant_notifications')
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

export async function markAllMerchantNotificationsRead(tenantId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('merchant_notifications')
    .update({ is_read: true, read_at: now, updated_at: now })
    .eq('tenant_id', tenantId)
    .eq('is_read', false);

  if (error) throw error;
}

export function subscribeToMerchantNotifications(
  tenantId: string,
  onChange: () => void,
): RealtimeChannel {
  return supabase
    .channel(`merchant-notifications-${tenantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'merchant_notifications', filter: `tenant_id=eq.${tenantId}` },
      onChange,
    )
    .subscribe();
}

export async function unsubscribeFromMerchantNotifications(channel: RealtimeChannel): Promise<void> {
  await supabase.removeChannel(channel);
}
