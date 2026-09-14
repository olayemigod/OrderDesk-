import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  confirmOfflinePayment,
  loadOrderFinancials,
  recordOfflineOrderPayment,
  sendMerchantPaymentOptions,
  verifyGatewayPayment,
  type OrderFinancialDocument,
  type OrderPaymentAttempt,
} from '../data/orderPaymentsRepository';
import { loadPaymentMethods, type MerchantPaymentMethod } from '../data/paymentMethodsRepository';
import type { MerchantOrder } from '../domain/order';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  order: MerchantOrder;
};

export function OrderPaymentPanel({ tenantId, order }: Props) {
  const appearance = useSellerTrayAppearance();
  const [documents, setDocuments] = useState<OrderFinancialDocument[]>([]);
  const [payments, setPayments] = useState<OrderPaymentAttempt[]>([]);
  const [methods, setMethods] = useState<MerchantPaymentMethod[]>([]);
  const [showRecordMethods, setShowRecordMethods] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [data, paymentMethods] = await Promise.all([
        loadOrderFinancials(tenantId, order.id),
        loadPaymentMethods(tenantId),
      ]);
      setDocuments(data.documents);
      setPayments(data.payments);
      setMethods(paymentMethods);
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

  const offlineMethods = useMemo(
    () => methods.filter((method) =>
      method.isEnabled &&
      ['bank_transfer', 'cash_on_delivery', 'pay_on_pickup'].includes(method.methodType),
    ),
    [methods],
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

  async function record(method: MerchantPaymentMethod) {
    Alert.alert(
      'Record payment received?',
      'Use this only after you or a staff member has verified the money or cash was actually received. SellerTray will mark the order paid and issue the financial receipt.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Record payment',
          onPress: () => {
            void run(method.id, async () => {
              await recordOfflineOrderPayment(
                tenantId,
                order.id,
                method.id,
                'Recorded by merchant/staff from the order payment panel.',
              );
              setShowRecordMethods(false);
              setNotice('Payment recorded and financial receipt issued.');
            });
          },
        },
      ],
    );
  }

  async function sendOptions() {
    await run('send-options', async () => {
      const result = await sendMerchantPaymentOptions(tenantId, order.id);
      setNotice(result.message);
    });
  }

  async function verify(payment: OrderPaymentAttempt) {
    await run(payment.id, async () => {
      await verifyGatewayPayment(tenantId, payment.id);
    });
  }

  async function run(paymentId: string, action: () => Promise<void>) {
    setBusyId(paymentId);
    setError(null);
    setNotice(null);
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
    <View style={[styles.wrap, appearance.dark && darkStyles.card]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>PAYMENT</Text>
          <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Financial status</Text>
        </View>
        <PaymentPill status={order.paymentStatus} />
      </View>

      <View style={[styles.summary, appearance.dark && darkStyles.subtleCard]}>
        <SummaryRow dark={appearance.dark} label="Amount paid" value={formatMoney(order.amountPaid, invoice?.currency ?? 'NGN')} />
        {invoice ? <SummaryRow dark={appearance.dark} label="Invoice" value={invoice.documentReference} /> : null}
        {receipt ? <SummaryRow dark={appearance.dark} label="Financial receipt" value={receipt.documentReference} /> : null}
        {order.paymentConfirmedAt ? (
          <SummaryRow dark={appearance.dark} label="Confirmed" value={formatDateTime(order.paymentConfirmedAt)} />
        ) : null}
      </View>

      {invoice && order.paymentStatus !== 'paid' ? (
        <View style={[styles.merchantActions, appearance.dark && darkStyles.subtleCard]}>
          <Text style={[styles.merchantActionsTitle, appearance.dark && darkStyles.titleText]}>Merchant payment actions</Text>
          <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>
            Staff can record verified offline payments here. For WhatsApp orders, payment choices can also be sent back to the customer.
          </Text>

          {order.source === 'whatsapp' ? (
            <Pressable
              disabled={busyId !== null}
              onPress={() => void sendOptions()}
              style={({ pressed }) => [styles.secondaryButton, appearance.dark && darkStyles.secondaryButton, pressed && styles.pressed, busyId !== null && styles.disabled]}
            >
              <Text style={[styles.secondaryText, appearance.dark && darkStyles.titleText]}>
                {busyId === 'send-options' ? 'Sending…' : 'Send payment options on WhatsApp'}
              </Text>
            </Pressable>
          ) : null}

          {offlineMethods.length > 0 ? (
            <Pressable
              disabled={busyId !== null}
              onPress={() => setShowRecordMethods((value) => !value)}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busyId !== null && styles.disabled]}
            >
              <Text style={styles.primaryText}>{showRecordMethods ? 'Hide payment methods' : 'Record payment received'}</Text>
            </Pressable>
          ) : null}

          {showRecordMethods ? (
            <View style={styles.recordMethodList}>
              {offlineMethods.map((method) => (
                <Pressable
                  key={method.id}
                  disabled={busyId !== null}
                  onPress={() => void record(method)}
                  style={({ pressed }) => [styles.recordMethodButton, appearance.dark && darkStyles.secondaryButton, pressed && styles.pressed]}
                >
                  <Text style={[styles.recordMethodTitle, appearance.dark && darkStyles.titleText]}>{method.displayName}</Text>
                  <Text style={[styles.recordMethodMeta, appearance.dark && darkStyles.bodyText]}>
                    {humanMethod(method.methodType)}
                  </Text>
                </Pressable>
              ))}
              <Text style={[styles.note, appearance.dark && darkStyles.bodyText]}>
                Paystack and Flutterwave are never manually marked paid here; use provider verification for gateway payments.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {loading && payments.length === 0 ? <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>Loading payment attempts…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {payments.length === 0 && !loading ? (
        <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>
          No payment attempt yet. The customer can choose a method on WhatsApp, or merchant/staff can record a verified offline payment above.
        </Text>
      ) : null}

      {payments.map((payment) => {
        const offline = ['bank_transfer', 'cash_on_delivery', 'pay_on_pickup'].includes(payment.methodType);
        const gateway = payment.methodType === 'paystack' || payment.methodType === 'flutterwave';
        const confirmable = offline && ['initiated', 'pending_verification'].includes(payment.status);
        const verifiable = gateway && ['initiated', 'pending_verification'].includes(payment.status);

        return (
          <View key={payment.id} style={[styles.attempt, appearance.dark && darkStyles.subtleCard]}>
            <View style={styles.attemptTop}>
              <View style={styles.headerCopy}>
                <Text style={[styles.attemptTitle, appearance.dark && darkStyles.titleText]}>{humanMethod(payment.methodType)}</Text>
                <Text style={[styles.attemptMeta, appearance.dark && darkStyles.bodyText]}>
                  {formatMoney(payment.amount, payment.currency)} · {humanAttemptStatus(payment.status)}
                </Text>
              </View>
              <Text style={[styles.time, appearance.dark && darkStyles.mutedText]}>{formatDateTime(payment.createdAt)}</Text>
            </View>

            {payment.providerReference ? (
              <Text style={[styles.reference, appearance.dark && darkStyles.bodyText]}>Ref: {payment.providerReference}</Text>
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

      <Text style={[styles.note, appearance.dark && darkStyles.bodyText]}>
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

function SummaryRow({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, dark && darkStyles.bodyText]}>{label}</Text>
      <Text selectable style={[styles.summaryValue, dark && darkStyles.titleText]}>{value}</Text>
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
  eyebrow: { color: '#667085', fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 15, fontWeight: '900', marginTop: 3 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  pillPaid: { backgroundColor: '#ECFDF3' },
  pillWarning: { backgroundColor: '#FFF7E8' },
  pillNeutral: { backgroundColor: '#F2F4F7' },
  pillText: { fontSize: 13, fontWeight: '900' },
  pillTextPaid: { color: '#027A48' },
  pillTextWarning: { color: '#B54708' },
  pillTextNeutral: { color: '#475467' },
  summary: { backgroundColor: '#FFFFFF', borderRadius: 11, padding: 10, gap: 7 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  summaryLabel: { color: '#667085', fontSize: 13, fontWeight: '700' },
  summaryValue: { color: '#102A43', fontSize: 13, fontWeight: '900', flex: 1, textAlign: 'right' },
  attempt: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 11, padding: 10, gap: 7 },
  attemptTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  attemptTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  attemptMeta: { color: '#667085', fontSize: 13, marginTop: 2 },
  time: { color: '#667085', fontSize: 13 },
  reference: { color: '#475467', fontSize: 13 },
  claim: { color: '#B54708', fontSize: 13, fontWeight: '800' },
  helper: { color: '#667085', fontSize: 13, lineHeight: 15 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 15 },
  exceptionBox: { backgroundColor: '#FEF3F2', borderRadius: 9, padding: 9, gap: 3 },
  exceptionTitle: { color: '#B42318', fontSize: 13, fontWeight: '900' },
  primaryButton: { minHeight: 40, borderRadius: 9, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  primaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  secondaryButton: { minHeight: 40, borderRadius: 9, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  secondaryText: { color: '#344054', fontSize: 13, fontWeight: '900' },
  merchantActions: { borderRadius: 12, borderWidth: 1, borderColor: '#E4E7EC', backgroundColor: '#FFFFFF', padding: 11, gap: 8 },
  merchantActionsTitle: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  recordMethodList: { gap: 7 },
  recordMethodButton: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', paddingHorizontal: 11, justifyContent: 'center' },
  recordMethodTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  recordMethodMeta: { color: '#667085', fontSize: 13, marginTop: 2 },
  notice: { color: '#027A48', fontSize: 13, lineHeight: 18, fontWeight: '800' },
  note: { color: '#667085', fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#475467' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  mutedText: { color: '#98A2B3' },
  secondaryButton: { backgroundColor: '#162F46', borderColor: '#667085' },
});
