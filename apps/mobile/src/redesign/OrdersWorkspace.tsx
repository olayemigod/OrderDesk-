import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { applyPosSaleAction, type PosSaleAction } from '../data/posSaleRepository';
import type { MerchantOrder, OrderSource } from '../domain/order';
import { orderTotal } from '../domain/order';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  businessCurrency: string;
  orders: MerchantOrder[];
  loading: boolean;
  canReturnCompletedSale: boolean;
  onChanged: () => Promise<void>;
};

type PendingAction = {
  orderId: string;
  action: PosSaleAction;
};

export function OrdersWorkspace({
  tenantId,
  businessCurrency,
  orders,
  loading,
  canReturnCompletedSale,
  onChanged,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function beginAction(order: MerchantOrder, action: PosSaleAction) {
    setPending({ orderId: order.id, action });
    setReason('');
    setError(null);
  }

  function cancelAction() {
    if (saving) return;
    setPending(null);
    setReason('');
    setError(null);
  }

  async function confirmAction(order: MerchantOrder) {
    if (!pending || pending.orderId !== order.id || saving) return;
    const cleanReason = reason.trim();
    if (!cleanReason) {
      setError('Enter a reason before continuing.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await applyPosSaleAction({
        tenantId,
        orderId: order.id,
        action: pending.action,
        reason: cleanReason,
      });
      setPending(null);
      setReason('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SellerTray could not update this sale.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>ORDERS</Text>
        <Text style={[styles.pageTitle, appearance.dark && darkStyles.titleText]}>Orders</Text>
        <Text style={[styles.pageSubtitle, appearance.dark && darkStyles.bodyText]}>
          Review customer orders, payment state and fulfilment progress.
        </Text>
      </View>

      {loading && orders.length === 0 ? (
        <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Loading orders…</Text>
        </View>
      ) : null}

      {!loading && orders.length === 0 ? (
        <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
          <Ionicons name="receipt-outline" size={28} color={theme.colors.greenDark} />
          <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>No orders here yet</Text>
          <Text style={[styles.emptyText, appearance.dark && darkStyles.bodyText]}>
            Walk-in, POS and WhatsApp orders for this branch will appear here.
          </Text>
        </View>
      ) : null}

      {orders.map((order) => {
        const total = orderTotal(order);
        const canVoid = order.source === 'pos'
          && order.status === 'draft'
          && order.paymentStatus === 'unpaid'
          && order.amountPaid === 0;
        const canReturn = canReturnCompletedSale
          && order.source === 'pos'
          && order.status === 'completed'
          && order.paymentStatus === 'paid'
          && order.fulfillmentStatus === 'collected'
          && order.returnStatus === 'none';
        const action = pending?.orderId === order.id ? pending.action : null;

        return (
          <View key={order.id} style={[styles.orderCard, appearance.dark && darkStyles.card]}>
            <View style={styles.orderTopRow}>
              <View style={styles.orderIdentity}>
                <Text style={[styles.customerName, appearance.dark && darkStyles.titleText]}>{order.customerName}</Text>
                <Text style={[styles.orderMeta, appearance.dark && darkStyles.bodyText]}>
                  {order.publicOrderId} · {sourceLabel(order.source)}
                </Text>
              </View>
              <Text style={[styles.orderValue, appearance.dark && darkStyles.titleText]}>
                {total === null ? 'Needs pricing' : formatMoney(total, businessCurrency)}
              </Text>
            </View>

            <View style={styles.orderStateRow}>
              <StatePill label={order.returnStatus === 'returned' ? 'Returned' : titleCase(order.status)} positive={order.returnStatus === 'returned'} />
              <StatePill label={titleCase(order.paymentStatus)} positive={order.paymentStatus === 'paid'} />
              <StatePill
                label={titleCase(order.fulfillmentStatus)}
                positive={order.fulfillmentStatus === 'delivered' || order.fulfillmentStatus === 'collected'}
              />
            </View>

            {order.returnStatus === 'returned' ? (
              <View style={[styles.returnedNotice, appearance.dark && darkStyles.subtleCard]}>
                <Ionicons name="return-down-back-outline" size={18} color={theme.colors.greenDark} />
                <Text style={[styles.returnedText, appearance.dark && darkStyles.bodyText]}>
                  {formatMoney(order.returnedAmount, businessCurrency)} returned. The original sale and payment remain in history.
                </Text>
              </View>
            ) : null}

            {!action && (canVoid || canReturn) ? (
              <View style={styles.actionRow}>
                {canVoid ? (
                  <Pressable
                    disabled={saving}
                    onPress={() => beginAction(order, 'void')}
                    style={[styles.outlineAction, appearance.dark && darkStyles.outlineButton]}
                  >
                    <Ionicons name="close-circle-outline" size={17} color={theme.colors.slate} />
                    <Text style={[styles.outlineActionText, appearance.dark && darkStyles.bodyText]}>Void sale</Text>
                  </Pressable>
                ) : null}
                {canReturn ? (
                  <Pressable
                    disabled={saving}
                    onPress={() => beginAction(order, 'return')}
                    style={[styles.outlineAction, styles.returnAction, appearance.dark && darkStyles.outlineButton]}
                  >
                    <Ionicons name="return-down-back-outline" size={17} color={theme.colors.greenDark} />
                    <Text style={styles.returnActionText}>Return sale</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {action ? (
              <View style={[styles.actionPanel, appearance.dark && darkStyles.subtleCard]}>
                <View style={styles.actionPanelHeading}>
                  <Ionicons
                    name={action === 'return' ? 'return-down-back-outline' : 'close-circle-outline'}
                    size={20}
                    color={action === 'return' ? theme.colors.greenDark : theme.colors.danger}
                  />
                  <View style={styles.actionPanelCopy}>
                    <Text style={[styles.actionPanelTitle, appearance.dark && darkStyles.titleText]}>
                      {action === 'return' ? 'Return this sale' : 'Void this draft sale'}
                    </Text>
                    <Text style={[styles.actionPanelText, appearance.dark && darkStyles.bodyText]}>
                      {action === 'return'
                        ? 'This returns the full counter sale, records the cash refund and restores stock. The original sale stays in history.'
                        : 'This closes the unpaid draft. No payment or stock movement will be created.'}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.fieldLabel, appearance.dark && darkStyles.bodyText]}>Reason</Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  editable={!saving}
                  placeholder={action === 'return' ? 'Why is the customer returning this sale?' : 'Why is this draft being voided?'}
                  placeholderTextColor={theme.colors.subtle}
                  multiline
                  maxLength={500}
                  style={[styles.reasonInput, appearance.dark && darkStyles.input]}
                />

                {error ? (
                  <View style={[styles.errorCard, appearance.dark && darkStyles.errorCard]}>
                    <Ionicons name="alert-circle-outline" size={18} color={theme.colors.danger} />
                    <Text style={[styles.errorText, appearance.dark && darkStyles.bodyText]}>{error}</Text>
                  </View>
                ) : null}

                <View style={styles.confirmRow}>
                  <Pressable disabled={saving} onPress={cancelAction} style={[styles.cancelButton, appearance.dark && darkStyles.outlineButton]}>
                    <Text style={[styles.cancelText, appearance.dark && darkStyles.bodyText]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    disabled={saving || !reason.trim()}
                    onPress={() => void confirmAction(order)}
                    style={[styles.confirmButton, (saving || !reason.trim()) && styles.disabled]}
                  >
                    {saving ? <ActivityIndicator color={theme.colors.white} /> : null}
                    <Text style={styles.confirmText}>
                      {saving ? 'Applying…' : action === 'return' ? 'Confirm return' : 'Confirm void'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function StatePill({ label, positive = false }: { label: string; positive?: boolean }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.statePill, appearance.dark && darkStyles.subtleCard, positive && styles.statePillPositive]}>
      <Text style={[styles.statePillText, appearance.dark && darkStyles.bodyText, positive && styles.statePillTextPositive]}>{label}</Text>
    </View>
  );
}

function sourceLabel(source: OrderSource): string {
  if (source === 'whatsapp') return 'WhatsApp';
  if (source === 'pos') return 'POS';
  return 'Manual';
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  pageTitle: { color: theme.colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  pageSubtitle: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
  muted: { color: theme.colors.muted, fontSize: 12 },
  emptyCard: { minHeight: 120, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 7 },
  emptyTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  emptyText: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  orderCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 10 },
  orderTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  orderIdentity: { flex: 1, minWidth: 0 },
  customerName: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  orderMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 3 },
  orderValue: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  orderStateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statePill: { borderRadius: theme.radius.pill, backgroundColor: '#F2F4F7', paddingHorizontal: 8, paddingVertical: 5 },
  statePillPositive: { backgroundColor: theme.colors.mintSoft },
  statePillText: { color: theme.colors.slate, fontSize: 10, fontWeight: '800' },
  statePillTextPositive: { color: theme.colors.greenDark },
  returnedNotice: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  returnedText: { flex: 1, color: theme.colors.greenDark, fontSize: 11, lineHeight: 17, fontWeight: '700' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  outlineAction: { minHeight: 38, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  outlineActionText: { color: theme.colors.slate, fontSize: 11, fontWeight: '900' },
  returnAction: { borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft },
  returnActionText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  actionPanel: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#F9FAFB', padding: 11, gap: 9 },
  actionPanelHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  actionPanelCopy: { flex: 1 },
  actionPanelTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  actionPanelText: { color: theme.colors.slate, fontSize: 11, lineHeight: 17, marginTop: 2 },
  fieldLabel: { color: theme.colors.slate, fontSize: 11, fontWeight: '900' },
  reasonInput: { minHeight: 82, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 11, paddingVertical: 9, color: theme.colors.navy, fontSize: 12, textAlignVertical: 'top' },
  errorCard: { borderRadius: 11, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 9, flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  errorText: { flex: 1, color: '#912018', fontSize: 11, lineHeight: 17 },
  confirmRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  cancelButton: { minHeight: 40, minWidth: 84, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  cancelText: { color: theme.colors.slate, fontSize: 11, fontWeight: '900' },
  confirmButton: { minHeight: 40, minWidth: 122, borderRadius: 11, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  confirmText: { color: theme.colors.white, fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  outlineButton: { backgroundColor: theme.colors.navy, borderColor: '#475467' },
  input: { backgroundColor: theme.colors.navy, borderColor: '#475467', color: theme.colors.cloud },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});