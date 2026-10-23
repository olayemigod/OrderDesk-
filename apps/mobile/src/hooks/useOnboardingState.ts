import { useCallback, useEffect, useState } from 'react';

import {
  loadSellerTrayOnboardingState,
  type SellerTrayOnboardingState,
} from '../data/onboardingRepository';

export function useOnboardingState(tenantId: string | null) {
  const [state, setState] = useState<SellerTrayOnboardingState | null>(null);
  const [loading, setLoading] = useState(Boolean(tenantId));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setState(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      setState(await loadSellerTrayOnboardingState(tenantId));
      setError(null);
    } catch (cause) {
      setState(null);
      setError(cause instanceof Error && cause.message.trim()
        ? cause.message
        : 'Unable to load SellerTray activation status.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, loading, error, refresh };
}
