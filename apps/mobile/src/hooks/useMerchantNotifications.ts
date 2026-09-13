import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  loadMerchantNotifications,
  markAllMerchantNotificationsRead,
  markMerchantNotificationRead,
  subscribeToMerchantNotifications,
  unsubscribeFromMerchantNotifications,
  type MerchantNotification,
} from '../data/merchantNotificationsRepository';

export function useMerchantNotifications(tenantId: string | null) {
  const [notifications, setNotifications] = useState<MerchantNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setNotifications([]);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      setNotifications(await loadMerchantNotifications(tenantId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load notifications.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
    if (!tenantId) return undefined;

    const channel = subscribeToMerchantNotifications(tenantId, () => {
      void refresh();
    });

    return () => {
      void unsubscribeFromMerchantNotifications(channel);
    };
  }, [refresh, tenantId]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications],
  );

  const markRead = useCallback(async (id: string) => {
    await markMerchantNotificationRead(id);
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, isRead: true } : notification,
      ),
    );
  }, []);

  const markAllRead = useCallback(async () => {
    if (!tenantId) return;
    await markAllMerchantNotificationsRead(tenantId);
    setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
  }, [tenantId]);

  return { notifications, unreadCount, loading, error, refresh, markRead, markAllRead };
}
