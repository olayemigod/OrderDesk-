import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { completePosSale } from '../data/commerceRepository';
import { prepareGovernedPosDraft } from '../data/posDraftPreparationRepository';
import {
  discardOfflinePosSale,
  isLikelyConnectivityError,
  loadOfflinePosSales,
  syncOfflinePosSales,
  type OfflinePosSale,
} from '../data/offlineSalesRepository';
import { supabase } from '../lib/supabase';

export function useOfflineSalesSync() {
  const [actorUserId, setActorUserId] = useState('');
  const [sales, setSales] = useState<OfflinePosSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const syncRunning = useRef(false);

  const probeReachability = useCallback(async () => {
    try {
      const { error } = await supabase.auth.getUser();
      if (error && isLikelyConnectivityError(error)) {
        setBackendReachable(false);
        return false;
      }
      setBackendReachable(true);
      return true;
    } catch (error) {
      if (isLikelyConnectivityError(error)) {
        setBackendReachable(false);
        return false;
      }
      setBackendReachable(true);
      return true;
    }
  }, []);

  const refresh = useCallback(async (userId = actorUserId) => {
    if (!userId) {
      setSales([]);
      return [];
    }
    const rows = await loadOfflinePosSales(userId);
    setSales(rows);
    void probeReachability();
    return rows;
  }, [actorUserId, probeReachability]);

  const replaySale = useCallback(async (sale: OfflinePosSale) => {
    const orderId = await prepareGovernedPosDraft({
      tenantId: sale.tenantId,
      branchId: sale.branchId,
      clientReference: sale.clientReference,
      customerId: sale.customerId,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
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
      setBackendReachable(true);
    } finally {
      syncRunning.current = false;
      setSyncing(false);
    }
  }, [actorUserId, probeReachability, refresh, replaySale]);

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
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && actorUserId) void syncNow(actorUserId);
    });
    return () => subscription.remove();
  }, [actorUserId, syncNow]);

  const connectionState = useMemo<'online' | 'syncing' | 'offline'>(() => {
    if (syncing) return 'syncing';
    if (backendReachable === false) return 'offline';
    const waiting = sales.some((sale) => sale.status === 'pending' && sale.attempts > 0 && /waiting for a connection/i.test(sale.lastError ?? ''));
    return waiting ? 'offline' : 'online';
  }, [backendReachable, sales, syncing]);

  const openCount = useMemo(() => sales.filter((sale) => sale.status !== 'synced').length, [sales]);

  return { actorUserId, sales, syncing, lastSyncAt, connectionState, backendReachable, openCount, refresh, syncNow, discard, probeReachability };
}
