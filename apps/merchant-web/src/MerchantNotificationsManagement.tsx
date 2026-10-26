import { useEffect, useState } from 'react';

import { errorMessage, supabase } from './supabase';

type NotificationRow = {
  id: string;
  event_key: string;
  severity: 'info' | 'attention' | 'urgent';
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
};

export default function MerchantNotificationsManagement({
  tenantId,
  onUnreadChanged,
}: {
  tenantId: string;
  onUnreadChanged: () => void;
}) {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('sellertray_list_merchant_notifications', {
        p_tenant_id: tenantId,
        p_limit: 100,
      });
      if (rpcError) throw rpcError;
      setRows((data ?? []) as NotificationRow[]);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load SellerTray notifications.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`merchant-web-notifications-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_notifications', filter: `tenant_id=eq.${tenantId}` }, () => {
        void load();
        onUnreadChanged();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_notification_reads', filter: `tenant_id=eq.${tenantId}` }, () => {
        void load();
        onUnreadChanged();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // onUnreadChanged is intentionally read at event time; tenant changes own subscription identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function markRead(notificationId: string) {
    setBusyId(notificationId);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('sellertray_mark_merchant_notification_read', {
        p_notification_id: notificationId,
      });
      if (rpcError) throw rpcError;
      setRows((current) => current.map((row) => row.id === notificationId ? { ...row, is_read: true } : row));
      onUnreadChanged();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to mark this notification as read.'));
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    setBusyId('all');
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('sellertray_mark_all_merchant_notifications_read', {
        p_tenant_id: tenantId,
      });
      if (rpcError) throw rpcError;
      setRows((current) => current.map((row) => ({ ...row, is_read: true })));
      onUnreadChanged();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to mark all notifications as read.'));
    } finally {
      setBusyId(null);
    }
  }

  const unread = rows.filter((row) => !row.is_read).length;

  return <div className="page-stack notifications-page">
    <div className="section-heading">
      <div><p className="eyebrow">Shared lifecycle inbox</p><h2>Notifications</h2></div>
      <div className="notification-page-actions"><span>{unread ? `${unread} unread in this view` : 'All caught up'}</span><button className="secondary-button" disabled={!unread || busyId === 'all'} onClick={() => void markAllRead()}>{busyId === 'all' ? 'Updating' : 'Mark all read'}</button></div>
    </div>
    <p className="muted notification-page-note">Commercial, agreement, setup, activation and service-term notices come from the same governed SellerTray events used by Mobile. Operational Admin queues remain separate.</p>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    <article className="panel notification-list-panel">
      {loading && rows.length === 0 ? <div className="notification-empty"><strong>Loading notifications</strong><p>Reading the governed SellerTray inbox.</p></div> : null}
      {!loading && rows.length === 0 ? <div className="notification-empty"><strong>No notifications yet</strong><p>SellerTray lifecycle and operational notices will appear here when there is something relevant to this Business.</p></div> : null}
      {rows.map((row) => <div className={row.is_read ? 'notification-row read' : 'notification-row'} key={row.id}>
        <span className={`notification-severity ${row.severity}`} aria-hidden="true" />
        <div className="notification-copy"><div className="notification-title-line"><strong>{row.title}</strong>{!row.is_read ? <span className="notification-unread-label">Unread</span> : null}</div><p>{row.body}</p><small>{dateTime(row.created_at)} · {humanize(row.event_key)}</small></div>
        {!row.is_read ? <button className="text-button notification-read-button" disabled={busyId === row.id} onClick={() => void markRead(row.id)}>{busyId === row.id ? 'Updating' : 'Mark read'}</button> : null}
      </div>)}
    </article>
  </div>;
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
