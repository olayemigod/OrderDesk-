import { useCallback, useEffect, useState } from 'react';

import {
  loadBusinessInsights,
  type BusinessInsights,
} from '../data/insightsRepository';

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
  }, [refresh]);

  return { insights, loading, error, refresh };
}
