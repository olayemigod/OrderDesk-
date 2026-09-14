import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';

export type MerchantNotification = {
  id: string;
  eventKey: 'new_whatsapp_order' | 'order_change_request' | 'new_whatsapp_message' | 'payment_verification_required' | 'payment_confirmed' | 'payment_failed' | 'payment_exception' | 'payment_gate_blocked' | 'customer_complaint' | 'refund_request' | 'catalogue_enquiry' | 'workflow_clarification';
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

  const { data, error } = await supabase.rpc('sellertray_list_merchant_notifications', {
    p_tenant_id: tenantId,
    p_limit: limit,
  });

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
  const { error } = await supabase.rpc('sellertray_mark_merchant_notification_read', {
    p_notification_id: id,
  });

  if (error) throw error;
}

export async function markAllMerchantNotificationsRead(tenantId: string): Promise<void> {
  const { error } = await supabase.rpc('sellertray_mark_all_merchant_notifications_read', {
    p_tenant_id: tenantId,
  });

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
