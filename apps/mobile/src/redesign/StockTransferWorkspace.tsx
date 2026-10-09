import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  loadAccessibleBranches,
  type CommerceBranch,
  type CommerceProduct,
  type CommerceUom,
} from '../data/commerceRepository';
import {
  cancelStockTransfer,
  createStockTransfer,
  dispatchStockTransfer,
  loadBranchStock,
  loadStockTransfer,
  loadStockTransfers,
  receiveStockTransfer,
  type BranchStockRow,
  type InventoryCapabilities,
  type StockTransferDetail,
  type StockTransferListRow,
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

type DraftLine = {
  productId: string;
  uomId: string;
  quantity: string;
};

export function StockTransferWorkspace({
  tenantId,
  branch,
  products,
  capabilities,
  onClose,
  onInventoryChanged,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [transfers, setTransfers] = useState<StockTransferListRow[]>([]);
  const [branches, setBranches] = useState<CommerceBranch[]>([]);
  const [stock, setStock] = useState<BranchStockRow[]>([]);
  const [detail, setDetail] = useState<StockTransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [destinationBranchId, setDestinationBranchId] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [confirmAction, setConfirmAction] = useState<'dispatch' | 'receive' | null>(null);
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  async function refreshWorkspace() {
    setLoading(true);
    setError(null);
    try {
      const [nextTransfers, nextBranches, nextStock] = await Promise.all([
        loadStockTransfers(tenantId, branch.id, 50),
        loadAccessibleBranches(tenantId),
        loadBranchStock(tenantId, branch.id),
      ]);
      setTransfers(nextTransfers);
      setBranches(nextBranches);
      setStock(nextStock);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load stock transfers.');
    } finally {
      setLoading(false);
    }
  }

  async function openTransfer(transferId: string) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      setDetail(await loadStockTransfer(tenantId, transferId));
      setCreateMode(false);
      setCancelMode(false);
      setConfirmAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load this stock transfer.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDetail(null);
    setCreateMode(false);
    setLines([]);
    setDestinationBranchId('');
    void refreshWorkspace();
  }, [tenantId, branch.id]);

  const otherBranches = branches.filter((entry) => entry.id !== branch.id);
  const accessibleBranchIds = useMemo(() => new Set(branches.map((entry) => entry.id)), [branches]);
  const stockByProduct = useMemo(
    () => new Map(stock.map((row) => [row.catalogItemId, row])),
    [stock],
  );
  const lineProductIds = useMemo(() => new Set(lines.map((line) => line.productId)), [lines]);
  const normalizedProductQuery = productQuery.trim().toLowerCase();
  const addableProducts = products.filter((product) => {
    if (!product.isActive || lineProductIds.has(product.id)) return false;
    if (!normalizedProductQuery) return true;
    return [product.name, product.sku ?? '', product.category ?? '']
      .join(' ')
      .toLowerCase()
      .includes(normalizedProductQuery);
  });

  function beginCreate() {
    setDetail(null);
    setCreateMode(true);
    setDestinationBranchId(otherBranches[0]?.id ?? '');
    setReference('');
    setReason('');
    setLines([]);
    setProductQuery('');
    setError(null);
    setNotice(null);
  }

  function addProduct(product: CommerceProduct) {
    const defaultUom = findStockUom(product) ?? product.uoms[0] ?? null;
    if (!defaultUom) {
      setError(`${product.name} has no configured unit for transfer.`);
      return;
    }
    setLines((current) => [...current, { productId: product.id, uomId: defaultUom.id, quantity: '1' }]);
    setProductQuery('');
    setError(null);
  }

  function updateLine(productId: string, update: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (
      line.productId === productId ? { ...line, ...update } : line
    )));
  }

  function removeLine(productId: string) {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }

  async function saveDraft() {
    if (saving) return;
    if (!destinationBranchId) {
      setError('Choose a destination branch.');
      return;
    }
    if (!reference.trim()) {
      setError('Enter a reference for this transfer.');
      return;
    }
    if (!reason.trim()) {
      setError('Enter a reason for this transfer.');
      return;
    }
    if (lines.length === 0) {
      setError('Add at least one product to this transfer.');
      return;
    }

    for (const line of lines) {
      const product = products.find((entry) => entry.id === line.productId);
      const uom = product?.uoms.find((entry) => entry.id === line.uomId);
      const quantity = Number(line.quantity);
      if (!product || !uom || !Number.isFinite(quantity) || quantity <= 0) {
        setError('Every transfer product needs a valid unit and quantity greater than zero.');
        return;
      }
      if (!uom.allowFractional && quantity !== Math.trunc(quantity)) {
        setError(`${product.name} · ${uom.name} does not allow fractional quantity.`);
        return;
      }
      const available = stockByProduct.get(product.id)?.quantityOnHand ?? 0;
      const needed = quantity * uom.conversionFactor;
      if (needed > available) {
        setError(`${product.name} needs ${formatQuantity(needed)} ${product.stockUom}, but ${formatQuantity(available)} is currently available at ${branch.name}.`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createStockTransfer({
        tenantId,
        sourceBranchId: branch.id,
        destinationBranchId,
        reference,
        reason,
        items: lines.map((line) => ({
          catalogItemId: line.productId,
          uomId: line.uomId,
          quantity: Number(line.quantity),
        })),
      });
      await Promise.all([refreshWorkspace(), openTransfer(result.transferId)]);
      setNotice(result.idempotentReplay ? 'This transfer draft already exists.' : 'Transfer draft saved. Stock has not moved yet.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this stock transfer.');
    } finally {
      setSaving(false);
    }
  }

  async function runTransferAction(action: 'dispatch' | 'receive') {
    if (!detail || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = action === 'dispatch'
        ? await dispatchStockTransfer(tenantId, detail.transferId)
        : await receiveStockTransfer(tenantId, detail.transferId);
      await Promise.all([
        openTransfer(detail.transferId),
        refreshWorkspace(),
        Promise.resolve(onInventoryChanged()),
      ]);
      setConfirmAction(null);
      setNotice(
        result.idempotentReplay
          ? `This transfer was already ${action === 'dispatch' ? 'dispatched' : 'received'}.`
          : action === 'dispatch'
            ? 'Stock dispatched. The quantity has left the source branch and is now in transit.'
            : 'Stock received. The quantity is now available at the destination branch.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} this stock transfer.`);
    } finally {
      setSaving(false);
    }
  }

  async function cancelDraft() {
    if (!detail || saving) return;
    if (!cancelReason.trim()) {
      setError('Enter why this transfer draft is being cancelled.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await cancelStockTransfer(tenantId, detail.transferId, cancelReason);
      await Promise.all([openTransfer(detail.transferId), refreshWorkspace()]);
      setCancelMode(false);
      setCancelReason('');
      setNotice('Transfer draft cancelled. No stock quantity was changed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel this transfer draft.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !detail && !createMode && transfers.length === 0) {
    return (
      <View style={styles.stack}>
        <BackButton onPress={onClose} dark={dark} />
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading stock transfers…</Text>
        </View>
      </View>
    );
  }

  if (createMode) {
    return (
      <View style={styles.stack}>
        <BackButton onPress={() => setCreateMode(false)} dark={dark} label="Transfers" />
        <View style={styles.heading}>
          <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>NEW TRANSFER</Text>
          <Text style={[styles.title, dark && darkStyles.titleText]}>Move stock from {branch.name}</Text>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
            Save a draft first. Stock leaves this branch only when the transfer is dispatched.
          </Text>
        </View>

        {error ? <MessageCard text={error} error dark={dark} /> : null}
        {notice ? <MessageCard text={notice} dark={dark} /> : null}

        {otherBranches.length === 0 ? (
          <View style={[styles.infoCard, dark && darkStyles.subtleCard]}>
            <Ionicons name="git-compare-outline" size={20} color={theme.colors.greenDark} />
            <Text style={[styles.infoText, dark && darkStyles.bodyText]}>
              No other accessible branch is available as a transfer destination.
            </Text>
          </View>
        ) : (
          <View style={[styles.formCard, dark && darkStyles.card]}>
            <FieldLabel dark={dark}>Destination branch</FieldLabel>
            <View style={styles.choiceWrap}>
              {otherBranches.map((entry) => (
                <Pressable
                  key={entry.id}
                  disabled={saving}
                  onPress={() => setDestinationBranchId(entry.id)}
                  style={[
                    styles.choiceChip,
                    dark && darkStyles.choiceChip,
                    destinationBranchId === entry.id && styles.choiceChipActive,
                  ]}
                >
                  <Text style={destinationBranchId === entry.id ? styles.choiceChipTextActive : [styles.choiceChipText, dark && darkStyles.bodyText]}>
                    {entry.name}
                  </Text>
                </Pressable>
              ))}
            </View>

            <FieldLabel dark={dark}>Reference</FieldLabel>
            <TextInput
              value={reference}
              onChangeText={setReference}
              editable={!saving}
              placeholder="e.g. Restock Lekki shelf"
              placeholderTextColor={theme.colors.subtle}
              style={[styles.input, dark && darkStyles.input]}
            />

            <FieldLabel dark={dark}>Reason</FieldLabel>
            <TextInput
              value={reason}
              onChangeText={setReason}
              editable={!saving}
              multiline
              placeholder="Why is this stock being moved?"
              placeholderTextColor={theme.colors.subtle}
              style={[styles.input, styles.multilineInput, dark && darkStyles.input]}
            />
          </View>
        )}

        {otherBranches.length > 0 ? (
          <View style={[styles.formCard, dark && darkStyles.card]}>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Products</Text>
            {lines.map((line) => {
              const product = products.find((entry) => entry.id === line.productId);
              if (!product) return null;
              const uom = product.uoms.find((entry) => entry.id === line.uomId) ?? null;
              const quantity = Number(line.quantity);
              const stockQuantity = uom && Number.isFinite(quantity) && quantity > 0
                ? quantity * uom.conversionFactor
                : null;
              const available = stockByProduct.get(product.id)?.quantityOnHand ?? 0;
              return (
                <View key={line.productId} style={[styles.lineCard, dark && darkStyles.subtleCard]}>
                  <View style={styles.lineHeader}>
                    <View style={styles.flexOne}>
                      <Text style={[styles.lineTitle, dark && darkStyles.titleText]}>{product.name}</Text>
                      <Text style={[styles.lineMeta, dark && darkStyles.bodyText]}>
                        {formatQuantity(available)} {product.stockUom} available at {branch.name}
                      </Text>
                    </View>
                    <Pressable disabled={saving} onPress={() => removeLine(product.id)} style={styles.iconButton}>
                      <Ionicons name="trash-outline" size={19} color={theme.colors.danger} />
                    </Pressable>
                  </View>

                  <FieldLabel dark={dark}>Unit</FieldLabel>
                  <View style={styles.choiceWrap}>
                    {product.uoms.map((entry) => (
                      <Pressable
                        key={entry.id}
                        disabled={saving}
                        onPress={() => updateLine(product.id, { uomId: entry.id })}
                        style={[
                          styles.choiceChip,
                          dark && darkStyles.choiceChip,
                          line.uomId === entry.id && styles.choiceChipActive,
                        ]}
                      >
                        <Text style={line.uomId === entry.id ? styles.choiceChipTextActive : [styles.choiceChipText, dark && darkStyles.bodyText]}>
                          {entry.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <FieldLabel dark={dark}>Quantity</FieldLabel>
                  <TextInput
                    value={line.quantity}
                    onChangeText={(value) => updateLine(product.id, { quantity: value })}
                    editable={!saving}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={theme.colors.subtle}
                    style={[styles.input, dark && darkStyles.input]}
                  />
                  {uom && stockQuantity !== null ? (
                    <Text style={[styles.helperText, dark && darkStyles.bodyText]}>
                      {formatQuantity(quantity)} {uom.name} = {formatQuantity(stockQuantity)} {product.stockUom}
                    </Text>
                  ) : null}
                </View>
              );
            })}

            <View style={[styles.searchBox, dark && darkStyles.input]}>
              <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
              <TextInput
                value={productQuery}
                onChangeText={setProductQuery}
                editable={!saving}
                placeholder="Add product"
                placeholderTextColor={theme.colors.subtle}
                style={[styles.searchInput, dark && darkStyles.inputText]}
              />
            </View>

            {addableProducts.slice(0, normalizedProductQuery ? 12 : 6).map((product) => (
              <Pressable
                key={product.id}
                disabled={saving}
                onPress={() => addProduct(product)}
                style={({ pressed }) => [styles.addProductRow, pressed && styles.pressed]}
              >
                <View style={styles.addProductIcon}>
                  <Ionicons name="add" size={18} color={theme.colors.greenDark} />
                </View>
                <View style={styles.flexOne}>
                  <Text style={[styles.addProductTitle, dark && darkStyles.titleText]}>{product.name}</Text>
                  <Text style={[styles.lineMeta, dark && darkStyles.bodyText]}>
                    {formatQuantity(stockByProduct.get(product.id)?.quantityOnHand ?? 0)} {product.stockUom} available
                  </Text>
                </View>
              </Pressable>
            ))}

            <Pressable
              disabled={saving || !destinationBranchId || lines.length === 0}
              onPress={() => void saveDraft()}
              style={({ pressed }) => [
                styles.primaryButton,
                (saving || !destinationBranchId || lines.length === 0) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {saving ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="save-outline" size={19} color={theme.colors.white} />}
              <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save transfer draft'}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  if (detail) {
    const outgoing = detail.sourceBranchId === branch.id;
    const incoming = detail.destinationBranchId === branch.id;
    const canDispatch = capabilities.canTransferStock === true
      && detail.status === 'draft'
      && outgoing
      && accessibleBranchIds.has(detail.sourceBranchId)
      && accessibleBranchIds.has(detail.destinationBranchId);
    const canReceive = capabilities.canTransferStock === true
      && detail.status === 'dispatched'
      && incoming
      && accessibleBranchIds.has(detail.destinationBranchId);
    const canCancel = capabilities.canTransferStock === true
      && detail.status === 'draft'
      && outgoing
      && accessibleBranchIds.has(detail.sourceBranchId);

    return (
      <View style={styles.stack}>
        <BackButton onPress={() => setDetail(null)} dark={dark} label="Transfers" />
        <View style={styles.heading}>
          <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>{outgoing ? 'OUTGOING TRANSFER' : 'INCOMING TRANSFER'}</Text>
          <View style={styles.titleRow}>
            <Text style={[styles.title, styles.flexOne, dark && darkStyles.titleText]}>{detail.reference}</Text>
            <StatusBadge status={detail.status} />
          </View>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
            {detail.sourceBranchName} → {detail.destinationBranchName}
          </Text>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>{detail.reason}</Text>
        </View>

        {error ? <MessageCard text={error} error dark={dark} /> : null}
        {notice ? <MessageCard text={notice} dark={dark} /> : null}

        <View style={styles.itemList}>
          {detail.items.map((item) => (
            <View key={item.itemId} style={[styles.transferItemCard, dark && darkStyles.card]}>
              <View style={styles.flexOne}>
                <Text style={[styles.lineTitle, dark && darkStyles.titleText]}>{item.productName}</Text>
                <Text style={[styles.lineMeta, dark && darkStyles.bodyText]}>
                  {formatQuantity(item.quantity)} {item.selectedUom}
                  {item.selectedUom.toLowerCase() !== item.stockUom.toLowerCase()
                    ? ` · ${formatQuantity(item.stockQuantity)} ${item.stockUom}`
                    : ''}
                </Text>
              </View>
              <Ionicons name="cube-outline" size={22} color={theme.colors.greenDark} />
            </View>
          ))}
        </View>

        {detail.status === 'dispatched' ? (
          <View style={[styles.infoCard, dark && darkStyles.subtleCard]}>
            <Ionicons name="trail-sign-outline" size={20} color={theme.colors.greenDark} />
            <Text style={[styles.infoText, dark && darkStyles.bodyText]}>
              Stock is in transit. It has left {detail.sourceBranchName} but is not available at {detail.destinationBranchName} until receipt is confirmed.
            </Text>
          </View>
        ) : null}

        {confirmAction ? (
          <View style={[styles.confirmCard, dark && darkStyles.card]}>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>
              {confirmAction === 'dispatch' ? 'Dispatch this stock?' : 'Receive this stock?'}
            </Text>
            <Text style={[styles.helperText, dark && darkStyles.bodyText]}>
              {confirmAction === 'dispatch'
                ? `This will reduce stock at ${detail.sourceBranchName} now. The destination will not increase until receipt is confirmed.`
                : `This will add the dispatched quantity to ${detail.destinationBranchName} now.`}
            </Text>
            <View style={styles.actionRow}>
              <Pressable disabled={saving} onPress={() => setConfirmAction(null)} style={[styles.secondaryButton, dark && darkStyles.secondaryButton]}>
                <Text style={[styles.secondaryButtonText, dark && darkStyles.bodyText]}>Back</Text>
              </Pressable>
              <Pressable disabled={saving} onPress={() => void runTransferAction(confirmAction)} style={styles.primaryButton}>
                {saving ? <ActivityIndicator color={theme.colors.white} /> : null}
                <Text style={styles.primaryButtonText}>{confirmAction === 'dispatch' ? 'Dispatch stock' : 'Receive stock'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {cancelMode ? (
          <View style={[styles.confirmCard, dark && darkStyles.card]}>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Cancel transfer draft</Text>
            <TextInput
              value={cancelReason}
              onChangeText={setCancelReason}
              editable={!saving}
              multiline
              placeholder="Why is this transfer no longer required?"
              placeholderTextColor={theme.colors.subtle}
              style={[styles.input, styles.multilineInput, dark && darkStyles.input]}
            />
            <View style={styles.actionRow}>
              <Pressable disabled={saving} onPress={() => setCancelMode(false)} style={[styles.secondaryButton, dark && darkStyles.secondaryButton]}>
                <Text style={[styles.secondaryButtonText, dark && darkStyles.bodyText]}>Keep draft</Text>
              </Pressable>
              <Pressable disabled={saving || !cancelReason.trim()} onPress={() => void cancelDraft()} style={[styles.dangerButton, (!cancelReason.trim() || saving) && styles.disabled]}>
                <Text style={styles.dangerButtonText}>Cancel draft</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {!confirmAction && !cancelMode && (canDispatch || canReceive || canCancel) ? (
          <View style={[styles.actionCard, dark && darkStyles.card]}>
            {canDispatch ? (
              <Pressable onPress={() => setConfirmAction('dispatch')} style={styles.primaryButton}>
                <Ionicons name="send-outline" size={19} color={theme.colors.white} />
                <Text style={styles.primaryButtonText}>Dispatch stock</Text>
              </Pressable>
            ) : null}
            {canReceive ? (
              <Pressable onPress={() => setConfirmAction('receive')} style={styles.primaryButton}>
                <Ionicons name="download-outline" size={19} color={theme.colors.white} />
                <Text style={styles.primaryButtonText}>Receive stock</Text>
              </Pressable>
            ) : null}
            {canCancel ? (
              <Pressable onPress={() => setCancelMode(true)} style={[styles.secondaryButton, dark && darkStyles.secondaryButton]}>
                <Text style={[styles.secondaryButtonText, dark && darkStyles.bodyText]}>Cancel draft</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {detail.status === 'draft' && outgoing && capabilities.canTransferStock && !canDispatch ? (
          <View style={[styles.infoCard, dark && darkStyles.subtleCard]}>
            <Ionicons name="shield-outline" size={19} color={theme.colors.muted} />
            <Text style={[styles.infoText, dark && darkStyles.bodyText]}>
              Dispatch is unavailable because you no longer have access to both branches on this transfer.
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <BackButton onPress={onClose} dark={dark} />
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>STOCK TRANSFERS</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>Transfers for {branch.name}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Outgoing stock leaves on dispatch. Incoming stock becomes available only after receipt.
        </Text>
      </View>

      {error ? <MessageCard text={error} error dark={dark} /> : null}
      {notice ? <MessageCard text={notice} dark={dark} /> : null}

      {capabilities.canTransferStock ? (
        <Pressable
          disabled={otherBranches.length === 0}
          onPress={beginCreate}
          style={[styles.primaryButton, otherBranches.length === 0 && styles.disabled]}
        >
          <Ionicons name="add" size={19} color={theme.colors.white} />
          <Text style={styles.primaryButtonText}>New transfer</Text>
        </Pressable>
      ) : null}

      {transfers.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <Ionicons name="git-compare-outline" size={30} color={theme.colors.greenDark} />
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No stock transfers yet</Text>
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>
            Transfers involving this branch will appear here.
          </Text>
        </View>
      ) : (
        <View style={styles.itemList}>
          {transfers.map((transfer) => {
            const outgoing = transfer.sourceBranchId === branch.id;
            return (
              <Pressable
                key={transfer.id}
                onPress={() => void openTransfer(transfer.id)}
                style={({ pressed }) => [styles.transferCard, dark && darkStyles.card, pressed && styles.pressed]}
              >
                <View style={[styles.directionIcon, !outgoing && styles.directionIconIncoming]}>
                  <Ionicons name={outgoing ? 'arrow-up-outline' : 'arrow-down-outline'} size={19} color={theme.colors.greenDark} />
                </View>
                <View style={styles.flexOne}>
                  <View style={styles.cardTitleRow}>
                    <Text style={[styles.transferTitle, styles.flexOne, dark && darkStyles.titleText]}>{transfer.reference}</Text>
                    <StatusBadge status={transfer.status} />
                  </View>
                  <Text style={[styles.lineMeta, dark && darkStyles.bodyText]}>
                    {outgoing ? `To ${transfer.destinationBranchName}` : `From ${transfer.sourceBranchName}`} · {transfer.itemCount} product{transfer.itemCount === 1 ? '' : 's'}
                  </Text>
                  <Text style={[styles.lineMeta, dark && darkStyles.bodyText]}>{formatDateTime(transfer.createdAt)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.subtle} />
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function findStockUom(product: CommerceProduct): CommerceUom | null {
  return product.uoms.find((uom) => uom.name.toLowerCase() === product.stockUom.toLowerCase()) ?? null;
}

function BackButton({ onPress, dark, label = 'Inventory' }: { onPress: () => void; dark: boolean; label?: string }) {
  return (
    <Pressable onPress={onPress} style={styles.backButton}>
      <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
      <Text style={[styles.backText, dark && darkStyles.bodyText]}>{label}</Text>
    </Pressable>
  );
}

function FieldLabel({ children, dark }: { children: string; dark: boolean }) {
  return <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>{children}</Text>;
}

function MessageCard({ text, error = false, dark }: { text: string; error?: boolean; dark: boolean }) {
  return (
    <View style={[styles.messageCard, error && styles.errorCard, dark && darkStyles.subtleCard]}>
      <Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={19} color={error ? theme.colors.danger : theme.colors.greenDark} />
      <Text style={[styles.messageText, dark && darkStyles.bodyText]}>{text}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: StockTransferDetail['status'] | StockTransferListRow['status'] }) {
  const label = status === 'draft' ? 'Draft' : status === 'dispatched' ? 'In transit' : status === 'received' ? 'Received' : 'Cancelled';
  return (
    <View style={[styles.statusBadge, status === 'received' && styles.statusBadgeGood, status === 'cancelled' && styles.statusBadgeMuted]}>
      <Text style={styles.statusBadgeText}>{label}</Text>
    </View>
  );
}

function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  flexOne: { flex: 1 },
  backButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  backText: { color: theme.colors.greenDark, fontSize: 13, fontWeight: '800' },
  heading: { gap: 4 },
  eyebrow: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: theme.colors.navy, fontSize: 23, lineHeight: 29, fontWeight: '900' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subtitle: { color: theme.colors.slate, fontSize: 12, lineHeight: 18 },
  formCard: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.lg, padding: 13, gap: 10 },
  sectionTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  fieldLabel: { color: theme.colors.slate, fontSize: 11, fontWeight: '800', marginTop: 2 },
  input: { minHeight: 45, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 9, color: theme.colors.navy, backgroundColor: theme.colors.white, fontSize: 13 },
  multilineInput: { minHeight: 78, textAlignVertical: 'top' },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choiceChip: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: theme.colors.white },
  choiceChipActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  choiceChipText: { color: theme.colors.slate, fontSize: 11, fontWeight: '700' },
  choiceChipTextActive: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  lineCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.cloud, padding: 11, gap: 8 },
  lineHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  lineMeta: { color: theme.colors.muted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  helperText: { color: theme.colors.muted, fontSize: 11, lineHeight: 17 },
  searchBox: { minHeight: 45, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11 },
  searchInput: { flex: 1, color: theme.colors.navy, fontSize: 13, paddingVertical: 8 },
  addProductRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 48, paddingVertical: 5 },
  addProductIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  addProductTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '800' },
  primaryButton: { minHeight: 46, borderRadius: theme.radius.md, backgroundColor: theme.colors.green, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryButtonText: { color: theme.colors.white, fontSize: 13, fontWeight: '900' },
  secondaryButton: { minHeight: 44, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', flex: 1 },
  secondaryButtonText: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  dangerButton: { minHeight: 44, borderRadius: theme.radius.md, backgroundColor: theme.colors.danger, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', flex: 1 },
  dangerButtonText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.76 },
  messageCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorCard: { backgroundColor: '#FEF3F2' },
  messageText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  infoCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.cloud, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  emptyCard: { minHeight: 150, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 18 },
  emptyTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  itemList: { gap: 9 },
  transferCard: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.lg, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  transferItemCard: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.md, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  directionIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: '#FFF4ED', alignItems: 'center', justifyContent: 'center' },
  directionIconIncoming: { backgroundColor: theme.colors.mintSoft },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  transferTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  statusBadge: { borderRadius: 999, backgroundColor: '#FFF4ED', paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeGood: { backgroundColor: theme.colors.mintSoft },
  statusBadgeMuted: { backgroundColor: theme.colors.cloud },
  statusBadgeText: { color: theme.colors.slate, fontSize: 9, fontWeight: '900' },
  actionCard: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.lg, padding: 12, gap: 8 },
  confirmCard: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.lg, padding: 12, gap: 10 },
  actionRow: { flexDirection: 'row', gap: 8 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
  input: { backgroundColor: '#102A43', borderColor: '#475467', color: theme.colors.cloud },
  inputText: { color: theme.colors.cloud },
  choiceChip: { backgroundColor: '#102A43', borderColor: '#475467' },
  secondaryButton: { backgroundColor: '#102A43', borderColor: '#475467' },
});