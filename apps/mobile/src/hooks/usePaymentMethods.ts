import { useCallback, useEffect, useState } from 'react';

import {
  connectPaymentGateway,
  disconnectPaymentGateway,
  loadPaymentMethods,
  savePaymentMethod,
  type MerchantPaymentMethod,
  type PaymentMethodInput,
} from '../data/paymentMethodsRepository';

export function usePaymentMethods(tenantId: string) {
  const [methods, setMethods] = useState<MerchantPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setMethods([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setMethods(await loadPaymentMethods(tenantId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load payment methods.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (input: PaymentMethodInput) => {
    setBusy(true);
    setError(null);
    try {
      const id = await savePaymentMethod(tenantId, input);
      await refresh();
      return id;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save payment method.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [refresh, tenantId]);

  const connectGateway = useCallback(async (
    methodId: string,
    provider: 'paystack' | 'flutterwave',
    secretKey: string,
    secretHash?: string | null,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await connectPaymentGateway(tenantId, methodId, provider, secretKey, secretHash);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to connect payment gateway.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [refresh, tenantId]);

  const disconnectGateway = useCallback(async (methodId: string) => {
    setBusy(true);
    setError(null);
    try {
      await disconnectPaymentGateway(tenantId, methodId);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to disconnect payment gateway.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [refresh, tenantId]);

  return {
    methods,
    loading,
    busy,
    error,
    refresh,
    save,
    connectGateway,
    disconnectGateway,
  };
}
