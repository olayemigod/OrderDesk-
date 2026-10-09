import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CatalogueView } from '../components/CatalogueView';
import { ManualOrderComposer } from '../components/ManualOrderComposer';
import { SettingsHub } from '../components/SettingsHub';
import type { MerchantOrder } from '../domain/order';
import { orderTotal } from '../domain/order';
import { useBusinesses } from '../hooks/useBusinesses';
import { useCatalogue } from '../hooks/useCatalogue';
import { useMerchantNotifications } from '../hooks/useMerchantNotifications';
import { useOrders } from '../hooks/useOrders';
import { supabase } from '../lib/supabase';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { HomeDashboard, type HomeAttentionItem } from './HomeDashboard';
import { MobileShell, type SellerTrayPrimaryTab } from './MobileShell';

export default function RedesignWorkspace() {
  const appearance = useSellerTrayAppearance();
  const { activeBusiness, saveProfile } = useBusinesses();
  const [tab, setTab] = useState<SellerTrayPrimaryTab>('home');
  const [merchantName, setMerchantName] = useState('there');

  const {
    orders,
    loading: ordersLoading,
    error: ordersError,
    createOrder,
  } = useOrders(activeBusiness?.id ?? null);
  const catalogue = useCatalogue(activeBusiness?.id ?? null);
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

  const home = useMemo(() => buildHomeSnapshot(orders), [orders]);

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

  const workspaceError = ordersError || catalogue.error || notifications.error;

  return (
    <MobileShell
      activeTab={tab}
      businessName={activeBusiness.name}
      branchName={null}
      notificationCount={notifications.unreadCount}
      orderAttentionCount={home.ordersNeedingAttention}
      syncState={workspaceError ? 'offline' : 'online'}
      onTabChange={setTab}
      onOpenNotifications={() => setTab('orders')}
    >
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
        <View style={styles.stack}>
          <ScreenHeading
            eyebrow="SELL"
            title="Create a sale"
            subtitle="Start with a customer and the products they are buying."
          />
          <ManualOrderComposer
            business={activeBusiness}
            onCreate={createOrder}
            onCreated={() => setTab('orders')}
          />
        </View>
      ) : null}

      {tab === 'orders' ? (
        <OrdersSnapshot
          businessCurrency={activeBusiness.currency}
          orders={orders}
          loading={ordersLoading}
        />
      ) : null}

      {tab === 'inventory' ? (
        <View style={styles.stack}>
          <ScreenHeading
            eyebrow="INVENTORY"
            title="Products and stock"
            subtitle="Find products quickly and keep selling information current."
          />
          <CatalogueView business={activeBusiness} />
        </View>
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

function OrdersSnapshot({
  orders,
  loading,
  businessCurrency,
}: {
  orders: MerchantOrder[];
  loading: boolean;
  businessCurrency: string;
}) {
  const appearance = useSellerTrayAppearance();

  return (
    <View style={styles.stack}>
      <ScreenHeading
        eyebrow="ORDERS"
        title="Orders"
        subtitle="Review customer orders, payment state and fulfilment progress."
      />

      {loading && orders.length === 0 ? (
        <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Loading orders…</Text>
        </View>
      ) : null}

      {!loading && orders.length === 0 ? (
        <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
          <Ionicons name="receipt-outline" size={28} color={theme.colors.greenDark} />
          <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>No orders yet</Text>
          <Text style={[styles.emptyText, appearance.dark && darkStyles.bodyText]}>
            Walk-in and WhatsApp orders will appear here.
          </Text>
        </View>
      ) : null}

      {orders.map((order) => {
        const total = orderTotal(order);
        return (
          <View key={order.id} style={[styles.orderCard, appearance.dark && darkStyles.card]}>
            <View style={styles.orderTopRow}>
              <View style={styles.orderIdentity}>
                <Text style={[styles.customerName, appearance.dark && darkStyles.titleText]}>{order.customerName}</Text>
                <Text style={[styles.orderMeta, appearance.dark && darkStyles.bodyText]}>
                  {order.publicOrderId} · {order.source === 'whatsapp' ? 'WhatsApp' : 'Manual'}
                </Text>
              </View>
              <Text style={[styles.orderValue, appearance.dark && darkStyles.titleText]}>
                {total === null ? 'Needs pricing' : formatMoney(total, businessCurrency)}
              </Text>
            </View>
            <View style={styles.orderStateRow}>
              <StatePill label={titleCase(order.status)} />
              <StatePill label={titleCase(order.paymentStatus)} positive={order.paymentStatus === 'paid'} />
              <StatePill label={titleCase(order.fulfillmentStatus)} positive={order.fulfillmentStatus === 'delivered' || order.fulfillmentStatus === 'collected'} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ScreenHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={styles.heading}>
      <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>{eyebrow}</Text>
      <Text style={[styles.pageTitle, appearance.dark && darkStyles.titleText]}>{title}</Text>
      <Text style={[styles.pageSubtitle, appearance.dark && darkStyles.bodyText]}>{subtitle}</Text>
    </View>
  );
}

function StatePill({ label, positive = false }: { label: string; positive?: boolean }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.statePill, appearance.dark && darkStyles.subtleCard, positive && styles.statePillPositive]}>
      <Text style={[styles.statePillText, appearance.dark && darkStyles.bodyText, positive && styles.statePillTextPositive]}>{label}</Text>
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
    collectedToday: activeTodayOrders.reduce((sum, order) => sum + Math.max(0, order.amountPaid), 0),
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

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
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
  errorCard: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: '#FDA29B',
    backgroundColor: theme.colors.dangerSoft,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
  errorCopy: { flex: 1 },
  errorTitle: { color: '#B42318', fontSize: 13, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 11, lineHeight: 17, marginTop: 2 },
  emptyCard: {
    minHeight: 120,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.white,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  emptyTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  emptyText: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  orderCard: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.white,
    padding: 13,
    gap: 10,
  },
  orderTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  orderIdentity: { flex: 1, minWidth: 0 },
  customerName: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  orderMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 3 },
  orderValue: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  orderStateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statePill: { borderRadius: theme.radius.pill, backgroundColor: '#F2F4F7', paddingHorizontal: 8, paddingVertical: 5 },
  statePillPositive: { backgroundColor: theme.colors.mintSoft },
  statePillText: { color: theme.colors.slate, fontSize: 10, fontWeight: '800' },
  statePillTextPositive: { color: theme.colors.greenDark },
});

const darkStyles = StyleSheet.create({
  page: { backgroundColor: '#081825' },
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});
