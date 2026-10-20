import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { completePosSale, PosDraftRequestError } from '../data/commerceRepository';
import { prepareGovernedPosDraft } from '../data/posDraftPreparationRepository';
import {
  discardOfflinePosSale,
  isLikelyConnectivityError,
  loadOfflinePosSales,
  syncOfflinePosSales,
  type OfflinePosSale,
} from '../data/offlineSalesRepository';
import { loadSellerTrayTaxQuote } from '../data/taxRepository';
import { supabase } from '../lib/supabase';

const ACTIVE_REACHABILITY_INTERVAL_MS = 5_000;

export function useOfflineSalesSync() {
  const [actorUserId, setActorUserId] = useState('');
  const [sales, setSales] = useState<OfflinePosSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const backendReachableRef = useRef<boolean | null>(null);
  const syncRunning = useRef(false);
  const reachabilityPromiseRef = useRef<Promise<boolean> | null>(null);

  const updateReachability = useCallback((reachable: boolean) => {
    backendReachableRef.current = reachable;
    setBackendReachable(reachable);
  }, []);

  const probeReachability = useCallback(async () => {
    if (reachabilityPromiseRef.current) return reachabilityPromiseRef.current;

    const probe = (async () => {
      try {
        const { error } = await supabase.auth.getUser();
        if (error && isLikelyConnectivityError(error)) {
          updateReachability(false);
          return false;
        }
        updateReachability(true);
        return true;
      } catch (error) {
        if (isLikelyConnectivityError(error)) {
          updateReachability(false);
          return false;
        }
        updateReachability(true);
        return true;
      }
    })();

    reachabilityPromiseRef.current = probe;
    try {
      return await probe;
    } finally {
      if (reachabilityPromiseRef.current === probe) reachabilityPromiseRef.current = null;
    }
  }, [updateReachability]);

  const refresh = useCallback(async (userId = actorUserId) => {
    if (!userId) {
      setSales([]);
      return [];
    }
    const rows = await loadOfflinePosSales(userId);
    setSales(rows);
    return rows;
  }, [actorUserId]);

  const replaySale = useCallback(async (sale: OfflinePosSale) => {
    let expectedTaxConfigurationId = sale.taxConfigurationId;
    let expectedTaxConfigurationRevision = sale.taxConfigurationRevision;

    // Schema v1-v3 sales predate Tax Authority. They can keep their original
    // zero-tax commercial amount only while tax remains inactive. Once tax is
    // active, human review is safer than silently charging tax after payment.
    if (expectedTaxConfigurationRevision === null || sale.taxContextLegacy) {
      const currentTax = await loadSellerTrayTaxQuote(sale.tenantId, sale.subtotal);
      if (currentTax.taxApplied || currentTax.taxAmount > 0.005) {
        throw new PosDraftRequestError(
          'Queued sale needs review because tax became active after this offline sale was recorded.',
          'conflict',
          409,
        );
      }
      expectedTaxConfigurationId = currentTax.configurationId;
      expectedTaxConfigurationRevision = currentTax.revision;
    }

    const orderId = await prepareGovernedPosDraft({
      tenantId: sale.tenantId,
      branchId: sale.branchId,
      clientReference: sale.clientReference,
      customerId: sale.customerId,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
      expectedTaxConfigurationId,
      expectedTaxConfigurationRevision,
      items: sale.lines.map((line) => ({
        catalogItemId: line.catalogItemId,
        uomId: line.uomId,
        uomName: line.uomName,
        quantity: line.quantity,
        expectedSellingPrice: line.expectedSellingPrice,
        sellingPrice: line.sellingPrice,
        expectedConversionFactor: line.expectedConversionFactor,
      })),
    });
    if (sale.completionIntent === 'cash') {
      const result = await completePosSale(sale.tenantId, orderId, null);
      if (result.status !== 'completed' || result.paymentStatus !== 'paid') {
        throw new Error('Offline cash sale could not be settled during sync. Review this sale before handing it off.');
      }
    }
    return orderId;
  }, []);

  const syncNow = useCallback(async (userId = actorUserId) => {
    if (!userId || syncRunning.current) return;
    syncRunning.current = true;
    setSyncing(true);
    try {
      if (!await probeReachability()) return;
      await syncOfflinePosSales(userId, replaySale);
      await refresh(userId);
      setLastSyncAt(new Date().toISOString());
      updateReachability(true);
    } finally {
      syncRunning.current = false;
      setSyncing(false);
    }
  }, [actorUserId, probeReachability, refresh, replaySale, updateReachability]);

  const discard = useCallback(async (clientReference: string) => {
    if (!actorUserId) return;
    await discardOfflinePosSale(clientReference, actorUserId);
    await refresh(actorUserId);
  }, [actorUserId, refresh]);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setActorUserId(data.session?.user.id ?? '');
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setActorUserId(session?.user.id ?? '');
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!actorUserId) { setSales([]); return; }
    void refresh(actorUserId).then(() => syncNow(actorUserId));
  }, [actorUserId, refresh, syncNow]);

  useEffect(() => {
    let appState = AppState.currentState;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    const probeAndRecover = async () => {
      if (!actorUserId || appState !== 'active') return;
      const wasOffline = backendReachableRef.current === false;
      const reachable = await probeReachability();
      if (reachable && wasOffline) void syncNow(actorUserId);
    };
    const startPolling = () => {
      stopPolling();
      if (!actorUserId || appState !== 'active') return;
      void probeAndRecover();
      interval = setInterval(() => {
        void probeAndRecover();
      }, ACTIVE_REACHABILITY_INTERVAL_MS);
    };

    startPolling();
    const subscription = AppState.addEventListener('change', (state) => {
      appState = state;
      if (state === 'active') {
        startPolling();
        if (actorUserId) void syncNow(actorUserId);
      } else {
        stopPolling();
      }
    });
    return () => {
      stopPolling();
      subscription.remove();
    };
  }, [actorUserId, probeReachability, syncNow]);

  const connectionState = useMemo<'online' | 'syncing' | 'offline'>(() => {
    if (backendReachable === false) return 'offline';
    if (syncing) return 'syncing';
    if (backendReachable === true) return 'online';
    const waiting = sales.some((sale) => sale.status === 'pending' && sale.attempts > 0 && /waiting for a connection/i.test(sale.lastError ?? ''));
    return waiting ? 'offline' : 'online';
  }, [backendReachable, sales, syncing]);

  const openCount = useMemo(() => sales.filter((sale) => sale.status !== 'synced').length, [sales]);

  return { actorUserId, sales, syncing, lastSyncAt, connectionState, backendReachable, openCount, refresh, syncNow, discard, probeReachability };
}
