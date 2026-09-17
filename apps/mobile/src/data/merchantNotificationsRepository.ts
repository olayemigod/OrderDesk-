import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';

type OperationalEventKey =
  | 'new_whatsapp_order'
  | 'order_change_request'
  | 'new_whatsapp_message'
  | 'payment_verification_required'
  | 'payment_confirmed'
  | 'payment_failed'
  | 'payment_exception'
  | 'payment_gate_blocked'
  | 'customer_complaint'
  | 'refund_request'
  | 'catalogue_enquiry'
  | 'customer_enquiry'
  | 'workflow_clarification';

export type PlatformMerchantEventKey =
  | 'platform_update'
  | 'platform_service'
  | 'platform_information'
  | 'platform_promotion';

export type MerchantNotification = {
  id: string;
  // Keep the operational key compatible with the existing notification-centre UI.
  // Platform messages expose their exact category separately through platformEventKey/messageType.
  eventKey: OperationalEventKey;
  platformEventKey: PlatformMerchantEventKey | null;
  severity: 'info' | 'attention' | 'urgent';
  title: string;
  body: string;
  orderId: string | null;
  changeRequestId: string | null;
  sourceInboundMessageId: string | null;
  messageType: 'operational' | 'update' | 'service' | 'information' | 'promotion';
  actionLabel: string | null;
  actionUrl: string | null;
  campaignId: string | null;
  isRead: boolean;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  event_key: OperationalEventKey | PlatformMerchantEventKey;
  severity: MerchantNotification['severity'];
  title: string;
  body: string;
  order_id: string | null;
  change_request_id: string | null;
  source_inbound_message_id: string | null;
  message_type?: MerchantNotification['messageType'];
  action_label?: string | null;
  action_url?: string | null;
  campaign_id?: string | null;
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

  return ((data ?? []) as NotificationRow[]).map((row) => {
    const platformEventKey = isPlatformEventKey(row.event_key) ? row.event_key : null;
    return {
      id: row.id,
      eventKey: platformEventKey ? 'workflow_clarification' : row.event_key as OperationalEventKey,
      platformEventKey,
      severity: row.severity,
      title: row.title,
      body: row.body,
      orderId: row.order_id,
      changeRequestId: row.change_request_id,
      sourceInboundMessageId: row.source_inbound_message_id,
      messageType: row.message_type ?? 'operational',
      actionLabel: row.action_label ?? null,
      actionUrl: row.action_url ?? null,
      campaignId: row.campaign_id ?? null,
      isRead: row.is_read,
      createdAt: row.created_at,
    };
  });
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

function isPlatformEventKey(value: string): value is PlatformMerchantEventKey {
  return ['platform_update', 'platform_service', 'platform_information', 'platform_promotion'].includes(value);
}
