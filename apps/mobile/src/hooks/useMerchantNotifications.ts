import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  loadMerchantNotifications,
  markAllMerchantNotificationsRead,
  markMerchantNotificationRead,
  subscribeToMerchantNotifications,
  unsubscribeFromMerchantNotifications,
  type MerchantNotification,
} from '../data/merchantNotificationsRepository';
import { isLikelyConnectivityError } from '../data/offlineSalesRepository';

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
      const next = await loadMerchantNotifications(tenantId);
      setNotifications(next.filter((notification) => !notification.isRead));
      setError(null);
    } catch (err) {
      if (isLikelyConnectivityError(err)) {
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Unable to load notifications.');
      }
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

  const unreadCount = useMemo(() => notifications.length, [notifications]);

  const markRead = useCallback(async (id: string) => {
    await markMerchantNotificationRead(id);
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!tenantId) return;
    await markAllMerchantNotificationsRead(tenantId);
    setNotifications([]);
  }, [tenantId]);

  return { notifications, unreadCount, loading, error, refresh, markRead, markAllRead };
}
