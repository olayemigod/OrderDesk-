import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createInitialBusiness,
  loadBusinesses,
  updateBusinessProfile,
  type BusinessProfileInput,
  type InitialBusinessInput,
  type MerchantBusiness,
} from '../data/businessRepository';

const ACTIVE_BUSINESS_KEY = 'orderdesk.activeBusinessId';
const ACTIVE_BUSINESS_ROLE_HINT_KEY = 'orderdesk.activeBusinessRoleHint';

export function useBusinesses() {
  const [businesses, setBusinesses] = useState<MerchantBusiness[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextBusinesses = await loadBusinesses();
      const storedBusinessId = await AsyncStorage.getItem(ACTIVE_BUSINESS_KEY);
      const storedIsValid = nextBusinesses.some((business) => business.id === storedBusinessId);
      const nextActiveId = storedIsValid ? storedBusinessId! : nextBusinesses[0]?.id ?? '';
      const nextActiveBusiness = nextBusinesses.find((business) => business.id === nextActiveId) ?? null;

      setBusinesses(nextBusinesses);
      setActiveBusinessId(nextActiveId);
      if (nextActiveId) {
        await AsyncStorage.setItem(ACTIVE_BUSINESS_KEY, nextActiveId);
      }
      if (nextActiveBusiness) {
        // This is only a UI request-suppression hint. Server-side membership and
        // capability checks remain authoritative for every protected action/read.
        await AsyncStorage.setItem(ACTIVE_BUSINESS_ROLE_HINT_KEY, nextActiveBusiness.role);
      } else {
        await AsyncStorage.removeItem(ACTIVE_BUSINESS_ROLE_HINT_KEY);
      }
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Unable to load your SellerTray businesses.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeBusiness = useMemo(
    () => businesses.find((business) => business.id === activeBusinessId) ?? null,
    [activeBusinessId, businesses],
  );

  const selectBusiness = useCallback(async (businessId: string) => {
    const selectedBusiness = businesses.find((business) => business.id === businessId) ?? null;
    setActiveBusinessId(businessId);
    await AsyncStorage.setItem(ACTIVE_BUSINESS_KEY, businessId);
    if (selectedBusiness) {
      await AsyncStorage.setItem(ACTIVE_BUSINESS_ROLE_HINT_KEY, selectedBusiness.role);
    } else {
      await AsyncStorage.removeItem(ACTIVE_BUSINESS_ROLE_HINT_KEY);
    }
  }, [businesses]);

  const createBusiness = useCallback(
    async (input: InitialBusinessInput) => {
      try {
        const businessId = await createInitialBusiness(input);
        await AsyncStorage.setItem(ACTIVE_BUSINESS_KEY, businessId);
        await refresh();
        setError(null);
        return businessId;
      } catch (err) {
        setError(errorMessage(err, 'Unable to create the business workspace.'));
        throw err;
      }
    },
    [refresh],
  );

  const saveProfile = useCallback(
    async (businessId: string, input: BusinessProfileInput) => {
      try {
        await updateBusinessProfile(businessId, input);
        await refresh();
        setError(null);
      } catch (err) {
        setError(errorMessage(err, 'Unable to update the business profile.'));
        throw err;
      }
    },
    [refresh],
  );

  return {
    businesses,
    activeBusiness,
    loading,
    error,
    refresh,
    selectBusiness,
    createBusiness,
    saveProfile,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}
