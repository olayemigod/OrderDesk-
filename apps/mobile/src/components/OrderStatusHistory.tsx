import { StyleSheet, Text, View } from 'react-native';

import type { MerchantOrder, OrderStatus, OrderStatusEvent } from '../domain/order';
import { OrderNotificationHistory } from './OrderNotificationHistory';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

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

export function OrderStatusHistory({ order }: { order: MerchantOrder }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={styles.wrap}>
      <View style={styles.section}>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Order history</Text>
        {order.statusHistory.length === 0 ? (
          <Text style={[styles.empty, appearance.dark && darkStyles.bodyText]}>No recorded workflow events yet.</Text>
        ) : (
          <>
            <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>Server-recorded workflow events for this order.</Text>
            <View style={[styles.timeline, appearance.dark && darkStyles.timeline]}>
              {order.statusHistory.map((event) => (
                <HistoryEvent key={event.id} event={event} />
              ))}
            </View>
          </>
        )}
      </View>

      <OrderNotificationHistory order={order} />
    </View>
  );
}

function HistoryEvent({ event }: { event: OrderStatusEvent }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.eventRow, appearance.dark && darkStyles.eventRow]}>
      <View style={styles.dot} />
      <View style={styles.eventBody}>
        <View style={styles.eventHeader}>
          <Text style={[styles.eventTitle, appearance.dark && darkStyles.titleText]}>{eventTitle(event)}</Text>
          <Text style={[styles.eventTime, appearance.dark && darkStyles.bodyText]}>{formatTime(event.createdAt)}</Text>
        </View>
        <Text style={[styles.eventMeta, appearance.dark && darkStyles.bodyText]}>
          {event.actorKind === 'merchant' ? 'Merchant action' : 'System'}
          {event.eventType === 'snapshot' ? ' · historical snapshot' : ''}
        </Text>
        {event.reason ? <Text style={[styles.reason, appearance.dark && darkStyles.bodyText]}>Reason: {event.reason}</Text> : null}
      </View>
    </View>
  );
}

function eventTitle(event: OrderStatusEvent): string {
  if (event.eventType === 'created') return `Order created as ${statusLabels[event.toStatus]}`;
  if (event.eventType === 'snapshot') return `Recorded state: ${statusLabels[event.toStatus]}`;
  if (event.fromStatus) {
    return `${statusLabels[event.fromStatus]} → ${statusLabels[event.toStatus]}`;
  }
  return statusLabels[event.toStatus];
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const styles = StyleSheet.create({
  wrap: { gap: 15 },
  section: { gap: 7 },
  title: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  subtitle: { color: '#667085', fontSize: 11, lineHeight: 16 },
  empty: { color: '#667085', fontSize: 11, lineHeight: 16 },
  timeline: { gap: 0, borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 12, overflow: 'hidden' },
  eventRow: { flexDirection: 'row', gap: 10, padding: 11, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E4E7EC' },
  dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: '#12B76A', marginTop: 5 },
  eventBody: { flex: 1 },
  eventHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  eventTitle: { flex: 1, color: '#344054', fontSize: 11, fontWeight: '800' },
  eventTime: { color: '#667085', fontSize: 9 },
  eventMeta: { color: '#667085', fontSize: 9, marginTop: 3 },
  reason: { color: '#475467', fontSize: 10, lineHeight: 15, marginTop: 5 },
});

const darkStyles = StyleSheet.create({
  timeline: { borderColor: '#475467' },
  eventRow: { backgroundColor: '#162F46', borderBottomColor: '#344054' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
});
