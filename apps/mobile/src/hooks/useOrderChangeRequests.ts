import { useCallback, useEffect, useState } from 'react';

import {
  loadCustomerOrderChangeRequests,
  runCustomerOrderChangeRequestAction,
  subscribeToCustomerOrderChangeRequests,
  unsubscribeFromCustomerOrderChangeRequests,
  type CustomerOrderChangeRequest,
} from '../data/orderChangeRequestsRepository';

export function useOrderChangeRequests(tenantId: string | null) {
  const [requests, setRequests] = useState<CustomerOrderChangeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setRequests([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      setRequests(await loadCustomerOrderChangeRequests(tenantId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customer requests.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
    if (!tenantId) return undefined;

    const channel = subscribeToCustomerOrderChangeRequests(tenantId, () => {
      void refresh();
    });
    return () => {
      void unsubscribeFromCustomerOrderChangeRequests(channel);
    };
  }, [refresh, tenantId]);

  const runAction = useCallback(async (
    requestId: string,
    action: 'apply' | 'resolve' | 'reject',
  ) => {
    setBusyId(requestId);
    try {
      await runCustomerOrderChangeRequestAction(requestId, action);
      await refresh();
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update customer request.';
      setError(message);
      throw err;
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  return { requests, loading, busyId, error, refresh, runAction };
}
