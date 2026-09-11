import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AccountDataControls } from './components/AccountDataControls';
import { BusinessInsightsPanel } from './components/BusinessInsightsPanel';
import { CatalogueView } from './components/CatalogueView';
import { ManualOrderComposer } from './components/ManualOrderComposer';
import { OrderItemsEditor } from './components/OrderItemsEditor';
import { OrderStatusHistory } from './components/OrderStatusHistory';
import { OrderWorkflowPanel } from './components/OrderWorkflowPanel';
import { SettingsHub } from './components/SettingsHub';
import { SetupGuideCard } from './components/SetupGuideCard';
import type { MerchantBusiness } from './data/businessRepository';
import type { OrderItemInput } from './data/ordersRepository';
import { orderTotal, type MerchantOrder, type OrderStatus } from './domain/order';
import { useBusinesses } from './hooks/useBusinesses';
import { useCatalogue } from './hooks/useCatalogue';
import { useOrders } from './hooks/useOrders';
import { supabase } from './lib/supabase';

type ViewName = 'home' | 'orders' | 'products' | 'more';
type OrderFilter = 'attention' | 'active' | 'done' | 'all';

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

const onboardingLabels: Record<MerchantBusiness['onboardingStatus'], string> = {
  profile: 'Complete business profile',
  catalogue: 'Add your catalogue',
  whatsapp: 'Connect WhatsApp',
  test_order: 'Send a test order',
  ready: 'Ready',
};

export default function SaasApp() {
  return <Workspace />;
}

function Workspace() {
  const {
    businesses,
    activeBusiness,
    loading: businessesLoading,
    error: businessesError,
    refresh: refreshBusinesses,
    selectBusiness,
    saveProfile,
  } = useBusinesses();
  const { orders, loading, error, refresh, createOrder, setStatus, addItem, editItem, removeItem } = useOrders(
    activeBusiness?.id ?? null,
  );
  const catalogue = useCatalogue(activeBusiness?.id ?? null);
  const [view, setView] = useState<ViewName>('home');
  const [selectedOrderId, setSelectedOrderId] = useState('');

  useEffect(() => {
    setSelectedOrderId('');
    setView('home');
  }, [activeBusiness?.id]);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId),
    [orders, selectedOrderId],
  );

  const reviewCount = orders.filter((order) => order.status === 'needs_review' || order.status === 'draft').length;

  async function refreshAll() {
    await refreshBusinesses();
    await refresh();
  }

  if (businessesLoading && !activeBusiness) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Opening SellerTray…</Text>
      </SafeAreaView>
    );
  }

  if (!activeBusiness) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.emptyTitle}>No business workspace yet</Text>
        <Text style={styles.emptyText}>Your account is not attached to an SellerTray business.</Text>
        {businessesError ? <Text style={styles.errorText}>{businessesError}</Text> : null}
        <Pressable onPress={() => void refreshBusinesses()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
        <View style={styles.noWorkspaceAccount}>
          <AccountDataControls />
        </View>
        <Pressable onPress={() => void supabase.auth.signOut({ scope: 'local' })}>
          <Text style={styles.linkText}>Sign out</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const pageError = businessesError || error;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.appFrame}>
        <ScrollView
          contentContainerStyle={styles.page}
          refreshControl={
            <RefreshControl
              refreshing={businessesLoading || loading}
              onRefresh={() => void refreshAll()}
            />
          }
        >
          <WorkspaceHeader
            business={activeBusiness}
            businesses={businesses}
            onSelectBusiness={selectBusiness}
          />

          {pageError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Workspace sync problem</Text>
              <Text style={styles.errorText}>{pageError}</Text>
              <Pressable onPress={() => void refreshAll()}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {view === 'home' ? (
            <HomeView
              business={activeBusiness}
              orders={orders}
              loading={loading}
              productCount={catalogue.items.filter((item) => item.isActive).length}
              onOpenOrders={() => {
                setSelectedOrderId('');
                setView('orders');
              }}
              onOpenProducts={() => setView('products')}
              onOpenMore={() => setView('more')}
              onSelectOrder={(id) => {
                setSelectedOrderId(id);
                setView('orders');
              }}
            />
          ) : null}

          {view === 'orders' ? (
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
              createOrder={createOrder}
            />
          ) : null}

          {view === 'products' ? (
            <CatalogueView business={activeBusiness} />
          ) : null}

          {view === 'more' ? (
            <SettingsHub business={activeBusiness} onSaveBusiness={saveProfile} />
          ) : null}
        </ScrollView>

        <BottomNav
          view={view}
          reviewCount={reviewCount}
          onChange={(nextView) => {
            if (nextView === 'orders' && view !== 'orders') setSelectedOrderId('');
            setView(nextView);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

function WorkspaceHeader({
  business,
  businesses,
  onSelectBusiness,
}: {
  business: MerchantBusiness;
  businesses: MerchantBusiness[];
  onSelectBusiness: (businessId: string) => Promise<void>;
}) {
  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>SELLERTRAY</Text>
          <Text style={styles.businessName}>{business.name}</Text>
          <Text style={styles.workspaceMeta}>
            {business.role.toUpperCase()} · {subscriptionLabels[business.subscriptionStatus]}
          </Text>
        </View>
        <Pressable onPress={() => void supabase.auth.signOut()} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      {businesses.length > 1 ? (
        <View style={styles.switcherCard}>
          <Text style={styles.switcherLabel}>BUSINESS</Text>
          <View style={styles.switcherButtons}>
            {businesses.map((candidate) => (
              <Pressable
                key={candidate.id}
                onPress={() => void onSelectBusiness(candidate.id)}
                style={[
                  styles.switcherButton,
                  candidate.id === business.id && styles.switcherButtonActive,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.switcherButtonText,
                    candidate.id === business.id && styles.switcherButtonTextActive,
                  ]}
                >
                  {candidate.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.stateRow}>
        <Badge
          label={whatsappLabels[business.whatsappConnectionStatus]}
          positive={business.whatsappConnectionStatus === 'connected'}
        />
        <Badge label={`${subscriptionLabels[business.subscriptionStatus]} plan`} />
      </View>
    </>
  );
}

function HomeView({
  business,
  orders,
  loading,
  productCount,
  onOpenOrders,
  onOpenProducts,
  onOpenMore,
  onSelectOrder,
}: {
  business: MerchantBusiness;
  orders: MerchantOrder[];
  loading: boolean;
  productCount: number;
  onOpenOrders: () => void;
  onOpenProducts: () => void;
  onOpenMore: () => void;
  onSelectOrder: (orderId: string) => void;
}) {
  return (
    <View style={styles.sectionStack}>
      <View>
        <Text style={styles.sectionEyebrow}>BUSINESS OVERVIEW</Text>
        <Text style={styles.pageTitle}>WhatsApp orders at a glance.</Text>
        <Text style={styles.pageSubtitle}>Activity shown here belongs only to {business.name}.</Text>
      </View>

      <SetupGuideCard
        business={business}
        productCount={productCount}
        orderCount={orders.length}
        onProducts={onOpenProducts}
        onOrders={onOpenOrders}
        onMore={onOpenMore}
      />

      <BusinessInsightsPanel business={business} />

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent orders</Text>
        <Pressable onPress={onOpenOrders}>
          <Text style={styles.linkText}>View all</Text>
        </Pressable>
      </View>

      <OrderList
        orders={orders.slice(0, 3)}
        loading={loading}
        selectedOrderId=""
        currency={business.currency}
        onSelect={onSelectOrder}
        emptyText="No WhatsApp orders have arrived for this business yet."
      />
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
  createOrder,
}: {
  business: MerchantBusiness;
  orders: MerchantOrder[];
  loading: boolean;
  selectedOrder: MerchantOrder | undefined;
  onSelectOrder: (orderId: string) => void;
  setStatus: (orderId: string, status: OrderStatus, reason?: string | null) => Promise<void>;
  addItem: (orderId: string, item: OrderItemInput) => Promise<void>;
  editItem: (itemId: string, item: OrderItemInput) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  createOrder: (input: {
    customerName: string;
    customerPhone: string;
    note?: string | null;
    items: Array<{ catalogItemId: string; quantity: number }>;
  }) => Promise<string>;
}) {
  const [filter, setFilter] = useState<OrderFilter>('attention');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!selectedOrder) return;

    if (selectedOrder.status === 'needs_review' || selectedOrder.status === 'draft') {
      setFilter('attention');
    } else if (['accepted', 'processing', 'ready'].includes(selectedOrder.status)) {
      setFilter('active');
    } else if (selectedOrder.status === 'completed') {
      setFilter('done');
    } else {
      setFilter('all');
    }
  }, [selectedOrder?.id, selectedOrder?.status]);

  const filterCounts = useMemo(
    () => ({
      attention: orders.filter((order) => order.status === 'needs_review' || order.status === 'draft').length,
      active: orders.filter((order) => ['accepted', 'processing', 'ready'].includes(order.status)).length,
      done: orders.filter((order) => order.status === 'completed').length,
      all: orders.length,
    }),
    [orders],
  );

  const visibleOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return orders.filter((order) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'attention' && (order.status === 'needs_review' || order.status === 'draft')) ||
        (filter === 'active' && ['accepted', 'processing', 'ready'].includes(order.status)) ||
        (filter === 'done' && order.status === 'completed');

      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;

      const searchable = [
        order.id,
        order.customerName,
        order.customerPhone,
        order.customerMessage,
        order.statusReason ?? '',
        ...order.items.flatMap((item) => [item.name, item.originalName ?? '']),
      ]
        .join(' ')
        .toLocaleLowerCase();

      return searchable.includes(normalizedQuery);
    });
  }, [filter, orders, query]);

  const visibleSelectedOrder =
    visibleOrders.find((order) => order.id === selectedOrder?.id) ?? visibleOrders[0];

  const emptyText = query.trim()
    ? 'No orders match this search inside the selected workflow view.'
    : filter === 'attention'
      ? 'No orders need review right now.'
      : filter === 'active'
        ? 'No accepted, processing or ready orders right now.'
        : filter === 'done'
          ? 'No completed orders yet.'
          : 'No orders yet. New WhatsApp orders will appear here automatically.';

  return (
    <View style={styles.sectionStack}>
      <View>
        <Text style={styles.sectionEyebrow}>ORDER INBOX</Text>
        <Text style={styles.pageTitle}>Orders</Text>
        <Text style={styles.pageSubtitle}>Review and progress {business.name} orders.</Text>
      </View>

      <ManualOrderComposer
        business={business}
        onCreate={createOrder}
        onCreated={(orderId) => {
          onSelectOrder(orderId);
          setFilter('all');
        }}
      />

      <View style={styles.inboxControls}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search customer, phone, message or product"
          autoCorrect={false}
          style={styles.searchInput}
        />
        <View style={styles.filterRow}>
          <OrderFilterButton
            label="Needs review"
            count={filterCounts.attention}
            active={filter === 'attention'}
            onPress={() => setFilter('attention')}
          />
          <OrderFilterButton
            label="In progress"
            count={filterCounts.active}
            active={filter === 'active'}
            onPress={() => setFilter('active')}
          />
          <OrderFilterButton
            label="Completed"
            count={filterCounts.done}
            active={filter === 'done'}
            onPress={() => setFilter('done')}
          />
          <OrderFilterButton
            label="All"
            count={filterCounts.all}
            active={filter === 'all'}
            onPress={() => setFilter('all')}
          />
        </View>
      </View>

      <Text style={styles.resultMeta}>
        Showing {visibleOrders.length} of {orders.length} order{orders.length === 1 ? '' : 's'}
      </Text>

      <OrderList
        orders={visibleOrders}
        loading={loading}
        selectedOrderId={visibleSelectedOrder?.id ?? ''}
        currency={business.currency}
        onSelect={onSelectOrder}
        emptyText={emptyText}
      />

      {visibleSelectedOrder ? (
        <OrderDetail
          order={visibleSelectedOrder}
          currency={business.currency}
          onAccept={() => setStatus(visibleSelectedOrder.id, 'accepted')}
          onReject={(reason) => setStatus(visibleSelectedOrder.id, 'rejected', reason)}
          onStart={() => setStatus(visibleSelectedOrder.id, 'processing')}
          onReady={() => setStatus(visibleSelectedOrder.id, 'ready')}
          onComplete={() => setStatus(visibleSelectedOrder.id, 'completed')}
          onCancel={(reason) => setStatus(visibleSelectedOrder.id, 'cancelled', reason)}
          onAddItem={(item) => addItem(visibleSelectedOrder.id, item)}
          onEditItem={editItem}
          onRemoveItem={removeItem}
        />
      ) : null}
    </View>
  );
}

function OrderFilterButton({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filterButton, active && styles.filterButtonActive]}
    >
      <Text style={[styles.filterButtonText, active && styles.filterButtonTextActive]}>{label}</Text>
      <Text style={[styles.filterCount, active && styles.filterCountActive]}>{count}</Text>
    </Pressable>
  );
}

function OrderList({
  orders,
  loading,
  selectedOrderId,
  currency,
  onSelect,
  emptyText,
}: {
  orders: MerchantOrder[];
  loading: boolean;
  selectedOrderId: string;
  currency: string;
  onSelect: (orderId: string) => void;
  emptyText: string;
}) {
  if (loading && orders.length === 0) {
    return (
      <View style={styles.loadingCard}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading orders…</Text>
      </View>
    );
  }

  if (!loading && orders.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>Nothing here</Text>
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <View style={styles.orderList}>
      {orders.map((order) => {
        const total = orderTotal(order);
        const reviewChecks = order.reviewReasons.length;

        return (
          <Pressable
            key={order.id}
            onPress={() => onSelect(order.id)}
            style={[styles.orderCard, selectedOrderId === order.id && styles.orderCardSelected]}
          >
            <View style={styles.orderTopRow}>
              <View style={styles.orderIdentity}>
                <Text style={styles.customerName}>{order.customerName}</Text>
                <Text numberOfLines={1} style={styles.orderId}>{formatReceivedAt(order.receivedAt)} · {order.id}</Text>
              </View>
              <View style={styles.orderRight}>
                <StatusPill status={order.status} />
                <Text style={[styles.orderValue, total === null && styles.orderValuePending]}>
                  {total === null ? 'Needs pricing' : formatMoney(total, currency)}
                </Text>
              </View>
            </View>
            <Text numberOfLines={2} style={styles.orderMessage}>
              {order.customerMessage || 'No customer message captured.'}
            </Text>
            {order.statusReason ? <Text numberOfLines={1} style={styles.closureMeta}>Reason: {order.statusReason}</Text> : null}
            <Text style={styles.orderMeta}>
              {order.items.length} item{order.items.length === 1 ? '' : 's'} · {order.source === 'whatsapp' ? 'WhatsApp' : 'Manual'} · {order.confidence === null ? 'Unscored' : `${Math.round(order.confidence * 100)}% parsed`}{reviewChecks > 0 ? ` · ${reviewChecks} initial review check${reviewChecks === 1 ? '' : 's'}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
  onCancel,
  onAddItem,
  onEditItem,
  onRemoveItem,
}: {
  order: MerchantOrder;
  currency: string;
  onAccept: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onStart: () => Promise<void>;
  onReady: () => Promise<void>;
  onComplete: () => Promise<void>;
  onCancel: (reason: string) => Promise<void>;
  onAddItem: (item: OrderItemInput) => Promise<void>;
  onEditItem: (itemId: string, item: OrderItemInput) => Promise<void>;
  onRemoveItem: (itemId: string) => Promise<void>;
}) {
  const total = orderTotal(order);
  const editable = order.status === 'needs_review' || order.status === 'draft';

  return (
    <View style={styles.detailCard}>
      <View style={styles.orderTopRow}>
        <View style={styles.orderIdentity}>
          <Text style={styles.detailTitle}>{order.customerName}</Text>
          <Text style={styles.orderMeta}>{order.customerPhone}</Text>
          <Text style={styles.orderMeta}>{formatReceivedAt(order.receivedAt)} · {order.source === 'whatsapp' ? 'WhatsApp' : 'Manual'}</Text>
        </View>
        <StatusPill status={order.status} />
      </View>

      <View style={styles.messageCard}>
        <Text style={styles.sectionEyebrow}>CUSTOMER MESSAGE</Text>
        <Text style={styles.messageText}>{order.customerMessage || 'No message captured.'}</Text>
      </View>

      <View>
        <Text style={styles.sectionTitle}>{editable ? 'Review order items' : 'Order items'}</Text>
        {editable ? <Text style={styles.pageSubtitle}>Correct AI interpretation and prices before acceptance.</Text> : null}
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
        <Text style={styles.totalValue}>{total === null ? 'Needs pricing' : formatMoney(total, currency)}</Text>
      </View>

      <OrderWorkflowPanel
        order={order}
        onAccept={onAccept}
        onReject={onReject}
        onStart={onStart}
        onReady={onReady}
        onComplete={onComplete}
        onCancel={onCancel}
      />

      <OrderStatusHistory order={order} />
    </View>
  );
}

function BottomNav({
  view,
  reviewCount,
  onChange,
}: {
  view: ViewName;
  reviewCount: number;
  onChange: (view: ViewName) => void;
}) {
  return (
    <View style={styles.bottomNav}>
      <NavButton label="Home" active={view === 'home'} onPress={() => onChange('home')} />
      <NavButton label="Orders" active={view === 'orders'} count={reviewCount} onPress={() => onChange('orders')} />
      <NavButton label="Products" active={view === 'products'} onPress={() => onChange('products')} />
      <NavButton label="More" active={view === 'more'} onPress={() => onChange('more')} />
    </View>
  );
}

function NavButton({
  label,
  active,
  count = 0,
  onPress,
}: {
  label: string;
  active: boolean;
  count?: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.navButton, active && styles.navButtonActive]}>
      <Text style={[styles.navText, active && styles.navTextActive]}>{label}</Text>
      {count > 0 ? <Text style={styles.navCount}>{count}</Text> : null}
    </Pressable>
  );
}

function Badge({ label, positive = false }: { label: string; positive?: boolean }) {
  return (
    <View style={[styles.badge, positive && styles.badgePositive]}>
      <Text style={[styles.badgeText, positive && styles.badgeTextPositive]}>{label}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <View style={[styles.statusPill, status === 'needs_review' && styles.statusReview]}>
      <Text style={styles.statusText}>{statusLabels[status]}</Text>
    </View>
  );
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatReceivedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F7F9', paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0 },
  appFrame: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12, backgroundColor: '#F6F7F9' },
  noWorkspaceAccount: { width: '100%', maxWidth: 620 },
  page: { padding: 18, paddingBottom: 34, gap: 15 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#246BFD', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  businessName: { color: '#101828', fontSize: 25, fontWeight: '900', marginTop: 3 },
  workspaceMeta: { color: '#667085', fontSize: 11, fontWeight: '800', marginTop: 4 },
  signOutButton: { paddingVertical: 5 },
  signOutText: { color: '#667085', fontSize: 11, fontWeight: '800' },
  switcherCard: { backgroundColor: '#FFFFFF', borderRadius: 15, borderWidth: 1, borderColor: '#EAECF0', padding: 11, gap: 8 },
  switcherLabel: { color: '#98A2B3', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  switcherButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  switcherButton: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 10 },
  switcherButtonActive: { borderColor: '#246BFD', backgroundColor: '#EEF4FF' },
  switcherButtonText: { color: '#667085', fontSize: 11, fontWeight: '800', maxWidth: 210 },
  switcherButtonTextActive: { color: '#175CD3' },
  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  badge: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#F2F4F7' },
  badgePositive: { backgroundColor: '#ECFDF3' },
  badgeText: { color: '#475467', fontSize: 10, fontWeight: '800' },
  badgeTextPositive: { color: '#027A48' },
  setupCard: { backgroundColor: '#101828', borderRadius: 17, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  setupCopy: { flex: 1 },
  setupEyebrow: { color: '#84ADFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  setupTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '900', marginTop: 4 },
  setupText: { color: '#D0D5DD', fontSize: 11, lineHeight: 17, marginTop: 4 },
  setupArrow: { color: '#FFFFFF', fontSize: 23, fontWeight: '900' },
  sectionStack: { gap: 14 },
  sectionEyebrow: { color: '#98A2B3', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  pageTitle: { color: '#101828', fontSize: 24, lineHeight: 30, fontWeight: '900', marginTop: 3 },
  pageSubtitle: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 3 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: '#101828', fontSize: 15, fontWeight: '900' },
  linkText: { color: '#246BFD', fontSize: 12, fontWeight: '800' },
  inboxControls: { gap: 9 },
  searchInput: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 12, paddingHorizontal: 13, backgroundColor: '#FFFFFF', color: '#101828' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, borderRadius: 999, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', paddingHorizontal: 11 },
  filterButtonActive: { borderColor: '#246BFD', backgroundColor: '#EEF4FF' },
  filterButtonText: { color: '#667085', fontSize: 11, fontWeight: '800' },
  filterButtonTextActive: { color: '#175CD3' },
  filterCount: { minWidth: 18, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden', textAlign: 'center', backgroundColor: '#F2F4F7', color: '#475467', fontSize: 9, fontWeight: '900' },
  filterCountActive: { backgroundColor: '#246BFD', color: '#FFFFFF' },
  resultMeta: { color: '#98A2B3', fontSize: 10, fontWeight: '700' },
  orderList: { gap: 9 },
  orderCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 15, padding: 13 },
  orderCardSelected: { borderColor: '#246BFD', borderWidth: 2 },
  orderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  orderIdentity: { flex: 1 },
  orderRight: { alignItems: 'flex-end', gap: 6 },
  customerName: { color: '#101828', fontSize: 15, fontWeight: '900' },
  orderId: { color: '#98A2B3', fontSize: 10, marginTop: 2 },
  orderValue: { color: '#101828', fontSize: 11, fontWeight: '900' },
  orderValuePending: { color: '#B54708' },
  orderMessage: { color: '#475467', fontSize: 13, lineHeight: 19, marginTop: 9 },
  closureMeta: { color: '#B54708', fontSize: 10, fontWeight: '700', marginTop: 6 },
  orderMeta: { color: '#667085', fontSize: 10, marginTop: 8 },
  statusPill: { borderRadius: 999, backgroundColor: '#EAECF0', paddingVertical: 5, paddingHorizontal: 8 },
  statusReview: { backgroundColor: '#FFF3D6' },
  statusText: { color: '#344054', fontSize: 10, fontWeight: '900' },
  detailCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 18, padding: 16, gap: 14 },
  detailTitle: { color: '#101828', fontSize: 19, fontWeight: '900' },
  messageCard: { backgroundColor: '#F9FAFB', borderRadius: 13, padding: 13 },
  messageText: { color: '#344054', fontSize: 13, lineHeight: 20, marginTop: 6 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 2 },
  totalLabel: { color: '#667085', fontWeight: '800', fontSize: 12 },
  totalValue: { color: '#101828', fontWeight: '900', fontSize: 19 },
  bottomNav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#EAECF0', backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingTop: 8, paddingBottom: Platform.OS === 'android' ? 46 : 10, gap: 4 },
  navButton: { flex: 1, minHeight: 48, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, paddingHorizontal: 2 },
  navButtonActive: { backgroundColor: '#EEF4FF' },
  navText: { color: '#667085', fontSize: 11, fontWeight: '800' },
  navTextActive: { color: '#175CD3' },
  navCount: { minWidth: 18, borderRadius: 999, backgroundColor: '#246BFD', color: '#FFFFFF', fontSize: 10, fontWeight: '900', textAlign: 'center', overflow: 'hidden', paddingHorizontal: 5 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 13, padding: 13, gap: 5 },
  errorTitle: { color: '#B42318', fontWeight: '900', fontSize: 12 },
  errorText: { color: '#912018', fontSize: 11, lineHeight: 17 },
  retryText: { color: '#B42318', fontWeight: '900', fontSize: 11 },
  loadingCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 18, gap: 8, alignItems: 'center' },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 18, borderWidth: 1, borderColor: '#EAECF0' },
  emptyTitle: { color: '#101828', fontWeight: '900', fontSize: 15, textAlign: 'center' },
  emptyText: { color: '#667085', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 4 },
  muted: { color: '#667085', fontSize: 11 },
  primaryButton: { minHeight: 44, borderRadius: 11, backgroundColor: '#246BFD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900' },
});
