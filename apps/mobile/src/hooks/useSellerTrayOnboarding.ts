import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  loadSellerTrayOnboardingState,
  type SellerTrayOnboardingState,
} from '../data/onboardingRepository';

export function useSellerTrayOnboarding(tenantId: string | null) {
  const [state, setState] = useState<SellerTrayOnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
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
      const next = await loadSellerTrayOnboardingState(tenantId);
      setState(next);
      setError(null);
    } catch (cause) {
      setState(null);
      setError(cause instanceof Error && cause.message
        ? cause.message
        : 'Unable to load SellerTray setup status.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!tenantId) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh, tenantId]);

  return { state, loading, error, refresh };
}
