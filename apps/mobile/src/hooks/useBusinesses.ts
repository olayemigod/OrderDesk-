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

      setBusinesses(nextBusinesses);
      setActiveBusinessId(nextActiveId);
      if (nextActiveId) await AsyncStorage.setItem(ACTIVE_BUSINESS_KEY, nextActiveId);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your OrderDesk businesses.');
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
    setActiveBusinessId(businessId);
    await AsyncStorage.setItem(ACTIVE_BUSINESS_KEY, businessId);
  }, []);

  const createBusiness = useCallback(
    async (input: InitialBusinessInput) => {
      try {
        const businessId = await createInitialBusiness(input);
        await AsyncStorage.setItem(ACTIVE_BUSINESS_KEY, businessId);
        await refresh();
        setError(null);
        return businessId;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to create the business workspace.');
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
        setError(err instanceof Error ? err.message : 'Unable to update the business profile.');
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
