import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CommerceBranch, CommerceProduct, CommerceUom } from '../data/commerceRepository';
import {
  applyStockCount,
  cancelStockCount,
  captureStockCountItem,
  loadActiveStockCount,
  loadStockCount,
  startStockCount,
  submitStockCount,
  type InventoryCapabilities,
  type StockCountDetail,
  type StockCountItem,
} from '../data/inventoryRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { createOperationalReference } from './operationalReference';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  products: CommerceProduct[];
  capabilities: InventoryCapabilities;
  onClose: () => void;
  onInventoryChanged: () => Promise<void> | void;
};

export function StockCountWorkspace({
  tenantId,
  branch,
  products,
  capabilities,
  onClose,
  onInventoryChanged,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [count, setCount] = useState<StockCountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reference, setReference] = useState(() => createOperationalReference('stock_count'));
  const [reason, setReason] = useState('Scheduled stock count');
  const [query, setQuery] = useState('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [countUomId, setCountUomId] = useState('');
  const [countQuantity, setCountQuantity] = useState('');
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [confirmApply, setConfirmApply] = useState(false);

  async function refreshCount(countId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const next = countId
        ? await loadStockCount(tenantId, countId)
        : await loadActiveStockCount(tenantId, branch.id);
      setCount(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load this stock count.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCount(null);
    setReference(createOperationalReference('stock_count'));
    setReason('Scheduled stock count');
    setEditingProductId(null);
    setCancelMode(false);
    setConfirmApply(false);
    void refreshCount();
  }, [tenantId, branch.id]);

  const visibleItems = useMemo(() => {
    if (!count) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return count.items;
    return count.items.filter((item) =>
      [item.productName, item.stockUom].join(' ').toLowerCase().includes(normalized),
    );
  }, [count, query]);

  const editingItem = count?.items.find((item) => item.productId === editingProductId) ?? null;
  const editingProduct = products.find((product) => product.id === editingProductId) ?? null;
  const selectedUom = editingProduct?.uoms.find((uom) => uom.id === countUomId) ?? null;
  const parsedQuantity = Number(countQuantity);
  const previewStockQuantity = selectedUom
    && countQuantity.trim() !== ''
    && Number.isFinite(parsedQuantity)
    && parsedQuantity >= 0
    ? parsedQuantity * selectedUom.conversionFactor
    : null;

  const varianceItems = count?.items.filter(
    (item) => item.varianceQuantity !== null && Math.abs(item.varianceQuantity) > 0.000001,
  ) ?? [];
  const increaseItems = varianceItems.filter((item) => (item.varianceQuantity ?? 0) > 0).length;
  const decreaseItems = varianceItems.filter((item) => (item.varianceQuantity ?? 0) < 0).length;

  async function startNewCount() {
    if (saving) return;
    if (!reference.trim()) {
      setError('Reference is required. Generate one or enter an external reference.');
      return;
    }
    if (!reason.trim()) {
      setError('Enter a reason for this stock count.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await startStockCount({ tenantId, branchId: branch.id, reference, reason });
      await refreshCount(result.countId);
      setNotice(result.idempotentReplay ? 'This stock count was already started.' : 'Stock count started.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start this stock count.');
    } finally {
      setSaving(false);
    }
  }

  function beginCapture(item: StockCountItem) {
    const product = products.find((entry) => entry.id === item.productId) ?? null;
    if (!product) {
      setError('This product is no longer available for counting.');
      return;
    }
    const defaultUom = findStockUom(product) ?? product.uoms[0] ?? null;
    setEditingProductId(item.productId);
    setCountUomId(
      product.uoms.find((uom) => uom.name.toLowerCase() === item.selectedUom?.toLowerCase())?.id
      ?? defaultUom?.id
      ?? '',
    );
    setCountQuantity(item.countedQuantity === null ? '' : formatQuantity(item.countedQuantity));
    setError(null);
    setNotice(null);
  }

  async function saveCapture() {
    if (!count || !editingItem || !selectedUom || saving) return;
    if (countQuantity.trim() === '' || !Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
      setError('Enter the physical quantity counted, including zero where nothing is present.');
      return;
    }
    if (!selectedUom.allowFractional && parsedQuantity !== Math.trunc(parsedQuantity)) {
      setError(`${selectedUom.name} does not allow fractional quantity.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await captureStockCountItem({
        tenantId,
        countId: count.countId,
        productId: editingItem.productId,
        uomId: selectedUom.id,
        quantity: parsedQuantity,
      });
      await refreshCount(count.countId);
      setEditingProductId(null);
      setCountUomId('');
      setCountQuantity('');
      setNotice(`${editingItem.productName} count saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this counted quantity.');
    } finally {
      setSaving(false);
    }
  }

  async function moveToReview() {
    if (!count || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await submitStockCount(tenantId, count.countId);
      await refreshCount(count.countId);
      setNotice('Physical count complete. Review the variances before applying them.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit this stock count for review.');
    } finally {
      setSaving(false);
    }
  }

  async function applyReviewedCount() {
    if (!count || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await applyStockCount(tenantId, count.countId);
      await Promise.all([refreshCount(count.countId), Promise.resolve(onInventoryChanged())]);
      setConfirmApply(false);
      setNotice(
        result.inventoryMovementCount === 0
          ? 'Stock count applied. No variance movements were required.'
          : `Stock count applied with ${result.inventoryMovementCount ?? 0} reconciliation movement${result.inventoryMovementCount === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to apply this stock count.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelCurrentCount() {
    if (!count || saving) return;
    if (!cancelReason.trim()) {
      setError('Enter why this stock count is being cancelled.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await cancelStockCount(tenantId, count.countId, cancelReason);
      await refreshCount(count.countId);
      setCancelMode(false);
      setCancelReason('');
      setNotice('Stock count cancelled. No inventory movements were posted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel this stock count.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.stack}>
      <Pressable onPress={onClose} style={styles.backButton}>
        <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
        <Text style={styles.backText}>Inventory</Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>STOCK COUNT</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>{branch.name}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>Count physical stock first. Variances change inventory only after review and apply.</Text>
      </View>

      {error ? <Message text={error} error dark={dark} /> : null}
      {notice ? <Message text={notice} dark={dark} /> : null}

      {loading && !count ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}><ActivityIndicator /><Text style={[styles.muted, dark && darkStyles.bodyText]}>Checking active stock count…</Text></View>
      ) : null}

      {!loading && !count ? (
        <View style={[styles.formCard, dark && darkStyles.card]}>
          <Text style={[styles.formTitle, dark && darkStyles.titleText]}>Start a stock count</Text>
          <View style={styles.fieldHeadingRow}>
            <Text style={[styles.label, dark && darkStyles.bodyText]}>Reference</Text>
            <Pressable onPress={() => setReference(createOperationalReference('stock_count'))} style={styles.generateButton}>
              <Ionicons name="refresh-outline" size={15} color={theme.colors.greenDark} />
              <Text style={styles.generateText}>Generate</Text>
            </Pressable>
          </View>
          <TextInput value={reference} onChangeText={setReference} autoCapitalize="characters" style={[styles.input, dark && darkStyles.input]} />
          <Text style={[styles.helper, dark && darkStyles.bodyText]}>Generated by default; replace it only when an external count sheet reference is useful.</Text>
          <Text style={[styles.label, dark && darkStyles.bodyText]}>Reason</Text>
          <TextInput value={reason} onChangeText={setReason} placeholder="Why is this count being performed?" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
          <Pressable disabled={saving || !capabilities.canCountStock} onPress={() => void startNewCount()} style={[styles.primaryButton, (saving || !capabilities.canCountStock) && styles.disabled]}>
            {saving ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="clipboard-outline" size={18} color={theme.colors.white} />}
            <Text style={styles.primaryText}>{saving ? 'Starting…' : 'Start count'}</Text>
          </Pressable>
        </View>
      ) : null}

      {count ? (
        <>
          <View style={[styles.summaryCard, dark && darkStyles.card]}>
            <View style={styles.summaryHead}>
              <View style={styles.flexCopy}>
                <Text style={[styles.summaryReference, dark && darkStyles.titleText]}>{count.reference}</Text>
                <Text style={[styles.muted, dark && darkStyles.bodyText]}>{count.reason}</Text>
              </View>
              <StatusPill status={count.status} />
            </View>
            <View style={styles.metricsRow}>
              <Metric label="Counted" value={`${count.capturedItems}/${count.totalItems}`} dark={dark} />
              <Metric label="Variances" value={String(varianceItems.length)} dark={dark} />
              <Metric label="+/−" value={`${increaseItems}/${decreaseItems}`} dark={dark} />
            </View>
          </View>

          {count.status === 'counting' ? (
            <>
              <View style={[styles.searchBox, dark && darkStyles.input]}>
                <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search products to count" placeholderTextColor={theme.colors.subtle} style={[styles.searchInput, dark && darkStyles.inputText]} />
              </View>
              <View style={styles.itemList}>
                {visibleItems.map((item) => (
                  <View key={item.itemId} style={[styles.itemCard, dark && darkStyles.card]}>
                    <View style={styles.itemHead}>
                      <View style={styles.flexCopy}>
                        <Text style={[styles.itemName, dark && darkStyles.titleText]}>{item.productName}</Text>
                        <Text style={[styles.muted, dark && darkStyles.bodyText]}>{item.captured ? `${formatQuantity(item.countedQuantity ?? 0)} ${item.selectedUom ?? item.stockUom} counted` : 'Not counted yet'}</Text>
                      </View>
                      <Pressable onPress={() => beginCapture(item)} style={styles.smallButton}>
                        <Text style={styles.smallButtonText}>{item.captured ? 'Edit' : 'Count'}</Text>
                      </Pressable>
                    </View>
                    {editingProductId === item.productId && editingItem ? (
                      <CountEditor
                        product={editingProduct}
                        selectedUomId={countUomId}
                        quantity={countQuantity}
                        previewStockQuantity={previewStockQuantity}
                        stockUom={item.stockUom}
                        dark={dark}
                        saving={saving}
                        onUomChange={setCountUomId}
                        onQuantityChange={setCountQuantity}
                        onCancel={() => { setEditingProductId(null); setCountQuantity(''); setCountUomId(''); }}
                        onSave={() => void saveCapture()}
                      />
                    ) : null}
                  </View>
                ))}
              </View>

              <View style={styles.actionRow}>
                <Pressable disabled={saving} onPress={() => setCancelMode(true)} style={[styles.secondaryButton, dark && darkStyles.outlineButton]}><Text style={[styles.secondaryText, dark && darkStyles.bodyText]}>Cancel count</Text></Pressable>
                <Pressable disabled={saving || count.capturedItems !== count.totalItems} onPress={() => void moveToReview()} style={[styles.primaryButton, (saving || count.capturedItems !== count.totalItems) && styles.disabled]}><Text style={styles.primaryText}>Review variances</Text></Pressable>
              </View>
            </>
          ) : null}

          {count.status === 'review' ? (
            <View style={[styles.reviewCard, dark && darkStyles.card]}>
              <Text style={[styles.formTitle, dark && darkStyles.titleText]}>Variance review</Text>
              {varianceItems.length === 0 ? <Text style={[styles.muted, dark && darkStyles.bodyText]}>No stock differences were found.</Text> : varianceItems.map((item) => (
                <View key={item.itemId} style={[styles.varianceRow, dark && darkStyles.subtleCard]}>
                  <View style={styles.flexCopy}><Text style={[styles.itemName, dark && darkStyles.titleText]}>{item.productName}</Text><Text style={[styles.muted, dark && darkStyles.bodyText]}>Expected {formatQuantity(item.expectedStockQuantity ?? 0)} · Counted {formatQuantity(item.countedStockQuantity ?? 0)} {item.stockUom}</Text></View>
                  <Text style={[styles.varianceValue, (item.varianceQuantity ?? 0) < 0 && styles.negative]}>{(item.varianceQuantity ?? 0) > 0 ? '+' : ''}{formatQuantity(item.varianceQuantity ?? 0)}</Text>
                </View>
              ))}
              {confirmApply ? (
                <View style={[styles.confirmCard, dark && darkStyles.subtleCard]}>
                  <Text style={[styles.confirmText, dark && darkStyles.bodyText]}>Applying creates immutable inventory movements for these variances. Continue?</Text>
                  <View style={styles.actionRow}>
                    <Pressable disabled={saving} onPress={() => setConfirmApply(false)} style={[styles.secondaryButton, dark && darkStyles.outlineButton]}><Text style={[styles.secondaryText, dark && darkStyles.bodyText]}>Not yet</Text></Pressable>
                    <Pressable disabled={saving || !capabilities.canApplyStockCount} onPress={() => void applyReviewedCount()} style={[styles.primaryButton, (saving || !capabilities.canApplyStockCount) && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.white} /> : null}<Text style={styles.primaryText}>Apply count</Text></Pressable>
                  </View>
                </View>
              ) : (
                <Pressable disabled={!capabilities.canApplyStockCount} onPress={() => setConfirmApply(true)} style={[styles.primaryButton, !capabilities.canApplyStockCount && styles.disabled]}><Text style={styles.primaryText}>Apply reviewed count</Text></Pressable>
              )}
            </View>
          ) : null}

          {(count.status === 'applied' || count.status === 'cancelled') ? (
            <View style={[styles.emptyCard, dark && darkStyles.card]}>
              <Ionicons name={count.status === 'applied' ? 'checkmark-circle-outline' : 'close-circle-outline'} size={30} color={count.status === 'applied' ? theme.colors.green : theme.colors.muted} />
              <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>{count.status === 'applied' ? 'Stock count applied' : 'Stock count cancelled'}</Text>
              <Text style={[styles.muted, dark && darkStyles.bodyText]}>{count.status === 'cancelled' ? count.cancelReason ?? 'No inventory movement was posted.' : 'The reviewed variance movements are now part of branch stock history.'}</Text>
            </View>
          ) : null}

          {cancelMode && count.status === 'counting' ? (
            <View style={[styles.confirmCard, dark && darkStyles.card]}>
              <Text style={[styles.formTitle, dark && darkStyles.titleText]}>Cancel stock count</Text>
              <TextInput value={cancelReason} onChangeText={setCancelReason} multiline placeholder="Reason for cancellation" placeholderTextColor={theme.colors.subtle} style={[styles.input, styles.multilineInput, dark && darkStyles.input]} />
              <View style={styles.actionRow}>
                <Pressable disabled={saving} onPress={() => setCancelMode(false)} style={[styles.secondaryButton, dark && darkStyles.outlineButton]}><Text style={[styles.secondaryText, dark && darkStyles.bodyText]}>Keep count</Text></Pressable>
                <Pressable disabled={saving || !cancelReason.trim()} onPress={() => void cancelCurrentCount()} style={[styles.dangerButton, (saving || !cancelReason.trim()) && styles.disabled]}><Text style={styles.dangerText}>Cancel count</Text></Pressable>
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function CountEditor({
  product,
  selectedUomId,
  quantity,
  previewStockQuantity,
  stockUom,
  dark,
  saving,
  onUomChange,
  onQuantityChange,
  onCancel,
  onSave,
}: {
  product: CommerceProduct | null;
  selectedUomId: string;
  quantity: string;
  previewStockQuantity: number | null;
  stockUom: string;
  dark: boolean;
  saving: boolean;
  onUomChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <View style={[styles.editorCard, dark && darkStyles.subtleCard]}>
      <Text style={[styles.label, dark && darkStyles.bodyText]}>Unit</Text>
      <View style={styles.uomRow}>
        {(product?.uoms ?? []).map((uom) => (
          <Pressable key={uom.id} onPress={() => onUomChange(uom.id)} style={[styles.uomChip, dark && darkStyles.outlineButton, selectedUomId === uom.id && styles.uomChipActive]}>
            <Text style={[styles.uomText, dark && darkStyles.bodyText, selectedUomId === uom.id && styles.uomTextActive]}>{uom.name}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.label, dark && darkStyles.bodyText]}>Physical quantity</Text>
      <TextInput value={quantity} onChangeText={(value) => onQuantityChange(value.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
      {previewStockQuantity !== null ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>Equals {formatQuantity(previewStockQuantity)} {stockUom}</Text> : null}
      <View style={styles.actionRow}><Pressable disabled={saving} onPress={onCancel} style={[styles.secondaryButton, dark && darkStyles.outlineButton]}><Text style={[styles.secondaryText, dark && darkStyles.bodyText]}>Cancel</Text></Pressable><Pressable disabled={saving} onPress={onSave} style={[styles.primaryButton, saving && styles.disabled]}><Text style={styles.primaryText}>Save count</Text></Pressable></View>
    </View>
  );
}

function Metric({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, dark && darkStyles.titleText]}>{value}</Text><Text style={[styles.metricLabel, dark && darkStyles.bodyText]}>{label}</Text></View>;
}

function StatusPill({ status }: { status: StockCountDetail['status'] }) {
  return <View style={styles.statusPill}><Text style={styles.statusText}>{status === 'review' ? 'Review' : status.charAt(0).toUpperCase() + status.slice(1)}</Text></View>;
}

function Message({ text, error, dark }: { text: string; error?: boolean; dark: boolean }) {
  return <View style={[error ? styles.errorCard : styles.noticeCard, dark && (error ? darkStyles.errorCard : darkStyles.noticeCard)]}><Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={19} color={error ? theme.colors.danger : theme.colors.greenDark} /><Text style={[error ? styles.errorText : styles.noticeText, dark && darkStyles.bodyText]}>{text}</Text></View>;
}

function findStockUom(product: CommerceProduct): CommerceUom | null {
  return product.uoms.find((uom) => uom.isStockUom) ?? null;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  title: { color: theme.colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 13, lineHeight: 19 },
  backButton: { alignSelf: 'flex-start', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5 },
  backText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  flexCopy: { flex: 1, minWidth: 0 },
  formCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 9 },
  formTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  fieldHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { color: theme.colors.slate, fontSize: 11.5, fontWeight: '900' },
  input: { minHeight: 47, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 12, color: theme.colors.navy, fontSize: 13 },
  multilineInput: { minHeight: 78, textAlignVertical: 'top', paddingTop: 10 },
  helper: { color: theme.colors.muted, fontSize: 10.5, lineHeight: 16 },
  generateButton: { minHeight: 30, paddingHorizontal: 8, borderRadius: 9, backgroundColor: theme.colors.mintSoft, flexDirection: 'row', alignItems: 'center', gap: 4 },
  generateText: { color: theme.colors.greenDark, fontSize: 10.5, fontWeight: '900' },
  primaryButton: { flex: 1, minHeight: 47, borderRadius: 13, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  primaryText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  secondaryButton: { flex: 1, minHeight: 47, borderRadius: 13, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryText: { color: theme.colors.slate, fontSize: 12, fontWeight: '900' },
  dangerButton: { flex: 1, minHeight: 47, borderRadius: 13, backgroundColor: theme.colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  dangerText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 9 },
  summaryCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 12 },
  summaryHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  summaryReference: { color: theme.colors.navy, fontSize: 16, fontWeight: '900' },
  statusPill: { borderRadius: theme.radius.pill, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { color: theme.colors.greenDark, fontSize: 10.5, fontWeight: '900' },
  metricsRow: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, borderRadius: 11, backgroundColor: '#F9FAFB', padding: 9 },
  metricValue: { color: theme.colors.navy, fontSize: 16, fontWeight: '900' },
  metricLabel: { color: theme.colors.muted, fontSize: 10, marginTop: 1 },
  searchBox: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, backgroundColor: theme.colors.white, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  searchInput: { flex: 1, color: theme.colors.navy, fontSize: 13, paddingVertical: 0 },
  itemList: { gap: 8 },
  itemCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 11, gap: 9 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemName: { color: theme.colors.navy, fontSize: 12.5, fontWeight: '900' },
  smallButton: { minHeight: 34, minWidth: 56, borderRadius: 10, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  smallButtonText: { color: theme.colors.greenDark, fontSize: 10.5, fontWeight: '900' },
  editorCard: { borderRadius: 11, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: theme.colors.border, padding: 10, gap: 8 },
  uomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  uomChip: { minHeight: 33, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  uomChipActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  uomText: { color: theme.colors.slate, fontSize: 10.5, fontWeight: '800' },
  uomTextActive: { color: theme.colors.greenDark },
  reviewCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 9 },
  varianceRow: { borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#F9FAFB', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  varianceValue: { color: theme.colors.greenDark, fontSize: 13, fontWeight: '900' },
  negative: { color: '#B42318' },
  confirmCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#F9FAFB', padding: 12, gap: 9 },
  confirmText: { color: theme.colors.slate, fontSize: 11.5, lineHeight: 17 },
  emptyCard: { minHeight: 125, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 7 },
  emptyTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 11, lineHeight: 16 },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 11, flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  errorText: { flex: 1, color: '#912018', fontSize: 11.5, lineHeight: 17 },
  noticeCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft, padding: 11, flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  noticeText: { flex: 1, color: theme.colors.slate, fontSize: 11.5, lineHeight: 17 },
  disabled: { opacity: 0.42 },
});

const darkStyles = StyleSheet.create({
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#CBD5E1' },
  card: { backgroundColor: '#111827', borderColor: '#334155' },
  subtleCard: { backgroundColor: '#172033', borderColor: '#334155' },
  outlineButton: { backgroundColor: '#111827', borderColor: '#334155' },
  input: { backgroundColor: '#111827', borderColor: '#334155', color: '#F8FAFC' },
  inputText: { color: '#F8FAFC' },
  errorCard: { backgroundColor: '#3F1D1D', borderColor: '#7F1D1D' },
  noticeCard: { backgroundColor: '#102E24', borderColor: '#166534' },
});
