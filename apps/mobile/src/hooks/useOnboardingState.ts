import { useCallback, useEffect, useState } from 'react';

import type { MerchantRole } from '../data/businessRepository';
import {
  loadSellerTrayOnboardingState,
  type SellerTrayOnboardingState,
} from '../data/onboardingRepository';

export function useOnboardingState(
  tenantId: string | null,
  role: MerchantRole | null | undefined,
) {
  const [state, setState] = useState<SellerTrayOnboardingState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRead = role === 'owner' || role === 'manager';

  const refresh = useCallback(async () => {
    if (!tenantId || !canRead) {
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
      setError(cause instanceof Error ? cause.message : 'Unable to load onboarding status.');
    } finally {
      setLoading(false);
    }
  }, [canRead, tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    state,
    loading,
    error,
    refresh,
    canRead,
  };
}
