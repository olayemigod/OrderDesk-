import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  confirmOfflinePayment,
  loadOrderFinancials,
  verifyGatewayPayment,
  type OrderFinancialDocument,
  type OrderPaymentAttempt,
} from '../data/orderPaymentsRepository';
import type { MerchantOrder } from '../domain/order';

type Props = {
  tenantId: string;
  order: MerchantOrder;
};

export function OrderPaymentPanel({ tenantId, order }: Props) {
  const [documents, setDocuments] = useState<OrderFinancialDocument[]>([]);
  const [payments, setPayments] = useState<OrderPaymentAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadOrderFinancials(tenantId, order.id);
      setDocuments(data.documents);
      setPayments(data.payments);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load payment details.');
    } finally {
      setLoading(false);
    }
  }, [order.id, tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh, order.paymentStatus, order.paymentConfirmedAt]);

  const invoice = useMemo(
    () => documents.find((item) => item.documentType === 'invoice' && item.status === 'issued') ?? null,
    [documents],
  );
  const receipt = useMemo(
    () => documents.find((item) => item.documentType === 'receipt' && item.status === 'issued') ?? null,
    [documents],
  );

  async function confirm(payment: OrderPaymentAttempt) {
    Alert.alert(
      'Confirm payment received?',
      'This will mark the payment as confirmed and issue the SellerTray financial receipt. Use this only after you have verified the money was received.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm payment',
          onPress: () => {
            void run(payment.id, async () => {
              await confirmOfflinePayment(tenantId, payment.id);
            });
          },
        },
      ],
    );
  }

  async function verify(payment: OrderPaymentAttempt) {
    await run(payment.id, async () => {
      await verifyGatewayPayment(tenantId, payment.id);
    });
  }

  async function run(paymentId: string, action: () => Promise<void>) {
    setBusyId(paymentId);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment operation failed.');
    } finally {
      setBusyId(null);
    }
  }

  if (!invoice && order.status !== 'accepted' && order.status !== 'processing' && order.status !== 'ready' && order.status !== 'completed') {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>PAYMENT</Text>
          <Text style={styles.title}>Financial status</Text>
        </View>
        <PaymentPill status={order.paymentStatus} />
      </View>

      <View style={styles.summary}>
        <SummaryRow label="Amount paid" value={formatMoney(order.amountPaid, invoice?.currency ?? 'NGN')} />
        {invoice ? <SummaryRow label="Invoice" value={invoice.documentReference} /> : null}
        {receipt ? <SummaryRow label="Financial receipt" value={receipt.documentReference} /> : null}
        {order.paymentConfirmedAt ? (
          <SummaryRow label="Confirmed" value={formatDateTime(order.paymentConfirmedAt)} />
        ) : null}
      </View>

      {loading && payments.length === 0 ? <Text style={styles.helper}>Loading payment attempts…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {payments.length === 0 && !loading ? (
        <Text style={styles.helper}>
          No payment attempt yet. Customers can choose an enabled method from WhatsApp after order acceptance.
        </Text>
      ) : null}

      {payments.map((payment) => {
        const offline = ['bank_transfer', 'cash_on_delivery', 'pay_on_pickup'].includes(payment.methodType);
        const gateway = payment.methodType === 'paystack' || payment.methodType === 'flutterwave';
        const confirmable = offline && ['initiated', 'pending_verification'].includes(payment.status);
        const verifiable = gateway && ['initiated', 'pending_verification'].includes(payment.status);

        return (
          <View key={payment.id} style={styles.attempt}>
            <View style={styles.attemptTop}>
              <View style={styles.headerCopy}>
                <Text style={styles.attemptTitle}>{humanMethod(payment.methodType)}</Text>
                <Text style={styles.attemptMeta}>
                  {formatMoney(payment.amount, payment.currency)} · {humanAttemptStatus(payment.status)}
                </Text>
              </View>
              <Text style={styles.time}>{formatDateTime(payment.createdAt)}</Text>
            </View>

            {payment.providerReference ? (
              <Text style={styles.reference}>Ref: {payment.providerReference}</Text>
            ) : null}
            {payment.customerClaimedAt ? (
              <Text style={styles.claim}>Customer says paid · {formatDateTime(payment.customerClaimedAt)}</Text>
            ) : null}
            {payment.exceptionState !== 'none' ? (
              <View style={styles.exceptionBox}>
                <Text style={styles.exceptionTitle}>Financial exception · {humanException(payment.exceptionState)}</Text>
                {payment.exceptionReason ? <Text style={styles.error}>{payment.exceptionReason}</Text> : null}
              </View>
            ) : null}
            {payment.failureReason ? <Text style={styles.error}>{payment.failureReason}</Text> : null}

            {confirmable ? (
              <Pressable
                disabled={busyId !== null}
                onPress={() => void confirm(payment)}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busyId !== null && styles.disabled]}
              >
                <Text style={styles.primaryText}>
                  {busyId === payment.id ? 'Confirming…' : 'Confirm payment received'}
                </Text>
              </Pressable>
            ) : null}

            {verifiable ? (
              <Pressable
                disabled={busyId !== null}
                onPress={() => void verify(payment)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busyId !== null && styles.disabled]}
              >
                <Text style={styles.secondaryText}>
                  {busyId === payment.id ? 'Checking provider…' : 'Verify with provider'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.note}>
        Order status, payment status and fulfilment status are independent. Confirming payment does not complete the order or delivery.
      </Text>
    </View>
  );
}

function PaymentPill({ status }: { status: MerchantOrder['paymentStatus'] }) {
  const label = {
    unpaid: 'Unpaid',
    pending: 'Started',
    verification_required: 'Verify',
    paid: 'Paid',
    payment_issue: 'Payment issue',
  }[status];

  return (
    <View style={[styles.pill, status === 'paid' ? styles.pillPaid : (status === 'verification_required' || status === 'payment_issue') ? styles.pillWarning : styles.pillNeutral]}>
      <Text style={[styles.pillText, status === 'paid' ? styles.pillTextPaid : (status === 'verification_required' || status === 'payment_issue') ? styles.pillTextWarning : styles.pillTextNeutral]}>
        {label}
      </Text>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text selectable style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function humanException(value: OrderPaymentAttempt['exceptionState']): string {
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

function humanMethod(value: OrderPaymentAttempt['methodType']): string {
  return {
    bank_transfer: 'Bank transfer',
    paystack: 'Paystack',
    flutterwave: 'Flutterwave',
    cash_on_delivery: 'Cash on delivery',
    pay_on_pickup: 'Pay on pickup',
  }[value];
}

function humanAttemptStatus(value: OrderPaymentAttempt['status']): string {
  return {
    initiated: 'Started',
    pending_verification: 'Awaiting verification',
    confirmed: 'Confirmed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    expired: 'Expired',
  }[value];
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
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
  wrap: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 15, padding: 13, gap: 10, backgroundColor: '#FCFCFD' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#667085', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 15, fontWeight: '900', marginTop: 3 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  pillPaid: { backgroundColor: '#ECFDF3' },
  pillWarning: { backgroundColor: '#FFF7E8' },
  pillNeutral: { backgroundColor: '#F2F4F7' },
  pillText: { fontSize: 9, fontWeight: '900' },
  pillTextPaid: { color: '#027A48' },
  pillTextWarning: { color: '#B54708' },
  pillTextNeutral: { color: '#475467' },
  summary: { backgroundColor: '#FFFFFF', borderRadius: 11, padding: 10, gap: 7 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  summaryLabel: { color: '#667085', fontSize: 10, fontWeight: '700' },
  summaryValue: { color: '#102A43', fontSize: 10, fontWeight: '900', flex: 1, textAlign: 'right' },
  attempt: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 11, padding: 10, gap: 7 },
  attemptTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  attemptTitle: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  attemptMeta: { color: '#667085', fontSize: 10, marginTop: 2 },
  time: { color: '#667085', fontSize: 9 },
  reference: { color: '#475467', fontSize: 9 },
  claim: { color: '#B54708', fontSize: 10, fontWeight: '800' },
  helper: { color: '#667085', fontSize: 10, lineHeight: 15 },
  error: { color: '#B42318', fontSize: 10, lineHeight: 15 },
  exceptionBox: { backgroundColor: '#FEF3F2', borderRadius: 9, padding: 9, gap: 3 },
  exceptionTitle: { color: '#B42318', fontSize: 10, fontWeight: '900' },
  primaryButton: { minHeight: 40, borderRadius: 9, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  primaryText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  secondaryButton: { minHeight: 40, borderRadius: 9, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  secondaryText: { color: '#344054', fontSize: 10, fontWeight: '900' },
  note: { color: '#667085', fontSize: 9, lineHeight: 14 },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
});
