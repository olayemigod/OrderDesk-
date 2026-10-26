import { useCallback, useEffect, useRef, useState } from 'react';

import { AppState } from 'react-native';

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

  const scope = useRef(tenantId);
  const request = useRef(0);
  const [loadedTenant, setLoadedTenant] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (scope.current !== tenantId) return;
    const revision = ++request.current;
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
      if (scope.current !== tenantId || request.current !== revision) return;
      setLoadedTenant(tenantId);
      setNotifications(next.filter((notification) => !notification.isRead));
      setUnreadCount(count);
      setError(null);
    } catch (err) {
      if (scope.current !== tenantId || request.current !== revision) return;
      if (isLikelyConnectivityError(err)) {
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Unable to load notifications.');
      }
    } finally {
      if (scope.current === tenantId && request.current === revision) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    scope.current = tenantId;
    setNotifications([]);
    setUnreadCount(0);
    setError(null);
    void refresh();
    if (!tenantId) return undefined;

    const channel = subscribeToMerchantNotifications(tenantId, () => {
      void refresh();
    });

    const interval = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 60000);
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => {
      scope.current = null;
      request.current += 1;
      clearInterval(interval);
      appState.remove();
      void unsubscribeFromMerchantNotifications(channel);
    };
  }, [refresh, tenantId]);

  const markRead = useCallback(async (id: string) => {
    await markMerchantNotificationRead(id);
    await refresh();
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    if (!tenantId) return;
    await markAllMerchantNotificationsRead(tenantId);
    await refresh();
  }, [tenantId, refresh]);

  return {
    notifications: loadedTenant === tenantId ? notifications : [],
    unreadCount: loadedTenant === tenantId ? unreadCount : 0,
    loading, error, refresh, markRead, markAllRead,
  };
}
