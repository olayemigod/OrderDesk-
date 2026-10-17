import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';

import {
  loadSubscriptionAccess,
  type SubscriptionAccess,
} from '../data/subscriptionRepository';
import { supabase } from '../lib/supabase';

export function useSubscriptionAccess(tenantId: string | null) {
  const [subscription, setSubscription] = useState<SubscriptionAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setSubscription(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      setSubscription(await loadSubscriptionAccess(tenantId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load subscription state.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
    if (!tenantId) return undefined;

    const channel: RealtimeChannel = supabase
      .channel(`subscription-${tenantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tenant_subscriptions', filter: `tenant_id=eq.${tenantId}` },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, tenantId]);

  return { subscription, loading, error, refresh };
}
