import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { MerchantRole } from '../data/businessRepository';
import {
  loadSellerTrayOnboardingState,
  type SellerTrayOnboardingState,
} from '../data/onboardingRepository';

const ACTIVE_BUSINESS_KEY = 'orderdesk.activeBusinessId';
const ACTIVE_BUSINESS_ROLE_HINT_KEY = 'orderdesk.activeBusinessRoleHint';

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
  useRefreshOnForeground(refresh);

  return {
    state,
    loading,
    error,
    refresh,
    canRead,
  };
}

// HomeDashboard does not own workspace membership state. useBusinesses caches a
// non-authoritative active-role hint beside the active Business id so cashier/staff
// sessions can avoid making a commercial-status request at all. The server still
// verifies Owner/Manager membership on every onboarding read.
export function useCurrentBusinessOnboardingState() {
  const [state, setState] = useState<SellerTrayOnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [storedTenantId, storedRole] = await Promise.all([
        AsyncStorage.getItem(ACTIVE_BUSINESS_KEY),
        AsyncStorage.getItem(ACTIVE_BUSINESS_ROLE_HINT_KEY),
      ]);
      const tenantId = storedTenantId?.trim() || null;
      const role = merchantRole(storedRole);
      const canRead = role === 'owner' || role === 'manager';

      if (!tenantId || !canRead) {
        setState(null);
        setError(null);
        return;
      }

      setState(await loadSellerTrayOnboardingState(tenantId));
      setError(null);
    } catch (cause) {
      // A stale role hint can never authorize a read; the server remains the
      // authority. If membership was downgraded, keep commercial detail hidden.
      if (isPermissionDenied(cause)) {
        setState(null);
        setError(null);
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to load onboarding status.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRefreshOnForeground(refresh);

  return { state, loading, error, refresh };
}

function useRefreshOnForeground(refresh: () => void | Promise<void>) {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
}

function merchantRole(value: string | null): MerchantRole | null {
  return value === 'owner' || value === 'manager' || value === 'staff' ? value : null;
}

function isPermissionDenied(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const code = 'code' in value ? String((value as { code?: unknown }).code ?? '') : '';
  const message = 'message' in value ? String((value as { message?: unknown }).message ?? '') : '';
  return code === '42501' || /owner or manager|permission|not permitted/i.test(message);
}
