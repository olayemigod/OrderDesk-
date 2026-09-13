import { supabase } from '../lib/supabase';

export type NotificationSettings = {
  notifyReceived: boolean;
  notifyAccepted: boolean;
  notifyReady: boolean;
  notifyRejected: boolean;
  notifyCancelled: boolean;
};

type NotificationSettingsRow = {
  notify_received: boolean;
  notify_accepted: boolean;
  notify_ready: boolean;
  notify_rejected: boolean;
  notify_cancelled: boolean;
};

export async function loadNotificationSettings(tenantId: string): Promise<NotificationSettings> {
  const { data, error } = await supabase
    .from('tenant_notification_settings')
    .select('notify_received, notify_accepted, notify_ready, notify_rejected, notify_cancelled')
    .eq('tenant_id', tenantId)
    .single();

  if (error) throw error;
  const row = data as NotificationSettingsRow;

  return {
    notifyReceived: row.notify_received,
    notifyAccepted: row.notify_accepted,
    notifyReady: row.notify_ready,
    notifyRejected: row.notify_rejected,
    notifyCancelled: row.notify_cancelled,
  };
}

export async function updateNotificationSettings(
  tenantId: string,
  settings: NotificationSettings,
): Promise<void> {
  const { error } = await supabase
    .from('tenant_notification_settings')
    .update({
      notify_received: settings.notifyReceived,
      notify_accepted: settings.notifyAccepted,
      notify_ready: settings.notifyReady,
      notify_rejected: settings.notifyRejected,
      notify_cancelled: settings.notifyCancelled,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId);

  if (error) throw error;
}
