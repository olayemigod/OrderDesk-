import { useCallback, useEffect, useState } from 'react';

import {
  loadMerchantNotifications,
  loadMerchantUnreadNotificationCount,
  markAllMerchantNotificationsRead,
  markMerchantNotificationRead,
  subscribeToMerchantNotifications,
  unsubscribeFromMerchantNotifications,
  type MerchantNotification,
} from '../data/merchantNotificationsRepository';
import { isLikelyConnectivityError } from '../data/offlineSalesRepository';

export function useMerchantNotifications(tenantId: string | null) {
  const [notifications, setNotifications] = useState<MerchantNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setNotifications([]);
      setUnreadCount(0);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const [next, count] = await Promise.all([
        loadMerchantNotifications(tenantId),
        loadMerchantUnreadNotificationCount(tenantId),
      ]);
      setNotifications(next.filter((notification) => !notification.isRead));
      setUnreadCount(count);
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

  const markRead = useCallback(async (id: string) => {
    await markMerchantNotificationRead(id);
    setNotifications((current) => current.filter((notification) => notification.id !== id));
    setUnreadCount((current) => Math.max(0, current - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!tenantId) return;
    await markAllMerchantNotificationsRead(tenantId);
    setNotifications([]);
    setUnreadCount(0);
  }, [tenantId]);

  return { notifications, unreadCount, loading, error, refresh, markRead, markAllRead };
}
