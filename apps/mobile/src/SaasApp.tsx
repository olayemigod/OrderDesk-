import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useConversationUnreadCounts } from './hooks/useConversationUnreadCounts';
import { useMerchantNotifications } from './hooks/useMerchantNotifications';
import { useOrders } from './hooks/useOrders';
import { usePushNotifications } from './hooks/usePushNotifications';
import { supabase } from './lib/supabase';
import { sellerTrayTheme as theme } from './theme/sellerTrayTheme';
import { useSellerTrayAppearance } from './theme/AppearanceContext';

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
  const appearance = useSellerTrayAppearance();
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
  const {
    notifications: merchantNotifications,
    unreadCount: merchantUnreadCount,
    loading: merchantNotificationsLoading,
    error: merchantNotificationsError,
    refresh: refreshMerchantNotifications,
    markRead: markMerchantNotificationRead,
    markAllRead: markAllMerchantNotificationsRead,
  } = useMerchantNotifications(activeBusiness?.id ?? null);
  const {
    unreadByCustomer,
    unreadCount: conversationUnreadCount,
    error: conversationUnreadError,
    refresh: refreshConversationUnread,
    markRead: markConversationRead,
  } = useConversationUnreadCounts(activeBusiness?.id ?? null);
  const [view, setView] = useState<ViewName>('home');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [merchantName, setMerchantName] = useState('there');

  useEffect(() => {
    if (view !== 'home') return undefined;
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
  }, [view]);

  useEffect(() => {
    setSelectedOrderId('');
    setView('home');
  }, [activeBusiness?.id]);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId),
    [orders, selectedOrderId],
  );

  const reviewCount = orders.filter((order) => order.status === 'needs_review' || order.status === 'draft').length;
  const inboxCount = conversationUnreadCount;
  const notificationCount = merchantUnreadCount;

  const handlePushOpen = useCallback((route: { tenantId: string | null; notificationId: string | null; orderId: string | null }) => {
    if (route.notificationId) {
      void markMerchantNotificationRead(route.notificationId);
    }
    if (route.orderId && (!route.tenantId || route.tenantId === activeBusiness?.id)) {
      setSelectedOrderId(route.orderId);
      setView('orders');
      return;
    }
    setView('notifications');
  }, [activeBusiness?.id, markMerchantNotificationRead]);

  usePushNotifications({
    enabled: Boolean(activeBusiness?.id),
    unreadCount: merchantUnreadCount + conversationUnreadCount,
    onOpen: handlePushOpen,
  });

  async function refreshAll() {
    await refreshBusinesses();
    await Promise.all([
      refresh(),
      refreshMerchantNotifications(),
      refreshConversationUnread(),
    ]);
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

  const pageError = businessesError || error || merchantNotificationsError || conversationUnreadError;

  return (
    <SafeAreaView style={[styles.safeArea, appearance.dark && darkStyles.safeArea]}>
      <StatusBar
        barStyle={appearance.dark ? 'light-content' : 'dark-content'}
        backgroundColor={appearance.dark ? '#081825' : '#F8FAFC'}
      />
      <View style={[styles.appFrame, appearance.dark && darkStyles.appFrame]}>
        <PinnedBrandHeader
          notificationCount={notificationCount}
          onOpenNotifications={() => setView('notifications')}
        />
        <ScrollView
          style={appearance.dark ? darkStyles.scroll : undefined}
          contentContainerStyle={[styles.page, appearance.dark && darkStyles.page]}
          refreshControl={
            <RefreshControl
              refreshing={businessesLoading || loading}
              onRefresh={() => void refreshAll()}
              tintColor={appearance.dark ? theme.colors.mint : theme.colors.green}
              colors={[theme.colors.green]}
              progressBackgroundColor={appearance.dark ? theme.colors.navy : theme.colors.white}
            />
          }
        >
          <WorkspaceContextHeader
            business={activeBusiness}
            businesses={businesses}
            onSelectBusiness={selectBusiness}
          />

          {pageError ? (
            <View style={[styles.errorCard, appearance.dark && darkStyles.errorCard]}>
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
              unreadByCustomer={unreadByCustomer}
              onMarkConversationRead={markConversationRead}
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
              notifications={merchantNotifications}
              loading={merchantNotificationsLoading}
              syncError={pageError}
              onMarkAllRead={() => void markAllMerchantNotificationsRead()}
              onOpenNotification={(notificationId, orderId) => {
                void markMerchantNotificationRead(notificationId);
                if (orderId) {
                  setSelectedOrderId(orderId);
                  setView('orders');
                }
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

function PinnedBrandHeader({
  notificationCount,
  onOpenNotifications,
}: {
  notificationCount: number;
  onOpenNotifications: () => void;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.pinnedHeader, appearance.dark && darkStyles.pinnedHeader]}>
      <SellerTrayBrand size={34} showTagline inverted={appearance.dark} />
      <Pressable
        onPress={onOpenNotifications}
        accessibilityLabel="Open notifications"
        style={({ pressed }) => [styles.notificationButton, appearance.dark && darkStyles.card, pressed && styles.quickActionPressed]}
      >
        <Ionicons name="notifications-outline" size={24} color={appearance.dark ? theme.colors.mint : theme.colors.navy} />
        {notificationCount > 0 ? (
          <View style={styles.notificationBadge}>
            <Text style={styles.notificationBadgeText}>{Math.min(notificationCount, 99)}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

function WorkspaceContextHeader({
  business,
  businesses,
  onSelectBusiness,
}: {
  business: MerchantBusiness;
  businesses: MerchantBusiness[];
  onSelectBusiness: (businessId: string) => Promise<void>;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <>
      <View style={styles.merchantIdentity}>
        <Text style={[styles.businessName, appearance.dark && darkStyles.titleText, appearance.textSize === 'large' && styles.businessNameLarge]}>{business.name}</Text>
        <Text style={[styles.workspaceMeta, appearance.dark && darkStyles.bodyText]}>
          {business.role.toUpperCase()} · {subscriptionLabels[business.subscriptionStatus]}
        </Text>
      </View>

      {businesses.length > 1 ? (
        <View style={[styles.switcherCard, appearance.dark && darkStyles.card]}>
          <Text style={[styles.switcherLabel, appearance.dark && darkStyles.bodyText]}>BUSINESS</Text>
          <View style={styles.switcherButtons}>
            {businesses.map((candidate) => (
              <Pressable
                key={candidate.id}
                onPress={() => void onSelectBusiness(candidate.id)}
                style={[
                  styles.switcherButton,
                  appearance.dark && darkStyles.outlineButton,
                  candidate.id === business.id && styles.switcherButtonActive,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.switcherButtonText,
                    appearance.dark && darkStyles.bodyText,
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
          label={
            business.whatsappReadiness.messagingReady
              ? 'WhatsApp ready'
              : business.whatsappConnectionStatus === 'connected'
                ? 'WhatsApp connected · outbound pending'
                : whatsappLabels[business.whatsappConnectionStatus]
          }
          positive={business.whatsappReadiness.messagingReady}
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
  const appearance = useSellerTrayAppearance();
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
      <View style={styles.greetingBlock}>
        <Text style={[styles.greetingTitle, appearance.dark && darkStyles.titleText, appearance.textSize === 'large' && styles.greetingTitleLarge]}>{timeGreeting()}, {merchantName}</Text>
        <Text style={[styles.greetingSubtitle, appearance.dark && darkStyles.bodyText]}>Here is what is happening at {business.name} today.</Text>
      </View>

      <Pressable onPress={onOpenOrders} style={({ pressed }) => [styles.homeHeroGreen, pressed && styles.heroPressed]}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="wallet-outline" size={23} color={theme.colors.white} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>SALES TODAY</Text>
            <Text style={styles.heroValue}>{formatMoney(salesToday, business.currency)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={theme.colors.white} />
        </View>
        <View style={styles.heroBottomRow}>
          <Text style={styles.heroMeta}>{todayOrders.length} order{todayOrders.length === 1 ? '' : 's'} received today</Text>
          <Text style={styles.heroLink}>View orders</Text>
        </View>
      </Pressable>

      <View style={styles.homeMetricGrid}>
        <HomeMetric icon="cart-outline" label="Orders today" value={String(todayOrders.length)} hint="Received today" />
        <HomeMetric icon="cash-outline" label="Sales today" value={formatMoney(salesToday, business.currency)} hint="Known order value" />
        <HomeMetric icon="time-outline" label="Awaiting payment" value={String(awaitingPayment)} hint="Needs payment action" attention={awaitingPayment > 0} />
        <HomeMetric icon="chatbubble-ellipses-outline" label="New enquiries" value={String(newEnquiries)} hint="WhatsApp needs review" attention={newEnquiries > 0} />
      </View>

      <View style={[styles.quickActionsCard, appearance.dark && darkStyles.card]}>
        <View>
          <Text style={[styles.sectionEyebrow, appearance.dark && darkStyles.bodyText]}>QUICK ACTIONS</Text>
          <Text style={[styles.sectionTitle, appearance.dark && darkStyles.titleText]}>Common tasks</Text>
        </View>
        <View style={styles.quickActionRow}>
          <QuickAction icon="receipt-outline" label="Orders" onPress={onOpenOrders} />
          <QuickAction icon="cube-outline" label="Catalogue" onPress={onOpenProducts} />
          <QuickAction icon="settings-outline" label="Setup" onPress={onOpenMore} />
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, appearance.dark && darkStyles.titleText]}>Recent orders</Text>
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
        emptyText="No orders yet. New WhatsApp and manual orders will appear here."
      />

      <SetupGuideCard
        business={business}
        productCount={productCount}
        orderCount={orders.length}
        onProducts={onOpenProducts}
        onOrders={onOpenOrders}
        onMore={onOpenMore}
      />

      <BusinessInsightsPanel business={business} />
    </View>
  );
}

function HomeMetric({
  icon,
  label,
  value,
  hint,
  attention = false,
}: {
  icon: string;
  label: string;
  value: string;
  hint: string;
  attention?: boolean;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.homeMetricCard, appearance.dark && darkStyles.card, attention && styles.homeMetricCardAttention, attention && appearance.dark && darkStyles.warningCard]}>
      <View style={styles.metricIconWrap}>
        <Ionicons name={icon as never} size={19} color={attention ? '#B54708' : theme.colors.greenDark} />
      </View>
      <Text style={[styles.homeMetricLabel, appearance.dark && darkStyles.bodyText]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.homeMetricValue, appearance.dark && darkStyles.titleText]}>{value}</Text>
      <Text style={[styles.homeMetricHint, appearance.dark && darkStyles.mutedText]}>{hint}</Text>
    </View>
  );
}

function QuickAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickAction, appearance.dark && darkStyles.mintCard, pressed && styles.quickActionPressed]}>
      <View style={[styles.quickActionIcon, appearance.dark && darkStyles.card]}>
        <Ionicons name={icon as never} size={22} color={theme.colors.greenDark} />
      </View>
      <Text style={[styles.quickActionText, appearance.dark && darkStyles.titleText]}>{label}</Text>
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
  const appearance = useSellerTrayAppearance();
  const [filter, setFilter] = useState<OrderFilter>('attention');
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [queueMode, setQueueMode] = useState(false);

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
      payment: orders.filter((order) =>
        ['unpaid', 'pending', 'verification_required', 'payment_issue'].includes(order.paymentStatus) &&
        !['rejected', 'cancelled'].includes(order.status),
      ).length,
      paid: orders.filter((order) => order.paymentStatus === 'paid').length,
      active: orders.filter((order) => ['accepted', 'processing', 'ready'].includes(order.status)).length,
      done: orders.filter((order) => order.status === 'completed').length,
      all: orders.length,
    }),
    [orders],
  );

  const visibleOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    const filtered = orders.filter((order) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'attention' && (order.status === 'needs_review' || order.status === 'draft')) ||
        (filter === 'payment' && ['unpaid', 'pending', 'verification_required', 'payment_issue'].includes(order.paymentStatus) && !['rejected', 'cancelled'].includes(order.status)) ||
        (filter === 'paid' && order.paymentStatus === 'paid') ||
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

    if (!queueMode) return filtered;

    const priority = (order: MerchantOrder) => {
      if (order.status === 'needs_review' || order.status === 'draft') return 0;
      if (['verification_required', 'payment_issue', 'pending', 'unpaid'].includes(order.paymentStatus)) return 1;
      if (order.status === 'accepted') return 2;
      if (order.status === 'processing') return 3;
      if (order.status === 'ready') return 4;
      return 5;
    };

    return filtered.slice().sort((a, b) => {
      const rank = priority(a) - priority(b);
      if (rank !== 0) return rank;
      return new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
    });
  }, [filter, orders, query, queueMode]);

  const emptyText = query.trim()
    ? 'No orders match this search inside the selected workflow view.'
    : filter === 'attention'
      ? 'No orders need review right now.'
      : filter === 'payment'
        ? 'No orders are awaiting payment action.'
        : filter === 'paid'
          ? 'No paid orders yet.'
          : filter === 'active'
            ? 'No accepted, processing or ready orders right now.'
            : filter === 'done'
              ? 'No completed orders yet.'
              : 'No orders yet. New WhatsApp and manual orders will appear here automatically.';

  if (selectedOrder) {
    return (
      <View style={styles.sectionStack}>
        <Pressable onPress={() => onSelectOrder('')} style={styles.backToListButton}>
          <Text style={[styles.backToListText, appearance.dark && darkStyles.greenText]}>← Orders</Text>
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
          <Text style={[styles.sectionEyebrow, appearance.dark && darkStyles.bodyText]}>ORDER MANAGEMENT</Text>
          <Text style={[styles.pageTitle, appearance.dark && darkStyles.titleText, appearance.textSize === 'large' && styles.pageTitleLarge]}>{queueMode ? 'Order Queue' : 'Orders'}</Text>
          <Text style={[styles.pageSubtitle, appearance.dark && darkStyles.bodyText]}>
            {queueMode
              ? 'Prioritised work queue: review, payment action and fulfilment first.'
              : `Review, accept and fulfil ${business.name} orders.`}
          </Text>
        </View>
        <Pressable
          onPress={() => setQueueMode((value) => !value)}
          style={({ pressed }) => [styles.queueToggle, appearance.dark && darkStyles.outlineButton, queueMode && styles.queueToggleActive, pressed && styles.quickActionPressed]}
        >
          <Ionicons name={queueMode ? 'list' : 'layers-outline'} size={19} color={queueMode ? theme.colors.white : theme.colors.greenDark} />
          <Text style={[styles.queueToggleText, queueMode && styles.queueToggleTextActive]}>
            {queueMode ? 'All orders' : 'Queue'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.orderStatsGrid}>
        <OrderStat icon="alert-circle-outline" label="Needs review" value={filterCounts.attention} active={filter === 'attention'} attention onPress={() => { setFilter('attention'); setQueueMode(false); }} />
        <OrderStat icon="time-outline" label="Awaiting payment" value={filterCounts.payment} active={filter === 'payment'} attention={filterCounts.payment > 0} onPress={() => { setFilter('payment'); setQueueMode(false); }} />
        <OrderStat icon="cube-outline" label="In fulfilment" value={filterCounts.active} active={filter === 'active'} onPress={() => { setFilter('active'); setQueueMode(false); }} />
        <OrderStat icon="checkmark-circle-outline" label="Completed" value={filterCounts.done} active={filter === 'done'} positive onPress={() => { setFilter('done'); setQueueMode(false); }} />
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
        <View style={styles.searchRow}>
          <View style={[styles.searchBox, appearance.dark && darkStyles.input]}>
            <Ionicons name="search-outline" size={19} color={theme.colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search orders, customers or products"
              placeholderTextColor={theme.colors.subtle}
              autoCorrect={false}
              style={[styles.searchInputEmbedded, appearance.dark && darkStyles.inputText]}
            />
          </View>
          <Pressable
            onPress={() => setShowFilters((value) => !value)}
            accessibilityLabel="More order filters"
            style={[styles.filterIconButton, appearance.dark && darkStyles.outlineButton, showFilters && styles.filterIconButtonActive]}
          >
            <Ionicons name="options-outline" size={21} color={showFilters ? theme.colors.white : appearance.dark ? theme.colors.mint : theme.colors.navy} />
          </Pressable>
        </View>

        {showFilters ? (
          <View style={[styles.filterPanel, appearance.dark && darkStyles.card]}>
            <Text style={[styles.filterPanelTitle, appearance.dark && darkStyles.titleText]}>Order filters</Text>
            <View style={styles.filterRow}>
              <OrderFilterButton label="New" count={filterCounts.attention} active={filter === 'attention'} onPress={() => setFilter('attention')} />
              <OrderFilterButton label="Payment" count={filterCounts.payment} active={filter === 'payment'} onPress={() => setFilter('payment')} />
              <OrderFilterButton label="Paid" count={filterCounts.paid} active={filter === 'paid'} onPress={() => setFilter('paid')} />
              <OrderFilterButton label="In progress" count={filterCounts.active} active={filter === 'active'} onPress={() => setFilter('active')} />
              <OrderFilterButton label="Completed" count={filterCounts.done} active={filter === 'done'} onPress={() => setFilter('done')} />
              <OrderFilterButton label="All" count={filterCounts.all} active={filter === 'all'} onPress={() => setFilter('all')} />
            </View>
          </View>
        ) : null}
      </View>

      <Text style={[styles.resultMeta, appearance.dark && darkStyles.bodyText]}>
        {visibleOrders.length} order{visibleOrders.length === 1 ? '' : 's'} {queueMode ? 'in priority queue' : 'in this view'}
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

function OrderStat({
  icon,
  label,
  value,
  active = false,
  attention = false,
  positive = false,
  onPress,
}: {
  icon: string;
  label: string;
  value: number;
  active?: boolean;
  attention?: boolean;
  positive?: boolean;
  onPress: () => void;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.orderStatCard,
        appearance.dark && darkStyles.card,
        active && styles.orderStatCardActive,
        attention && styles.orderStatCardAttention,
      ]}
    >
      <View style={[styles.orderStatIcon, positive && styles.orderStatIconPositive]}>
        <Ionicons name={icon as never} size={19} color={positive ? theme.colors.greenDark : attention ? '#B54708' : theme.colors.navy} />
      </View>
      <Text style={[styles.orderStatValue, appearance.dark && darkStyles.titleText]}>{value}</Text>
      <Text style={[styles.orderStatLabel, appearance.dark && darkStyles.bodyText]}>{label}</Text>
    </Pressable>
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
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filterButton, appearance.dark && darkStyles.outlineButton, active && styles.filterButtonActive]}
    >
      <Text style={[styles.filterButtonText, appearance.dark && darkStyles.bodyText, active && styles.filterButtonTextActive]}>{label}</Text>
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
  const appearance = useSellerTrayAppearance();
  if (loading && orders.length === 0) {
    return (
      <View style={[styles.loadingCard, appearance.dark && darkStyles.card]}>
        <ActivityIndicator />
        <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Loading orders…</Text>
      </View>
    );
  }

  if (!loading && orders.length === 0) {
    return (
      <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
        <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>Nothing here</Text>
        <Text style={[styles.emptyText, appearance.dark && darkStyles.bodyText]}>{emptyText}</Text>
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
            style={[styles.orderCard, appearance.dark && darkStyles.card, selectedOrderId === order.id && styles.orderCardSelected]}
          >
            <View style={styles.orderTopRow}>
              <View style={styles.orderIdentity}>
                <Text style={[styles.customerName, appearance.dark && darkStyles.titleText]}>{order.customerName}</Text>
                <Text numberOfLines={1} style={[styles.orderId, appearance.dark && darkStyles.bodyText]}>{order.publicOrderId} · {formatReceivedAt(order.receivedAt)}</Text>
              </View>
              <View style={styles.orderRight}>
                <StatusPill status={order.status} />
                <Text style={[styles.orderValue, appearance.dark && darkStyles.titleText, total === null && styles.orderValuePending]}>
                  {total === null ? 'Needs pricing' : formatMoney(total, currency)}
                </Text>
              </View>
            </View>
            <Text numberOfLines={2} style={[styles.orderMessage, appearance.dark && darkStyles.bodyText]}>
              {order.customerMessage || 'No customer message captured.'}
            </Text>
            {order.statusReason ? <Text numberOfLines={1} style={styles.closureMeta}>Reason: {order.statusReason}</Text> : null}
            <Text style={[styles.orderMeta, appearance.dark && darkStyles.mutedText]}>
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
  const appearance = useSellerTrayAppearance();
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
    <View style={[styles.detailCard, appearance.dark && darkStyles.card]}>
      <View style={styles.detailHero}>
        <View style={styles.customerAvatar}>
          <Text style={styles.customerAvatarText}>{customerInitials(order.customerName)}</Text>
        </View>
        <View style={styles.orderIdentity}>
          <Text style={[styles.detailTitle, appearance.dark && darkStyles.titleText]}>{order.customerName}</Text>
          <Text style={styles.publicOrderId}>{order.publicOrderId}</Text>
          <Text style={[styles.orderMeta, appearance.dark && darkStyles.bodyText]}>{order.customerPhone} · {formatReceivedAt(order.receivedAt)}</Text>
        </View>
        <StatusPill status={order.status} />
      </View>

      <View style={styles.detailSummaryRow}>
        <DetailSummary label="Payment" value={formatPaymentStatus(order.paymentStatus)} positive={order.paymentStatus === 'paid'} />
        <DetailSummary label="Fulfilment" value={formatFulfillmentStatus(order.fulfillmentStatus)} positive={order.fulfillmentStatus === 'delivered' || order.fulfillmentStatus === 'collected'} />
        <DetailSummary label="Source" value={order.source === 'whatsapp' ? 'WhatsApp' : 'Manual'} positive={order.source === 'whatsapp'} />
      </View>

      <View style={[styles.messageCard, appearance.dark && darkStyles.subtleCard]}>
        <Text style={[styles.sectionEyebrow, appearance.dark && darkStyles.bodyText]}>CUSTOMER MESSAGE</Text>
        <Text style={[styles.messageText, appearance.dark && darkStyles.bodyText]}>{order.customerMessage || 'No message captured.'}</Text>
      </View>

      <View>
        <Text style={[styles.sectionTitle, appearance.dark && darkStyles.titleText]}>{editable ? 'Review order items' : 'Order items'}</Text>
        {editable ? (
          <Text style={[styles.pageSubtitle, appearance.dark && darkStyles.bodyText]}>
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
        <Text style={[styles.totalLabel, appearance.dark && darkStyles.bodyText]}>Order total</Text>
        <Text style={[styles.totalValue, appearance.dark && darkStyles.titleText]}>{total === null ? 'Needs pricing' : formatMoney(total, currency)}</Text>
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
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.detailSummaryCard, appearance.dark && darkStyles.subtleCard, positive && styles.detailSummaryCardPositive, positive && appearance.dark && darkStyles.mintCard]}>
      <Text style={[styles.detailSummaryLabel, appearance.dark && darkStyles.bodyText]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.detailSummaryValue, appearance.dark && darkStyles.titleText, positive && styles.detailSummaryValuePositive]}>{value}</Text>
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
  const appearance = useSellerTrayAppearance();
  const [query, setQuery] = useState('');
  const [selectedPhone, setSelectedPhone] = useState('');
  const [conversationFilter, setConversationFilter] = useState<'all' | 'new' | 'payment' | 'active'>('all');
  const [showConversationFilters, setShowConversationFilters] = useState(false);

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

  const conversationCounts = {
    all: conversations.length,
    new: conversations.filter((conversation) =>
      conversation.orders.some((order) => order.status === 'needs_review' || order.status === 'draft'),
    ).length,
    payment: conversations.filter((conversation) =>
      conversation.orders.some((order) =>
        ['unpaid', 'pending', 'verification_required', 'payment_issue'].includes(order.paymentStatus) &&
        !['rejected', 'cancelled'].includes(order.status),
      ),
    ).length,
    active: conversations.filter((conversation) =>
      conversation.orders.some((order) => ['accepted', 'processing', 'ready'].includes(order.status)),
    ).length,
  };

  const normalized = query.trim().toLowerCase();
  const visible = conversations.filter((conversation) => {
    const matchesFilter =
      conversationFilter === 'all' ||
      (conversationFilter === 'new' && conversation.orders.some((order) => order.status === 'needs_review' || order.status === 'draft')) ||
      (conversationFilter === 'payment' && conversation.orders.some((order) =>
        ['unpaid', 'pending', 'verification_required', 'payment_issue'].includes(order.paymentStatus) &&
        !['rejected', 'cancelled'].includes(order.status),
      )) ||
      (conversationFilter === 'active' && conversation.orders.some((order) => ['accepted', 'processing', 'ready'].includes(order.status)));

    if (!matchesFilter) return false;
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
          <Text style={[styles.backToListText, appearance.dark && darkStyles.greenText]}>← Conversations</Text>
        </Pressable>

        <View style={styles.conversationHeader}>
          <View style={styles.customerAvatar}>
            <Text style={styles.customerAvatarText}>{customerInitials(selected.name)}</Text>
          </View>
          <View style={styles.orderIdentity}>
            <Text style={[styles.detailTitle, appearance.dark && darkStyles.titleText]}>{selected.name}</Text>
            <Text style={[styles.orderMeta, appearance.dark && darkStyles.bodyText]}>{selected.phone}</Text>
          </View>
          <Badge label="WhatsApp" positive />
        </View>

        <View style={[styles.threadNotice, appearance.dark && darkStyles.infoCard]}>
          <Text style={[styles.threadNoticeTitle, appearance.dark && darkStyles.titleText]}>Captured order messages</Text>
          <Text style={[styles.threadNoticeText, appearance.dark && darkStyles.bodyText]}>
            SellerTray shows WhatsApp messages currently attached to orders. Full conversational history will populate through the approved WhatsApp message-history pipeline.
          </Text>
        </View>

        <View style={styles.conversationThread}>
          {selected.orders
            .slice()
            .reverse()
            .map((order) => (
              <View key={order.id} style={[styles.customerBubble, appearance.dark && darkStyles.mintCard]}>
                <Text style={[styles.bubbleText, appearance.dark && darkStyles.titleText]}>{order.customerMessage || 'Order message captured without text.'}</Text>
                <View style={styles.bubbleMetaRow}>
                  <Text style={styles.bubbleMeta}>{formatReceivedAt(order.receivedAt)}</Text>
                  <Text style={styles.bubbleOrderRef}>{order.publicOrderId}</Text>
                </View>
                <View style={[styles.linkedOrderCard, appearance.dark && darkStyles.card]}>
                  <View style={styles.linkedOrderCopy}>
                    <Text style={[styles.linkedOrderTitle, appearance.dark && darkStyles.titleText]}>Linked order</Text>
                    <Text style={[styles.linkedOrderMeta, appearance.dark && darkStyles.bodyText]}>
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
        <Text style={[styles.sectionEyebrow, appearance.dark && darkStyles.bodyText]}>WHATSAPP COMMERCE</Text>
        <Text style={[styles.pageTitle, appearance.dark && darkStyles.titleText, appearance.textSize === 'large' && styles.pageTitleLarge]}>Conversations</Text>
        <Text style={[styles.pageSubtitle, appearance.dark && darkStyles.bodyText]}>Customer chats linked to orders, payments and fulfilment activity.</Text>
      </View>

      <View style={styles.conversationStatsGrid}>
        <ConversationStat icon="chatbubbles-outline" label="All" value={conversationCounts.all} active={conversationFilter === 'all'} onPress={() => setConversationFilter('all')} />
        <ConversationStat icon="sparkles-outline" label="New orders" value={conversationCounts.new} active={conversationFilter === 'new'} onPress={() => setConversationFilter('new')} />
        <ConversationStat icon="card-outline" label="Payment" value={conversationCounts.payment} active={conversationFilter === 'payment'} onPress={() => setConversationFilter('payment')} />
        <ConversationStat icon="cube-outline" label="Active" value={conversationCounts.active} active={conversationFilter === 'active'} onPress={() => setConversationFilter('active')} />
      </View>

      <View style={styles.searchRow}>
        <View style={[styles.searchBox, appearance.dark && darkStyles.input]}>
          <Ionicons name="search-outline" size={19} color={theme.colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search customer or message"
            placeholderTextColor={theme.colors.subtle}
            autoCorrect={false}
            style={[styles.searchInputEmbedded, appearance.dark && darkStyles.inputText]}
          />
        </View>
        <Pressable
          onPress={() => setShowConversationFilters((value) => !value)}
          accessibilityLabel="More conversation filters"
          style={[styles.filterIconButton, appearance.dark && darkStyles.outlineButton, showConversationFilters && styles.filterIconButtonActive]}
        >
          <Ionicons name="options-outline" size={21} color={showConversationFilters ? theme.colors.white : appearance.dark ? theme.colors.mint : theme.colors.navy} />
        </Pressable>
      </View>

      {showConversationFilters ? (
        <View style={[styles.filterPanel, appearance.dark && darkStyles.card]}>
          <Text style={[styles.filterPanelTitle, appearance.dark && darkStyles.titleText]}>Inbox filters</Text>
          <View style={styles.filterRow}>
            <SimpleFilter label="All" active={conversationFilter === 'all'} onPress={() => setConversationFilter('all')} />
            <SimpleFilter label="New orders" active={conversationFilter === 'new'} onPress={() => setConversationFilter('new')} />
            <SimpleFilter label="Payment pending" active={conversationFilter === 'payment'} onPress={() => setConversationFilter('payment')} />
            <SimpleFilter label="In progress" active={conversationFilter === 'active'} onPress={() => setConversationFilter('active')} />
          </View>
        </View>
      ) : null}

      <View style={styles.inboxStatCard}>
        <View style={styles.inboxStatIcon}>
          <Ionicons name="logo-whatsapp" size={24} color={theme.colors.white} />
        </View>
        <View style={styles.conversationCopy}>
          <Text style={styles.inboxStatValue}>{visible.length}</Text>
          <Text style={styles.inboxStatTitle}>Conversations in this view</Text>
          <Text style={styles.inboxStatText}>Built from connected WhatsApp order activity.</Text>
        </View>
      </View>

      {visible.length === 0 ? (
        <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
          <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>No conversations yet</Text>
          <Text style={[styles.emptyText, appearance.dark && darkStyles.bodyText]}>WhatsApp customers will appear here after SellerTray captures supported order messages.</Text>
        </View>
      ) : (
        <View style={[styles.conversationList, appearance.dark && darkStyles.card]}>
          {visible.map((conversation) => (
            <Pressable
              key={conversation.phone}
              onPress={() => setSelectedPhone(conversation.phone)}
              style={[styles.conversationRow, appearance.dark && darkStyles.rowBorder]}
            >
              <View style={styles.customerAvatarSmall}>
                <Text style={styles.customerAvatarSmallText}>{customerInitials(conversation.name)}</Text>
              </View>
              <View style={styles.conversationCopy}>
                <View style={styles.conversationNameRow}>
                  <Text style={[styles.conversationName, appearance.dark && darkStyles.titleText]}>{conversation.name}</Text>
                  <Text style={styles.conversationTime}>
                    {conversation.latest ? formatReceivedAt(conversation.latest.receivedAt) : ''}
                  </Text>
                </View>
                <Text numberOfLines={1} style={[styles.conversationPreview, appearance.dark && darkStyles.bodyText]}>
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

function NotificationCenterView({
  orders,
  syncError,
  onOpenOrder,
  onBack,
}: {
  orders: MerchantOrder[];
  syncError: string | null;
  onOpenOrder: (orderId: string) => void;
  onBack: () => void;
}) {
  const appearance = useSellerTrayAppearance();
  const alerts = orders
    .flatMap((order) => {
      const rows: Array<{ key: string; title: string; text: string; icon: string; tone: 'warning' | 'info' | 'success'; orderId: string }> = [];
      if (order.status === 'needs_review' || order.status === 'draft') {
        rows.push({
          key: order.id + '-review',
          title: 'Order needs review',
          text: `${order.publicOrderId} · ${order.customerName}`,
          icon: 'alert-circle-outline',
          tone: 'warning',
          orderId: order.id,
        });
      }
      if (['pending', 'verification_required', 'payment_issue'].includes(order.paymentStatus)) {
        rows.push({
          key: order.id + '-payment',
          title: order.paymentStatus === 'payment_issue' ? 'Payment needs attention' : 'Payment update',
          text: `${order.publicOrderId} · ${formatPaymentStatus(order.paymentStatus)}`,
          icon: 'card-outline',
          tone: 'warning',
          orderId: order.id,
        });
      }
      if (order.status === 'ready') {
        rows.push({
          key: order.id + '-ready',
          title: 'Order ready',
          text: `${order.publicOrderId} is ready for pickup or delivery.`,
          icon: 'checkmark-circle-outline',
          tone: 'success',
          orderId: order.id,
        });
      }
      return rows;
    })
    .slice(0, 30);

  return (
    <View style={styles.sectionStack}>
      <Pressable onPress={onBack} style={styles.backToListButton}>
        <Text style={[styles.backToListText, appearance.dark && darkStyles.greenText]}>← Home</Text>
      </Pressable>
      <View>
        <Text style={[styles.sectionEyebrow, appearance.dark && darkStyles.bodyText]}>ACTIVITY CENTER</Text>
        <Text style={[styles.pageTitle, appearance.dark && darkStyles.titleText, appearance.textSize === 'large' && styles.pageTitleLarge]}>Notifications</Text>
        <Text style={[styles.pageSubtitle, appearance.dark && darkStyles.bodyText]}>Orders, payments and important SellerTray activity that needs your attention.</Text>
      </View>

      {syncError ? (
        <View style={[styles.notificationSyncCard, appearance.dark && darkStyles.errorCard]}>
          <Ionicons name="cloud-offline-outline" size={22} color="#B42318" />
          <View style={styles.conversationCopy}>
            <Text style={styles.notificationAlertTitle}>Workspace sync problem</Text>
            <Text style={styles.notificationAlertText}>{syncError}</Text>
          </View>
        </View>
      ) : null}

      {alerts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="notifications-outline" size={28} color={theme.colors.greenDark} />
          <Text style={styles.emptyTitle}>You are all caught up</Text>
          <Text style={styles.emptyText}>New order, payment and fulfilment alerts will appear here.</Text>
        </View>
      ) : (
        <View style={[styles.notificationList, appearance.dark && darkStyles.card]}>
          {alerts.map((alert) => (
            <Pressable key={alert.key} onPress={() => onOpenOrder(alert.orderId)} style={[styles.notificationAlertRow, appearance.dark && darkStyles.rowBorder]}>
              <View style={[
                styles.notificationAlertIcon,
                alert.tone === 'warning' && styles.notificationAlertIconWarning,
                alert.tone === 'success' && styles.notificationAlertIconSuccess,
              ]}>
                <Ionicons name={alert.icon as never} size={20} color={alert.tone === 'warning' ? '#B54708' : alert.tone === 'success' ? theme.colors.greenDark : theme.colors.navy} />
              </View>
              <View style={styles.conversationCopy}>
                <Text style={[styles.notificationAlertTitle, appearance.dark && darkStyles.titleText]}>{alert.title}</Text>
                <Text style={[styles.notificationAlertText, appearance.dark && darkStyles.bodyText]}>{alert.text}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function ConversationStat({
  icon,
  label,
  value,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  value: number;
  active: boolean;
  onPress: () => void;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable onPress={onPress} style={[styles.conversationStatCard, appearance.dark && darkStyles.card, active && styles.conversationStatCardActive]}>
      <Ionicons name={icon as never} size={19} color={active ? theme.colors.greenDark : theme.colors.navy} />
      <Text style={[styles.conversationStatValue, appearance.dark && darkStyles.titleText]}>{value}</Text>
      <Text style={[styles.conversationStatLabel, appearance.dark && darkStyles.bodyText]}>{label}</Text>
    </Pressable>
  );
}

function SimpleFilter({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable onPress={onPress} style={[styles.filterButton, appearance.dark && darkStyles.outlineButton, active && styles.filterButtonActive]}>
      <Text style={[styles.filterButtonText, appearance.dark && darkStyles.bodyText, active && styles.filterButtonTextActive]}>{label}</Text>
    </Pressable>
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
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.bottomNav, appearance.dark && darkStyles.bottomNav]}>
      <NavButton icon="home-outline" label="Home" active={view === 'home'} onPress={() => onChange('home')} />
      <NavButton icon="receipt-outline" label="Orders" active={view === 'orders'} count={reviewCount} onPress={() => onChange('orders')} />
      <NavButton icon="chatbubbles-outline" label="Conversations" active={view === 'inbox'} count={inboxCount} onPress={() => onChange('inbox')} />
      <NavButton icon="cube-outline" label="Catalogue" active={view === 'products'} onPress={() => onChange('products')} />
      <NavButton icon="ellipsis-horizontal" label="More" active={view === 'more'} onPress={() => onChange('more')} />
    </View>
  );
}

function NavButton({
  icon,
  label,
  active,
  count = 0,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  count?: number;
  onPress: () => void;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable onPress={onPress} style={[styles.navButton, appearance.dark && darkStyles.navButton, active && styles.navButtonActive, active && appearance.dark && darkStyles.navButtonActive]}>
      <View style={styles.navIconWrap}>
        <Ionicons name={icon as never} size={20} color={active ? theme.colors.green : appearance.dark ? '#D0D5DD' : theme.colors.muted} />
        {count > 0 ? <Text style={styles.navCount}>{count}</Text> : null}
      </View>
      <Text numberOfLines={1} style={[styles.navText, appearance.dark && darkStyles.bodyText, active && styles.navTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Badge({ label, positive = false }: { label: string; positive?: boolean }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.badge, appearance.dark && darkStyles.subtleCard, positive && styles.badgePositive, positive && appearance.dark && darkStyles.mintCard]}>
      <Text style={[styles.badgeText, appearance.dark && darkStyles.bodyText, positive && styles.badgeTextPositive]}>{label}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: OrderStatus }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.statusPill, appearance.dark && darkStyles.subtleCard, status === 'needs_review' && styles.statusReview]}>
      <Text style={[styles.statusText, appearance.dark && darkStyles.titleText]}>{statusLabels[status]}</Text>
    </View>
  );
}

function firstName(value: string): string {
  const clean = value.trim();
  if (!clean) return 'there';
  const part = clean.split(/\s+/)[0] ?? clean;
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function timeGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
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
  page: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 34, gap: 15 },
  pinnedHeader: { minHeight: 66, paddingHorizontal: 18, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: '#F8FAFC', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E4E7EC', zIndex: 20, elevation: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 },
  notificationButton: { width: 46, height: 46, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  notificationBadge: { position: 'absolute', right: 3, top: 2, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: '#D92D20', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  notificationBadgeText: { color: theme.colors.white, fontSize: 9, fontWeight: '900' },
  headerCopy: { flex: 1, gap: 10 },
  merchantIdentity: { gap: 1, paddingLeft: 2 },
  eyebrow: { color: '#12B76A', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  businessName: { color: '#102A43', fontSize: 25, fontWeight: '900', marginTop: 3 },
  businessNameLarge: { fontSize: 28 },
  workspaceMeta: { color: '#667085', fontSize: 13, fontWeight: '800', marginTop: 4 },
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
  badgeText: { color: '#475467', fontSize: 12, fontWeight: '800' },
  badgeTextPositive: { color: '#027A48' },
  setupCard: { backgroundColor: '#102A43', borderRadius: 17, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  setupCopy: { flex: 1 },
  setupEyebrow: { color: '#84ADFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  setupTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '900', marginTop: 4 },
  setupText: { color: '#D0D5DD', fontSize: 11, lineHeight: 17, marginTop: 4 },
  setupArrow: { color: '#FFFFFF', fontSize: 23, fontWeight: '900' },
  sectionStack: { gap: 14 },
  homeHero: { gap: 2 },
  greetingBlock: { gap: 3, paddingTop: 2 },
  greetingTitle: { color: theme.colors.navy, fontSize: 27, lineHeight: 33, fontWeight: '900' },
  greetingTitleLarge: { fontSize: 30, lineHeight: 36 },
  greetingSubtitle: { color: theme.colors.slate, fontSize: 14, lineHeight: 21 },
  homeHeroGreen: { backgroundColor: theme.colors.green, borderRadius: 19, padding: 16, gap: 15, ...theme.shadow.card },
  heroPressed: { opacity: 0.88, transform: [{ scale: 0.995 }] },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIconWrap: { width: 46, height: 46, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1 },
  heroEyebrow: { color: '#E8FFF3', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  heroValue: { color: theme.colors.white, fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 2 },
  heroBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  heroMeta: { color: '#E8FFF3', fontSize: 12, fontWeight: '700', flex: 1 },
  heroLink: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  homeMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  homeMetricCard: { flexGrow: 1, flexBasis: '46%', minWidth: 138, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 14, ...theme.shadow.card },
  homeMetricCardAttention: { backgroundColor: theme.colors.warningSoft, borderColor: '#FEDF89' },
  metricIconWrap: { width: 36, height: 36, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  homeMetricLabel: { color: theme.colors.slate, fontSize: 13, fontWeight: '800' },
  homeMetricValue: { color: theme.colors.navy, fontSize: 24, fontWeight: '900', marginTop: 4 },
  homeMetricHint: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, fontWeight: '700', marginTop: 3 },
  quickActionsCard: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: 14, gap: 11, ...theme.shadow.card },
  quickActionRow: { flexDirection: 'row', gap: 8 },
  quickAction: { flex: 1, minHeight: 76, borderRadius: 14, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 6 },
  quickActionPressed: { opacity: 0.75 },
  quickActionIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  quickActionText: { color: theme.colors.navy, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  sectionEyebrow: { color: '#667085', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  pageTitle: { color: '#102A43', fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 3 },
  pageTitleLarge: { fontSize: 31, lineHeight: 38 },
  pageSubtitle: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 3 },
  pageHeadingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pageHeadingCopy: { flex: 1 },
  orderSummaryBadge: { minWidth: 78, borderRadius: 14, backgroundColor: theme.colors.warningSoft, borderWidth: 1, borderColor: '#FEDF89', paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center' },
  orderSummaryValue: { color: theme.colors.navy, fontSize: 19, fontWeight: '900' },
  orderSummaryLabel: { color: '#B54708', fontSize: 7, fontWeight: '900', letterSpacing: 0.7, marginTop: 2 },
  backToListButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', paddingRight: 12 },
  backToListText: { color: theme.colors.greenDark, fontSize: 13, fontWeight: '900' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: '#102A43', fontSize: 18, fontWeight: '900' },
  linkText: { color: '#12B76A', fontSize: 14, fontWeight: '800' },
  inboxControls: { gap: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBox: { flex: 1, minHeight: 50, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 14, paddingHorizontal: 13, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { minHeight: 48, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 12, paddingHorizontal: 13, backgroundColor: '#FFFFFF', color: '#102A43', fontSize: 14 },
  searchInputEmbedded: { flex: 1, minHeight: 48, color: '#102A43', fontSize: 14, paddingVertical: 0 },
  filterIconButton: { width: 50, height: 50, borderRadius: 14, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  filterIconButtonActive: { backgroundColor: theme.colors.navy, borderColor: theme.colors.navy },
  filterPanel: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 15, padding: 12, gap: 10 },
  filterPanelTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  queueToggle: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.green, paddingHorizontal: 11, backgroundColor: theme.colors.mintSoft },
  queueToggleActive: { backgroundColor: theme.colors.green, borderColor: theme.colors.green },
  queueToggleText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  queueToggleTextActive: { color: theme.colors.white },
  orderStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  orderStatCard: { flexBasis: '46%', flexGrow: 1, minWidth: 138, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 12, gap: 4 },
  orderStatCardActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  orderStatCardAttention: { borderColor: '#FEDF89' },
  orderStatIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  orderStatIconPositive: { backgroundColor: theme.colors.mintSoft },
  orderStatValue: { color: theme.colors.navy, fontSize: 22, fontWeight: '900', marginTop: 2 },
  orderStatLabel: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, borderRadius: 999, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', paddingHorizontal: 11 },
  filterButtonActive: { borderColor: '#12B76A', backgroundColor: '#ECFDF3' },
  filterButtonText: { color: '#667085', fontSize: 12, fontWeight: '800' },
  filterButtonTextActive: { color: '#079455' },
  filterCount: { minWidth: 18, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden', textAlign: 'center', backgroundColor: '#F2F4F7', color: '#475467', fontSize: 9, fontWeight: '900' },
  filterCountActive: { backgroundColor: '#12B76A', color: '#FFFFFF' },
  resultMeta: { color: '#667085', fontSize: 12, fontWeight: '700' },
  orderList: { gap: 9 },
  orderCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 15, padding: 13 },
  orderCardSelected: { borderColor: '#12B76A', borderWidth: 2 },
  orderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  orderIdentity: { flex: 1 },
  orderRight: { alignItems: 'flex-end', gap: 6 },
  customerName: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  orderId: { color: '#667085', fontSize: 12, marginTop: 2 },
  publicOrderId: { color: '#079455', fontSize: 13, fontWeight: '900', marginTop: 2 },
  orderValue: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  orderValuePending: { color: '#B54708' },
  orderMessage: { color: '#475467', fontSize: 13, lineHeight: 19, marginTop: 9 },
  closureMeta: { color: '#B54708', fontSize: 10, fontWeight: '700', marginTop: 6 },
  orderMeta: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 8 },
  statusPill: { borderRadius: 999, backgroundColor: '#E4E7EC', paddingVertical: 5, paddingHorizontal: 8 },
  statusReview: { backgroundColor: '#FFF3D6' },
  statusText: { color: '#344054', fontSize: 11, fontWeight: '900' },
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
  conversationStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  conversationStatCard: { flexBasis: '22%', flexGrow: 1, minWidth: 72, minHeight: 86, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 10, gap: 3 },
  conversationStatCardActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  conversationStatValue: { color: theme.colors.navy, fontSize: 19, fontWeight: '900' },
  conversationStatLabel: { color: theme.colors.slate, fontSize: 10, fontWeight: '800' },
  threadNotice: { backgroundColor: theme.colors.infoSoft, borderRadius: 13, padding: 12, gap: 3 },
  threadNoticeTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  threadNoticeText: { color: theme.colors.slate, fontSize: 12, lineHeight: 18 },
  conversationThread: { gap: 10 },
  customerBubble: { alignSelf: 'stretch', backgroundColor: theme.colors.mintSoft, borderRadius: 16, borderTopLeftRadius: 5, padding: 12, gap: 8 },
  bubbleText: { color: theme.colors.navy, fontSize: 14, lineHeight: 21 },
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
  inboxStatIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  inboxStatValue: { color: theme.colors.white, fontSize: 26, fontWeight: '900', minWidth: 40 },
  inboxStatTitle: { color: theme.colors.white, fontSize: 14, fontWeight: '900' },
  inboxStatText: { color: theme.colors.mint, fontSize: 11, lineHeight: 16, marginTop: 2 },
  conversationList: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, overflow: 'hidden' },
  conversationRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  customerAvatarSmall: { width: 40, height: 40, borderRadius: 14, backgroundColor: theme.colors.mint, alignItems: 'center', justifyContent: 'center' },
  customerAvatarSmallText: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' },
  conversationCopy: { flex: 1 },
  conversationNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  conversationName: { color: theme.colors.navy, fontSize: 14, fontWeight: '900', flex: 1 },
  conversationTime: { color: theme.colors.subtle, fontSize: 10 },
  conversationPreview: { color: theme.colors.slate, fontSize: 12, lineHeight: 17, marginTop: 3 },
  conversationMeta: { color: theme.colors.greenDark, fontSize: 10, fontWeight: '800', marginTop: 3 },
  conversationChevron: { color: theme.colors.subtle, fontSize: 23 },
  bottomNav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E4E7EC', backgroundColor: '#FFFFFF', paddingHorizontal: 4, paddingTop: 7, paddingBottom: Platform.OS === 'android' ? 46 : 10, gap: 1 },
  navButton: { flex: 1, minHeight: 58, borderRadius: 11, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 1 },
  navButtonActive: { backgroundColor: '#ECFDF3' },
  navIconWrap: { position: 'relative', minWidth: 28, alignItems: 'center' },
  navText: { color: '#667085', fontSize: 10.5, fontWeight: '800', maxWidth: '100%', textAlign: 'center' },
  navTextActive: { color: '#079455' },
  navCount: { position: 'absolute', right: -7, top: -7, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: '#12B76A', color: '#FFFFFF', fontSize: 9, lineHeight: 17, fontWeight: '900', textAlign: 'center', overflow: 'hidden', paddingHorizontal: 3 },
  notificationSyncCard: { backgroundColor: '#FEF3F2', borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  notificationList: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, overflow: 'hidden' },
  notificationAlertRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  notificationAlertIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: theme.colors.infoSoft, alignItems: 'center', justifyContent: 'center' },
  notificationAlertIconWarning: { backgroundColor: theme.colors.warningSoft },
  notificationAlertIconSuccess: { backgroundColor: theme.colors.mintSoft },
  notificationAlertTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  notificationAlertText: { color: theme.colors.slate, fontSize: 12, lineHeight: 17, marginTop: 2 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 13, padding: 13, gap: 5 },
  errorTitle: { color: '#B42318', fontWeight: '900', fontSize: 14 },
  errorText: { color: '#912018', fontSize: 13, lineHeight: 19 },
  retryText: { color: '#B42318', fontWeight: '900', fontSize: 11 },
  loadingCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 18, gap: 8, alignItems: 'center' },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 18, borderWidth: 1, borderColor: '#E4E7EC' },
  emptyTitle: { color: '#102A43', fontWeight: '900', fontSize: 15, textAlign: 'center' },
  emptyText: { color: '#667085', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 4 },
  muted: { color: '#667085', fontSize: 13 },
  primaryButton: { minHeight: 44, borderRadius: 11, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900' },
});

const darkStyles = StyleSheet.create({
  safeArea: { backgroundColor: '#081825' },
  pinnedHeader: { backgroundColor: '#081825', borderBottomColor: '#344054' },
  appFrame: { backgroundColor: '#081825' },
  scroll: { backgroundColor: '#081825' },
  page: { backgroundColor: '#081825' },
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  mintCard: { backgroundColor: '#12372C', borderColor: '#1C6B4A' },
  warningCard: { backgroundColor: '#3D2A12', borderColor: '#B54708' },
  infoCard: { backgroundColor: '#102D45', borderColor: '#344054' },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  mutedText: { color: '#98A2B3' },
  greenText: { color: '#6CE9A6' },
  input: { backgroundColor: '#102A43', borderColor: '#475467' },
  inputText: { color: '#F8FAFC' },
  outlineButton: { backgroundColor: '#102A43', borderColor: '#475467' },
  rowBorder: { borderBottomColor: '#344054' },
  bottomNav: { backgroundColor: '#0B2035', borderTopColor: '#344054' },
  navButton: { backgroundColor: 'transparent' },
  navButtonActive: { backgroundColor: '#12372C' },
});
