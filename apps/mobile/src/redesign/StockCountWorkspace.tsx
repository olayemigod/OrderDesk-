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
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
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
    setReference('');
    setReason('');
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
    (item) => item.varianceQuantity !== null && item.varianceQuantity !== 0,
  ) ?? [];
  const increaseItems = varianceItems.filter((item) => (item.varianceQuantity ?? 0) > 0).length;
  const decreaseItems = varianceItems.filter((item) => (item.varianceQuantity ?? 0) < 0).length;

  async function startNewCount() {
    if (saving) return;
    if (!reference.trim()) {
      setError('Enter a reference for this stock count.');
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
      const result = await startStockCount({
        tenantId,
        branchId: branch.id,
        reference,
        reason,
      });
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
      await Promise.all([
        refreshCount(count.countId),
        Promise.resolve(onInventoryChanged()),
      ]);
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
      setNotice('Stock count cancelled. No stock quantity was changed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel this stock count.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !count) {
    return (
      <View style={styles.stack}>
        <BackButton dark={dark} onPress={onClose} />
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading stock count…</Text>
        </View>
      </View>
    );
  }

  if (!count) {
    return (
      <View style={styles.stack}>
        <BackButton dark={dark} onPress={onClose} />
        <View style={styles.heading}>
          <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>STOCK COUNT</Text>
          <Text style={[styles.title, dark && darkStyles.titleText]}>Count stock at {branch.name}</Text>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
            Count every product first. SellerTray will show expected quantities and variances only after capture is complete.
          </Text>
        </View>

        {error ? <MessageCard text={error} error dark={dark} /> : null}
        {notice ? <MessageCard text={notice} dark={dark} /> : null}

        {!capabilities.canCountStock ? (
          <View style={[styles.infoCard, dark && darkStyles.subtleCard]}>
            <Ionicons name="lock-closed-outline" size={20} color={theme.colors.greenDark} />
            <Text style={[styles.infoText, dark && darkStyles.bodyText]}>
              You can view inventory, but you do not have permission to start a physical stock count.
            </Text>
          </View>
        ) : (
          <View style={[styles.formCard, dark && darkStyles.card]}>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Start stock count</Text>
            <FieldLabel dark={dark}>Reference</FieldLabel>
            <TextInput
              value={reference}
              onChangeText={setReference}
              placeholder="e.g. October month-end count"
              placeholderTextColor={theme.colors.subtle}
              style={[styles.input, dark && darkStyles.input]}
            />
            <FieldLabel dark={dark}>Reason</FieldLabel>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Why is this count being done?"
              placeholderTextColor={theme.colors.subtle}
              multiline
              style={[styles.input, styles.multilineInput, dark && darkStyles.input]}
            />
            <Pressable
              disabled={saving}
              onPress={() => void startNewCount()}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, saving && styles.disabled]}
            >
              {saving ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="clipboard-outline" size={19} color={theme.colors.white} />}
              <Text style={styles.primaryButtonText}>Start count</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (count.status === 'applied' || count.status === 'cancelled') {
    const applied = count.status === 'applied';
    return (
      <View style={styles.stack}>
        <BackButton dark={dark} onPress={onClose} />
        <View style={[styles.completeCard, dark && darkStyles.card]}>
          <View style={[styles.completeIcon, !applied && styles.cancelledIcon]}>
            <Ionicons name={applied ? 'checkmark-circle-outline' : 'close-circle-outline'} size={34} color={applied ? theme.colors.greenDark : theme.colors.muted} />
          </View>
          <Text style={[styles.completeTitle, dark && darkStyles.titleText]}>
            {applied ? 'Stock count applied' : 'Stock count cancelled'}
          </Text>
          <Text style={[styles.completeText, dark && darkStyles.bodyText]}>
            {applied
              ? 'Approved variances were posted as auditable stock reconciliation movements.'
              : 'No count variance was posted to stock.'}
          </Text>
          <Text style={[styles.referenceText, dark && darkStyles.bodyText]}>{count.reference}</Text>
          {notice ? <Text style={[styles.noticeInline, dark && darkStyles.bodyText]}>{notice}</Text> : null}
          <Pressable onPress={onClose} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back to Inventory</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const isCounting = count.status === 'counting';
  const allCaptured = count.totalItems > 0 && count.capturedItems === count.totalItems;
  const canCancel = isCounting ? capabilities.canCountStock : capabilities.canApplyStockCount;

  return (
    <View style={styles.stack}>
      <BackButton dark={dark} onPress={onClose} />
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>{isCounting ? 'PHYSICAL COUNT' : 'VARIANCE REVIEW'}</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>{count.reference}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>{branch.name} · {count.reason}</Text>
      </View>

      {error ? <MessageCard text={error} error dark={dark} /> : null}
      {notice ? <MessageCard text={notice} dark={dark} /> : null}

      {isCounting ? (
        <View style={styles.summaryRow}>
          <SummaryCard label="Counted" value={`${count.capturedItems}/${count.totalItems}`} dark={dark} />
          <SummaryCard label="Remaining" value={String(Math.max(count.totalItems - count.capturedItems, 0))} dark={dark} />
        </View>
      ) : (
        <View style={styles.reviewSummary}>
          <SummaryCard label="Variance items" value={String(varianceItems.length)} dark={dark} />
          <SummaryCard label="Increase items" value={String(increaseItems)} dark={dark} />
          <SummaryCard label="Decrease items" value={String(decreaseItems)} dark={dark} attention={decreaseItems > 0} />
        </View>
      )}

      <View style={[styles.searchBox, dark && darkStyles.input]}>
        <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search product"
          placeholderTextColor={theme.colors.subtle}
          style={[styles.searchInput, dark && darkStyles.inputText]}
        />
      </View>

      {editingItem && isCounting ? (
        <View style={[styles.formCard, dark && darkStyles.card]}>
          <View style={styles.formHeader}>
            <View style={styles.flexOne}>
              <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{editingItem.productName}</Text>
              <Text style={[styles.helperText, dark && darkStyles.bodyText]}>Enter the quantity physically present. Use 0 if none is present.</Text>
            </View>
            <Pressable disabled={saving} onPress={() => setEditingProductId(null)} style={styles.iconButton}>
              <Ionicons name="close" size={20} color={theme.colors.slate} />
            </Pressable>
          </View>

          <FieldLabel dark={dark}>Count unit</FieldLabel>
          <View style={styles.uomWrap}>
            {(editingProduct?.uoms ?? []).map((uom) => (
              <Pressable
                key={uom.id}
                disabled={saving}
                onPress={() => setCountUomId(uom.id)}
                style={[
                  styles.choiceChip,
                  countUomId === uom.id && styles.choiceChipActive,
                  dark && darkStyles.choiceChip,
                ]}
              >
                <Text style={countUomId === uom.id ? styles.choiceChipTextActive : [styles.choiceChipText, dark && darkStyles.bodyText]}>
                  {uom.name}
                </Text>
              </Pressable>
            ))}
          </View>

          <FieldLabel dark={dark}>Physical quantity</FieldLabel>
          <TextInput
            value={countQuantity}
            onChangeText={setCountQuantity}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={theme.colors.subtle}
            style={[styles.input, dark && darkStyles.input]}
          />
          {selectedUom && previewStockQuantity !== null ? (
            <Text style={[styles.conversionPreview, dark && darkStyles.bodyText]}>
              {formatQuantity(parsedQuantity)} {selectedUom.name} = {formatQuantity(previewStockQuantity)} {editingItem.stockUom}
            </Text>
          ) : null}

          <Pressable
            disabled={saving}
            onPress={() => void saveCapture()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, saving && styles.disabled]}
          >
            {saving ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="checkmark" size={19} color={theme.colors.white} />}
            <Text style={styles.primaryButtonText}>Save count</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.itemList}>
          {visibleItems.map((item) => (
            <CountItemCard
              key={item.itemId}
              item={item}
              counting={isCounting}
              dark={dark}
              disabled={saving || !capabilities.canCountStock}
              onPress={() => beginCapture(item)}
            />
          ))}
        </View>
      )}

      {isCounting && !editingItem ? (
        <View style={[styles.actionCard, dark && darkStyles.card]}>
          <Text style={[styles.helperText, dark && darkStyles.bodyText]}>
            {allCaptured
              ? 'Every product has a physical count. Continue to review the variances.'
              : `${count.totalItems - count.capturedItems} product${count.totalItems - count.capturedItems === 1 ? '' : 's'} still need a physical count.`}
          </Text>
          <Pressable
            disabled={!allCaptured || saving || !capabilities.canCountStock}
            onPress={() => void moveToReview()}
            style={({ pressed }) => [styles.primaryButton, (!allCaptured || !capabilities.canCountStock) && styles.disabled, pressed && styles.pressed]}
          >
            <Ionicons name="document-text-outline" size={19} color={theme.colors.white} />
            <Text style={styles.primaryButtonText}>Review variances</Text>
          </Pressable>
        </View>
      ) : null}

      {!isCounting ? (
        <View style={[styles.actionCard, dark && darkStyles.card]}>
          {!capabilities.canApplyStockCount ? (
            <View style={styles.reviewWaiting}>
              <Ionicons name="shield-outline" size={20} color={theme.colors.greenDark} />
              <Text style={[styles.helperText, dark && darkStyles.bodyText]}>
                The count is ready for an authorised reviewer to apply or cancel.
              </Text>
            </View>
          ) : confirmApply ? (
            <View style={styles.confirmStack}>
              <Text style={[styles.confirmTitle, dark && darkStyles.titleText]}>Apply reviewed variances?</Text>
              <Text style={[styles.helperText, dark && darkStyles.bodyText]}>
                SellerTray will post {varianceItems.length} reconciliation movement{varianceItems.length === 1 ? '' : 's'}. The physical count itself will not overwrite stock.
              </Text>
              <View style={styles.inlineActions}>
                <Pressable disabled={saving} onPress={() => setConfirmApply(false)} style={[styles.secondaryButton, dark && darkStyles.outlineButton]}>
                  <Text style={styles.secondaryButtonText}>Back</Text>
                </Pressable>
                <Pressable disabled={saving} onPress={() => void applyReviewedCount()} style={[styles.primaryButton, styles.flexButton]}>
                  {saving ? <ActivityIndicator color={theme.colors.white} /> : null}
                  <Text style={styles.primaryButtonText}>Confirm & apply</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable disabled={saving} onPress={() => setConfirmApply(true)} style={styles.primaryButton}>
              <Ionicons name="shield-checkmark-outline" size={19} color={theme.colors.white} />
              <Text style={styles.primaryButtonText}>Apply variances</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {canCancel ? (
        cancelMode ? (
          <View style={[styles.cancelCard, dark && darkStyles.card]}>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Cancel stock count</Text>
            <Text style={[styles.helperText, dark && darkStyles.bodyText]}>Cancellation does not change stock. Enter why this count should be stopped.</Text>
            <TextInput
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="Cancellation reason"
              placeholderTextColor={theme.colors.subtle}
              multiline
              style={[styles.input, styles.multilineInput, dark && darkStyles.input]}
            />
            <View style={styles.inlineActions}>
              <Pressable disabled={saving} onPress={() => setCancelMode(false)} style={[styles.secondaryButton, dark && darkStyles.outlineButton]}>
                <Text style={styles.secondaryButtonText}>Keep count</Text>
              </Pressable>
              <Pressable disabled={saving} onPress={() => void cancelCurrentCount()} style={[styles.dangerButton, styles.flexButton]}>
                <Text style={styles.dangerButtonText}>Cancel count</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable disabled={saving} onPress={() => setCancelMode(true)} style={styles.cancelLink}>
            <Text style={styles.cancelLinkText}>Cancel stock count</Text>
          </Pressable>
        )
      ) : null}

      <View style={[styles.infoCard, dark && darkStyles.subtleCard]}>
        <Ionicons name="layers-outline" size={20} color={theme.colors.greenDark} />
        <Text style={[styles.infoText, dark && darkStyles.bodyText]}>
          Sales, receipts and other stock movements can continue after a product is counted. SellerTray applies only the reviewed variance, so later movements are preserved.
        </Text>
      </View>
    </View>
  );
}

function CountItemCard({
  item,
  counting,
  dark,
  disabled,
  onPress,
}: {
  item: StockCountItem;
  counting: boolean;
  dark: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const variance = item.varianceQuantity ?? 0;
  return (
    <Pressable
      disabled={!counting || disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.itemCard, dark && darkStyles.card, pressed && styles.pressed]}
    >
      <View style={[styles.itemIcon, item.captured && styles.itemIconDone]}>
        <Ionicons name={item.captured ? 'checkmark' : 'cube-outline'} size={18} color={theme.colors.greenDark} />
      </View>
      <View style={styles.flexOne}>
        <Text style={[styles.itemName, dark && darkStyles.titleText]}>{item.productName}</Text>
        {counting ? (
          <Text style={[styles.itemMeta, dark && darkStyles.bodyText]}>
            {item.captured
              ? `${formatQuantity(item.countedQuantity ?? 0)} ${item.selectedUom ?? item.stockUom} counted`
              : `Not counted · Stock unit ${item.stockUom}`}
          </Text>
        ) : (
          <View style={styles.reviewFacts}>
            <Text style={[styles.itemMeta, dark && darkStyles.bodyText]}>
              Expected {formatQuantity(item.expectedStockQuantity ?? 0)} · Counted {formatQuantity(item.countedStockQuantity ?? 0)} {item.stockUom}
            </Text>
            <Text style={[styles.varianceText, variance < 0 && styles.varianceNegative, variance === 0 && styles.varianceZero]}>
              Variance {variance > 0 ? '+' : ''}{formatQuantity(variance)}
            </Text>
          </View>
        )}
      </View>
      {counting ? <Ionicons name="chevron-forward" size={18} color={theme.colors.subtle} /> : null}
    </Pressable>
  );
}

function BackButton({ dark, onPress }: { dark: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.backButton}>
      <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
      <Text style={[styles.backText, dark && darkStyles.bodyText]}>Inventory</Text>
    </Pressable>
  );
}

function SummaryCard({
  label,
  value,
  dark,
  attention = false,
}: {
  label: string;
  value: string;
  dark: boolean;
  attention?: boolean;
}) {
  return (
    <View style={[styles.summaryCard, dark && darkStyles.card, attention && styles.summaryAttention]}>
      <Text style={[styles.summaryValue, dark && darkStyles.titleText, attention && styles.summaryAttentionText]}>{value}</Text>
      <Text style={[styles.summaryLabel, dark && darkStyles.bodyText]}>{label}</Text>
    </View>
  );
}

function MessageCard({ text, error = false, dark }: { text: string; error?: boolean; dark: boolean }) {
  return (
    <View style={[error ? styles.errorCard : styles.noticeCard, dark && (error ? darkStyles.errorCard : darkStyles.subtleCard)]}>
      <Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={19} color={error ? theme.colors.danger : theme.colors.greenDark} />
      <Text style={[error ? styles.errorText : styles.noticeText, dark && darkStyles.bodyText]}>{text}</Text>
    </View>
  );
}

function FieldLabel({ children, dark }: { children: string; dark: boolean }) {
  return <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>{children}</Text>;
}

function findStockUom(product: CommerceProduct): CommerceUom | null {
  return product.uoms.find((uom) => uom.name.toLowerCase() === product.stockUom.toLowerCase()) ?? null;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  flexOne: { flex: 1, minWidth: 0 },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  title: { color: theme.colors.navy, fontSize: 27, lineHeight: 33, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 13, lineHeight: 19 },
  backButton: { alignSelf: 'flex-start', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5 },
  backText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  emptyCard: { minHeight: 130, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 8 },
  muted: { color: theme.colors.muted, fontSize: 12 },
  formCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 9 },
  formHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sectionTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  fieldLabel: { color: theme.colors.slate, fontSize: 11, fontWeight: '800', marginTop: 2 },
  input: { minHeight: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.cloud, paddingHorizontal: 12, color: theme.colors.navy, fontSize: 14 },
  multilineInput: { minHeight: 78, paddingTop: 12, textAlignVertical: 'top' },
  primaryButton: { minHeight: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14 },
  primaryButtonText: { color: theme.colors.white, fontSize: 12.5, fontWeight: '900' },
  secondaryButton: { minHeight: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13 },
  secondaryButtonText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  dangerButton: { minHeight: 46, borderRadius: theme.radius.md, backgroundColor: theme.colors.dangerSoft, borderWidth: 1, borderColor: '#FDA29B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13 },
  dangerButtonText: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.76 },
  infoCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { flex: 1, color: '#912018', fontSize: 11.5, lineHeight: 17 },
  noticeCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  noticeText: { flex: 1, color: theme.colors.slate, fontSize: 11.5, lineHeight: 17 },
  summaryRow: { flexDirection: 'row', gap: 8 },
  reviewSummary: { flexDirection: 'row', gap: 7 },
  summaryCard: { flex: 1, minHeight: 70, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 10, justifyContent: 'center' },
  summaryAttention: { backgroundColor: theme.colors.warningSoft, borderColor: '#FEDF89' },
  summaryValue: { color: theme.colors.navy, fontSize: 17, fontWeight: '900' },
  summaryAttentionText: { color: '#B54708' },
  summaryLabel: { color: theme.colors.muted, fontSize: 10.5, marginTop: 2 },
  searchBox: { minHeight: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11 },
  searchInput: { flex: 1, minHeight: 46, color: theme.colors.navy, fontSize: 13, paddingVertical: 0 },
  itemList: { gap: 8 },
  itemCard: { minHeight: 70, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  itemIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: theme.colors.cloud, alignItems: 'center', justifyContent: 'center' },
  itemIconDone: { backgroundColor: theme.colors.mintSoft },
  itemName: { color: theme.colors.navy, fontSize: 12.5, fontWeight: '900' },
  itemMeta: { color: theme.colors.muted, fontSize: 10.5, lineHeight: 15, marginTop: 2 },
  reviewFacts: { gap: 3 },
  varianceText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  varianceNegative: { color: '#B42318' },
  varianceZero: { color: theme.colors.muted },
  iconButton: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.cloud },
  uomWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choiceChip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.white },
  choiceChipActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  choiceChipText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  choiceChipTextActive: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  conversionPreview: { color: theme.colors.muted, fontSize: 11, lineHeight: 16 },
  helperText: { color: theme.colors.muted, fontSize: 11, lineHeight: 17 },
  actionCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 10 },
  reviewWaiting: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  confirmStack: { gap: 8 },
  confirmTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  inlineActions: { flexDirection: 'row', gap: 8 },
  flexButton: { flex: 1 },
  cancelCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 8 },
  cancelLink: { alignSelf: 'center', minHeight: 38, justifyContent: 'center', paddingHorizontal: 10 },
  cancelLinkText: { color: '#B42318', fontSize: 11.5, fontWeight: '800' },
  completeCard: { minHeight: 260, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 20, alignItems: 'center', justifyContent: 'center', gap: 9 },
  completeIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  cancelledIcon: { backgroundColor: theme.colors.cloud },
  completeTitle: { color: theme.colors.navy, fontSize: 20, fontWeight: '900' },
  completeText: { color: theme.colors.slate, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  referenceText: { color: theme.colors.muted, fontSize: 11, fontWeight: '800' },
  noticeInline: { color: theme.colors.slate, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  input: { backgroundColor: '#162F46', borderColor: '#475467', color: theme.colors.cloud },
  inputText: { color: theme.colors.cloud },
  outlineButton: { backgroundColor: '#162F46', borderColor: '#475467' },
  choiceChip: { backgroundColor: '#162F46', borderColor: '#475467' },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});