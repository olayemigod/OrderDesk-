import { useCallback, useEffect, useState } from 'react';

import { loadOrderGateStatus, type OrderGateStatus } from '../data/orderGateRepository';

export function useOrderGateStatus(
  orderId: string,
  refreshKey: string,
) {
  const [status, setStatus] = useState<OrderGateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orderId) {
      setStatus(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setStatus(await loadOrderGateStatus(orderId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to check SellerTray operational gates.');
    } finally {
      setLoading(false);
    }
  }, [orderId, refreshKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, loading, error, refresh };
}
