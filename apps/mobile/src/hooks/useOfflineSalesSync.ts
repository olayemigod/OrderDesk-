import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { createPosDraft } from '../data/commerceRepository';
import {
  discardOfflinePosSale,
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
  const syncRunning = useRef(false);

  const refresh = useCallback(async (userId = actorUserId) => {
    if (!userId) {
      setSales([]);
      return [];
    }
    const rows = await loadOfflinePosSales(userId);
    setSales(rows);
    return rows;
  }, [actorUserId]);

  const syncNow = useCallback(async (userId = actorUserId) => {
    if (!userId || syncRunning.current) return;
    syncRunning.current = true;
    setSyncing(true);
    try {
      await syncOfflinePosSales(userId, createPosDraft);
      await refresh(userId);
      setLastSyncAt(new Date().toISOString());
    } finally {
      syncRunning.current = false;
      setSyncing(false);
    }
  }, [actorUserId, refresh]);

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
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!actorUserId) {
      setSales([]);
      return;
    }
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
    const waitingForConnection = sales.some(
      (sale) => sale.status === 'pending' && sale.attempts > 0 && /waiting for a connection/i.test(sale.lastError ?? ''),
    );
    return waitingForConnection ? 'offline' : 'online';
  }, [sales, syncing]);

  const openCount = useMemo(
    () => sales.filter((sale) => sale.status !== 'synced').length,
    [sales],
  );

  return {
    actorUserId,
    sales,
    syncing,
    lastSyncAt,
    connectionState,
    openCount,
    refresh,
    syncNow,
    discard,
  };
}
