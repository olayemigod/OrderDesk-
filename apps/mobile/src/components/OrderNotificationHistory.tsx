import { StyleSheet, Text, View } from 'react-native';

import type {
  MerchantOrder,
  NotificationDeliveryStatus,
  NotificationEventKey,
  OrderNotification,
} from '../domain/order';

type Props = {
  order: MerchantOrder;
};

const eventLabels: Record<NotificationEventKey, string> = {
  order_received: 'Order received',
  order_accepted: 'Order accepted',
  order_ready: 'Order ready',
  order_out_for_delivery: 'Out for delivery',
  order_rejected: 'Order rejected',
  order_cancelled: 'Order cancelled',
  order_status_reply: 'Status reply',
  order_receipt: 'Order receipt sent',
  payment_options: 'Payment options',
  payment_instructions: 'Payment instructions',
  payment_claim_received: 'Payment claim received',
  payment_confirmed: 'Payment confirmed',
  payment_status_reply: 'Payment status reply',
  financial_document: 'Financial document sent',
};

const statusLabels: Record<NotificationDeliveryStatus, string> = {
  pending: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Delivery failed',
  template_required: 'Template required',
  skipped: 'Skipped',
};

export function OrderNotificationHistory({ order }: Props) {
  if (order.source !== 'whatsapp' && order.notifications.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>CUSTOMER UPDATES</Text>
        <Text style={styles.title}>WhatsApp notifications</Text>
        <Text style={styles.helper}>
          Delivery state is read-only. SellerTray controls provider delivery on the server.
        </Text>
      </View>

      {order.notifications.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No customer update queued yet</Text>
          <Text style={styles.emptyText}>
            Notifications appear here when an enabled order event is queued for this customer.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {order.notifications.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} />
          ))}
        </View>
      )}
    </View>
  );
}

function NotificationRow({ notification }: { notification: OrderNotification }) {
  const status = notification.deliveryStatus;
  const needsAttention = status === 'failed' || status === 'template_required';
  const positive = status === 'sent';

  return (
    <View style={styles.row}>
      <View style={styles.topRow}>
        <View style={styles.eventCopy}>
          <Text style={styles.eventTitle}>{eventLabels[notification.eventKey]}</Text>
          <Text style={styles.timeText}>
            {formatTime(notification.sentAt ?? notification.createdAt)}
          </Text>
        </View>
        <View
          style={[
            styles.statusPill,
            positive && styles.statusPillPositive,
            needsAttention && styles.statusPillAttention,
          ]}
        >
          <Text
            style={[
              styles.statusText,
              positive && styles.statusTextPositive,
              needsAttention && styles.statusTextAttention,
            ]}
          >
            {statusLabels[status]}
          </Text>
        </View>
      </View>
      <Text style={styles.message}>{notification.messageBody}</Text>
      {status === 'template_required' ? (
        <Text style={styles.attentionText}>
          The customer-service window is closed. An approved WhatsApp template is required before this update can be delivered.
        </Text>
      ) : null}
      {status === 'failed' ? (
        <Text style={styles.attentionText}>
          SellerTray will retry within the governed delivery policy when the notification is eligible.
        </Text>
      ) : null}
    </View>
  );
}

function formatTime(value: string): string {
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
  wrap: { gap: 9 },
  heading: { gap: 3 },
  eyebrow: { color: '#667085', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  helper: { color: '#667085', fontSize: 10, lineHeight: 15 },
  list: { gap: 8 },
  row: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12, gap: 7 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 9 },
  eventCopy: { flex: 1 },
  eventTitle: { color: '#102A43', fontSize: 11, fontWeight: '900' },
  timeText: { color: '#667085', fontSize: 9, marginTop: 2 },
  statusPill: { borderRadius: 999, backgroundColor: '#F2F4F7', paddingHorizontal: 8, paddingVertical: 4 },
  statusPillPositive: { backgroundColor: '#ECFDF3' },
  statusPillAttention: { backgroundColor: '#FFF8E7' },
  statusText: { color: '#475467', fontSize: 9, fontWeight: '900' },
  statusTextPositive: { color: '#027A48' },
  statusTextAttention: { color: '#B54708' },
  message: { color: '#475467', fontSize: 10, lineHeight: 16 },
  attentionText: { color: '#B54708', fontSize: 9, lineHeight: 14 },
  emptyCard: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12 },
  emptyTitle: { color: '#344054', fontSize: 11, fontWeight: '800' },
  emptyText: { color: '#667085', fontSize: 10, lineHeight: 15, marginTop: 3 },
});
