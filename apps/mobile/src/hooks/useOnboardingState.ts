import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { MerchantRole } from '../data/businessRepository';
import {
  loadSellerTrayOnboardingState,
  type SellerTrayOnboardingState,
} from '../data/onboardingRepository';

const ACTIVE_BUSINESS_KEY = 'orderdesk.activeBusinessId';

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

// HomeDashboard is intentionally kept presentation-focused and does not own the
// Business workspace state. The active Business identity is already persisted by
// useBusinesses, so the Home preparation surface can resolve that same identity
// without running a second Business/WhatsApp workspace load.
export function useCurrentBusinessOnboardingState() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [state, setState] = useState<SellerTrayOnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolveTenant = useCallback(async () => {
    const stored = await AsyncStorage.getItem(ACTIVE_BUSINESS_KEY);
    const next = stored?.trim() || null;
    setTenantId(next);
    return next;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const currentTenantId = tenantId ?? await resolveTenant();
      if (!currentTenantId) {
        setState(null);
        setError(null);
        return;
      }
      setState(await loadSellerTrayOnboardingState(currentTenantId));
      setError(null);
    } catch (cause) {
      // The server permits commercial onboarding detail only to Owner/Manager.
      // Cashiers/staff should simply retain their operational Home without a
      // financial onboarding card or a false workspace error.
      if (isPermissionDenied(cause)) {
        setState(null);
        setError(null);
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to load onboarding status.');
      }
    } finally {
      setLoading(false);
    }
  }, [resolveTenant, tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, loading, error, refresh };
}

function isPermissionDenied(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const code = 'code' in value ? String((value as { code?: unknown }).code ?? '') : '';
  const message = 'message' in value ? String((value as { message?: unknown }).message ?? '') : '';
  return code === '42501' || /owner or manager|permission|not permitted/i.test(message);
}
