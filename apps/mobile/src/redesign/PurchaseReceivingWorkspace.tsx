import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { createOperationalReference } from './operationalReference';

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
  const [reference, setReference] = useState(() => createOperationalReference('purchase_receipt'));
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
      if (next.branchId !== branch.id) throw new Error('This purchase belongs to another Branch.');
      setDetail(next);
      setQuantities({});
      setReference(createOperationalReference('purchase_receipt'));
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
    let lines: Array<{ purchaseOrderItemId: string; quantity: number }> = [];
    try {
      lines = detail.items.flatMap((item) => {
        const quantity = parseQuantity(quantities[item.itemId]);
        if (quantity <= 0) return [];
        if (quantity > item.remainingQuantity + 0.000001) {
          throw new Error(`${item.productName} exceeds the remaining ordered quantity.`);
        }
        return [{ purchaseOrderItemId: item.itemId, quantity }];
      });
    } catch (cause) {
      setError(errorMessage(cause, 'Check the received quantities.'));
      return;
    }

    if (!reference.trim()) {
      setError('Reference is required. Generate one or enter the supplier delivery reference.');
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
      setReference(createOperationalReference('purchase_receipt'));
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
          Receive only what physically arrived. Stock changes when a receipt is posted, not when a Purchase Order is placed.
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
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Placed Purchase Orders for this Branch will appear here.</Text>
        </View>
      ) : (
        <View style={styles.orderList}>
          {orders.map((order) => (
            <Pressable
              key={order.id}
              onPress={() => setSelectedId(order.id)}
              style={({ pressed }) => [styles.orderCard, dark && darkStyles.card, selectedId === order.id && styles.orderCardSelected, pressed && styles.pressed]}
            >
              <View style={styles.flexCopy}>
                <Text style={[styles.orderReference, dark && darkStyles.titleText]}>{order.reference}</Text>
                <Text style={[styles.orderMeta, dark && darkStyles.bodyText]}>{order.supplierName} · {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}</Text>
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
            <View style={styles.flexCopy}>
              <Text style={[styles.detailTitle, dark && darkStyles.titleText]}>{detail.reference}</Text>
              <Text style={[styles.orderMeta, dark && darkStyles.bodyText]}>{detail.supplierName}</Text>
            </View>
            <View style={styles.statusPill}><Text style={styles.statusPillText}>{statusLabel(detail.status)}</Text></View>
          </View>

          <View style={[styles.stockRuleCard, dark && darkStyles.subtleCard]}>
            <Ionicons name="cube-outline" size={20} color={theme.colors.greenDark} />
            <Text style={[styles.stockRuleText, dark && darkStyles.bodyText]}>
              This Purchase Order belongs to {detail.branchName}. Each posted receipt increases only this branch’s ledger stock; partial receipts increase only the quantity received.
            </Text>
          </View>

          <View style={styles.lines}>
            {detail.items.map((item) => {
              const quantity = parseQuantity(quantities[item.itemId]);
              const stockQuantity = quantity * item.conversionFactor;
              const complete = item.remainingQuantity <= 0.000001;
              return (
                <View key={item.itemId} style={[styles.lineCard, dark && darkStyles.subtleCard]}>
                  <View style={styles.lineHead}>
                    <View style={styles.flexCopy}>
                      <Text style={[styles.lineName, dark && darkStyles.titleText]}>{item.productName}</Text>
                      <Text style={[styles.orderMeta, dark && darkStyles.bodyText]}>
                        {[item.sku, `1 ${item.selectedUom} = ${formatQuantity(item.conversionFactor)} Stock UOM`].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Text style={[styles.remainingText, complete && styles.completeText]}>{complete ? 'Complete' : `${formatQuantity(item.remainingQuantity)} ${item.selectedUom} left`}</Text>
                  </View>

                  {!complete ? (
                    <View style={styles.quantityRow}>
                      <TextInput
                        value={quantities[item.itemId] ?? ''}
                        onChangeText={(value) => setQuantities((current) => ({ ...current, [item.itemId]: value.replace(/[^0-9.]/g, '') }))}
                        keyboardType="decimal-pad"
                        placeholder="Qty received"
                        placeholderTextColor={theme.colors.subtle}
                        style={[styles.input, dark && darkStyles.input]}
                      />
                      <Pressable onPress={() => setQuantities((current) => ({ ...current, [item.itemId]: formatQuantity(item.remainingQuantity) }))} style={styles.allButton}>
                        <Text style={styles.allButtonText}>All</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {quantity > 0 ? <Text style={[styles.stockPreview, dark && darkStyles.bodyText]}>Posts {formatQuantity(stockQuantity)} in Stock UOM</Text> : null}
                </View>
              );
            })}
          </View>

          {detail.status !== 'received' ? (
            <View style={styles.formBlock}>
              <View style={styles.fieldHeadingRow}>
                <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Receipt / delivery reference</Text>
                <Pressable onPress={() => setReference(createOperationalReference('purchase_receipt'))} style={styles.generateButton}>
                  <Ionicons name="refresh-outline" size={15} color={theme.colors.greenDark} />
                  <Text style={styles.generateText}>Generate</Text>
                </Pressable>
              </View>
              <TextInput
                value={reference}
                onChangeText={setReference}
                placeholder="Auto-generated or supplier reference"
                placeholderTextColor={theme.colors.subtle}
                autoCapitalize="characters"
                style={[styles.input, dark && darkStyles.input]}
              />
              <Text style={[styles.helperText, dark && darkStyles.bodyText]}>SellerTray generates a unique reference by default. Replace it with the supplier’s delivery or invoice reference when that is more useful.</Text>

              <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Optional receiving note"
                placeholderTextColor={theme.colors.subtle}
                multiline
                style={[styles.input, styles.notesInput, dark && darkStyles.input]}
              />
              <Pressable disabled={busy} onPress={() => void submitReceipt()} style={[styles.primaryButton, busy && styles.disabled]}>
                {busy ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="download-outline" size={19} color={theme.colors.white} />}
                <Text style={styles.primaryText}>{busy ? 'Posting receipt…' : 'Receive selected quantities'}</Text>
              </Pressable>
            </View>
          ) : null}

          {detail.receipts.length > 0 ? (
            <View style={styles.historyBlock}>
              <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Receipt history</Text>
              {detail.receipts.map((receipt) => (
                <View key={receipt.receiptId} style={[styles.historyRow, dark && darkStyles.subtleCard]}>
                  <View style={styles.flexCopy}>
                    <Text style={[styles.historyReference, dark && darkStyles.titleText]}>{receipt.reference}</Text>
                    <Text style={[styles.orderMeta, dark && darkStyles.bodyText]}>{formatDate(receipt.receivedAt)} · {receipt.itemCount} {receipt.itemCount === 1 ? 'item' : 'items'}</Text>
                  </View>
                  <Ionicons name="checkmark-circle-outline" size={19} color={theme.colors.greenDark} />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <Pressable disabled={loading || busy} onPress={() => void refresh(selectedId)} style={[styles.refreshButton, dark && darkStyles.outlineButton]}>
        <Ionicons name="refresh-outline" size={18} color={theme.colors.greenDark} />
        <Text style={styles.refreshText}>{loading ? 'Refreshing…' : 'Refresh purchases'}</Text>
      </Pressable>
    </View>
  );
}

function MessageCard({ text, error, dark, onDismiss }: { text: string; error?: boolean; dark: boolean; onDismiss: () => void }) {
  return (
    <View style={[error ? styles.errorCard : styles.noticeCard, dark && (error ? darkStyles.errorCard : darkStyles.noticeCard)]}>
      <Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={20} color={error ? theme.colors.danger : theme.colors.greenDark} />
      <Text style={[error ? styles.errorText : styles.noticeText, dark && darkStyles.bodyText]}>{text}</Text>
      <Pressable onPress={onDismiss}><Ionicons name="close" size={20} color={theme.colors.muted} /></Pressable>
    </View>
  );
}

function parseQuantity(value: string | undefined): number {
  if (!value?.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function statusLabel(value: string): string {
  if (value === 'partially_received') return 'Part received';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  backButton: { alignSelf: 'flex-start', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5 },
  backText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  title: { color: theme.colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 13, lineHeight: 19 },
  flexCopy: { flex: 1, minWidth: 0 },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { flex: 1, color: '#912018', fontSize: 11.5, lineHeight: 17 },
  noticeCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  noticeText: { flex: 1, color: theme.colors.slate, fontSize: 11.5, lineHeight: 17 },
  emptyCard: { minHeight: 135, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 7 },
  emptyTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 11.5, lineHeight: 17, textAlign: 'center' },
  orderList: { gap: 8 },
  orderCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  orderCardSelected: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  orderReference: { color: theme.colors.navy, fontSize: 13.5, fontWeight: '900' },
  orderMeta: { color: theme.colors.muted, fontSize: 10.5, lineHeight: 16, marginTop: 2 },
  orderAmount: { alignItems: 'flex-end' },
  amountText: { color: theme.colors.navy, fontSize: 12.5, fontWeight: '900' },
  statusText: { color: theme.colors.muted, fontSize: 10.5, marginTop: 2 },
  detailLoading: { minHeight: 90, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center', gap: 6 },
  detailCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 13 },
  detailHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  detailTitle: { color: theme.colors.navy, fontSize: 17, fontWeight: '900' },
  statusPill: { borderRadius: theme.radius.pill, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 9, paddingVertical: 5 },
  statusPillText: { color: theme.colors.greenDark, fontSize: 10.5, fontWeight: '900' },
  stockRuleCard: { borderRadius: theme.radius.md, backgroundColor: '#F0FDF4', padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  stockRuleText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  lines: { gap: 8 },
  lineCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#F9FAFB', padding: 11, gap: 8 },
  lineHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  remainingText: { color: '#B54708', fontSize: 10.5, fontWeight: '900' },
  completeText: { color: theme.colors.greenDark },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: 47, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 12, color: theme.colors.navy, fontSize: 13 },
  allButton: { minHeight: 47, minWidth: 54, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  allButtonText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  stockPreview: { color: theme.colors.muted, fontSize: 10.5, fontWeight: '700' },
  formBlock: { gap: 8 },
  fieldHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fieldLabel: { color: theme.colors.slate, fontSize: 11.5, fontWeight: '900' },
  generateButton: { minHeight: 30, paddingHorizontal: 8, borderRadius: 9, backgroundColor: theme.colors.mintSoft, flexDirection: 'row', alignItems: 'center', gap: 4 },
  generateText: { color: theme.colors.greenDark, fontSize: 10.5, fontWeight: '900' },
  helperText: { color: theme.colors.muted, fontSize: 10.5, lineHeight: 16 },
  notesInput: { minHeight: 78, textAlignVertical: 'top', paddingTop: 11 },
  primaryButton: { minHeight: 50, borderRadius: 13, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryText: { color: theme.colors.white, fontSize: 12.5, fontWeight: '900' },
  historyBlock: { gap: 7 },
  sectionTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  historyRow: { borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#F9FAFB', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  historyReference: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  refreshButton: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  refreshText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.82 },
});

const darkStyles = StyleSheet.create({
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#CBD5E1' },
  card: { backgroundColor: '#111827', borderColor: '#334155' },
  subtleCard: { backgroundColor: '#172033', borderColor: '#334155' },
  input: { backgroundColor: '#111827', borderColor: '#334155', color: '#F8FAFC' },
  outlineButton: { backgroundColor: '#111827', borderColor: '#334155' },
  errorCard: { backgroundColor: '#3F1D1D', borderColor: '#7F1D1D' },
  noticeCard: { backgroundColor: '#102E24', borderColor: '#166534' },
});
