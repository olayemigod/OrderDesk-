import { useCallback, useEffect, useState } from 'react';

import {
  defaultOperationalPolicy,
  loadOperationalPolicy,
  saveOperationalPolicy,
  type OperationalPolicy,
} from '../data/operationalPolicyRepository';

export function useOperationalPolicy(tenantId: string) {
  const [policy, setPolicy] = useState<OperationalPolicy>(defaultOperationalPolicy);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setPolicy(defaultOperationalPolicy);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setPolicy(await loadOperationalPolicy(tenantId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load operational policy.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (next: OperationalPolicy) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveOperationalPolicy(tenantId, next);
      setPolicy(saved);
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save operational policy.';
      setError(message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [tenantId]);

  return { policy, loading, saving, error, refresh, save };
}
