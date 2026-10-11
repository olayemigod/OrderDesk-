import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
  type InventoryOperation,
  type StockMovementRow,
} from '../data/inventoryRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
};

const NO_CAPABILITIES: InventoryCapabilities = {
  canReceiveStock: false,
  canAdjustStock: false,
};

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
  const [operationMode, setOperationMode] = useState<InventoryOperation | null>(null);
  const [operationUomId, setOperationUomId] = useState('');
  const [operationQuantity, setOperationQuantity] = useState('');
  const [adjustmentDirection, setAdjustmentDirection] = useState<InventoryAdjustmentDirection>('increase');
  const [operationReference, setOperationReference] = useState('');
  const [operationReason, setOperationReason] = useState('');
  const [operationSaving, setOperationSaving] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load branch stock.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshMovements(productId: string) {
    setMovementLoading(true);
    setMovementError(null);
    try {
      const next = await loadStockMovements(tenantId, branch.id, productId, 50);
      setMovements(next);
    } catch (err) {
      setMovementError(err instanceof Error ? err.message : 'Unable to load stock history.');
    } finally {
      setMovementLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setSelectedProductId(null);
    setMovements([]);
    setOperationMode(null);
    setOperationNotice(null);
    setCapabilities(NO_CAPABILITIES);
    setCapabilityLoading(true);
    setCapabilityError(null);
    setProducts([]);
    void refreshStock();

    void loadInventoryCapabilities(tenantId, branch.id)
      .then((next) => {
        if (active) setCapabilities(next);
      })
      .catch((err) => {
        if (!active) return;
        setCapabilities(NO_CAPABILITIES);
        setCapabilityError(err instanceof Error ? err.message : 'Stock actions are unavailable.');
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
      .catch((err) => {
        if (active) setMovementError(err instanceof Error ? err.message : 'Unable to load stock history.');
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
  const selectedOperationUom = selectedProduct?.uoms.find((uom) => uom.id === operationUomId) ?? null;
  const parsedOperationQuantity = Number(operationQuantity);
  const previewStockQuantity = selectedOperationUom && Number.isFinite(parsedOperationQuantity) && parsedOperationQuantity > 0
    ? parsedOperationQuantity * selectedOperationUom.conversionFactor
    : null;

  function beginOperation(mode: InventoryOperation) {
    if (!selectedProduct) {
      setOperationError('Product units are not available yet. Refresh Inventory and try again.');
      return;
    }
    const defaultUom = findDefaultOperationUom(selectedProduct, mode);
    setOperationMode(mode);
    setOperationUomId(defaultUom?.id ?? '');
    setOperationQuantity('');
    setAdjustmentDirection('increase');
    setOperationReference('');
    setOperationReason('');
    setOperationError(null);
    setOperationNotice(null);
  }

  function closeOperation() {
    if (operationSaving) return;
    setOperationMode(null);
    setOperationError(null);
  }

  async function submitOperation() {
    if (!selected || !selectedProduct || !operationMode || operationSaving) return;
    const quantity = Number(operationQuantity);
    if (!selectedOperationUom) {
      setOperationError('Choose a unit for this stock movement.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setOperationError('Enter a quantity greater than zero.');
      return;
    }
    if (!operationReference.trim()) {
      setOperationError('Enter a reference for this stock movement.');
      return;
    }
    if (!operationReason.trim()) {
      setOperationError('Enter a reason for this stock movement.');
      return;
    }

    setOperationSaving(true);
    setOperationError(null);
    setOperationNotice(null);
    try {
      const result = await applyInventoryOperation({
        tenantId,
        branchId: branch.id,
        productId: selected.catalogItemId,
        uomId: selectedOperationUom.id,
        operation: operationMode,
        quantity,
        adjustmentDirection: operationMode === 'adjust' ? adjustmentDirection : null,
        reference: operationReference,
        reason: operationReason,
      });

      setOperationNotice(
        result.idempotentReplay
          ? `${result.reference} was already posted. Current stock is ${formatQuantity(result.quantityOnHand)} ${result.stockUom}.`
          : `${operationMode === 'receive' ? 'Stock received' : 'Stock adjusted'}. Current stock is ${formatQuantity(result.quantityOnHand)} ${result.stockUom}.`,
      );
      setOperationMode(null);
      setOperationQuantity('');
      setOperationReference('');
      setOperationReason('');
      await Promise.all([
        refreshStock(),
        refreshMovements(selected.catalogItemId),
      ]);
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : 'Unable to post this stock movement.');
    } finally {
      setOperationSaving(false);
    }
  }

  if (selected) {
    const canReceive = capabilities.canReceiveStock;
    const canAdjust = capabilities.canAdjustStock;
    return (
      <View style={styles.stack}>
        <Pressable
          onPress={() => {
            setSelectedProductId(null);
            setOperationMode(null);
            setOperationNotice(null);
          }}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
          <Text style={styles.backText}>Inventory</Text>
        </Pressable>

        <View style={styles.heading}>
          <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>STOCK HISTORY</Text>
          <Text style={[styles.title, dark && darkStyles.titleText]}>{selected.itemName}</Text>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
            {branch.name} · {formatQuantity(selected.quantityOnHand)} {selected.stockUom} on hand
          </Text>
        </View>

        <View style={[styles.balanceCard, dark && darkStyles.card]}>
          <View style={styles.balanceIcon}>
            <Ionicons name="cube-outline" size={24} color={theme.colors.greenDark} />
          </View>
          <View style={styles.balanceCopy}>
            <Text style={[styles.balanceLabel, dark && darkStyles.bodyText]}>Current stock</Text>
            <Text style={[styles.balanceValue, dark && darkStyles.titleText]}>
              {formatQuantity(selected.quantityOnHand)} {selected.stockUom}
            </Text>
            <Text style={[styles.balanceMeta, dark && darkStyles.bodyText]}>
              {selected.lastMovementAt ? `Last movement ${formatDateTime(selected.lastMovementAt)}` : 'No stock movements yet'}
            </Text>
          </View>
        </View>

        {capabilityLoading ? (
          <View style={[styles.actionLoading, dark && darkStyles.subtleCard]}>
            <ActivityIndicator size="small" />
            <Text style={[styles.actionLoadingText, dark && darkStyles.bodyText]}>Checking stock permissions…</Text>
          </View>
        ) : null}

        {!capabilityLoading && (canReceive || canAdjust) ? (
          <View style={styles.actionRow}>
            {canReceive ? (
              <Pressable
                disabled={operationSaving}
                onPress={() => beginOperation('receive')}
                style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
              >
                <Ionicons name="download-outline" size={18} color={theme.colors.white} />
                <Text style={styles.primaryActionText}>Receive stock</Text>
              </Pressable>
            ) : null}
            {canAdjust ? (
              <Pressable
                disabled={operationSaving}
                onPress={() => beginOperation('adjust')}
                style={({ pressed }) => [styles.secondaryAction, dark && darkStyles.outlineButton, pressed && styles.pressed]}
              >
                <Ionicons name="options-outline" size={18} color={theme.colors.greenDark} />
                <Text style={styles.secondaryActionText}>Adjust stock</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {capabilityError ? (
          <View style={[styles.permissionNotice, dark && darkStyles.subtleCard]}>
            <Ionicons name="shield-outline" size={18} color={theme.colors.muted} />
            <Text style={[styles.permissionNoticeText, dark && darkStyles.bodyText]}>
              Stock history is available, but stock actions could not be verified.
            </Text>
          </View>
        ) : null}

        {operationNotice ? (
          <View style={[styles.successCard, dark && darkStyles.subtleCard]}>
            <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.greenDark} />
            <Text style={[styles.successText, dark && darkStyles.bodyText]}>{operationNotice}</Text>
          </View>
        ) : null}

        {operationMode ? (
          <InventoryOperationForm
            mode={operationMode}
            product={selectedProduct}
            stockRow={selected}
            selectedUom={selectedOperationUom}
            selectedUomId={operationUomId}
            quantity={operationQuantity}
            previewStockQuantity={previewStockQuantity}
            adjustmentDirection={adjustmentDirection}
            reference={operationReference}
            reason={operationReason}
            saving={operationSaving}
            error={operationError}
            dark={dark}
            onSelectUom={setOperationUomId}
            onChangeQuantity={setOperationQuantity}
            onChangeDirection={setAdjustmentDirection}
            onChangeReference={setOperationReference}
            onChangeReason={setOperationReason}
            onCancel={closeOperation}
            onSubmit={() => void submitOperation()}
          />
        ) : null}

        {movementError ? (
          <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
            <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{movementError}</Text>
          </View>
        ) : null}

        {movementLoading && movements.length === 0 ? (
          <View style={[styles.emptyCard, dark && darkStyles.card]}>
            <ActivityIndicator />
            <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading stock history…</Text>
          </View>
        ) : null}

        {!movementLoading && movements.length === 0 ? (
          <View style={[styles.emptyCard, dark && darkStyles.card]}>
            <Ionicons name="swap-vertical-outline" size={28} color={theme.colors.greenDark} />
            <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No movement yet</Text>
            <Text style={[styles.muted, dark && darkStyles.bodyText]}>
              Stock receipts, sales, returns, transfers and adjustments will appear here after they are posted.
            </Text>
          </View>
        ) : (
          <View style={styles.movementList}>
            {movements.map((movement) => (
              <View key={movement.id} style={[styles.movementCard, dark && darkStyles.card]}>
                <View style={styles.movementTopRow}>
                  <View style={[styles.movementIcon, movement.quantityDelta < 0 && styles.movementIconOut]}>
                    <Ionicons
                      name={movement.quantityDelta < 0 ? 'arrow-up-outline' : 'arrow-down-outline'}
                      size={18}
                      color={movement.quantityDelta < 0 ? '#B42318' : theme.colors.greenDark}
                    />
                  </View>
                  <View style={styles.movementCopy}>
                    <Text style={[styles.movementTitle, dark && darkStyles.titleText]}>
                      {movementLabel(movement.movementType)}
                    </Text>
                    <Text style={[styles.movementMeta, dark && darkStyles.bodyText]}>
                      {formatDateTime(movement.businessAt)} · {movement.referenceId}
                    </Text>
                  </View>
                  <Text style={[styles.movementQuantity, movement.quantityDelta < 0 && styles.movementQuantityOut]}>
                    {movement.quantityDelta > 0 ? '+' : ''}{formatQuantity(movement.quantityDelta)} {movement.stockUom}
                  </Text>
                </View>
                {movement.sourceUom.toLowerCase() !== movement.stockUom.toLowerCase() ? (
                  <Text style={[styles.conversionText, dark && darkStyles.bodyText]}>
                    {formatQuantity(movement.sourceQuantity)} {movement.sourceUom} × {formatQuantity(movement.conversionFactor)}
                  </Text>
                ) : null}
                {movement.reason ? (
                  <Text style={[styles.reasonText, dark && darkStyles.bodyText]}>{movement.reason}</Text>
                ) : null}
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
        <Text style={[styles.title, dark && darkStyles.titleText]}>Stock at {branch.name}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Quantities are shown in each product’s stock unit.
        </Text>
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard label="Products" value={rows.length} icon="cube-outline" dark={dark} />
        <SummaryCard label="Out of stock" value={outOfStockCount} icon="alert-circle-outline" dark={dark} attention={outOfStockCount > 0} />
      </View>

      <View style={[styles.searchBox, dark && darkStyles.input]}>
        <Ionicons name="search-outline" size={19} color={theme.colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search product, SKU or stock unit"
          placeholderTextColor={theme.colors.subtle}
          autoCorrect={false}
          style={[styles.searchInput, dark && darkStyles.inputText]}
        />
        <Pressable onPress={() => void refreshStock()} disabled={loading} style={styles.refreshButton}>
          <Ionicons name="refresh-outline" size={20} color={theme.colors.greenDark} />
        </Pressable>
      </View>

      {error ? (
        <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
          <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{error}</Text>
        </View>
      ) : null}

      {loading && rows.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading branch stock…</Text>
        </View>
      ) : null}

      {!loading && visibleRows.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <Ionicons name="cube-outline" size={28} color={theme.colors.greenDark} />
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>
            {rows.length === 0 ? 'No products yet' : 'No matching stock item'}
          </Text>
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>
            {rows.length === 0
              ? 'Add products before tracking stock for this branch.'
              : 'Change the search and try again.'}
          </Text>
        </View>
      ) : (
        <View style={styles.stockList}>
          {visibleRows.map((row) => {
            const out = row.quantityOnHand <= 0;
            return (
              <Pressable
                key={row.catalogItemId}
                onPress={() => {
                  setSelectedProductId(row.catalogItemId);
                  setOperationMode(null);
                  setOperationNotice(null);
                }}
                style={({ pressed }) => [styles.stockCard, dark && darkStyles.card, pressed && styles.pressed]}
              >
                <View style={[styles.stockIcon, out && styles.stockIconOut]}>
                  <Ionicons name="cube-outline" size={21} color={out ? '#B42318' : theme.colors.greenDark} />
                </View>
                <View style={styles.stockCopy}>
                  <Text style={[styles.stockName, dark && darkStyles.titleText]}>{row.itemName}</Text>
                  <Text style={[styles.stockMeta, dark && darkStyles.bodyText]}>
                    {[row.sku, row.category].filter(Boolean).join(' · ') || row.stockUom}
                  </Text>
                  <Text style={[styles.stockUpdated, dark && darkStyles.bodyText]}>
                    {row.lastMovementAt ? `Updated ${formatDateTime(row.lastMovementAt)}` : 'No stock movement yet'}
                  </Text>
                </View>
                <View style={styles.stockBalance}>
                  <Text style={[styles.stockQuantity, dark && darkStyles.titleText, out && styles.stockQuantityOut]}>
                    {formatQuantity(row.quantityOnHand)}
                  </Text>
                  <Text style={[styles.stockUom, dark && darkStyles.bodyText]}>{row.stockUom}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.subtle} />
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={[styles.infoCard, dark && darkStyles.subtleCard]}>
        <Ionicons name="shield-checkmark-outline" size={20} color={theme.colors.greenDark} />
        <Text style={[styles.infoText, dark && darkStyles.bodyText]}>
          Stock changes are posted as auditable movements. Stock counts use a separate review step before they change on-hand quantity.
        </Text>
      </View>
    </View>
  );
}

function InventoryOperationForm({
  mode,
  product,
  stockRow,
  selectedUom,
  selectedUomId,
  quantity,
  previewStockQuantity,
  adjustmentDirection,
  reference,
  reason,
  saving,
  error,
  dark,
  onSelectUom,
  onChangeQuantity,
  onChangeDirection,
  onChangeReference,
  onChangeReason,
  onCancel,
  onSubmit,
}: {
  mode: InventoryOperation;
  product: CommerceProduct | null;
  stockRow: BranchStockRow;
  selectedUom: CommerceUom | null;
  selectedUomId: string;
  quantity: string;
  previewStockQuantity: number | null;
  adjustmentDirection: InventoryAdjustmentDirection;
  reference: string;
  reason: string;
  saving: boolean;
  error: string | null;
  dark: boolean;
  onSelectUom: (value: string) => void;
  onChangeQuantity: (value: string) => void;
  onChangeDirection: (value: InventoryAdjustmentDirection) => void;
  onChangeReference: (value: string) => void;
  onChangeReason: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const isReceive = mode === 'receive';
  const availableUoms = product?.uoms ?? [];
  const canSubmit = Boolean(
    selectedUom
    && Number.isFinite(Number(quantity))
    && Number(quantity) > 0
    && reference.trim()
    && reason.trim()
    && !saving,
  );

  return (
    <View style={[styles.operationCard, dark && darkStyles.card]}>
      <View style={styles.operationHeading}>
        <View style={styles.operationHeadingIcon}>
          <Ionicons
            name={isReceive ? 'download-outline' : 'options-outline'}
            size={20}
            color={theme.colors.greenDark}
          />
        </View>
        <View style={styles.operationHeadingCopy}>
          <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>
            {isReceive ? 'Receive stock' : 'Adjust stock'}
          </Text>
          <Text style={[styles.operationSubtitle, dark && darkStyles.bodyText]}>
            {isReceive
              ? `Record stock received into the current branch for ${stockRow.itemName}.`
              : `Record a controlled correction to ${stockRow.itemName}. This does not overwrite stock history.`}
          </Text>
        </View>
      </View>

      {!isReceive ? (
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Adjustment</Text>
          <View style={styles.segmentRow}>
            <Pressable
              disabled={saving}
              onPress={() => onChangeDirection('increase')}
              style={[
                styles.segmentButton,
                dark && darkStyles.outlineButton,
                adjustmentDirection === 'increase' && styles.segmentButtonActive,
              ]}
            >
              <Ionicons name="add" size={16} color={adjustmentDirection === 'increase' ? theme.colors.greenDark : theme.colors.muted} />
              <Text style={[styles.segmentText, dark && darkStyles.bodyText, adjustmentDirection === 'increase' && styles.segmentTextActive]}>
                Increase
              </Text>
            </Pressable>
            <Pressable
              disabled={saving}
              onPress={() => onChangeDirection('decrease')}
              style={[
                styles.segmentButton,
                dark && darkStyles.outlineButton,
                adjustmentDirection === 'decrease' && styles.segmentButtonDanger,
              ]}
            >
              <Ionicons name="remove" size={16} color={adjustmentDirection === 'decrease' ? '#B42318' : theme.colors.muted} />
              <Text style={[styles.segmentText, dark && darkStyles.bodyText, adjustmentDirection === 'decrease' && styles.segmentTextDanger]}>
                Decrease
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Unit</Text>
        {availableUoms.length === 0 ? (
          <Text style={[styles.fieldHelp, dark && darkStyles.bodyText]}>No configured unit is available for this product.</Text>
        ) : (
          <View style={styles.uomRow}>
            {availableUoms.map((uom) => (
              <Pressable
                key={uom.id}
                disabled={saving}
                onPress={() => onSelectUom(uom.id)}
                style={[
                  styles.uomChip,
                  dark && darkStyles.outlineButton,
                  uom.id === selectedUomId && styles.uomChipActive,
                ]}
              >
                <Text style={[styles.uomChipText, dark && darkStyles.bodyText, uom.id === selectedUomId && styles.uomChipTextActive]}>
                  {uom.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Quantity</Text>
        <TextInput
          value={quantity}
          onChangeText={onChangeQuantity}
          editable={!saving}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={theme.colors.subtle}
          style={[styles.formInput, dark && darkStyles.input, dark && darkStyles.inputText]}
        />
        {selectedUom && previewStockQuantity !== null ? (
          <Text style={[styles.fieldHelp, dark && darkStyles.bodyText]}>
            {formatQuantity(Number(quantity))} {selectedUom.name} = {formatQuantity(previewStockQuantity)} {stockRow.stockUom}
          </Text>
        ) : null}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Reference</Text>
        <TextInput
          value={reference}
          onChangeText={onChangeReference}
          editable={!saving}
          autoCapitalize="characters"
          maxLength={160}
          placeholder={isReceive ? 'Supplier receipt or delivery reference' : 'Adjustment reference'}
          placeholderTextColor={theme.colors.subtle}
          style={[styles.formInput, dark && darkStyles.input, dark && darkStyles.inputText]}
        />
        <Text style={[styles.fieldHelp, dark && darkStyles.bodyText]}>
          Reusing the same reference for this product is treated as a retry, not a second stock change.
        </Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Reason</Text>
        <TextInput
          value={reason}
          onChangeText={onChangeReason}
          editable={!saving}
          multiline
          maxLength={500}
          placeholder={isReceive ? 'What stock was received and why?' : 'Why is this correction required?'}
          placeholderTextColor={theme.colors.subtle}
          style={[styles.formInput, styles.reasonInput, dark && darkStyles.input, dark && darkStyles.inputText]}
        />
      </View>

      {!isReceive && adjustmentDirection === 'decrease' ? (
        <View style={[styles.warningCard, dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={18} color="#B54708" />
          <Text style={[styles.warningText, dark && darkStyles.bodyText]}>
            SellerTray will reject this adjustment if it would take branch stock below zero.
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.colors.danger} />
          <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.formActions}>
        <Pressable disabled={saving} onPress={onCancel} style={[styles.cancelAction, dark && darkStyles.outlineButton]}>
          <Text style={[styles.cancelActionText, dark && darkStyles.bodyText]}>Cancel</Text>
        </Pressable>
        <Pressable
          disabled={!canSubmit}
          onPress={onSubmit}
          style={[styles.submitAction, !canSubmit && styles.disabled]}
        >
          {saving ? <ActivityIndicator color={theme.colors.white} /> : null}
          <Text style={styles.submitActionText}>
            {saving ? 'Posting…' : isReceive ? 'Post receipt' : 'Post adjustment'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  dark,
  attention = false,
}: {
  label: string;
  value: number;
  icon: string;
  dark: boolean;
  attention?: boolean;
}) {
  return (
    <View style={[styles.summaryCard, dark && darkStyles.card, attention && styles.summaryCardAttention]}>
      <Ionicons name={icon as never} size={20} color={attention ? '#B54708' : theme.colors.greenDark} />
      <Text style={[styles.summaryValue, dark && darkStyles.titleText]}>{value}</Text>
      <Text style={[styles.summaryLabel, dark && darkStyles.bodyText]}>{label}</Text>
    </View>
  );
}

function findDefaultOperationUom(product: CommerceProduct, mode: InventoryOperation): CommerceUom | null {
  if (mode === 'receive') {
    const purchaseUom = product.uoms.find((uom) => uom.isDefaultPurchase);
    if (purchaseUom) return purchaseUom;
  }

  return product.uoms.find((uom) => uom.name.toLowerCase() === product.stockUom.toLowerCase())
    ?? product.uoms.find((uom) => uom.isDefaultSelling)
    ?? product.uoms[0]
    ?? null;
}

function movementLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  title: { color: theme.colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
  backButton: { alignSelf: 'flex-start', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5 },
  backText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  summaryRow: { flexDirection: 'row', gap: 8 },
  summaryCard: { flex: 1, minHeight: 90, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 12, gap: 3 },
  summaryCardAttention: { backgroundColor: theme.colors.warningSoft, borderColor: '#FEDF89' },
  summaryValue: { color: theme.colors.navy, fontSize: 22, fontWeight: '900', marginTop: 4 },
  summaryLabel: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  searchBox: { minHeight: 50, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, paddingLeft: 12, paddingRight: 5, flexDirection: 'row', alignItems: 'center', gap: 7 },
  searchInput: { flex: 1, minHeight: 48, color: theme.colors.navy, fontSize: 14, paddingVertical: 0 },
  refreshButton: { width: 42, height: 42, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { flex: 1, color: '#912018', fontSize: 12, lineHeight: 18 },
  emptyCard: { minHeight: 120, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 7 },
  emptyTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  stockList: { gap: 8 },
  stockCard: { minHeight: 82, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  stockIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  stockIconOut: { backgroundColor: theme.colors.dangerSoft },
  stockCopy: { flex: 1, minWidth: 0 },
  stockName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  stockMeta: { color: theme.colors.muted, fontSize: 10.5, marginTop: 2 },
  stockUpdated: { color: theme.colors.subtle, fontSize: 10, marginTop: 4 },
  stockBalance: { alignItems: 'flex-end' },
  stockQuantity: { color: theme.colors.navy, fontSize: 18, fontWeight: '900' },
  stockQuantityOut: { color: '#B42318' },
  stockUom: { color: theme.colors.muted, fontSize: 10.5, fontWeight: '700' },
  infoCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  balanceCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  balanceIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  balanceCopy: { flex: 1 },
  balanceLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '800' },
  balanceValue: { color: theme.colors.navy, fontSize: 23, fontWeight: '900', marginTop: 2 },
  balanceMeta: { color: theme.colors.muted, fontSize: 10.5, marginTop: 3 },
  actionLoading: { borderRadius: theme.radius.md, backgroundColor: '#F9FAFB', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionLoadingText: { color: theme.colors.slate, fontSize: 11, fontWeight: '700' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryAction: { minHeight: 42, borderRadius: 12, backgroundColor: theme.colors.green, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  primaryActionText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  secondaryAction: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secondaryActionText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  permissionNotice: { borderRadius: theme.radius.md, backgroundColor: '#F9FAFB', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  permissionNoticeText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  successCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  successText: { flex: 1, color: theme.colors.greenDark, fontSize: 11, lineHeight: 17, fontWeight: '700' },
  operationCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 12 },
  operationHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  operationHeadingIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  operationHeadingCopy: { flex: 1 },
  operationTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  operationSubtitle: { color: theme.colors.slate, fontSize: 11, lineHeight: 17, marginTop: 2 },
  fieldGroup: { gap: 6 },
  fieldLabel: { color: theme.colors.slate, fontSize: 11, fontWeight: '900' },
  fieldHelp: { color: theme.colors.muted, fontSize: 10.5, lineHeight: 16 },
  formInput: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 11, color: theme.colors.navy, fontSize: 13 },
  reasonInput: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' },
  segmentRow: { flexDirection: 'row', gap: 7 },
  segmentButton: { flex: 1, minHeight: 40, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  segmentButtonActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  segmentButtonDanger: { borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft },
  segmentText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  segmentTextActive: { color: theme.colors.greenDark },
  segmentTextDanger: { color: '#B42318' },
  uomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  uomChip: { minHeight: 36, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  uomChipActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  uomChipText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  uomChipTextActive: { color: theme.colors.greenDark },
  warningCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FEDF89', backgroundColor: theme.colors.warningSoft, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  warningText: { flex: 1, color: '#93370D', fontSize: 11, lineHeight: 17 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  cancelAction: { minHeight: 42, minWidth: 86, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  cancelActionText: { color: theme.colors.slate, fontSize: 11, fontWeight: '900' },
  submitAction: { minHeight: 42, minWidth: 126, borderRadius: 12, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  submitActionText: { color: theme.colors.white, fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.42 },
  movementList: { gap: 8 },
  movementCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 11, gap: 6 },
  movementTopRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  movementIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  movementIconOut: { backgroundColor: theme.colors.dangerSoft },
  movementCopy: { flex: 1 },
  movementTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  movementMeta: { color: theme.colors.muted, fontSize: 10.5, marginTop: 2 },
  movementQuantity: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  movementQuantityOut: { color: '#B42318' },
  conversionText: { color: theme.colors.muted, fontSize: 10.5, paddingLeft: 45 },
  reasonText: { color: theme.colors.slate, fontSize: 11, lineHeight: 16, paddingLeft: 45 },
  pressed: { opacity: 0.74 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  input: { backgroundColor: theme.colors.navy, borderColor: '#475467' },
  inputText: { color: theme.colors.cloud },
  outlineButton: { backgroundColor: theme.colors.navy, borderColor: '#475467' },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});