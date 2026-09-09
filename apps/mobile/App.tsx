import { useMemo, useState } from 'react';
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
import type { OrderItemInput } from './src/data/ordersRepository';
import { orderTotal, type MerchantOrder, type OrderStatus } from './src/domain/order';
import { useOrders } from './src/hooks/useOrders';
import { supabase } from './src/lib/supabase';

const money = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
});

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

export default function App() {
  return (
    <AuthGate>
      <OrdersScreen />
    </AuthGate>
  );
}

function OrdersScreen() {
  const { orders, loading, error, refresh, setStatus, addItem, editItem, removeItem } = useOrders();
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? orders[0],
    [orders, selectedOrderId],
  );

  const reviewCount = orders.filter((order) => order.status === 'needs_review').length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ORDERDESK</Text>
            <Text style={styles.title}>Orders</Text>
            <Text style={styles.subtitle}>WhatsApp orders, organised for action.</Text>
          </View>
          <View style={styles.headerActions}>
            <View style={styles.reviewBadge}>
              <Text style={styles.reviewNumber}>{reviewCount}</Text>
              <Text style={styles.reviewText}>to review</Text>
            </View>
            <Pressable onPress={() => void supabase.auth.signOut()} style={styles.signOutButton}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </View>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Order sync problem</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void refresh()} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Order inbox</Text>

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
              New WhatsApp orders will appear here as soon as the OrderDesk webhook creates them.
            </Text>
          </View>
        ) : null}

        <View style={styles.inbox}>
          {orders.map((order) => (
            <Pressable
              key={order.id}
              onPress={() => setSelectedOrderId(order.id)}
              style={[
                styles.orderCard,
                selectedOrder?.id === order.id && styles.orderCardSelected,
              ]}
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
                <Text style={styles.metaText}>
                  {order.source === 'whatsapp' ? 'WhatsApp' : 'Manual'}
                </Text>
                <Text style={styles.metaText}>
                  {order.confidence === null ? 'Unscored' : `${Math.round(order.confidence * 100)}% parsed`}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        {selectedOrder ? (
          <OrderDetail
            order={selectedOrder}
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
      </ScrollView>
    </SafeAreaView>
  );
}

function OrderDetail({
  order,
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
        <Text style={styles.totalValue}>{total === null ? 'Needs pricing' : money.format(total)}</Text>
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
        <ActionButton
          label="Accept order"
          disabled={!canAccept}
          onPress={() => void onAccept()}
        />
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
  page: { padding: 20, paddingBottom: 48, gap: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerCopy: { flex: 1 },
  headerActions: { gap: 8, alignItems: 'stretch' },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, color: '#246BFD' },
  title: { fontSize: 32, fontWeight: '800', color: '#111827', marginTop: 2 },
  subtitle: { color: '#667085', marginTop: 4, fontSize: 14 },
  reviewBadge: {
    backgroundColor: '#111827',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  reviewNumber: { color: '#FFFFFF', fontWeight: '800', fontSize: 18 },
  reviewText: { color: '#D0D5DD', fontSize: 11 },
  signOutButton: { alignItems: 'center', paddingVertical: 6 },
  signOutText: { color: '#667085', fontWeight: '700', fontSize: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginTop: 8 },
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
  orderId: { marginTop: 2, fontSize: 12, color: '#98A2B3' },
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
  emptyTitle: { color: '#101828', fontWeight: '800', fontSize: 16 },
  emptyText: { color: '#667085', marginTop: 6, lineHeight: 20 },
});
