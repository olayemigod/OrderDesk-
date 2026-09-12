import { useCallback, useEffect, useState } from 'react';

import {
  loadPlatformAdminAudit,
  loadPlatformAdminOverview,
  loadPlatformAiParserReadiness,
  mutatePlatformTenant,
  type PlatformAdminAuditEvent,
  type PlatformAdminMutationAction,
  type PlatformAdminOverview,
  type PlatformAiParserReadiness,
} from '../data/platformAdminRepository';

export function usePlatformAdmin() {
  const [overview, setOverview] = useState<PlatformAdminOverview | null>(null);
  const [audit, setAudit] = useState<PlatformAdminAuditEvent[]>([]);
  const [readiness, setReadiness] = useState<PlatformAiParserReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadPlatformAdminOverview();
      setOverview(next);
      if (next) {
        const [nextAudit, nextReadiness] = await Promise.all([
          loadPlatformAdminAudit(null, 30),
          loadPlatformAiParserReadiness(),
        ]);
        setAudit(nextAudit);
        setReadiness(nextReadiness);
      } else {
        setAudit([]);
        setReadiness(null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load ProcessEdge admin console.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(async (
    tenantId: string,
    action: PlatformAdminMutationAction,
    value: string | number | null,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const next = await mutatePlatformTenant(tenantId, action, value);
      setOverview(next);
      const [nextAudit, nextReadiness] = await Promise.all([
        loadPlatformAdminAudit(null, 30),
        loadPlatformAiParserReadiness(),
      ]);
      setAudit(nextAudit);
      setReadiness(nextReadiness);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update this SellerTray business.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    overview,
    audit,
    readiness,
    isPlatformAdmin: overview !== null,
    loading,
    busy,
    error,
    refresh,
    mutate,
  };
}
