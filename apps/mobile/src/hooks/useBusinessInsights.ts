import { useCallback, useEffect, useState } from 'react';

import {
  loadBusinessInsights,
  type BusinessInsights,
} from '../data/insightsRepository';
import { supabase } from '../lib/supabase';

export function useBusinessInsights(tenantId: string | null) {
  const [insights, setInsights] = useState<BusinessInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setInsights(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      setInsights(await loadBusinessInsights(tenantId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load business insights.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
    if (!tenantId) return undefined;

    const channel = supabase
      .channel(`business-insights-${tenantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items', filter: `tenant_id=eq.${tenantId}` },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, tenantId]);

  return { insights, loading, error, refresh };
}
