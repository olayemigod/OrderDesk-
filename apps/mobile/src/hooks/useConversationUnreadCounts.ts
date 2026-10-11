import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  loadConversationUnreadCounts,
  markConversationRead,
  subscribeToConversationActivity,
  unsubscribeFromConversationActivity,
  type ConversationUnreadState,
} from '../data/conversationUnreadRepository';

export function useConversationUnreadCounts(tenantId: string | null, branchId?: string | null) {
  const [rows, setRows] = useState<ConversationUnreadState[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setRows([]);
      setError(null);
      return;
    }

    try {
      setRows(await loadConversationUnreadCounts(tenantId, branchId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load conversation unread counts.');
    }
  }, [tenantId, branchId]);

  useEffect(() => {
    void refresh();
    if (!tenantId) return undefined;

    const channel = subscribeToConversationActivity(tenantId, () => {
      void refresh();
    }, branchId);

    return () => {
      void unsubscribeFromConversationActivity(channel);
    };
  }, [refresh, tenantId, branchId]);

  const unreadByCustomer = useMemo(
    () => new Map(rows.map((row) => [row.customerId, row])),
    [rows],
  );

  const unreadCount = useMemo(
    () => rows.reduce((sum, row) => sum + row.unreadCount, 0),
    [rows],
  );

  const markRead = useCallback(
    async (customerId: string, through: string | null) => {
      if (!tenantId || !customerId) return;
      await markConversationRead(tenantId, customerId, through, branchId);
      setRows((current) =>
        current.map((row) =>
          row.customerId === customerId
            ? { ...row, unreadCount: 0, latestReceivedAt: through ?? row.latestReceivedAt }
            : row,
        ),
      );
    },
    [tenantId, branchId],
  );

  return { rows, unreadByCustomer, unreadCount, error, refresh, markRead };
}
