import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AuthGate } from './src/components/AuthGate';
import { OrderItemsEditor } from './src/components/OrderItemsEditor';
import type { MerchantBusiness } from './src/data/businessRepository';
import type { OrderItemInput } from './src/data/ordersRepository';
import { orderTotal, type MerchantOrder, type OrderStatus } from './src/domain/order';
import { useBusinesses } from './src/hooks/useBusinesses';
import { useOrders } from './src/hooks/useOrders';
import { supabase } from './src/lib/supabase';

const statusLabels: Record<OrderStatus, string> = {
  draft: 'Draft',
  needs_review: 'Needs review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  processing: 'Processing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const onboardingLabels: Record<MerchantBusiness['onboardingStatus'], string> = {
  profile: 'Business profile',
  catalogue: 'Add catalogue',
  whatsapp: 'Connect WhatsApp',
  test_order: 'Send test order',
  ready: 'Ready',
};

const subscriptionLabels: Record<MerchantBusiness['subscriptionStatus'], string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  grace: 'Grace period',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

const whatsappLabels: Record<MerchantBusiness['whatsappConnectionStatus'], string> = {
  not_connected: 'WhatsApp not connected',
  pending: 'WhatsApp pending',
  connected: 'WhatsApp connected',
  error: 'WhatsApp needs attention',
};

function formatMoney(value: number, currency = 'NGN') {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function App() {
  return (
    <AuthGate>
      <WorkspaceScreen />
    </AuthGate>
  );
}

function WorkspaceScreen() {
  const {
    businesses,
    activeBusiness,
    loading: businessesLoading,
    error: businessesError,
    refresh: refreshBusinesses,
    selectBusiness,
  } = useBusinesses();
  const { orders, loading, error, refresh, setStatus, addItem, editItem, removeItem } = useOrders(
    activeBusiness?.id ?? null,
  );
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [view, setView] = useState<'home' | 'orders'>('home');

  useEffect(() => {
    setSelectedOrderId('');
  }, [activeBusiness?.id]);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? orders[0],
    [orders, selectedOrderId],
  );

  const reviewCount = orders.filter((order) => order.status === 'needs_review').length;
  const inProgressCount = orders.filter((order) =>
    ['accepted', 'processing', 'ready'].includes(order.status),
  ).length;
  const completedCount = orders.filter((order) => order.status === 'completed').length;
  const todayCount = orders.filter(
    (order) => new Date(order.receivedAt).toDateString() === new Date().toDateString(),
  ).length;
  const orderValue = orders.reduce((sum, order) => {
    if (order.status === 'rejected' || order.status === 'cancelled') return sum;
    return sum + (orderTotal(order) ?? 0);
  }, 0);

  const refreshing = businessesLoading || loading;
  const pageError = businessesError || error;

  async function refreshAll() {
    await refreshBusinesses();
    await refresh();
  }

  if (businessesLoading && !activeBusiness) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.metaText}>Opening your OrderDesk workspace…</Text>
      </SafeAreaView>
    );
  }

  if (!activeBusiness) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.emptyTitle}>No business workspace yet</Text>
        <Text style={styles.emptyText}>
          Your merchant account must belong to an OrderDesk business before orders can be managed.
        </Text>
        {businessesError ? <Text style={styles.errorText}>{businessesError}</Text> : null}
        <Pressable onPress={() => void refreshBusinesses()} style={styles.primaryCompactButton}>
          <Text style={styles.primaryCompactButtonText}>Retry</Text>
        </Pressable>
        <Pressable onPress={() => void supabase.auth.signOut()} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} />}
      >
        <View style={styles.workspaceHeader}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ORDERDESK</Text>
            <Text style={styles.businessName}>{activeBusiness.name}</Text>
            <Text style={styles.workspaceMeta}>
              {activeBusiness.role.toUpperCase()} · {subscriptionLabels[activeBusiness.subscriptionStatus]}
            </Text>
          </View>
          <Pressable onPress={() => void supabase.auth.signOut()} style={styles.signOutButton}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>

        {businesses.length > 1 ? (
          <View style={styles.businessSwitcher}>
            <Text style={styles.switcherLabel}>BUSINESS</Text>
            <View style={styles.businessButtons}>
              {businesses.map((business) => (
                <Pressable
                  key={business.id}
                  onPress={() => void selectBusiness(business.id)}
                  style={[
                    styles.businessButton,
                    business.id === activeBusiness.id && styles.businessButtonActive,
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.businessButtonText,
                      business.id === activeBusiness.id && styles.businessButtonTextActive,
                    ]}
                  >
                    {business.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.accountStateRow}>
          <StateBadge
            label={whatsappLabels[activeBusiness.whatsappConnectionStatus]}
            positive={activeBusiness.whatsappConnectionStatus === 'connected'}
          />
          <StateBadge label={`${subscriptionLabels[activeBusiness.subscriptionStatus]} plan`} />
        </View>

        {activeBusiness.onboardingStatus !== 'ready' ? (
          <View style={styles.setupCard}>
            <View style={styles.setupCopy}>
              <Text style={styles.setupEyebrow}>FINISH SETUP</Text>
              <Text style={styles.setupTitle}>{onboardingLabels[activeBusiness.onboardingStatus]}</Text>
              <Text style={styles.setupText}>
                Complete the remaining setup so OrderDesk can automate more of your WhatsApp orders.
              </Text>
            </View>
            <Text style={styles.setupArrow}>→</Text>
          </View>
        ) : null}

        <View style={styles.tabs}>
          <Pressable
            onPress={() => setView('home')}
            style={[styles.tabButton, view === 'home' && styles.tabButtonActive]}
          >
            <Text style={[styles.tabText, view === 'home' && styles.tabTextActive]}>Home</Text>
          </Pressable>
          <Pressable
            onPress={() => setView('orders')}
            style={[styles.tabButton, view === 'orders' && styles.tabButtonActive]}
          >
            <Text style={[styles.tabText, view === 'orders' && styles.tabTextActive]}>Orders</Text>
            {reviewCount > 0 ? <Text style={styles.tabCount}>{reviewCount}</Text> : null}
          </Pressable>
        </View>

        {pageError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Workspace sync problem</Text>
            <Text style={styles.errorText}>{pageError}</Text>
            <Pressable onPress={() => void refreshAll()} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {view === 'home' ? (
          <HomeView
            business={activeBusiness}
            orders={orders}
            loading={loading}
            todayCount={todayCount}
            reviewCount={reviewCount}
            inProgressCount={inProgressCount}
            completedCount={completedCount}
            orderValue={orderValue}
            onOpenOrders={() => setView('orders')}
            onSelectOrder={(orderId) => {
              setSelectedOrderId(orderId);
              setView('orders');
            }}
          />
        ) : (
          <OrdersView
            business={activeBusiness}
            orders={orders}
            loading={loading}
            selectedOrder={selectedOrder}
            onSelectOrder={setSelectedOrderId}
            setStatus={setStatus}
            addItem={addItem}
            editItem={editItem}
            removeItem={removeItem}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function HomeView({
  business,
  orders,
  loading,
  todayCount,
  reviewCount,
  inProgressCount,
  completedCount,
  orderValue,
  onOpenOrders,
  onSelectOrder,
}: {
  business: MerchantBusiness;
  orders: MerchantOrder[];
  loading: boolean;
  todayCount: number;
  reviewCount: number;
  inProgressCount: number;
  completedCount: number;
  orderValue: number;
  onOpenOrders: () => void;
  onSelectOrder: (orderId: string) => void;
}) {
  return (
    <>
      <View style={styles.homeHero}>
        <Text style={styles.homeEyebrow}>BUSINESS OVERVIEW</Text>
        <Text style={styles.homeTitle}>Your WhatsApp orders at a glance.</Text>
        <Text style={styles.homeSubtitle}>
          OrderDesk is tracking activity for {business.name} only.
        </Text>
      </View>

      <View style={styles.statsGrid}>
        <MetricCard label="Today" value={String(todayCount)} helper="orders received" />
        <MetricCard label="Needs review" value={String(reviewCount)} helper="waiting for action" />
        <MetricCard label="In progress" value={String(inProgressCount)} helper="accepted to ready" />
        <MetricCard label="Completed" value={String(completedCount)} helper="all completed" />
      </View>

      <View style={styles.valueCard}>
        <Text style={styles.valueLabel}>ORDER VALUE</Text>
        <Text style={styles.valueAmount}>{formatMoney(orderValue, business.currency)}</Text>
        <Text style={styles.valueHelper}>Known value across current non-cancelled orders</Text>
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Recent orders</Text>
        <Pressable onPress={onOpenOrders}>
          <Text style={styles.sectionLink}>View all</Text>
        </Pressable>
      </View>

      {loading && orders.length === 0 ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator />
          <Text style={styles.metaText}>Loading orders…</Text>
        </View>
      ) : null}

      {!loading && orders.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No orders for this business yet</Text>
          <Text style={styles.emptyText}>
            New WhatsApp orders will appear here when this business receives them.
          </Text>
        </View>
      ) : null}

      <View style={styles.inbox}>
        {orders.slice(0, 3).map((order) => (
          <OrderCard key={order.id} order={order} onPress={() => onSelectOrder(order.id)} />
        ))}
      </View>
    </>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricHelper}>{helper}</Text>
    </View>
  );
}

function StateBadge({ label, positive = false }: { label: string; positive?: boolean }) {
  return (
    <View style={[styles.stateBadge, positive && styles.stateBadgePositive]}>
      <Text style={[styles.stateBadgeText, positive && styles.stateBadgeTextPositive]}>{label}</Text>
    </View>
  );
}

function OrdersView({
  business,
  orders,
  loading,
  selectedOrder,
  onSelectOrder,
  setStatus,
  addItem,
  editItem,
  removeItem,
}: {
  business: MerchantBusiness;
  orders: MerchantOrder[];
  loading: boolean;
  selectedOrder: MerchantOrder | undefined;
  onSelectOrder: (orderId: string) => void;
  setStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  addItem: (orderId: string, item: OrderItemInput) => Promise<void>;
  editItem: (itemId: string, item: OrderItemInput) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
}) {
  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.sectionTitle}>Order inbox</Text>
          <Text style={styles.sectionSubtitle}>Only {business.name} orders are shown here.</Text>
        </View>
      </View>

      {loading && orders.length === 0 ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator />
          <Text style={styles.metaText}>Loading orders…</Text>
        </View>
      ) : null}

      {!loading && orders.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptyText}>
            New WhatsApp orders will appear here as soon as OrderDesk creates them for this business.
          </Text>
        </View>
      ) : null}

      <View style={styles.inbox}>
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            selected={selectedOrder?.id === order.id}
            onPress={() => onSelectOrder(order.id)}
          />
        ))}
      </View>

      {selectedOrder ? (
        <OrderDetail
          order={selectedOrder}
          currency={business.currency}
          onAccept={() => setStatus(selectedOrder.id, 'accepted')}
          onReject={() => setStatus(selectedOrder.id, 'rejected')}
          onStart={() => setStatus(selectedOrder.id, 'processing')}
          onReady={() => setStatus(selectedOrder.id, 'ready')}
          onComplete={() => setStatus(selectedOrder.id, 'completed')}
          onAddItem={(input) => addItem(selectedOrder.id, input)}
          onEditItem={editItem}
          onRemoveItem={removeItem}
        />
      ) : null}
    </>
  );
}

function OrderCard({
  order,
  selected = false,
  onPress,
}: {
  order: MerchantOrder;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.orderCard, selected && styles.orderCardSelected]}
    >
      <View style={styles.orderCardTop}>
        <View style={styles.orderCardIdentity}>
          <Text style={styles.customerName}>{order.customerName}</Text>
          <Text style={styles.orderId}>{order.id}</Text>
        </View>
        <StatusPill status={order.status} />
      </View>
      <Text numberOfLines={2} style={styles.messagePreview}>
        {order.customerMessage || 'No customer message captured.'}
      </Text>
      <View style={styles.orderMeta}>
        <Text style={styles.metaText}>
          {order.items.length} item{order.items.length === 1 ? '' : 's'}
        </Text>
        <Text style={styles.metaText}>{order.source === 'whatsapp' ? 'WhatsApp' : 'Manual'}</Text>
        <Text style={styles.metaText}>
          {order.confidence === null ? 'Unscored' : `${Math.round(order.confidence * 100)}% parsed`}
        </Text>
      </View>
    </Pressable>
  );
}

function OrderDetail({
  order,
  currency,
  onAccept,
  onReject,
  onStart,
  onReady,
  onComplete,
  onAddItem,
  onEditItem,
  onRemoveItem,
}: {
  order: MerchantOrder;
  currency: string;
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
  onStart: () => Promise<void>;
  onReady: () => Promise<void>;
  onComplete: () => Promise<void>;
  onAddItem: (item: OrderItemInput) => Promise<void>;
  onEditItem: (itemId: string, item: OrderItemInput) => Promise<void>;
  onRemoveItem: (itemId: string) => Promise<void>;
}) {
  const total = orderTotal(order);
  const editable = order.status === 'needs_review' || order.status === 'draft';
  const canAccept = order.items.length > 0 && order.items.every((item) => item.unitPrice !== null);

  return (
    <View style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <View>
          <Text style={styles.detailTitle}>{order.customerName}</Text>
          <Text style={styles.phone}>{order.customerPhone}</Text>
        </View>
        <StatusPill status={order.status} />
      </View>

      <View style={styles.sourceMessage}>
        <Text style={styles.sourceLabel}>CUSTOMER MESSAGE</Text>
        <Text style={styles.sourceText}>
          {order.customerMessage || 'No customer message captured.'}
        </Text>
      </View>

      <View style={styles.itemsHeadingRow}>
        <Text style={styles.itemsTitle}>{editable ? 'Review order items' : 'Order items'}</Text>
        {editable ? <Text style={styles.reviewHint}>Correct AI parsing before acceptance</Text> : null}
      </View>

      <OrderItemsEditor
        order={order}
        editable={editable}
        onAdd={(_orderId, item) => onAddItem(item)}
        onEdit={onEditItem}
        onRemove={onRemoveItem}
      />

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Order total</Text>
        <Text style={styles.totalValue}>
          {total === null ? 'Needs pricing' : formatMoney(total, currency)}
        </Text>
      </View>

      {editable && !canAccept ? (
        <View style={styles.acceptanceNotice}>
          <Text style={styles.acceptanceNoticeTitle}>Complete the order before accepting</Text>
          <Text style={styles.acceptanceNoticeText}>
            An accepted order must contain at least one item and every item must have a selling price.
          </Text>
        </View>
      ) : null}

      <ActionBar
        status={order.status}
        canAccept={canAccept}
        onAccept={onAccept}
        onReject={onReject}
        onStart={onStart}
        onReady={onReady}
        onComplete={onComplete}
      />
    </View>
  );
}

function ActionBar({
  status,
  canAccept,
  onAccept,
  onReject,
  onStart,
  onReady,
  onComplete,
}: {
  status: OrderStatus;
  canAccept: boolean;
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
  onStart: () => Promise<void>;
  onReady: () => Promise<void>;
  onComplete: () => Promise<void>;
}) {
  if (status === 'needs_review' || status === 'draft') {
    return (
      <View style={styles.actions}>
        <ActionButton label="Reject" variant="secondary" onPress={() => void onReject()} />
        <ActionButton label="Accept order" disabled={!canAccept} onPress={() => void onAccept()} />
      </View>
    );
  }

  if (status === 'accepted') {
    return <ActionButton label="Start processing" onPress={() => void onStart()} />;
  }
  if (status === 'processing') {
    return <ActionButton label="Mark ready" onPress={() => void onReady()} />;
  }
  if (status === 'ready') {
    return <ActionButton label="Complete order" onPress={() => void onComplete()} />;
  }

  return null;
}

function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === 'secondary' && styles.actionButtonSecondary,
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.actionButtonPressed,
      ]}
    >
      <Text
        style={[
          styles.actionButtonText,
          variant === 'secondary' && styles.actionButtonSecondaryText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <View style={[styles.statusPill, status === 'needs_review' && styles.statusReview]}>
      <Text style={styles.statusText}>{statusLabels[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F7F9' },
  centered: {
    flex: 1,
    backgroundColor: '#F6F7F9',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
  },
  page: { padding: 20, paddingBottom: 56, gap: 16 },
  workspaceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, color: '#246BFD' },
  businessName: { fontSize: 27, fontWeight: '900', color: '#101828', marginTop: 3 },
  workspaceMeta: { color: '#667085', marginTop: 4, fontSize: 12, fontWeight: '700' },
  signOutButton: { paddingVertical: 6, paddingHorizontal: 2 },
  signOutText: { color: '#667085', fontWeight: '700', fontSize: 12 },
  businessSwitcher: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EAECF0',
    padding: 12,
    gap: 9,
  },
  switcherLabel: { color: '#98A2B3', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  businessButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  businessButton: {
    maxWidth: '100%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  businessButtonActive: { borderColor: '#246BFD', backgroundColor: '#EEF4FF' },
  businessButtonText: { color: '#667085', fontWeight: '700', fontSize: 12 },
  businessButtonTextActive: { color: '#175CD3' },
  accountStateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stateBadge: {
    borderRadius: 999,
    backgroundColor: '#F2F4F7',
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  stateBadgePositive: { backgroundColor: '#ECFDF3' },
  stateBadgeText: { color: '#475467', fontSize: 11, fontWeight: '800' },
  stateBadgeTextPositive: { color: '#027A48' },
  setupCard: {
    backgroundColor: '#101828',
    borderRadius: 18,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  setupCopy: { flex: 1 },
  setupEyebrow: { color: '#84ADFF', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  setupTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', marginTop: 5 },
  setupText: { color: '#D0D5DD', fontSize: 12, lineHeight: 18, marginTop: 5 },
  setupArrow: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#EAECF0',
    padding: 4,
    borderRadius: 14,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  tabButtonActive: { backgroundColor: '#FFFFFF' },
  tabText: { color: '#667085', fontSize: 13, fontWeight: '800' },
  tabTextActive: { color: '#101828' },
  tabCount: {
    color: '#FFFFFF',
    backgroundColor: '#246BFD',
    borderRadius: 999,
    minWidth: 19,
    textAlign: 'center',
    overflow: 'hidden',
    paddingHorizontal: 5,
    fontSize: 11,
    fontWeight: '900',
  },
  homeHero: { paddingTop: 5, gap: 5 },
  homeEyebrow: { color: '#98A2B3', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  homeTitle: { color: '#101828', fontSize: 25, lineHeight: 31, fontWeight: '900' },
  homeSubtitle: { color: '#667085', fontSize: 13, lineHeight: 19 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 145,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 16,
    padding: 15,
  },
  metricLabel: { color: '#667085', fontSize: 11, fontWeight: '800' },
  metricValue: { color: '#101828', fontSize: 28, fontWeight: '900', marginTop: 5 },
  metricHelper: { color: '#98A2B3', fontSize: 11, marginTop: 3 },
  valueCard: { backgroundColor: '#EEF4FF', borderRadius: 18, padding: 18 },
  valueLabel: { color: '#175CD3', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  valueAmount: { color: '#101828', fontSize: 28, fontWeight: '900', marginTop: 6 },
  valueHelper: { color: '#667085', fontSize: 11, marginTop: 4 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  sectionTitle: { fontSize: 16, fontWeight: '900', color: '#111827' },
  sectionSubtitle: { color: '#98A2B3', fontSize: 11, marginTop: 3 },
  sectionLink: { color: '#246BFD', fontSize: 12, fontWeight: '800' },
  inbox: { gap: 10 },
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  orderCardSelected: { borderColor: '#246BFD', borderWidth: 2 },
  orderCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  orderCardIdentity: { flex: 1 },
  customerName: { fontSize: 16, fontWeight: '800', color: '#101828' },
  orderId: { marginTop: 2, fontSize: 11, color: '#98A2B3' },
  messagePreview: { color: '#475467', fontSize: 14, lineHeight: 20, marginTop: 10 },
  orderMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  metaText: { color: '#667085', fontSize: 12 },
  statusPill: {
    borderRadius: 999,
    backgroundColor: '#EAECF0',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  statusReview: { backgroundColor: '#FFF3D6' },
  statusText: { fontSize: 11, fontWeight: '800', color: '#344054' },
  detailCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  detailTitle: { fontSize: 20, fontWeight: '800', color: '#101828' },
  phone: { marginTop: 3, fontSize: 13, color: '#667085' },
  sourceMessage: { backgroundColor: '#F9FAFB', borderRadius: 14, padding: 14, marginTop: 16 },
  sourceLabel: { fontSize: 10, fontWeight: '800', color: '#98A2B3', letterSpacing: 1 },
  sourceText: { marginTop: 7, color: '#344054', fontSize: 14, lineHeight: 21 },
  itemsHeadingRow: { marginTop: 18, marginBottom: 8, gap: 3 },
  itemsTitle: { fontSize: 14, fontWeight: '800', color: '#101828' },
  reviewHint: { color: '#667085', fontSize: 12 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
  },
  totalLabel: { color: '#667085', fontWeight: '700' },
  totalValue: { color: '#101828', fontWeight: '900', fontSize: 20 },
  acceptanceNotice: { backgroundColor: '#FFF8E7', borderRadius: 12, padding: 12, marginTop: 14 },
  acceptanceNoticeTitle: { color: '#7A2E0E', fontWeight: '800', fontSize: 13 },
  acceptanceNoticeText: { color: '#854A0E', marginTop: 4, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  actionButton: {
    flex: 1,
    backgroundColor: '#246BFD',
    borderRadius: 13,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 18,
  },
  actionButtonSecondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD' },
  actionButtonDisabled: { opacity: 0.35 },
  actionButtonPressed: { opacity: 0.75 },
  actionButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  actionButtonSecondaryText: { color: '#344054' },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 14, padding: 14, gap: 6 },
  errorTitle: { color: '#B42318', fontWeight: '800' },
  errorText: { color: '#912018', fontSize: 13, lineHeight: 18 },
  retryButton: { alignSelf: 'flex-start', marginTop: 4 },
  retryText: { color: '#B42318', fontWeight: '800' },
  loadingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    gap: 10,
    alignItems: 'center',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  emptyTitle: { color: '#101828', fontWeight: '800', fontSize: 16, textAlign: 'center' },
  emptyText: { color: '#667085', marginTop: 6, lineHeight: 20, textAlign: 'center' },
  primaryCompactButton: {
    backgroundColor: '#246BFD',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  primaryCompactButtonText: { color: '#FFFFFF', fontWeight: '800' },
});
