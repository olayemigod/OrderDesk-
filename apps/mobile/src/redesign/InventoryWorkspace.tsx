import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SellerTrayText as Text } from '../components/SellerTrayText';
import {
  loadCommerceProducts,
  type CommerceBranch,
  type CommerceProduct,
  type CommerceUom,
} from '../data/commerceRepository';
import {
  applyInventoryOperation,
  loadBranchStock,
  loadInventoryCapabilities,
  loadStockMovements,
  type BranchStockRow,
  type InventoryAdjustmentDirection,
  type InventoryCapabilities,
  type StockMovementRow,
} from '../data/inventoryRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { createInventoryOperationCommandId, createOperationalReference } from './operationalReference';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
};

const NO_CAPABILITIES: InventoryCapabilities = {
  canReceiveStock: false,
  canAdjustStock: false,
};

const ADJUST_REASONS = [
  'Data correction',
  'Damage',
  'Expiry',
  'Missing / shrinkage',
  'Inventory recovery',
  'Other approved adjustment',
] as const;

export function InventoryWorkspace({ tenantId, branch }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [rows, setRows] = useState<BranchStockRow[]>([]);
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<InventoryCapabilities>(NO_CAPABILITIES);
  const [capabilityLoading, setCapabilityLoading] = useState(true);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [commandId, setCommandId] = useState('');
  const [uomId, setUomId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [direction, setDirection] = useState<InventoryAdjustmentDirection>('increase');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState<string>(ADJUST_REASONS[0]);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshStock() {
    setLoading(true);
    setError(null);
    try {
      const next = await loadBranchStock(tenantId, branch.id);
      setRows(next);
      if (selectedProductId && !next.some((row) => row.catalogItemId === selectedProductId)) {
        setSelectedProductId(null);
        setMovements([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load branch stock.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshMovements(productId: string) {
    setMovementLoading(true);
    setMovementError(null);
    try {
      setMovements(await loadStockMovements(tenantId, branch.id, productId, 50));
    } catch (cause) {
      setMovementError(cause instanceof Error ? cause.message : 'Unable to load stock history.');
    } finally {
      setMovementLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setSelectedProductId(null);
    setMovements([]);
    setAdjustOpen(false);
    setNotice(null);
    setCapabilities(NO_CAPABILITIES);
    setCapabilityLoading(true);
    setCapabilityError(null);
    setProducts([]);
    void refreshStock();

    void loadInventoryCapabilities(tenantId, branch.id)
      .then((next) => {
        if (active) setCapabilities(next);
      })
      .catch((cause) => {
        if (!active) return;
        setCapabilities(NO_CAPABILITIES);
        setCapabilityError(cause instanceof Error ? cause.message : 'Stock action access is unavailable.');
      })
      .finally(() => {
        if (active) setCapabilityLoading(false);
      });

    void loadCommerceProducts(tenantId)
      .then((next) => {
        if (active) setProducts(next);
      })
      .catch(() => {
        if (active) setProducts([]);
      });

    return () => {
      active = false;
    };
  }, [tenantId, branch.id]);

  useEffect(() => {
    if (!selectedProductId) {
      setMovements([]);
      setMovementError(null);
      return undefined;
    }
    let active = true;
    setMovementLoading(true);
    setMovementError(null);
    void loadStockMovements(tenantId, branch.id, selectedProductId, 50)
      .then((next) => {
        if (active) setMovements(next);
      })
      .catch((cause) => {
        if (active) setMovementError(cause instanceof Error ? cause.message : 'Unable to load stock history.');
      })
      .finally(() => {
        if (active) setMovementLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId, branch.id, selectedProductId]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!normalizedQuery) return rows;
    return rows.filter((row) =>
      [row.itemName, row.sku ?? '', row.category ?? '', row.stockUom]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [normalizedQuery, rows]);

  const outOfStockCount = rows.filter((row) => row.quantityOnHand <= 0).length;
  const selected = rows.find((row) => row.catalogItemId === selectedProductId) ?? null;
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const selectedUom = selectedProduct?.uoms.find((uom) => uom.id === uomId) ?? null;
  const parsedQuantity = Number(quantity);
  const previewStockQuantity = selectedUom && Number.isFinite(parsedQuantity) && parsedQuantity > 0
    ? parsedQuantity * selectedUom.conversionFactor
    : null;

  function beginAdjustment() {
    if (!selectedProduct) {
      setOperationError('Product units are not available yet. Refresh Inventory and try again.');
      return;
    }
    const defaultUom = findStockUom(selectedProduct);
    const defaultReason = ADJUST_REASONS[0];
    setAdjustOpen(true);
    setCommandId(createInventoryOperationCommandId('adjust'));
    setUomId(defaultUom?.id ?? '');
    setQuantity('');
    setDirection(requiredDirectionForAdjustmentReason(defaultReason) ?? 'increase');
    setReference(createOperationalReference('adjust'));
    setReason(defaultReason);
    setReasonOpen(false);
    setOperationError(null);
    setNotice(null);
  }

  function closeAdjustment() {
    if (saving) return;
    setAdjustOpen(false);
    setCommandId('');
    setReasonOpen(false);
    setOperationError(null);
  }

  async function submitAdjustment() {
    if (!selected || !selectedProduct || saving) return;
    const parsed = Number(quantity);
    if (!commandId) return setOperationError('Restart this stock adjustment and try again.');
    if (!selectedUom) return setOperationError('Choose a unit for this stock adjustment.');
    if (!Number.isFinite(parsed) || parsed <= 0) return setOperationError('Enter a quantity greater than zero.');
    if (!reference.trim()) return setOperationError('Reference is required. Generate one or enter an external reference.');
    if (!reason.trim()) return setOperationError('Choose a reason for this stock adjustment.');

    setSaving(true);
    setOperationError(null);
    setNotice(null);
    try {
      const result = await applyInventoryOperation({
        tenantId,
        branchId: branch.id,
        productId: selected.catalogItemId,
        uomId: selectedUom.id,
        operation: 'adjust',
        commandId,
        quantity: parsed,
        adjustmentDirection: direction,
        reference,
        reason,
      });
      setNotice(
        result.idempotentReplay
          ? `${result.reference} was already posted. Current stock is ${formatQuantity(result.quantityOnHand)} ${result.stockUom}.`
          : `Stock adjusted. Current stock is ${formatQuantity(result.quantityOnHand)} ${result.stockUom}.`,
      );
      setAdjustOpen(false);
      setCommandId('');
      setQuantity('');
      setReference('');
      setReason(ADJUST_REASONS[0]);
      setReasonOpen(false);
      await Promise.all([refreshStock(), refreshMovements(selected.catalogItemId)]);
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : 'Unable to post this stock adjustment.');
    } finally {
      setSaving(false);
    }
  }

  if (selected) {
    const forcedDirection = requiredDirectionForAdjustmentReason(reason);
    return (
      <View style={styles.stack}>
        <Pressable
          onPress={() => {
            setSelectedProductId(null);
            setAdjustOpen(false);
            setCommandId('');
            setReasonOpen(false);
          }}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
          <Text style={styles.backText}>Inventory</Text>
        </Pressable>

        <View style={styles.heading}>
          <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>STOCK DETAIL</Text>
          <Text style={[styles.title, dark && darkStyles.titleText]}>{selected.itemName}</Text>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>{branch.name}</Text>
        </View>

        <View style={[styles.balanceCard, dark && darkStyles.card]}>
          <Text style={[styles.balanceLabel, dark && darkStyles.bodyText]}>On hand</Text>
          <Text style={[styles.balanceValue, dark && darkStyles.titleText]}>{formatQuantity(selected.quantityOnHand)} {selected.stockUom}</Text>
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>{selected.lastMovementAt ? `Last movement ${formatDate(selected.lastMovementAt)}` : 'No stock movement yet'}</Text>
        </View>

        <View style={[styles.governanceCard, dark && darkStyles.subtleCard]}>
          <Ionicons name="git-compare-outline" size={20} color={theme.colors.greenDark} />
          <Text style={[styles.governanceText, dark && darkStyles.bodyText]}>
            Supplier deliveries are received from Purchase Receiving against a placed Purchase Order. Stock sent from another branch is received through Stock Transfers. Use adjustment only for a genuine correction.
          </Text>
        </View>

        {capabilityError ? <ErrorCard text={capabilityError} dark={dark} /> : null}
        {notice ? <NoticeCard text={notice} dark={dark} /> : null}

        {!adjustOpen ? (
          capabilities.canAdjustStock ? (
            <Pressable disabled={capabilityLoading} onPress={beginAdjustment} style={[styles.primaryAction, capabilityLoading && styles.disabled]}>
              <Ionicons name="options-outline" size={20} color={theme.colors.white} />
              <Text style={styles.primaryActionText}>Adjust stock</Text>
            </Pressable>
          ) : null
        ) : (
          <View style={[styles.operationCard, dark && darkStyles.card]}>
            <View style={styles.operationHead}>
              <View style={styles.flexCopy}>
                <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>Adjust stock</Text>
                <Text style={[styles.muted, dark && darkStyles.bodyText]}>Record a controlled correction to this branch stock. Do not use this for supplier receipts or branch transfers.</Text>
              </View>
              <Pressable onPress={closeAdjustment} disabled={saving} style={styles.iconButton}><Ionicons name="close" size={20} color={theme.colors.slate} /></Pressable>
            </View>

            <View style={styles.segmentRow}>
              {(['increase', 'decrease'] as InventoryAdjustmentDirection[]).map((nextDirection) => (
                <Pressable
                  key={nextDirection}
                  disabled={forcedDirection !== null}
                  onPress={() => setDirection(nextDirection)}
                  style={[styles.segmentButton, dark && darkStyles.outlineButton, direction === nextDirection && styles.segmentButtonActive, forcedDirection !== null && styles.disabled]}
                >
                  <Text style={[styles.segmentText, dark && darkStyles.bodyText, direction === nextDirection && styles.segmentTextActive]}>{nextDirection === 'increase' ? 'Increase' : 'Decrease'}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Unit</Text>
            <View style={styles.uomRow}>
              {(selectedProduct?.uoms ?? []).map((uom) => (
                <Pressable key={uom.id} onPress={() => setUomId(uom.id)} style={[styles.uomChip, dark && darkStyles.outlineButton, uomId === uom.id && styles.uomChipActive]}>
                  <Text style={[styles.uomChipText, dark && darkStyles.bodyText, uomId === uom.id && styles.uomChipTextActive]}>{uom.name}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Quantity</Text>
            <TextInput value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
            {previewStockQuantity !== null && selectedUom ? <Text style={[styles.preview, dark && darkStyles.bodyText]}>{formatQuantity(parsedQuantity)} {selectedUom.name} = {formatQuantity(previewStockQuantity)} {selected.stockUom}</Text> : null}

            <View style={styles.fieldHeadingRow}>
              <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Reference</Text>
              <Pressable onPress={() => setReference(createOperationalReference('adjust'))} style={styles.generateButton}><Ionicons name="refresh-outline" size={15} color={theme.colors.greenDark} /><Text style={styles.generateText}>Generate</Text></Pressable>
            </View>
            <TextInput value={reference} onChangeText={setReference} autoCapitalize="characters" placeholder="Auto-generated reference" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
            <Text style={[styles.helperText, dark && darkStyles.bodyText]}>Generated by default. Replace it only when an external correction reference is more useful.</Text>

            <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Reason</Text>
            <Pressable onPress={() => setReasonOpen((current) => !current)} style={[styles.selectButton, dark && darkStyles.input]}>
              <Text style={[styles.selectText, dark && darkStyles.titleText]}>{reason}</Text>
              <Ionicons name={reasonOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.slate} />
            </Pressable>
            {reasonOpen ? (
              <View style={[styles.selectMenu, dark && darkStyles.card]}>
                {ADJUST_REASONS.map((nextReason) => (
                  <Pressable
                    key={nextReason}
                    onPress={() => {
                      setReason(nextReason);
                      const required = requiredDirectionForAdjustmentReason(nextReason);
                      if (required) setDirection(required);
                      setReasonOpen(false);
                    }}
                    style={[styles.selectOption, reason === nextReason && styles.selectOptionActive]}
                  >
                    <Text style={[styles.selectOptionText, dark && darkStyles.bodyText, reason === nextReason && styles.selectOptionTextActive]}>{nextReason}</Text>
                    {reason === nextReason ? <Ionicons name="checkmark" size={17} color={theme.colors.greenDark} /> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Text style={[styles.helperText, dark && darkStyles.bodyText]}>Damage, expiry and missing stock reduce stock. Inventory recovery increases stock.</Text>

            {operationError ? <ErrorCard text={operationError} dark={dark} /> : null}
            <View style={styles.formActions}>
              <Pressable disabled={saving} onPress={closeAdjustment} style={[styles.cancelButton, dark && darkStyles.outlineButton]}><Text style={[styles.cancelText, dark && darkStyles.bodyText]}>Cancel</Text></Pressable>
              <Pressable disabled={saving} onPress={() => void submitAdjustment()} style={[styles.postButton, saving && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.white} /> : null}<Text style={styles.postButtonText}>{saving ? 'Posting…' : 'Post adjustment'}</Text></Pressable>
            </View>
          </View>
        )}

        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Movement history</Text>
          <Pressable disabled={movementLoading} onPress={() => void refreshMovements(selected.catalogItemId)}><Ionicons name="refresh-outline" size={19} color={theme.colors.greenDark} /></Pressable>
        </View>
        {movementError ? <ErrorCard text={movementError} dark={dark} /> : null}
        {movementLoading && movements.length === 0 ? <ActivityIndicator /> : null}
        {!movementLoading && movements.length === 0 ? (
          <View style={[styles.emptyCard, dark && darkStyles.card]}><Ionicons name="swap-vertical-outline" size={28} color={theme.colors.greenDark} /><Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No movement yet</Text><Text style={[styles.muted, dark && darkStyles.bodyText]}>Purchase receipts, sales, returns, transfers and adjustments will appear here.</Text></View>
        ) : (
          <View style={styles.movementList}>
            {movements.map((movement) => (
              <View key={movement.id} style={[styles.movementCard, dark && darkStyles.card]}>
                <View style={styles.movementTop}><Text style={[styles.movementType, dark && darkStyles.titleText]}>{movementLabel(movement.movementType)}</Text><Text style={[styles.movementDelta, movement.quantityDelta < 0 && styles.negative]}>{movement.quantityDelta > 0 ? '+' : ''}{formatQuantity(movement.quantityDelta)} {movement.stockUom}</Text></View>
                <Text style={[styles.movementMeta, dark && darkStyles.bodyText]}>{formatDate(movement.businessAt)} · {movement.referenceId}</Text>
                <Text style={[styles.movementMeta, dark && darkStyles.bodyText]}>{formatQuantity(movement.sourceQuantity)} {movement.sourceUom} × {formatQuantity(movement.conversionFactor)}</Text>
                {movement.reason ? <Text style={[styles.reasonText, dark && darkStyles.bodyText]}>{movement.reason}</Text> : null}
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>INVENTORY</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>{branch.name}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>Branch stock is ledger-driven. Supplier stock enters through Purchase Receiving, branch stock moves through Stock Transfers, and adjustments are reserved for corrections.</Text>
      </View>
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, dark && darkStyles.card]}><Text style={[styles.summaryValue, dark && darkStyles.titleText]}>{rows.length}</Text><Text style={[styles.summaryLabel, dark && darkStyles.bodyText]}>Products</Text></View>
        <View style={[styles.summaryCard, dark && darkStyles.card]}><Text style={[styles.summaryValue, outOfStockCount > 0 && styles.negative, dark && darkStyles.titleText]}>{outOfStockCount}</Text><Text style={[styles.summaryLabel, dark && darkStyles.bodyText]}>Out of stock</Text></View>
      </View>
      <View style={[styles.searchBox, dark && darkStyles.input]}><Ionicons name="search-outline" size={19} color={theme.colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Search stock" placeholderTextColor={theme.colors.subtle} style={[styles.searchInput, dark && darkStyles.inputText]} /></View>
      {error ? <ErrorCard text={error} dark={dark} /> : null}
      {loading && rows.length === 0 ? <View style={[styles.emptyCard, dark && darkStyles.card]}><ActivityIndicator /><Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading stock…</Text></View> : null}
      {!loading && visibleRows.length === 0 ? <View style={[styles.emptyCard, dark && darkStyles.card]}><Ionicons name="cube-outline" size={28} color={theme.colors.greenDark} /><Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No matching stock</Text></View> : null}
      <View style={styles.stockList}>
        {visibleRows.map((row) => (
          <Pressable key={row.catalogItemId} onPress={() => setSelectedProductId(row.catalogItemId)} style={({ pressed }) => [styles.stockCard, dark && darkStyles.card, pressed && styles.pressed]}>
            <View style={styles.flexCopy}><Text style={[styles.stockName, dark && darkStyles.titleText]}>{row.itemName}</Text><Text style={[styles.muted, dark && darkStyles.bodyText]}>{[row.sku, row.category].filter(Boolean).join(' · ') || `Stock unit: ${row.stockUom}`}</Text></View>
            <View style={styles.stockAmountWrap}><Text style={[styles.stockAmount, row.quantityOnHand <= 0 && styles.negative, dark && darkStyles.titleText]}>{formatQuantity(row.quantityOnHand)}</Text><Text style={[styles.stockUnit, dark && darkStyles.bodyText]}>{row.stockUom}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
        ))}
      </View>
      <Pressable disabled={loading} onPress={() => void refreshStock()} style={[styles.refreshButton, dark && darkStyles.outlineButton]}><Ionicons name="refresh-outline" size={18} color={theme.colors.greenDark} /><Text style={styles.refreshText}>{loading ? 'Refreshing…' : 'Refresh stock'}</Text></Pressable>
    </View>
  );
}

function findStockUom(product: CommerceProduct): CommerceUom | null {
  return product.uoms.find((uom) => uom.isStockUom) ?? product.uoms[0] ?? null;
}

function requiredDirectionForAdjustmentReason(reason: string): InventoryAdjustmentDirection | null {
  if (reason === 'Damage' || reason === 'Expiry' || reason === 'Missing / shrinkage') return 'decrease';
  if (reason === 'Inventory recovery') return 'increase';
  return null;
}

function ErrorCard({ text, dark }: { text: string; dark: boolean }) {
  return <View style={[styles.errorCard, dark && darkStyles.errorCard]}><Ionicons name="alert-circle-outline" size={19} color={theme.colors.danger} /><Text style={[styles.errorText, dark && darkStyles.bodyText]}>{text}</Text></View>;
}

function NoticeCard({ text, dark }: { text: string; dark: boolean }) {
  return <View style={[styles.noticeCard, dark && darkStyles.subtleCard]}><Ionicons name="checkmark-circle-outline" size={19} color={theme.colors.greenDark} /><Text style={[styles.noticeText, dark && darkStyles.bodyText]}>{text}</Text></View>;
}

function movementLabel(value: string): string {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
function formatQuantity(value: number): string { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))); }
function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const styles = StyleSheet.create({
  stack:{gap:14},heading:{gap:3},eyebrow:{color:theme.colors.muted,fontSize:11,fontWeight:'900',letterSpacing:1.05},title:{color:theme.colors.navy,fontSize:28,lineHeight:34,fontWeight:'900'},subtitle:{color:theme.colors.slate,fontSize:13,lineHeight:19},flexCopy:{flex:1,minWidth:0},backButton:{alignSelf:'flex-start',minHeight:38,flexDirection:'row',alignItems:'center',gap:5},backText:{color:theme.colors.greenDark,fontSize:12,fontWeight:'900'},summaryRow:{flexDirection:'row',gap:10},summaryCard:{flex:1,borderRadius:theme.radius.md,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:13},summaryValue:{color:theme.colors.navy,fontSize:22,fontWeight:'900'},summaryLabel:{color:theme.colors.muted,fontSize:11,marginTop:2},searchBox:{minHeight:50,borderWidth:1,borderColor:theme.colors.border,borderRadius:theme.radius.md,backgroundColor:theme.colors.white,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:8},searchInput:{flex:1,color:theme.colors.navy,fontSize:14,paddingVertical:0},stockList:{gap:8},stockCard:{minHeight:72,borderRadius:theme.radius.md,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:12,flexDirection:'row',alignItems:'center',gap:10},stockName:{color:theme.colors.navy,fontSize:14,fontWeight:'900'},stockAmountWrap:{alignItems:'flex-end'},stockAmount:{color:theme.colors.navy,fontSize:17,fontWeight:'900'},stockUnit:{color:theme.colors.muted,fontSize:10.5},balanceCard:{borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:16,gap:4},balanceLabel:{color:theme.colors.muted,fontSize:11,fontWeight:'800'},balanceValue:{color:theme.colors.navy,fontSize:28,lineHeight:34,fontWeight:'900'},muted:{color:theme.colors.muted,fontSize:11.5,lineHeight:17},governanceCard:{borderRadius:theme.radius.md,borderWidth:1,borderColor:'#ABEFC6',backgroundColor:theme.colors.mintSoft,padding:11,flexDirection:'row',gap:8,alignItems:'flex-start'},governanceText:{flex:1,color:theme.colors.slate,fontSize:11.5,lineHeight:17},primaryAction:{minHeight:48,borderRadius:13,backgroundColor:theme.colors.green,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6},primaryActionText:{color:theme.colors.white,fontSize:12,fontWeight:'900'},operationCard:{borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:14,gap:10},operationHead:{flexDirection:'row',alignItems:'flex-start',gap:10},operationTitle:{color:theme.colors.navy,fontSize:16,fontWeight:'900'},iconButton:{width:36,height:36,borderRadius:12,backgroundColor:'#F2F4F7',alignItems:'center',justifyContent:'center'},segmentRow:{flexDirection:'row',gap:8},segmentButton:{flex:1,minHeight:40,borderRadius:11,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,alignItems:'center',justifyContent:'center'},segmentButtonActive:{backgroundColor:theme.colors.mintSoft,borderColor:theme.colors.green},segmentText:{color:theme.colors.slate,fontSize:11,fontWeight:'800'},segmentTextActive:{color:theme.colors.greenDark},fieldLabel:{color:theme.colors.slate,fontSize:11.5,fontWeight:'900',marginTop:2},fieldHeadingRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},input:{minHeight:48,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,paddingHorizontal:12,color:theme.colors.navy,fontSize:13},helperText:{color:theme.colors.muted,fontSize:10.5,lineHeight:16},generateButton:{minHeight:30,paddingHorizontal:8,borderRadius:9,backgroundColor:theme.colors.mintSoft,flexDirection:'row',alignItems:'center',gap:4},generateText:{color:theme.colors.greenDark,fontSize:10.5,fontWeight:'900'},uomRow:{flexDirection:'row',flexWrap:'wrap',gap:6},uomChip:{minHeight:34,borderRadius:theme.radius.pill,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,paddingHorizontal:10,alignItems:'center',justifyContent:'center'},uomChipActive:{borderColor:theme.colors.green,backgroundColor:theme.colors.mintSoft},uomChipText:{color:theme.colors.slate,fontSize:11,fontWeight:'800'},uomChipTextActive:{color:theme.colors.greenDark},preview:{color:theme.colors.muted,fontSize:11,fontWeight:'700'},selectButton:{minHeight:48,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,paddingHorizontal:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},selectText:{flex:1,color:theme.colors.navy,fontSize:13,fontWeight:'800'},selectMenu:{borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,overflow:'hidden'},selectOption:{minHeight:43,paddingHorizontal:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.colors.border},selectOptionActive:{backgroundColor:theme.colors.mintSoft},selectOptionText:{color:theme.colors.slate,fontSize:12,fontWeight:'700'},selectOptionTextActive:{color:theme.colors.greenDark,fontWeight:'900'},formActions:{flexDirection:'row',gap:10,marginTop:4},cancelButton:{minHeight:48,minWidth:100,borderRadius:13,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,alignItems:'center',justifyContent:'center'},cancelText:{color:theme.colors.slate,fontSize:12,fontWeight:'900'},postButton:{flex:1,minHeight:48,borderRadius:13,backgroundColor:theme.colors.green,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},postButtonText:{color:theme.colors.white,fontSize:12,fontWeight:'900'},sectionHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},sectionTitle:{color:theme.colors.navy,fontSize:15,fontWeight:'900'},movementList:{gap:8},movementCard:{borderRadius:theme.radius.md,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:11,gap:3},movementTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},movementType:{color:theme.colors.navy,fontSize:12.5,fontWeight:'900'},movementDelta:{color:theme.colors.greenDark,fontSize:12.5,fontWeight:'900'},movementMeta:{color:theme.colors.muted,fontSize:10.5,lineHeight:15},reasonText:{color:theme.colors.slate,fontSize:11,lineHeight:16,marginTop:2},negative:{color:'#B42318'},noticeCard:{borderRadius:theme.radius.md,borderWidth:1,borderColor:'#ABEFC6',backgroundColor:theme.colors.mintSoft,padding:11,flexDirection:'row',gap:7,alignItems:'flex-start'},noticeText:{flex:1,color:theme.colors.slate,fontSize:11.5,lineHeight:17},errorCard:{borderRadius:theme.radius.md,borderWidth:1,borderColor:'#FDA29B',backgroundColor:theme.colors.dangerSoft,padding:11,flexDirection:'row',gap:7,alignItems:'flex-start'},errorText:{flex:1,color:'#912018',fontSize:11.5,lineHeight:17},emptyCard:{minHeight:120,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:18,alignItems:'center',justifyContent:'center',gap:7},emptyTitle:{color:theme.colors.navy,fontSize:15,fontWeight:'900'},refreshButton:{minHeight:46,borderRadius:13,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6},refreshText:{color:theme.colors.greenDark,fontSize:12,fontWeight:'900'},disabled:{opacity:0.42},pressed:{opacity:0.82}
});

const darkStyles=StyleSheet.create({titleText:{color:'#F8FAFC'},bodyText:{color:'#CBD5E1'},card:{backgroundColor:'#111827',borderColor:'#334155'},subtleCard:{backgroundColor:'#172033',borderColor:'#334155'},outlineButton:{backgroundColor:'#111827',borderColor:'#334155'},input:{backgroundColor:'#111827',borderColor:'#334155',color:'#F8FAFC'},inputText:{color:'#F8FAFC'},errorCard:{backgroundColor:'#3F1D1D',borderColor:'#7F1D1D'}});
