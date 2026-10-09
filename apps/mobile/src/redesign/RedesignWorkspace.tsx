import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SettingsHub } from '../components/SettingsHub';
import { loadAccessibleBranches, type CommerceBranch } from '../data/commerceRepository';
import type { MerchantOrder } from '../domain/order';
import { orderTotal } from '../domain/order';
import { useBusinesses } from '../hooks/useBusinesses';
import { useMerchantNotifications } from '../hooks/useMerchantNotifications';
import { useOrders } from '../hooks/useOrders';
import { supabase } from '../lib/supabase';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { HomeDashboard, type HomeAttentionItem } from './HomeDashboard';
import { InventoryWorkspace } from './InventoryWorkspace';
import { MobileShell, type SellerTrayPrimaryTab } from './MobileShell';
import { OrdersWorkspace } from './OrdersWorkspace';
import { SellWorkspace } from './SellWorkspace';

export default function RedesignWorkspace() {
  const appearance = useSellerTrayAppearance();
  const { activeBusiness, saveProfile } = useBusinesses();
  const [tab, setTab] = useState<SellerTrayPrimaryTab>('home');
  const [merchantName, setMerchantName] = useState('there');
  const [branches, setBranches] = useState<CommerceBranch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState('');
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [showBranchSwitcher, setShowBranchSwitcher] = useState(false);

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

  if (!activeBusiness) {
    return (
      <View style={[styles.centered, appearance.dark && darkStyles.page]}>
        <ActivityIndicator />
        <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Opening your business…</Text>
      </View>
    );
  }

  const attentionItems: HomeAttentionItem[] = [];
  if (home.whatsappNeedsReview > 0) {
    attentionItems.push({
      key: 'whatsapp-orders',
      icon: 'logo-whatsapp',
      title: `${home.whatsappNeedsReview} WhatsApp order${home.whatsappNeedsReview === 1 ? '' : 's'} need review`,
      detail: 'Review customer requests before processing them.',
      count: home.whatsappNeedsReview,
      onPress: () => setTab('orders'),
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

  const workspaceError = ordersError || notifications.error || branchError;

  return (
    <MobileShell
      activeTab={tab}
      businessName={activeBusiness.name}
      branchName={activeBranch?.name ?? (branchLoading ? 'Loading branch…' : null)}
      canSwitchBranch={branches.length > 1}
      notificationCount={notifications.unreadCount}
      orderAttentionCount={home.ordersNeedingAttention}
      syncState={workspaceError ? 'offline' : branchLoading ? 'syncing' : 'online'}
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
          <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.danger} />
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
          pendingWhatsappCount={home.whatsappNeedsReview}
          attentionItems={attentionItems}
          onNewSale={() => setTab('sell')}
          onOpenOrders={() => setTab('orders')}
          onOpenInventory={() => setTab('inventory')}
          onOpenWhatsapp={() => setTab('orders')}
        />
      ) : null}

      {tab === 'sell' ? (
        activeBranch ? (
          <SellWorkspace
            tenantId={activeBusiness.id}
            branch={activeBranch}
            currency={activeBusiness.currency}
            onDraftCreated={() => {
              void refreshOrders().finally(() => setTab('orders'));
            }}
          />
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
          canReturnCompletedSale={activeBusiness.role === 'owner' || activeBusiness.role === 'manager'}
          onChanged={refreshOrders}
        />
      ) : null}

      {tab === 'inventory' ? (
        activeBranch ? (
          <InventoryWorkspace
            tenantId={activeBusiness.id}
            branch={activeBranch}
          />
        ) : (
          <BranchRequiredState loading={branchLoading} />
        )
      ) : null}

      {tab === 'more' ? (
        <SettingsHub
          business={activeBusiness}
          onSaveBusiness={saveProfile}
        />
      ) : null}
    </MobileShell>
  );
}

function BranchRequiredState({ loading }: { loading: boolean }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
      {loading ? <ActivityIndicator /> : <Ionicons name="location-outline" size={28} color={theme.colors.greenDark} />}
      <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>
        {loading ? 'Loading branch' : 'No branch available'}
      </Text>
      <Text style={[styles.emptyText, appearance.dark && darkStyles.bodyText]}>
        {loading ? 'SellerTray is checking your branch access.' : 'Ask a manager to assign an active branch before continuing.'}
      </Text>
    </View>
  );
}

function BranchSwitcher({
  branches,
  activeBranchId,
  onSelect,
}: {
  branches: CommerceBranch[];
  activeBranchId: string;
  onSelect: (branchId: string) => void;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.branchSwitcher, appearance.dark && darkStyles.card]}>
      <Text style={[styles.branchSwitcherTitle, appearance.dark && darkStyles.titleText]}>Choose branch</Text>
      <Text style={[styles.branchSwitcherText, appearance.dark && darkStyles.bodyText]}>
        Sales, orders and stock activity will use the selected branch.
      </Text>
      <View style={styles.branchList}>
        {branches.map((branch) => {
          const active = branch.id === activeBranchId;
          return (
            <Pressable
              key={branch.id}
              onPress={() => onSelect(branch.id)}
              style={[
                styles.branchRow,
                appearance.dark && darkStyles.subtleCard,
                active && styles.branchRowActive,
              ]}
            >
              <View style={styles.branchIcon}>
                <Ionicons name="storefront-outline" size={19} color={theme.colors.greenDark} />
              </View>
              <View style={styles.branchCopy}>
                <Text style={[styles.branchName, appearance.dark && darkStyles.titleText]}>{branch.name}</Text>
                <Text style={[styles.branchCode, appearance.dark && darkStyles.bodyText]}>
                  {branch.code}{branch.isDefault ? ' · Default' : ''}
                </Text>
              </View>
              {active ? <Ionicons name="checkmark-circle" size={21} color={theme.colors.green} /> : null}
            </Pressable>
          );
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
    whatsappNeedsReview: orders.filter((order) =>
      order.source === 'whatsapp' && ['needs_review', 'draft'].includes(order.status),
    ).length,
    paymentIssues: orders.filter((order) =>
      ['verification_required', 'payment_issue'].includes(order.paymentStatus) &&
      !['rejected', 'cancelled'].includes(order.status),
    ).length,
    ordersNeedingAttention: orders.filter((order) =>
      ['needs_review', 'draft'].includes(order.status) ||
      ['verification_required', 'payment_issue'].includes(order.paymentStatus),
    ).length,
  };
}

function localDayKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, backgroundColor: theme.colors.cloud },
  page: { backgroundColor: theme.colors.cloud },
  stack: { gap: 14 },
  muted: { color: theme.colors.muted, fontSize: 12 },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  pageTitle: { color: theme.colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  pageSubtitle: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
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
});

const darkStyles = StyleSheet.create({
  page: { backgroundColor: '#081825' },
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});