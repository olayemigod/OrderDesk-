import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadActiveCashShift, type CashShift } from '../data/cashShiftRepository';
import { loadAccessibleBranches, type CommerceBranch } from '../data/commerceRepository';
import { loadStockTransfers } from '../data/inventoryRepository';
import { loadLowStock } from '../data/lowStockRepository';
import type { MerchantOrder } from '../domain/order';
import { orderTotal } from '../domain/order';
import { useBusinesses } from '../hooks/useBusinesses';
import { useMerchantNotifications } from '../hooks/useMerchantNotifications';
import { useOfflineSalesSync } from '../hooks/useOfflineSalesSync';
import { useOrders } from '../hooks/useOrders';
import { supabase } from '../lib/supabase';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { HomeDashboard, type HomeAttentionItem } from './HomeDashboard';
import { InventoryTabWorkspace } from './InventoryTabWorkspace';
import { MobileShell, type SellerTrayPrimaryTab } from './MobileShell';
import { MoreWorkspace } from './MoreWorkspace';
import { OrdersWorkspace } from './OrdersWorkspace';
import { SellWorkspace } from './SellWorkspace';

export default function RedesignWorkspace() {
  const appearance = useSellerTrayAppearance();
  const { activeBusiness, saveProfile } = useBusinesses();
  const offline = useOfflineSalesSync();
  const [tab, setTab] = useState<SellerTrayPrimaryTab>('home');
  const [merchantName, setMerchantName] = useState('there');
  const [branches, setBranches] = useState<CommerceBranch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState('');
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [showBranchSwitcher, setShowBranchSwitcher] = useState(false);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [pendingTransferCount, setPendingTransferCount] = useState(0);
  const [inventorySummaryLoading, setInventorySummaryLoading] = useState(false);
  const [inventorySummaryError, setInventorySummaryError] = useState<string | null>(null);
  const [activeCashShift, setActiveCashShift] = useState<CashShift | null>(null);
  const [cashShiftLoading, setCashShiftLoading] = useState(false);
  const [cashShiftError, setCashShiftError] = useState<string | null>(null);
  const [canRefundSale, setCanRefundSale] = useState(false);
  const [refundAuthorityLoading, setRefundAuthorityLoading] = useState(false);
  const [refundAuthorityError, setRefundAuthorityError] = useState<string | null>(null);
  const [cashRouteKey, setCashRouteKey] = useState(0);
  const [whatsappRouteKey, setWhatsappRouteKey] = useState(0);
  const [syncRouteKey, setSyncRouteKey] = useState(0);

  const {
    orders,
    loading: ordersLoading,
    error: ordersError,
    refresh: refreshOrders,
  } = useOrders(activeBusiness?.id ?? null);
  const notifications = useMerchantNotifications(activeBusiness?.id ?? null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      const metadata = data.user?.user_metadata ?? {};
      const candidate =
        (typeof metadata.full_name === 'string' && metadata.full_name) ||
        (typeof metadata.name === 'string' && metadata.name) ||
        data.user?.email?.split('@')[0] ||
        'there';
      setMerchantName(candidate);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const tenantId = activeBusiness?.id ?? '';
    if (!tenantId) {
      setBranches([]);
      setActiveBranchId('');
      return undefined;
    }

    let active = true;
    setBranchLoading(true);
    setBranchError(null);
    void loadAccessibleBranches(tenantId)
      .then((rows) => {
        if (!active) return;
        setBranches(rows);
        setActiveBranchId((current) => {
          if (rows.some((branch) => branch.id === current)) return current;
          return rows.find((branch) => branch.isDefault)?.id ?? rows[0]?.id ?? '';
        });
      })
      .catch((err) => {
        if (!active) return;
        setBranches([]);
        setActiveBranchId('');
        setBranchError(err instanceof Error ? err.message : 'Unable to load branches.');
      })
      .finally(() => {
        if (active) setBranchLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeBusiness?.id]);

  const activeBranch = useMemo(
    () => branches.find((branch) => branch.id === activeBranchId) ?? branches[0] ?? null,
    [activeBranchId, branches],
  );
  const branchOrders = useMemo(
    () => activeBranch ? orders.filter((order) => order.branchId === activeBranch.id) : orders,
    [activeBranch, orders],
  );
  const home = useMemo(() => buildHomeSnapshot(branchOrders), [branchOrders]);

  async function refreshActiveCashShift(
    tenantId = activeBusiness?.id ?? '',
    branchId = activeBranch?.id ?? '',
    options?: { quiet?: boolean },
  ): Promise<CashShift | null> {
    if (!tenantId || !branchId) {
      setActiveCashShift(null);
      return null;
    }
    if (!options?.quiet) setCashShiftLoading(true);
    setCashShiftError(null);
    try {
      const next = await loadActiveCashShift(tenantId, branchId);
      setActiveCashShift(next);
      return next;
    } catch (err) {
      setActiveCashShift(null);
      setCashShiftError(err instanceof Error ? err.message : 'Unable to refresh cashier shift.');
      return null;
    } finally {
      if (!options?.quiet) setCashShiftLoading(false);
    }
  }

  useEffect(() => {
    const tenantId = activeBusiness?.id ?? '';
    const branchId = activeBranch?.id ?? '';
    if (!tenantId || !branchId) {
      setActiveCashShift(null);
      setCashShiftLoading(false);
      setCashShiftError(null);
      return undefined;
    }
    let active = true;
    setCashShiftLoading(true);
    setCashShiftError(null);
    void loadActiveCashShift(tenantId, branchId)
      .then((next) => {
        if (active) setActiveCashShift(next);
      })
      .catch((err) => {
        if (!active) return;
        setActiveCashShift(null);
        setCashShiftError(err instanceof Error ? err.message : 'Unable to refresh cashier shift.');
      })
      .finally(() => {
        if (active) setCashShiftLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeBusiness?.id, activeBranch?.id]);

  useEffect(() => {
    const tenantId = activeBusiness?.id ?? '';
    const branchId = activeBranch?.id ?? '';
    if (!tenantId || !branchId) {
      setCanRefundSale(false);
      setRefundAuthorityLoading(false);
      setRefundAuthorityError(null);
      return undefined;
    }

    let active = true;
    setRefundAuthorityLoading(true);
    setRefundAuthorityError(null);
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_sellertray_pos_return_authority', {
          p_tenant_id: tenantId,
          p_branch_id: branchId,
        });
        if (error) throw error;
        if (active) setCanRefundSale(data === true);
      } catch (err) {
        if (!active) return;
        setCanRefundSale(false);
        setRefundAuthorityError(err instanceof Error ? err.message : 'Unable to check return permission.');
      } finally {
        if (active) setRefundAuthorityLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [activeBusiness?.id, activeBranch?.id]);

  useEffect(() => {
    const tenantId = activeBusiness?.id ?? '';
    const branchId = activeBranch?.id ?? '';
    if (!tenantId || !branchId) {
      setLowStockCount(0);
      setPendingTransferCount(0);
      setInventorySummaryLoading(false);
      setInventorySummaryError(null);
      return undefined;
    }

    let active = true;
    setInventorySummaryLoading(true);
    setInventorySummaryError(null);
    void Promise.all([
      loadLowStock(tenantId, branchId),
      loadStockTransfers(tenantId, branchId, 100),
    ])
      .then(([lowStock, transfers]) => {
        if (!active) return;
        setLowStockCount(lowStock.length);
        setPendingTransferCount(
          transfers.filter((transfer) => transfer.status === 'draft' || transfer.status === 'dispatched').length,
        );
      })
      .catch((err) => {
        if (!active) return;
        setLowStockCount(0);
        setPendingTransferCount(0);
        setInventorySummaryError(err instanceof Error ? err.message : 'Unable to refresh inventory status.');
      })
      .finally(() => {
        if (active) setInventorySummaryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeBusiness?.id, activeBranch?.id]);

  if (!activeBusiness) {
    return (
      <View style={[styles.centered, appearance.dark && darkStyles.page]}>
        <ActivityIndicator />
        <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Opening your business…</Text>
      </View>
    );
  }

  function openCashWorkspace() {
    setTab('more');
    setCashRouteKey((value) => value + 1);
  }

  function openWhatsAppWorkspace() {
    setTab('more');
    setWhatsappRouteKey((value) => value + 1);
  }

  function openSyncWorkspace() {
    setTab('more');
    setSyncRouteKey((value) => value + 1);
  }

  const attentionItems: HomeAttentionItem[] = [];
  if (!cashShiftLoading && activeBranch && !activeCashShift) {
    attentionItems.push({
      key: 'cashier-shift',
      icon: 'cash-outline',
      title: 'Cashier shift is closed',
      detail: 'Open a shift before taking counter cash sales.',
      tone: 'warning',
      onPress: openCashWorkspace,
    });
  }
  if (offline.openCount > 0) {
    attentionItems.push({
      key: 'held-sales-sync',
      icon: 'cloud-upload-outline',
      title: `${offline.openCount} held sale${offline.openCount === 1 ? '' : 's'} waiting`,
      detail: 'Sync or review held sales. They are not paid or completed until processed online.',
      count: offline.openCount,
      tone: 'warning',
      onPress: openSyncWorkspace,
    });
  }
  if (home.whatsappNeedsReview > 0) {
    attentionItems.push({
      key: 'whatsapp-orders',
      icon: 'logo-whatsapp',
      title: `${home.whatsappNeedsReview} WhatsApp order${home.whatsappNeedsReview === 1 ? '' : 's'} need review`,
      detail: 'Review customer conversations and requests before processing them.',
      count: home.whatsappNeedsReview,
      onPress: openWhatsAppWorkspace,
    });
  }
  if (home.paymentIssues > 0) {
    attentionItems.push({
      key: 'payment-action',
      icon: 'card-outline',
      title: `${home.paymentIssues} payment${home.paymentIssues === 1 ? '' : 's'} need action`,
      detail: 'Confirm pending transfers or resolve payment issues.',
      count: home.paymentIssues,
      tone: 'warning',
      onPress: () => setTab('orders'),
    });
  }
  if (lowStockCount > 0) {
    attentionItems.push({
      key: 'low-stock',
      icon: 'cube-outline',
      title: `${lowStockCount} product${lowStockCount === 1 ? '' : 's'} need replenishment`,
      detail: 'Review branch stock levels and replenishment targets.',
      count: lowStockCount,
      tone: 'warning',
      onPress: () => setTab('inventory'),
    });
  }
  if (pendingTransferCount > 0) {
    attentionItems.push({
      key: 'stock-transfers',
      icon: 'git-compare-outline',
      title: `${pendingTransferCount} stock transfer${pendingTransferCount === 1 ? '' : 's'} pending`,
      detail: 'Review draft or in-transit branch stock movements.',
      count: pendingTransferCount,
      onPress: () => setTab('inventory'),
    });
  }

  const workspaceError = ordersError || notifications.error || branchError || inventorySummaryError || cashShiftError || refundAuthorityError;
  const workspaceSyncing = branchLoading || inventorySummaryLoading || cashShiftLoading || refundAuthorityLoading;
  const syncState = offline.connectionState === 'offline'
    ? 'offline'
    : offline.syncing || workspaceSyncing
      ? 'syncing'
      : 'online';

  return (
    <MobileShell
      activeTab={tab}
      businessName={activeBusiness.name}
      branchName={activeBranch?.name ?? (branchLoading ? 'Loading branch…' : null)}
      canSwitchBranch={branches.length > 1}
      notificationCount={notifications.unreadCount}
      orderAttentionCount={home.ordersNeedingAttention}
      syncState={syncState}
      onTabChange={setTab}
      onOpenNotifications={() => setTab('orders')}
      onOpenBranchSwitcher={() => setShowBranchSwitcher((value) => !value)}
    >
      {showBranchSwitcher && branches.length > 1 ? (
        <BranchSwitcher
          branches={branches}
          activeBranchId={activeBranch?.id ?? ''}
          onSelect={(branchId) => {
            setActiveBranchId(branchId);
            setShowBranchSwitcher(false);
          }}
        />
      ) : null}

      {workspaceError ? (
        <View style={[styles.errorCard, appearance.dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={22} color={theme.colors.danger} />
          <View style={styles.errorCopy}>
            <Text style={[styles.errorTitle, appearance.dark && darkStyles.titleText]}>Some information could not refresh</Text>
            <Text style={[styles.errorText, appearance.dark && darkStyles.bodyText]}>{workspaceError}</Text>
          </View>
        </View>
      ) : null}

      {tab === 'home' ? (
        <HomeDashboard
          merchantName={merchantName}
          branchName={activeBranch?.name ?? null}
          currency={activeBusiness.currency}
          salesToday={home.salesToday}
          ordersToday={home.ordersToday}
          amountCollectedToday={home.collectedToday}
          lowStockCount={lowStockCount}
          pendingWhatsappCount={home.whatsappNeedsReview}
          pendingTransferCount={pendingTransferCount}
          shiftOpen={cashShiftLoading ? null : Boolean(activeCashShift)}
          attentionItems={attentionItems}
          onNewSale={() => setTab('sell')}
          onOpenOrders={() => setTab('orders')}
          onOpenInventory={() => setTab('inventory')}
          onOpenWhatsapp={openWhatsAppWorkspace}
        />
      ) : null}

      {tab === 'sell' ? (
        activeBranch ? (
          cashShiftLoading ? (
            <ShiftRequiredState loading />
          ) : activeCashShift ? (
            <SellWorkspace
              tenantId={activeBusiness.id}
              actorUserId={offline.actorUserId}
              branch={activeBranch}
              currency={activeBusiness.currency}
              onOfflineSaleQueued={() => void offline.refresh()}
              onDraftCreated={() => {
                void Promise.all([
                  refreshOrders(),
                  refreshActiveCashShift(activeBusiness.id, activeBranch.id, { quiet: true }),
                ]).finally(() => setTab('orders'));
              }}
            />
          ) : (
            <ShiftRequiredState onOpenShift={openCashWorkspace} />
          )
        ) : (
          <BranchRequiredState loading={branchLoading} />
        )
      ) : null}

      {tab === 'orders' ? (
        <OrdersWorkspace
          tenantId={activeBusiness.id}
          businessCurrency={activeBusiness.currency}
          orders={branchOrders}
          loading={ordersLoading}
          canReturnCompletedSale={canRefundSale && Boolean(activeCashShift)}
          onChanged={async () => {
            await Promise.all([
              refreshOrders(),
              refreshActiveCashShift(activeBusiness.id, activeBranch?.id ?? '', { quiet: true }),
            ]);
          }}
        />
      ) : null}

      {tab === 'inventory' ? (
        activeBranch ? (
          <InventoryTabWorkspace tenantId={activeBusiness.id} branch={activeBranch} />
        ) : (
          <BranchRequiredState loading={branchLoading} />
        )
      ) : null}

      {tab === 'more' ? (
        activeBranch ? (
          <MoreWorkspace
            business={activeBusiness}
            branch={activeBranch}
            activeShift={activeCashShift}
            offlineSales={offline.sales}
            offlineSyncing={offline.syncing}
            cashRouteKey={cashRouteKey}
            whatsappRouteKey={whatsappRouteKey}
            syncRouteKey={syncRouteKey}
            onSaveBusiness={saveProfile}
            onShiftChanged={(next) => {
              setActiveCashShift(next);
              setCashShiftError(null);
            }}
            onOpenOrders={() => setTab('orders')}
            onSyncOfflineSales={() => offline.syncNow()}
            onDiscardOfflineSale={offline.discard}
          />
        ) : (
          <BranchRequiredState loading={branchLoading} />
        )
      ) : null}
    </MobileShell>
  );
}

function ShiftRequiredState({ loading = false, onOpenShift }: { loading?: boolean; onOpenShift?: () => void }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
      {loading ? <ActivityIndicator /> : <Ionicons name="cash-outline" size={30} color={theme.colors.greenDark} />}
      <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>{loading ? 'Checking cashier shift' : 'Open a shift to start selling'}</Text>
      <Text style={[styles.emptyText, appearance.dark && darkStyles.bodyText]}>
        {loading ? 'SellerTray is checking the active drawer for this branch.' : 'Counter cash sales are tied to an open register so cash can be reconciled correctly.'}
      </Text>
      {!loading && onOpenShift ? (
        <Pressable onPress={onOpenShift} style={styles.primaryButton}>
          <Ionicons name="lock-open-outline" size={18} color={theme.colors.white} />
          <Text style={styles.primaryButtonText}>Open Cash & Shift</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function BranchRequiredState({ loading }: { loading: boolean }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
      {loading ? <ActivityIndicator /> : <Ionicons name="location-outline" size={28} color={theme.colors.greenDark} />}
      <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>{loading ? 'Loading branch' : 'No branch available'}</Text>
      <Text style={[styles.emptyText, appearance.dark && darkStyles.bodyText]}>
        {loading ? 'SellerTray is checking your branch access.' : 'Ask a manager to assign an active branch before continuing.'}
      </Text>
    </View>
  );
}

function BranchSwitcher({ branches, activeBranchId, onSelect }: { branches: CommerceBranch[]; activeBranchId: string; onSelect: (branchId: string) => void }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.branchSwitcher, appearance.dark && darkStyles.card]}>
      <Text style={[styles.branchSwitcherTitle, appearance.dark && darkStyles.titleText]}>Choose branch</Text>
      <Text style={[styles.branchSwitcherText, appearance.dark && darkStyles.bodyText]}>Sales, orders and stock activity will use the selected branch.</Text>
      <View style={styles.branchList}>
        {branches.map((branch) => {
          const active = branch.id === activeBranchId;
          return <Pressable key={branch.id} onPress={() => onSelect(branch.id)} style={[styles.branchRow, appearance.dark && darkStyles.subtleCard, active && styles.branchRowActive]}>
            <View style={styles.branchIcon}><Ionicons name="storefront-outline" size={19} color={theme.colors.greenDark} /></View>
            <View style={styles.branchCopy}>
              <Text style={[styles.branchName, appearance.dark && darkStyles.titleText]}>{branch.name}</Text>
              <Text style={[styles.branchCode, appearance.dark && darkStyles.bodyText]}>{branch.code}{branch.isDefault ? ' · Default' : ''}</Text>
            </View>
            {active ? <Ionicons name="checkmark-circle" size={21} color={theme.colors.green} /> : null}
          </Pressable>;
        })}
      </View>
    </View>
  );
}

function buildHomeSnapshot(orders: MerchantOrder[]) {
  const today = localDayKey(new Date());
  const todayOrders = orders.filter((order) => localDayKey(new Date(order.receivedAt)) === today);
  const activeTodayOrders = todayOrders.filter((order) => !['rejected', 'cancelled'].includes(order.status));

  return {
    ordersToday: todayOrders.length,
    salesToday: activeTodayOrders.reduce((sum, order) => sum + (orderTotal(order) ?? 0), 0),
    collectedToday: activeTodayOrders.reduce((sum, order) => sum + Math.max(0, order.amountPaid - order.returnedAmount), 0),
    whatsappNeedsReview: orders.filter((order) => order.source === 'whatsapp' && ['needs_review', 'draft'].includes(order.status)).length,
    paymentIssues: orders.filter((order) => ['verification_required', 'payment_issue'].includes(order.paymentStatus) && !['rejected', 'cancelled'].includes(order.status)).length,
    ordersNeedingAttention: orders.filter((order) => ['needs_review', 'draft'].includes(order.status) || ['verification_required', 'payment_issue'].includes(order.paymentStatus)).length,
  };
}

function localDayKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, backgroundColor: theme.colors.cloud },
  muted: { color: theme.colors.muted, fontSize: 12 },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  errorCopy: { flex: 1 },
  errorTitle: { color: '#B42318', fontSize: 13, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 11, lineHeight: 17, marginTop: 2 },
  branchSwitcher: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 8, marginBottom: 14 },
  branchSwitcherTitle: { color: theme.colors.navy, fontSize: 17, fontWeight: '900' },
  branchSwitcherText: { color: theme.colors.slate, fontSize: 12, lineHeight: 18 },
  branchList: { gap: 7, marginTop: 3 },
  branchRow: { minHeight: 64, borderRadius: theme.radius.md, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: theme.colors.border, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  branchRowActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  branchIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  branchCopy: { flex: 1 },
  branchName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  branchCode: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  emptyCard: { minHeight: 120, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 7 },
  emptyTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  emptyText: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  primaryButton: { minHeight: 44, borderRadius: theme.radius.md, backgroundColor: theme.colors.green, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 5 },
  primaryButtonText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
});

const darkStyles = StyleSheet.create({
  page: { backgroundColor: '#081825' },
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});
