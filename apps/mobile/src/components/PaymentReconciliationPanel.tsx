import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  confirmReconciliationPayment,
  loadPaymentReconciliation,
  verifyReconciliationGateway,
  type PaymentReconciliationItem,
} from '../data/paymentReconciliationRepository';

type Filter = 'attention' | 'all';

export function PaymentReconciliationPanel({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<PaymentReconciliationItem[]>([]);
  const [filter, setFilter] = useState<Filter>('attention');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await loadPaymentReconciliation(tenantId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load payment reconciliation.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const metrics = useMemo(() => ({
    verify: items.filter((item) => item.status === 'pending_verification').length,
    open: items.filter((item) => item.status === 'initiated').length,
    confirmed: items.filter((item) => item.status === 'confirmed').length,
    failed: items.filter((item) => item.status === 'failed').length,
    exceptions: items.filter((item) => item.exceptionState !== 'none').length,
  }), [items]);

  const visible = useMemo(
    () => filter === 'all'
      ? items
      : items.filter((item) => item.status === 'pending_verification' || item.status === 'failed' || item.exceptionState !== 'none'),
    [filter, items],
  );

  async function run(item: PaymentReconciliationItem, action: () => Promise<void>) {
    setBusyId(item.id);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment reconciliation action failed.');
    } finally {
      setBusyId(null);
    }
  }

  function confirm(item: PaymentReconciliationItem) {
    Alert.alert(
      'Confirm payment received?',
      'Verify the money has been received before confirming. SellerTray will issue the financial payment receipt, but will not change order or fulfilment state.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm payment',
          onPress: () => void run(item, () => confirmReconciliationPayment(tenantId, item.id)),
        },
      ],
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headingRow}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>RECONCILIATION</Text>
          <Text style={styles.title}>Payment inbox</Text>
          <Text style={styles.helper}>
            Review customer claims, provider payments and exceptions across this business.
          </Text>
        </View>
        <Pressable disabled={loading} onPress={() => void refresh()} style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
          <Text style={styles.refreshText}>{loading ? '…' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <View style={styles.metrics}>
        <Metric label="Verify" value={metrics.verify} attention={metrics.verify > 0} />
        <Metric label="Open" value={metrics.open} />
        <Metric label="Paid" value={metrics.confirmed} />
        <Metric label="Failed" value={metrics.failed} attention={metrics.failed > 0} />
        <Metric label="Issues" value={metrics.exceptions} attention={metrics.exceptions > 0} />
      </View>

      <View style={styles.filters}>
        <FilterButton active={filter === 'attention'} label={'Attention (' + (metrics.verify + metrics.failed + metrics.exceptions) + ')'} onPress={() => setFilter('attention')} />
        <FilterButton active={filter === 'all'} label={'Recent (' + items.length + ')'} onPress={() => setFilter('all')} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && visible.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{filter === 'attention' ? 'No payment needs attention' : 'No payment activity yet'}</Text>
          <Text style={styles.helper}>
            {filter === 'attention'
              ? 'Customer transfer claims and failed attempts will appear here.'
              : 'Payment attempts appear here after customers choose a payment method.'}
          </Text>
        </View>
      ) : null}

      {visible.map((item) => {
        const offline = ['bank_transfer', 'cash_on_delivery', 'pay_on_pickup'].includes(item.methodType);
        const gateway = item.methodType === 'paystack' || item.methodType === 'flutterwave';
        const confirmable = offline && ['initiated', 'pending_verification'].includes(item.status);
        const verifiable = gateway && ['initiated', 'pending_verification'].includes(item.status);

        return (
          <View key={item.id} style={styles.item}>
            <View style={styles.itemTop}>
              <View style={styles.flex}>
                <Text style={styles.orderRef}>{item.publicOrderId}</Text>
                <Text style={styles.customer}>{item.customerName}</Text>
              </View>
              <StatusPill status={item.status} />
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.method}>{humanMethod(item.methodType)}</Text>
              <Text style={styles.amount}>{formatMoney(item.amount, item.currency)}</Text>
            </View>

            {item.customerClaimedAt ? (
              <Text style={styles.claim}>Customer says paid · {formatDateTime(item.customerClaimedAt)}</Text>
            ) : null}
            {item.providerReference ? <Text style={styles.reference}>Ref: {item.providerReference}</Text> : null}
            {item.exceptionState !== 'none' ? (
              <Text style={styles.exception}>
                Financial exception: {humanException(item.exceptionState)}
                {item.exceptionReason ? ' · ' + item.exceptionReason : ''}
              </Text>
            ) : null}
            {item.failureReason ? <Text style={styles.error}>{item.failureReason}</Text> : null}
            <Text style={styles.time}>Started {formatDateTime(item.createdAt)}</Text>

            {confirmable || verifiable ? (
              <View style={styles.actions}>
                {confirmable ? (
                  <Pressable
                    disabled={busyId !== null}
                    onPress={() => confirm(item)}
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busyId !== null && styles.disabled]}
                  >
                    <Text style={styles.primaryText}>{busyId === item.id ? 'Confirming…' : 'Confirm received'}</Text>
                  </Pressable>
                ) : null}
                {verifiable ? (
                  <Pressable
                    disabled={busyId !== null}
                    onPress={() => void run(item, () => verifyReconciliationGateway(tenantId, item.id))}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busyId !== null && styles.disabled]}
                  >
                    <Text style={styles.secondaryText}>{busyId === item.id ? 'Checking…' : 'Verify provider'}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Metric({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return (
    <View style={[styles.metric, attention && styles.metricAttention]}>
      <Text style={[styles.metricValue, attention && styles.metricValueAttention]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function FilterButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.filterButton, active && styles.filterButtonActive]}>
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function StatusPill({ status }: { status: PaymentReconciliationItem['status'] }) {
  const label = humanStatus(status);
  const attention = status === 'pending_verification' || status === 'failed';
  const positive = status === 'confirmed';
  return (
    <View style={[styles.pill, positive && styles.pillPositive, attention && styles.pillAttention]}>
      <Text style={[styles.pillText, positive && styles.pillTextPositive, attention && styles.pillTextAttention]}>{label}</Text>
    </View>
  );
}

function humanException(value: PaymentReconciliationItem['exceptionState']): string {
  return {
    none: 'None',
    refund_pending: 'Refund pending',
    refunded: 'Refunded',
    disputed: 'Disputed',
    chargeback: 'Chargeback',
    reversed: 'Reversed',
    duplicate_payment: 'Duplicate payment',
  }[value];
}

function humanMethod(value: PaymentReconciliationItem['methodType']): string {
  return {
    bank_transfer: 'Bank transfer',
    paystack: 'Paystack',
    flutterwave: 'Flutterwave',
    cash_on_delivery: 'Cash on delivery',
    pay_on_pickup: 'Pay on pickup',
  }[value];
}

function humanStatus(value: PaymentReconciliationItem['status']): string {
  return {
    initiated: 'Open',
    pending_verification: 'Verify',
    confirmed: 'Paid',
    failed: 'Failed',
    cancelled: 'Cancelled',
    expired: 'Expired',
  }[value];
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return currency + ' ' + value.toFixed(2);
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const styles = StyleSheet.create({
  wrap: { gap: 10, borderTopWidth: 1, borderTopColor: '#E4E7EC', paddingTop: 15 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  flex: { flex: 1 },
  eyebrow: { color: '#667085', fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 16, fontWeight: '900', marginTop: 3 },
  helper: { color: '#667085', fontSize: 12, lineHeight: 15, marginTop: 3 },
  refresh: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 8 },
  refreshText: { color: '#12B76A', fontSize: 12, fontWeight: '900' },
  metrics: { flexDirection: 'row', gap: 6 },
  metric: { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  metricAttention: { backgroundColor: '#FFF7E8' },
  metricValue: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  metricValueAttention: { color: '#B54708' },
  metricLabel: { color: '#667085', fontSize: 13, fontWeight: '800', marginTop: 2 },
  filters: { flexDirection: 'row', gap: 7 },
  filterButton: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  filterButtonActive: { backgroundColor: '#102A43', borderColor: '#102A43' },
  filterText: { color: '#475467', fontSize: 13, fontWeight: '900' },
  filterTextActive: { color: '#FFFFFF' },
  empty: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12 },
  emptyTitle: { color: '#344054', fontSize: 13, fontWeight: '900' },
  item: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 12, padding: 11, gap: 6 },
  itemTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  orderRef: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  customer: { color: '#667085', fontSize: 12, marginTop: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  method: { color: '#475467', fontSize: 12, fontWeight: '800' },
  amount: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  claim: { color: '#B54708', fontSize: 12, fontWeight: '800' },
  reference: { color: '#667085', fontSize: 9 },
  time: { color: '#667085', fontSize: 9 },
  error: { color: '#B42318', fontSize: 12, lineHeight: 15 },
  exception: { color: '#B42318', fontSize: 12, lineHeight: 15, fontWeight: '800' },
  pill: { borderRadius: 999, backgroundColor: '#F2F4F7', paddingHorizontal: 8, paddingVertical: 4 },
  pillPositive: { backgroundColor: '#ECFDF3' },
  pillAttention: { backgroundColor: '#FFF7E8' },
  pillText: { color: '#475467', fontSize: 13, fontWeight: '900' },
  pillTextPositive: { color: '#027A48' },
  pillTextAttention: { color: '#B54708' },
  actions: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  primaryButton: { minHeight: 38, flexGrow: 1, borderRadius: 9, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  primaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  secondaryButton: { minHeight: 38, flexGrow: 1, borderRadius: 9, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  secondaryText: { color: '#344054', fontSize: 13, fontWeight: '900' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
});
