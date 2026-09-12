import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
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
import { OrderFulfillmentPanel } from './components/OrderFulfillmentPanel';
import { OrderPaymentPanel } from './components/OrderPaymentPanel';
import { OrderItemsEditor } from './components/OrderItemsEditor';
import { OrderStatusHistory } from './components/OrderStatusHistory';
import { OrderWorkflowPanel } from './components/OrderWorkflowPanel';
import { SettingsHub } from './components/SettingsHub';
import { SetupGuideCard } from './components/SetupGuideCard';
import { SellerTrayBrand } from './components/SellerTrayBrand';
import type { MerchantBusiness } from './data/businessRepository';
import type { OrderFulfillmentInput, OrderItemInput } from './data/ordersRepository';
import { orderTotal, type MerchantOrder, type OrderStatus } from './domain/order';
import { useBusinesses } from './hooks/useBusinesses';
import { useCatalogue } from './hooks/useCatalogue';
import { useOrders } from './hooks/useOrders';
import { supabase } from './lib/supabase';
import { sellerTrayTheme as theme } from './theme/sellerTrayTheme';

type ViewName = 'home' | 'orders' | 'inbox' | 'products' | 'more' | 'notifications';
type OrderFilter = 'attention' | 'payment' | 'paid' | 'active' | 'done' | 'all';

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
  const {
    orders,
    loading,
    error,
    refresh,
    createOrder,
    setStatus,
    startDelivery,
    completeFulfillment,
    addItem,
    editItem,
    removeItem,
  } = useOrders(activeBusiness?.id ?? null);
  const catalogue = useCatalogue(activeBusiness?.id ?? null);
  const [view, setView] = useState<ViewName>('home');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [merchantName, setMerchantName] = useState('there');

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
      setMerchantName(firstName(candidate));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setSelectedOrderId('');
    setView('home');
  }, [activeBusiness?.id]);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId),
    [orders, selectedOrderId],
  );

  const reviewCount = orders.filter((order) => order.status === 'needs_review' || order.status === 'draft').length;
  const inboxCount = new Set(
    orders.filter((order) => order.source === 'whatsapp').map((order) => order.customerPhone),
  ).size;
  const notificationCount =
    reviewCount +
    orders.filter((order) =>
      ['pending', 'verification_required', 'payment_issue'].includes(order.paymentStatus),
    ).length;

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
            notificationCount={notificationCount}
            onOpenNotifications={() => setView('notifications')}
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
              merchantName={merchantName}
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
              startDelivery={startDelivery}
              completeFulfillment={completeFulfillment}
              addItem={addItem}
              editItem={editItem}
              removeItem={removeItem}
              createOrder={createOrder}
            />
          ) : null}

          {view === 'inbox' ? (
            <ConversationsView
              orders={orders}
              currency={activeBusiness.currency}
              onOpenOrder={(orderId) => {
                setSelectedOrderId(orderId);
                setView('orders');
              }}
            />
          ) : null}

          {view === 'products' ? (
            <CatalogueView business={activeBusiness} />
          ) : null}

          {view === 'more' ? (
            <SettingsHub business={activeBusiness} onSaveBusiness={saveProfile} />
          ) : null}

          {view === 'notifications' ? (
            <NotificationCenterView
              orders={orders}
              syncError={pageError}
              onOpenOrder={(orderId) => {
                setSelectedOrderId(orderId);
                setView('orders');
              }}
              onBack={() => setView('home')}
            />
          ) : null}
        </ScrollView>

        <BottomNav
          view={view}
          reviewCount={reviewCount}
          inboxCount={inboxCount}
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
  notificationCount,
  onOpenNotifications,
}: {
  business: MerchantBusiness;
  businesses: MerchantBusiness[];
  onSelectBusiness: (businessId: string) => Promise<void>;
  notificationCount: number;
  onOpenNotifications: () => void;
}) {
  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <SellerTrayBrand size={38} showTagline />
          <View style={styles.merchantIdentity}>
            <Text style={styles.businessName}>{business.name}</Text>
            <Text style={styles.workspaceMeta}>
              {business.role.toUpperCase()} · {subscriptionLabels[business.subscriptionStatus]}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onOpenNotifications}
          accessibilityLabel="Open notifications"
          style={({ pressed }) => [styles.notificationButton, pressed && styles.quickActionPressed]}
        >
          <Ionicons name="notifications-outline" size={25} color={theme.colors.navy} />
          {notificationCount > 0 ? (
            <View style={styles.notificationBadge}>
              <Text style={styles.notificationBadgeText}>{Math.min(notificationCount, 99)}</Text>
            </View>
          ) : null}
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
  merchantName,
  orders,
  loading,
  productCount,
  onOpenOrders,
  onOpenProducts,
  onOpenMore,
  onSelectOrder,
}: {
  business: MerchantBusiness;
  merchantName: string;
  orders: MerchantOrder[];
  loading: boolean;
  productCount: number;
  onOpenOrders: () => void;
  onOpenProducts: () => void;
  onOpenMore: () => void;
  onSelectOrder: (orderId: string) => void;
}) {
  const now = new Date();
  const todayKey = localDayKey(now);
  const todayOrders = orders.filter((order) => localDayKey(new Date(order.receivedAt)) === todayKey);
  const salesToday = todayOrders.reduce((sum, order) => {
    if (order.status === 'rejected' || order.status === 'cancelled') return sum;
    const total = orderTotal(order);
    return total === null ? sum : sum + total;
  }, 0);
  const awaitingPayment = orders.filter((order) =>
    !['paid'].includes(order.paymentStatus) && !['rejected', 'cancelled'].includes(order.status),
  ).length;
  const newEnquiries = orders.filter((order) =>
    order.source === 'whatsapp' && (order.status === 'needs_review' || order.status === 'draft'),
  ).length;

  return (
    <View style={styles.sectionStack}>
      <View style={styles.homeHero}>
        <Text style={styles.sectionEyebrow}>MERCHANT DASHBOARD</Text>
        <Text style={styles.pageTitle}>Your business in one place.</Text>
        <Text style={styles.pageSubtitle}>
          Manage orders, catalogue and merchant setup for {business.name}.
        </Text>
      </View>

      <View style={styles.homeMetricGrid}>
        <HomeMetric label="Orders today" value={String(todayOrders.length)} hint="Received today" />
        <HomeMetric label="Sales today" value={formatMoney(salesToday, business.currency)} hint="Known order value" />
        <HomeMetric label="Awaiting payment" value={String(awaitingPayment)} hint="Needs payment action" attention={awaitingPayment > 0} />
        <HomeMetric label="New enquiries" value={String(newEnquiries)} hint="WhatsApp needs review" attention={newEnquiries > 0} />
      </View>

      <View style={styles.quickActionsCard}>
        <View>
          <Text style={styles.sectionEyebrow}>QUICK ACTIONS</Text>
          <Text style={styles.sectionTitle}>Common tasks</Text>
        </View>
        <View style={styles.quickActionRow}>
          <QuickAction label="Orders" onPress={onOpenOrders} />
          <QuickAction label="Catalogue" onPress={onOpenProducts} />
          <QuickAction label="Setup" onPress={onOpenMore} />
        </View>
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

function HomeMetric({
  label,
  value,
  hint,
  attention = false,
}: {
  label: string;
  value: string;
  hint: string;
  attention?: boolean;
}) {
  return (
    <View style={[styles.homeMetricCard, attention && styles.homeMetricCardAttention]}>
      <Text style={styles.homeMetricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.homeMetricValue}>{value}</Text>
      <Text style={styles.homeMetricHint}>{hint}</Text>
    </View>
  );
}

function QuickAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickAction, pressed && styles.quickActionPressed]}>
      <Text style={styles.quickActionMark}>+</Text>
      <Text style={styles.quickActionText}>{label}</Text>
    </Pressable>
  );
}

function OrdersView({
  business,
  orders,
  loading,
  selectedOrder,
  onSelectOrder,
  setStatus,
  startDelivery,
  completeFulfillment,
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
  startDelivery: (orderId: string, input: OrderFulfillmentInput) => Promise<void>;
  completeFulfillment: (orderId: string, input: OrderFulfillmentInput) => Promise<void>;
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
        order.publicOrderId,
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

  const emptyText = query.trim()
    ? 'No orders match this search inside the selected workflow view.'
    : filter === 'attention'
      ? 'No orders need review right now.'
      : filter === 'active'
        ? 'No accepted, processing or ready orders right now.'
        : filter === 'done'
          ? 'No completed orders yet.'
          : 'No orders yet. New WhatsApp orders will appear here automatically.';

  if (selectedOrder) {
    return (
      <View style={styles.sectionStack}>
        <Pressable onPress={() => onSelectOrder('')} style={styles.backToListButton}>
          <Text style={styles.backToListText}>← Orders</Text>
        </Pressable>
        <OrderDetail
          order={selectedOrder}
          tenantId={business.id}
          currency={business.currency}
          onAccept={() => setStatus(selectedOrder.id, 'accepted')}
          onReject={(reason) => setStatus(selectedOrder.id, 'rejected', reason)}
          onStart={() => setStatus(selectedOrder.id, 'processing')}
          onReady={() => setStatus(selectedOrder.id, 'ready')}
          onCancel={(reason) => setStatus(selectedOrder.id, 'cancelled', reason)}
          onStartDelivery={(input) => startDelivery(selectedOrder.id, input)}
          onCompleteFulfillment={(input) => completeFulfillment(selectedOrder.id, input)}
          onAddItem={(item) => addItem(selectedOrder.id, item)}
          onEditItem={editItem}
          onRemoveItem={removeItem}
        />
      </View>
    );
  }

  return (
    <View style={styles.sectionStack}>
      <View style={styles.pageHeadingRow}>
        <View style={styles.pageHeadingCopy}>
          <Text style={styles.sectionEyebrow}>ORDER MANAGEMENT</Text>
          <Text style={styles.pageTitle}>Orders</Text>
          <Text style={styles.pageSubtitle}>Review, accept and fulfil {business.name} orders.</Text>
        </View>
        <View style={styles.orderSummaryBadge}>
          <Text style={styles.orderSummaryValue}>{filterCounts.attention}</Text>
          <Text style={styles.orderSummaryLabel}>NEEDS REVIEW</Text>
        </View>
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
          placeholder="Search orders, customers or products"
          autoCorrect={false}
          style={styles.searchInput}
        />
        <View style={styles.filterRow}>
          <OrderFilterButton
            label="New"
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
        {visibleOrders.length} order{visibleOrders.length === 1 ? '' : 's'} in this view
      </Text>

      <OrderList
        orders={visibleOrders}
        loading={loading}
        selectedOrderId=""
        currency={business.currency}
        onSelect={onSelectOrder}
        emptyText={emptyText}
      />
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
                <Text numberOfLines={1} style={styles.orderId}>{order.publicOrderId} · {formatReceivedAt(order.receivedAt)}</Text>
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
  tenantId,
  currency,
  onAccept,
  onReject,
  onStart,
  onReady,
  onCancel,
  onStartDelivery,
  onCompleteFulfillment,
  onAddItem,
  onEditItem,
  onRemoveItem,
}: {
  order: MerchantOrder;
  tenantId: string;
  currency: string;
  onAccept: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onStart: () => Promise<void>;
  onReady: () => Promise<void>;
  onCancel: (reason: string) => Promise<void>;
  onStartDelivery: (input: OrderFulfillmentInput) => Promise<void>;
  onCompleteFulfillment: (input: OrderFulfillmentInput) => Promise<void>;
  onAddItem: (item: OrderItemInput) => Promise<void>;
  onEditItem: (itemId: string, item: OrderItemInput) => Promise<void>;
  onRemoveItem: (itemId: string) => Promise<void>;
}) {
  const total = orderTotal(order);
  const editable =
    order.status === 'needs_review' ||
    order.status === 'draft' ||
    (
      order.source === 'manual' &&
      order.status === 'accepted' &&
      order.paymentStatus === 'unpaid' &&
      order.fulfillmentStatus === 'unassigned'
    );

  return (
    <View style={styles.detailCard}>
      <View style={styles.detailHero}>
        <View style={styles.customerAvatar}>
          <Text style={styles.customerAvatarText}>{customerInitials(order.customerName)}</Text>
        </View>
        <View style={styles.orderIdentity}>
          <Text style={styles.detailTitle}>{order.customerName}</Text>
          <Text style={styles.publicOrderId}>{order.publicOrderId}</Text>
          <Text style={styles.orderMeta}>{order.customerPhone} · {formatReceivedAt(order.receivedAt)}</Text>
        </View>
        <StatusPill status={order.status} />
      </View>

      <View style={styles.detailSummaryRow}>
        <DetailSummary label="Payment" value={formatPaymentStatus(order.paymentStatus)} positive={order.paymentStatus === 'paid'} />
        <DetailSummary label="Fulfilment" value={formatFulfillmentStatus(order.fulfillmentStatus)} positive={order.fulfillmentStatus === 'delivered' || order.fulfillmentStatus === 'collected'} />
        <DetailSummary label="Source" value={order.source === 'whatsapp' ? 'WhatsApp' : 'Manual'} positive={order.source === 'whatsapp'} />
      </View>

      <View style={styles.messageCard}>
        <Text style={styles.sectionEyebrow}>CUSTOMER MESSAGE</Text>
        <Text style={styles.messageText}>{order.customerMessage || 'No message captured.'}</Text>
      </View>

      <View>
        <Text style={styles.sectionTitle}>{editable ? 'Review order items' : 'Order items'}</Text>
        {editable ? (
          <Text style={styles.pageSubtitle}>
            {order.source === 'manual'
              ? 'You can adjust quantities and selling prices while this manual order is unpaid and has not entered fulfilment.'
              : 'Correct AI interpretation and prices before acceptance.'}
          </Text>
        ) : null}
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

      <OrderPaymentPanel tenantId={tenantId} order={order} />

      <OrderWorkflowPanel
        order={order}
        onAccept={onAccept}
        onReject={onReject}
        onStart={onStart}
        onReady={onReady}
        onCancel={onCancel}
      />

      <OrderFulfillmentPanel
        order={order}
        onStartDelivery={onStartDelivery}
        onCompleteFulfillment={onCompleteFulfillment}
      />

      <OrderStatusHistory order={order} />
    </View>
  );
}

function DetailSummary({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <View style={[styles.detailSummaryCard, positive && styles.detailSummaryCardPositive]}>
      <Text style={styles.detailSummaryLabel}>{label}</Text>
      <Text numberOfLines={1} style={[styles.detailSummaryValue, positive && styles.detailSummaryValuePositive]}>{value}</Text>
    </View>
  );
}

function ConversationsView({
  orders,
  currency,
  onOpenOrder,
}: {
  orders: MerchantOrder[];
  currency: string;
  onOpenOrder: (orderId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedPhone, setSelectedPhone] = useState('');

  const conversations = useMemo(() => {
    const whatsappOrders = orders
      .filter((order) => order.source === 'whatsapp')
      .slice()
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

    const byPhone = new Map<string, MerchantOrder[]>();
    whatsappOrders.forEach((order) => {
      const current = byPhone.get(order.customerPhone) ?? [];
      current.push(order);
      byPhone.set(order.customerPhone, current);
    });

    return Array.from(byPhone.entries()).map(([phone, customerOrders]) => ({
      phone,
      name: customerOrders[0]?.customerName ?? phone,
      latest: customerOrders[0],
      orders: customerOrders,
    }));
  }, [orders]);

  const normalized = query.trim().toLowerCase();
  const visible = conversations.filter((conversation) => {
    if (!normalized) return true;
    return [conversation.name, conversation.phone, conversation.latest?.customerMessage ?? '']
      .join(' ')
      .toLowerCase()
      .includes(normalized);
  });

  const selected = conversations.find((conversation) => conversation.phone === selectedPhone);

  if (selected) {
    return (
      <View style={styles.sectionStack}>
        <Pressable onPress={() => setSelectedPhone('')} style={styles.backToListButton}>
          <Text style={styles.backToListText}>← Inbox</Text>
        </Pressable>

        <View style={styles.conversationHeader}>
          <View style={styles.customerAvatar}>
            <Text style={styles.customerAvatarText}>{customerInitials(selected.name)}</Text>
          </View>
          <View style={styles.orderIdentity}>
            <Text style={styles.detailTitle}>{selected.name}</Text>
            <Text style={styles.orderMeta}>{selected.phone}</Text>
          </View>
          <Badge label="WhatsApp" positive />
        </View>

        <View style={styles.threadNotice}>
          <Text style={styles.threadNoticeTitle}>Captured order messages</Text>
          <Text style={styles.threadNoticeText}>
            SellerTray shows WhatsApp messages currently attached to orders. Full conversational history will populate through the approved WhatsApp message-history pipeline.
          </Text>
        </View>

        <View style={styles.conversationThread}>
          {selected.orders
            .slice()
            .reverse()
            .map((order) => (
              <View key={order.id} style={styles.customerBubble}>
                <Text style={styles.bubbleText}>{order.customerMessage || 'Order message captured without text.'}</Text>
                <View style={styles.bubbleMetaRow}>
                  <Text style={styles.bubbleMeta}>{formatReceivedAt(order.receivedAt)}</Text>
                  <Text style={styles.bubbleOrderRef}>{order.publicOrderId}</Text>
                </View>
                <View style={styles.linkedOrderCard}>
                  <View style={styles.linkedOrderCopy}>
                    <Text style={styles.linkedOrderTitle}>Linked order</Text>
                    <Text style={styles.linkedOrderMeta}>
                      {order.items.length} item{order.items.length === 1 ? '' : 's'} · {orderTotal(order) === null ? 'Needs pricing' : formatMoney(orderTotal(order) ?? 0, currency)}
                    </Text>
                  </View>
                  <Pressable onPress={() => onOpenOrder(order.id)} style={styles.openOrderButton}>
                    <Text style={styles.openOrderButtonText}>Open</Text>
                  </Pressable>
                </View>
              </View>
            ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.sectionStack}>
      <View>
        <Text style={styles.sectionEyebrow}>CONVERSATIONS</Text>
        <Text style={styles.pageTitle}>Inbox</Text>
        <Text style={styles.pageSubtitle}>WhatsApp customers and the order messages SellerTray has captured.</Text>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search customer or message"
        autoCorrect={false}
        style={styles.searchInput}
      />

      <View style={styles.inboxStatCard}>
        <Text style={styles.inboxStatValue}>{conversations.length}</Text>
        <View>
          <Text style={styles.inboxStatTitle}>Customer conversations</Text>
          <Text style={styles.inboxStatText}>Built from connected WhatsApp order activity.</Text>
        </View>
      </View>

      {visible.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyText}>WhatsApp customers will appear here after SellerTray captures supported order messages.</Text>
        </View>
      ) : (
        <View style={styles.conversationList}>
          {visible.map((conversation) => (
            <Pressable
              key={conversation.phone}
              onPress={() => setSelectedPhone(conversation.phone)}
              style={styles.conversationRow}
            >
              <View style={styles.customerAvatarSmall}>
                <Text style={styles.customerAvatarSmallText}>{customerInitials(conversation.name)}</Text>
              </View>
              <View style={styles.conversationCopy}>
                <View style={styles.conversationNameRow}>
                  <Text style={styles.conversationName}>{conversation.name}</Text>
                  <Text style={styles.conversationTime}>
                    {conversation.latest ? formatReceivedAt(conversation.latest.receivedAt) : ''}
                  </Text>
                </View>
                <Text numberOfLines={1} style={styles.conversationPreview}>
                  {conversation.latest?.customerMessage || 'Order message captured'}
                </Text>
                <Text style={styles.conversationMeta}>
                  {conversation.orders.length} linked order{conversation.orders.length === 1 ? '' : 's'}
                </Text>
              </View>
              <Text style={styles.conversationChevron}>›</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function BottomNav({
  view,
  reviewCount,
  inboxCount,
  onChange,
}: {
  view: ViewName;
  reviewCount: number;
  inboxCount: number;
  onChange: (view: ViewName) => void;
}) {
  return (
    <View style={styles.bottomNav}>
      <NavButton label="Home" active={view === 'home'} onPress={() => onChange('home')} />
      <NavButton label="Orders" active={view === 'orders'} count={reviewCount} onPress={() => onChange('orders')} />
      <NavButton label="Inbox" active={view === 'inbox'} count={inboxCount} onPress={() => onChange('inbox')} />
      <NavButton label="Catalogue" active={view === 'products'} onPress={() => onChange('products')} />
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

function customerInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ST';
  if (parts.length === 1) return (parts[0] ?? 'ST').slice(0, 2).toUpperCase();
  return `${parts[0]?.charAt(0) ?? ''}${parts[1]?.charAt(0) ?? ''}`.toUpperCase();
}

function formatPaymentStatus(value: MerchantOrder['paymentStatus']): string {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function formatFulfillmentStatus(value: MerchantOrder['fulfillmentStatus']): string {
  if (value === 'unassigned') return 'Not started';
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function localDayKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  safeArea: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0 },
  appFrame: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12, backgroundColor: '#F8FAFC' },
  noWorkspaceAccount: { width: '100%', maxWidth: 620 },
  page: { padding: 18, paddingBottom: 34, gap: 15 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 },
  headerCopy: { flex: 1, gap: 10 },
  merchantIdentity: { gap: 1, paddingLeft: 2 },
  eyebrow: { color: '#12B76A', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  businessName: { color: '#102A43', fontSize: 25, fontWeight: '900', marginTop: 3 },
  workspaceMeta: { color: '#667085', fontSize: 11, fontWeight: '800', marginTop: 4 },
  signOutButton: { paddingVertical: 5 },
  signOutText: { color: '#667085', fontSize: 11, fontWeight: '800' },
  switcherCard: { backgroundColor: '#FFFFFF', borderRadius: 15, borderWidth: 1, borderColor: '#E4E7EC', padding: 11, gap: 8 },
  switcherLabel: { color: '#667085', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  switcherButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  switcherButton: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 10 },
  switcherButtonActive: { borderColor: '#12B76A', backgroundColor: '#ECFDF3' },
  switcherButtonText: { color: '#667085', fontSize: 11, fontWeight: '800', maxWidth: 210 },
  switcherButtonTextActive: { color: '#079455' },
  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  badge: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#F2F4F7' },
  badgePositive: { backgroundColor: '#ECFDF3' },
  badgeText: { color: '#475467', fontSize: 10, fontWeight: '800' },
  badgeTextPositive: { color: '#027A48' },
  setupCard: { backgroundColor: '#102A43', borderRadius: 17, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  setupCopy: { flex: 1 },
  setupEyebrow: { color: '#84ADFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  setupTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '900', marginTop: 4 },
  setupText: { color: '#D0D5DD', fontSize: 11, lineHeight: 17, marginTop: 4 },
  setupArrow: { color: '#FFFFFF', fontSize: 23, fontWeight: '900' },
  sectionStack: { gap: 14 },
  homeHero: { gap: 2 },
  homeMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  homeMetricCard: { flexGrow: 1, flexBasis: '46%', minWidth: 138, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 13, ...theme.shadow.card },
  homeMetricCardAttention: { backgroundColor: theme.colors.warningSoft, borderColor: '#FEDF89' },
  homeMetricLabel: { color: theme.colors.slate, fontSize: 10, fontWeight: '800' },
  homeMetricValue: { color: theme.colors.navy, fontSize: 21, fontWeight: '900', marginTop: 4 },
  homeMetricHint: { color: theme.colors.muted, fontSize: 9, fontWeight: '700', marginTop: 3 },
  quickActionsCard: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: 14, gap: 11, ...theme.shadow.card },
  quickActionRow: { flexDirection: 'row', gap: 8 },
  quickAction: { flex: 1, minHeight: 58, borderRadius: 13, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 5 },
  quickActionPressed: { opacity: 0.75 },
  quickActionMark: { color: theme.colors.greenDark, fontSize: 20, lineHeight: 21, fontWeight: '900' },
  quickActionText: { color: theme.colors.navy, fontSize: 10, fontWeight: '900', textAlign: 'center' },
  sectionEyebrow: { color: '#667085', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  pageTitle: { color: '#102A43', fontSize: 24, lineHeight: 30, fontWeight: '900', marginTop: 3 },
  pageSubtitle: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 3 },
  pageHeadingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pageHeadingCopy: { flex: 1 },
  orderSummaryBadge: { minWidth: 78, borderRadius: 14, backgroundColor: theme.colors.warningSoft, borderWidth: 1, borderColor: '#FEDF89', paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center' },
  orderSummaryValue: { color: theme.colors.navy, fontSize: 19, fontWeight: '900' },
  orderSummaryLabel: { color: '#B54708', fontSize: 7, fontWeight: '900', letterSpacing: 0.7, marginTop: 2 },
  backToListButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', paddingRight: 12 },
  backToListText: { color: theme.colors.greenDark, fontSize: 13, fontWeight: '900' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  linkText: { color: '#12B76A', fontSize: 12, fontWeight: '800' },
  inboxControls: { gap: 9 },
  searchInput: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 12, paddingHorizontal: 13, backgroundColor: '#FFFFFF', color: '#102A43' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, borderRadius: 999, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', paddingHorizontal: 11 },
  filterButtonActive: { borderColor: '#12B76A', backgroundColor: '#ECFDF3' },
  filterButtonText: { color: '#667085', fontSize: 11, fontWeight: '800' },
  filterButtonTextActive: { color: '#079455' },
  filterCount: { minWidth: 18, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden', textAlign: 'center', backgroundColor: '#F2F4F7', color: '#475467', fontSize: 9, fontWeight: '900' },
  filterCountActive: { backgroundColor: '#12B76A', color: '#FFFFFF' },
  resultMeta: { color: '#667085', fontSize: 10, fontWeight: '700' },
  orderList: { gap: 9 },
  orderCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 15, padding: 13 },
  orderCardSelected: { borderColor: '#12B76A', borderWidth: 2 },
  orderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  orderIdentity: { flex: 1 },
  orderRight: { alignItems: 'flex-end', gap: 6 },
  customerName: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  orderId: { color: '#667085', fontSize: 10, marginTop: 2 },
  publicOrderId: { color: '#079455', fontSize: 11, fontWeight: '900', marginTop: 2 },
  orderValue: { color: '#102A43', fontSize: 11, fontWeight: '900' },
  orderValuePending: { color: '#B54708' },
  orderMessage: { color: '#475467', fontSize: 13, lineHeight: 19, marginTop: 9 },
  closureMeta: { color: '#B54708', fontSize: 10, fontWeight: '700', marginTop: 6 },
  orderMeta: { color: '#667085', fontSize: 10, marginTop: 8 },
  statusPill: { borderRadius: 999, backgroundColor: '#E4E7EC', paddingVertical: 5, paddingHorizontal: 8 },
  statusReview: { backgroundColor: '#FFF3D6' },
  statusText: { color: '#344054', fontSize: 10, fontWeight: '900' },
  detailCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 18, padding: 16, gap: 14, ...theme.shadow.card },
  detailHero: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  customerAvatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: theme.colors.mint, alignItems: 'center', justifyContent: 'center' },
  customerAvatarText: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  detailTitle: { color: '#102A43', fontSize: 19, fontWeight: '900' },
  detailSummaryRow: { flexDirection: 'row', gap: 7 },
  detailSummaryCard: { flex: 1, minWidth: 0, borderRadius: 12, backgroundColor: '#F9FAFB', paddingHorizontal: 9, paddingVertical: 9 },
  detailSummaryCardPositive: { backgroundColor: theme.colors.mintSoft },
  detailSummaryLabel: { color: theme.colors.muted, fontSize: 8, fontWeight: '800' },
  detailSummaryValue: { color: theme.colors.navy, fontSize: 10, fontWeight: '900', marginTop: 3 },
  detailSummaryValuePositive: { color: theme.colors.greenDark },
  messageCard: { backgroundColor: '#F9FAFB', borderRadius: 13, padding: 13 },
  messageText: { color: '#344054', fontSize: 13, lineHeight: 20, marginTop: 6 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 2 },
  totalLabel: { color: '#667085', fontWeight: '800', fontSize: 12 },
  totalValue: { color: '#102A43', fontWeight: '900', fontSize: 19 },
  conversationHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  threadNotice: { backgroundColor: theme.colors.infoSoft, borderRadius: 13, padding: 12, gap: 3 },
  threadNoticeTitle: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' },
  threadNoticeText: { color: theme.colors.slate, fontSize: 10, lineHeight: 15 },
  conversationThread: { gap: 10 },
  customerBubble: { alignSelf: 'stretch', backgroundColor: theme.colors.mintSoft, borderRadius: 16, borderTopLeftRadius: 5, padding: 12, gap: 8 },
  bubbleText: { color: theme.colors.navy, fontSize: 12, lineHeight: 18 },
  bubbleMetaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  bubbleMeta: { color: theme.colors.muted, fontSize: 9 },
  bubbleOrderRef: { color: theme.colors.greenDark, fontSize: 9, fontWeight: '900' },
  linkedOrderCard: { backgroundColor: theme.colors.white, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkedOrderCopy: { flex: 1 },
  linkedOrderTitle: { color: theme.colors.navy, fontSize: 10, fontWeight: '900' },
  linkedOrderMeta: { color: theme.colors.muted, fontSize: 9, marginTop: 2 },
  openOrderButton: { minHeight: 34, borderRadius: 9, backgroundColor: theme.colors.green, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  openOrderButtonText: { color: theme.colors.white, fontSize: 10, fontWeight: '900' },
  inboxStatCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.navy, borderRadius: 16, padding: 14 },
  inboxStatValue: { color: theme.colors.white, fontSize: 26, fontWeight: '900', minWidth: 40 },
  inboxStatTitle: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  inboxStatText: { color: theme.colors.mint, fontSize: 9, marginTop: 2 },
  conversationList: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, overflow: 'hidden' },
  conversationRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  customerAvatarSmall: { width: 40, height: 40, borderRadius: 14, backgroundColor: theme.colors.mint, alignItems: 'center', justifyContent: 'center' },
  customerAvatarSmallText: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' },
  conversationCopy: { flex: 1 },
  conversationNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  conversationName: { color: theme.colors.navy, fontSize: 12, fontWeight: '900', flex: 1 },
  conversationTime: { color: theme.colors.subtle, fontSize: 8 },
  conversationPreview: { color: theme.colors.slate, fontSize: 10, marginTop: 3 },
  conversationMeta: { color: theme.colors.greenDark, fontSize: 8, fontWeight: '800', marginTop: 3 },
  conversationChevron: { color: theme.colors.subtle, fontSize: 23 },
  bottomNav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E4E7EC', backgroundColor: '#FFFFFF', paddingHorizontal: 5, paddingTop: 8, paddingBottom: Platform.OS === 'android' ? 46 : 10, gap: 2 },
  navButton: { flex: 1, minHeight: 48, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, paddingHorizontal: 2 },
  navButtonActive: { backgroundColor: '#ECFDF3' },
  navText: { color: '#667085', fontSize: 9.5, fontWeight: '800' },
  navTextActive: { color: '#079455' },
  navCount: { minWidth: 18, borderRadius: 999, backgroundColor: '#12B76A', color: '#FFFFFF', fontSize: 10, fontWeight: '900', textAlign: 'center', overflow: 'hidden', paddingHorizontal: 5 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 13, padding: 13, gap: 5 },
  errorTitle: { color: '#B42318', fontWeight: '900', fontSize: 12 },
  errorText: { color: '#912018', fontSize: 11, lineHeight: 17 },
  retryText: { color: '#B42318', fontWeight: '900', fontSize: 11 },
  loadingCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 18, gap: 8, alignItems: 'center' },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 18, borderWidth: 1, borderColor: '#E4E7EC' },
  emptyTitle: { color: '#102A43', fontWeight: '900', fontSize: 15, textAlign: 'center' },
  emptyText: { color: '#667085', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 4 },
  muted: { color: '#667085', fontSize: 11 },
  primaryButton: { minHeight: 44, borderRadius: 11, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900' },
});
