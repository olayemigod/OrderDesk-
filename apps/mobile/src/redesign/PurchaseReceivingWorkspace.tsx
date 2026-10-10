import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { CommerceBranch } from '../data/commerceRepository';
import {
  loadPurchaseReceivingDetail,
  loadReceivablePurchases,
  receivePurchaseOrder,
  type PurchaseReceivingDetail,
  type ReceivablePurchaseOrder,
} from '../data/purchasingRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  onClose: () => void;
};

export function PurchaseReceivingWorkspace({ tenantId, branch, onClose }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [orders, setOrders] = useState<ReceivablePurchaseOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseReceivingDetail | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedOrder = useMemo(
    () => orders.find((row) => row.id === selectedId) ?? null,
    [orders, selectedId],
  );

  async function refresh(preferredId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const next = await loadReceivablePurchases(tenantId, branch.id);
      setOrders(next);
      const wanted = preferredId ?? selectedId;
      const nextId = wanted && next.some((row) => row.id === wanted) ? wanted : next[0]?.id ?? null;
      setSelectedId(nextId);
      if (!nextId) {
        setDetail(null);
        setQuantities({});
      }
    } catch (cause) {
      setOrders([]);
      setSelectedId(null);
      setDetail(null);
      setError(errorMessage(cause, 'Unable to load purchases ready for receiving.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(orderId: string) {
    setDetailLoading(true);
    setError(null);
    try {
      const next = await loadPurchaseReceivingDetail(tenantId, orderId);
      if (next.branchId !== branch.id) {
        throw new Error('This purchase belongs to another Branch.');
      }
      setDetail(next);
      setQuantities({});
      setReference('');
      setNotes('');
    } catch (cause) {
      setDetail(null);
      setError(errorMessage(cause, 'Unable to load this purchase.'));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantId, branch.id]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId]);

  async function submitReceipt() {
    if (!detail || busy) return;
    const lines = detail.items.flatMap((item) => {
      const quantity = parseQuantity(quantities[item.itemId]);
      if (quantity <= 0) return [];
      if (quantity > item.remainingQuantity + 0.000001) {
        throw new Error(`${item.productName} exceeds the remaining ordered quantity.`);
      }
      return [{ purchaseOrderItemId: item.itemId, quantity }];
    });

    if (!reference.trim()) {
      setError('Enter the supplier receipt or delivery reference.');
      return;
    }
    if (!lines.length) {
      setError('Enter at least one quantity received.');
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await receivePurchaseOrder({
        tenantId,
        purchaseOrderId: detail.purchaseOrderId,
        reference,
        notes,
        items: lines,
      });
      setMessage(
        result.idempotentReplay
          ? `Receipt ${result.reference} was already recorded. No stock was duplicated.`
          : `Receipt ${result.reference} recorded. Stock is updated for ${branch.name}.`,
      );
      const nextDetail = await loadPurchaseReceivingDetail(tenantId, detail.purchaseOrderId);
      setDetail(nextDetail);
      setQuantities({});
      setReference('');
      setNotes('');
      await refresh(nextDetail.status === 'received' ? null : nextDetail.purchaseOrderId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to receive this purchase.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.stack}>
      <Pressable onPress={onClose} style={styles.backButton}>
        <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
        <Text style={[styles.backText, dark && darkStyles.bodyText]}>More</Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>PURCHASE RECEIVING</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>{branch.name}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Receive stock against placed Purchase Orders. SellerTray keeps the ordered unit conversion and posts stock through the inventory ledger.
        </Text>
      </View>

      {error ? <MessageCard text={error} error dark={dark} onDismiss={() => setError(null)} /> : null}
      {message ? <MessageCard text={message} dark={dark} onDismiss={() => setMessage(null)} /> : null}

      {loading && orders.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading purchases…</Text>
        </View>
      ) : null}

      {!loading && orders.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <Ionicons name="checkmark-circle-outline" size={30} color={theme.colors.green} />
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>Nothing waiting to be received</Text>
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>
            Placed Purchase Orders for this Branch will appear here.
          </Text>
        </View>
      ) : (
        <View style={styles.orderList}>
          {orders.map((order) => (
            <Pressable
              key={order.id}
              onPress={() => setSelectedId(order.id)}
              style={({ pressed }) => [
                styles.orderCard,
                dark && darkStyles.card,
                selectedId === order.id && styles.orderCardSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.orderCopy}>
                <Text style={[styles.orderReference, dark && darkStyles.titleText]}>{order.reference}</Text>
                <Text style={[styles.orderMeta, dark && darkStyles.bodyText]}>
                  {order.supplierName} · {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                </Text>
              </View>
              <View style={styles.orderAmount}>
                <Text style={[styles.amountText, dark && darkStyles.titleText]}>{money(order.totalAmount, order.currency)}</Text>
                <Text style={[styles.statusText, dark && darkStyles.bodyText]}>{statusLabel(order.status)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {detailLoading ? (
        <View style={[styles.detailLoading, dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading purchase details…</Text>
        </View>
      ) : detail && selectedOrder ? (
        <View style={[styles.detailCard, dark && darkStyles.card]}>
          <View style={styles.detailHead}>
            <View style={styles.orderCopy}>
              <Text style={[styles.detailTitle, dark && darkStyles.titleText]}>{detail.reference}</Text>
              <Text style={[styles.orderMeta, dark && darkStyles.bodyText]}>{detail.supplierName}</Text>
            </View>
            <View style={styles.statusPill}><Text style={styles.statusPillText}>{statusLabel(detail.status)}</Text></View>
          </View>

          <View style={styles.lines}>
            {detail.items.map((item) => {
              const quantity = parseQuantity(quantities[item.itemId]);
              const stockQuantity = quantity * item.conversionFactor;
              const complete = item.remainingQuantity <= 0.000001;
              return (
                <View key={item.itemId} style={[styles.lineCard, dark && darkStyles.subtleCard]}>
                  <View style={styles.lineHead}>
                    <View style={styles.orderCopy}>
                      <Text style={[styles.lineName, dark && darkStyles.titleText]}>{item.productName}</Text>
                      <Text style={[styles.orderMeta, dark && darkStyles.bodyText]}>
                        {[item.sku, `${formatQuantity(item.conversionFactor)} Stock UOM per ${item.selectedUom}`].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Text style={[styles.remainingText, complete && styles.completeText]}>
                      {complete ? 'Complete' : `${formatQuantity(item.remainingQuantity)} ${item.selectedUom} left`}
                    </Text>
                  </View>

                  {!complete ? (
                    <View style={styles.quantityRow}>
                      <TextInput
                        value={quantities[item.itemId] ?? ''}
                        onChangeText={(value) => setQuantities((current) => ({ ...current, [item.itemId]: value }))}
                        keyboardType="decimal-pad"
                        placeholder="Qty received"
                        placeholderTextColor={theme.colors.subtle}
                        style={[styles.input, dark && darkStyles.input]}
                      />
                      <Pressable
                        onPress={() => setQuantities((current) => ({
                          ...current,
                          [item.itemId]: formatQuantity(item.remainingQuantity),
                        }))}
                        style={styles.allButton}
                      >
                        <Text style={styles.allButtonText}>All</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {quantity > 0 ? (
                    <Text style={[styles.stockPreview, dark && darkStyles.bodyText]}>
                      Posts {formatQuantity(stockQuantity)} in Stock UOM
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>

          {detail.status !== 'received' ? (
            <View style={styles.formBlock}>
              <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Receipt / delivery reference</Text>
              <TextInput
                value={reference}
                onChangeText={setReference}
                placeholder="e.g. SUP-INV-1042"
                placeholderTextColor={theme.colors.subtle}
                autoCapitalize="characters"
                style={[styles.input, dark && darkStyles.input]}
              />
              <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Optional receiving note"
                placeholderTextColor={theme.colors.subtle}
                multiline
                style={[styles.input, styles.notesInput, dark && darkStyles.input]}
              />
              <Pressable
                disabled={busy}
                onPress={() => void submitReceipt()}
                style={[styles.primaryButton, busy && styles.disabled]}
              >
                {busy ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="cube-outline" size={18} color={theme.colors.white} />}
                <Text style={styles.primaryButtonText}>{busy ? 'Receiving…' : 'Receive stock'}</Text>
              </Pressable>
            </View>
          ) : null}

          {detail.receipts.length ? (
            <View style={styles.historyBlock}>
              <Text style={[styles.sectionLabel, dark && darkStyles.bodyText]}>RECEIPT HISTORY</Text>
              {detail.receipts.map((receipt) => (
                <View key={receipt.receiptId} style={styles.historyRow}>
                  <View style={styles.orderCopy}>
                    <Text style={[styles.historyReference, dark && darkStyles.titleText]}>{receipt.reference}</Text>
                    <Text style={[styles.orderMeta, dark && darkStyles.bodyText]}>{dateTime(receipt.receivedAt)}</Text>
                  </View>
                  <Text style={[styles.historyCount, dark && darkStyles.bodyText]}>{receipt.itemCount} items</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <Pressable disabled={loading} onPress={() => void refresh()} style={[styles.refreshButton, loading && styles.disabled]}>
        <Ionicons name="refresh-outline" size={18} color={theme.colors.greenDark} />
        <Text style={styles.refreshText}>Refresh purchases</Text>
      </Pressable>
    </View>
  );
}

function MessageCard({
  text,
  error = false,
  dark,
  onDismiss,
}: {
  text: string;
  error?: boolean;
  dark: boolean;
  onDismiss: () => void;
}) {
  return (
    <View style={[styles.messageCard, error && styles.errorCard, dark && darkStyles.subtleCard]}>
      <Ionicons
        name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'}
        size={19}
        color={error ? theme.colors.danger : theme.colors.greenDark}
      />
      <Text style={[styles.messageText, dark && darkStyles.bodyText]}>{text}</Text>
      <Pressable onPress={onDismiss}><Ionicons name="close" size={18} color={theme.colors.muted} /></Pressable>
    </View>
  );
}

function parseQuantity(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') return cause.message;
  return fallback;
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  backButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  backText: { color: theme.colors.greenDark, fontSize: 13, fontWeight: '800' },
  heading: { gap: 4 },
  eyebrow: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: theme.colors.navy, fontSize: 23, lineHeight: 29, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 12, lineHeight: 18 },
  orderList: { gap: 8 },
  orderCard: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.md, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  orderCardSelected: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  orderCopy: { flex: 1, minWidth: 0 },
  orderReference: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  orderMeta: { color: theme.colors.muted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  orderAmount: { alignItems: 'flex-end', maxWidth: '42%' },
  amountText: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  statusText: { color: theme.colors.muted, fontSize: 9, marginTop: 2 },
  detailCard: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.lg, padding: 13, gap: 13 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailTitle: { color: theme.colors.navy, fontSize: 16, fontWeight: '900' },
  statusPill: { borderRadius: 14, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 8, paddingVertical: 4 },
  statusPillText: { color: theme.colors.greenDark, fontSize: 9, fontWeight: '900' },
  lines: { gap: 8 },
  lineCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.cloud, padding: 10, gap: 8 },
  lineHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineName: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  remainingText: { color: theme.colors.greenDark, fontSize: 10, fontWeight: '900' },
  completeText: { color: theme.colors.muted },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  input: { minHeight: 44, flex: 1, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.md, paddingHorizontal: 11, color: theme.colors.navy, fontSize: 12 },
  notesInput: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
  allButton: { minHeight: 44, minWidth: 54, borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  allButtonText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  stockPreview: { color: theme.colors.slate, fontSize: 10 },
  formBlock: { gap: 7 },
  fieldLabel: { color: theme.colors.slate, fontSize: 10, fontWeight: '800' },
  primaryButton: { minHeight: 46, borderRadius: theme.radius.md, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 4 },
  primaryButtonText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  historyBlock: { gap: 6 },
  sectionLabel: { color: theme.colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  historyRow: { minHeight: 45, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  historyReference: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' },
  historyCount: { color: theme.colors.muted, fontSize: 10 },
  messageCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorCard: { backgroundColor: theme.colors.dangerSoft },
  messageText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  emptyCard: { minHeight: 140, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 18 },
  emptyTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  detailLoading: { minHeight: 100, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', gap: 8 },
  refreshButton: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: theme.colors.white },
  refreshText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  input: { backgroundColor: '#102A43', borderColor: '#344054', color: theme.colors.cloud },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});
