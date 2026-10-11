import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  completePosCashSale,
  createPosClientReference,
  createPosDraft,
  loadCommerceProducts,
  type CommerceBranch,
  type CommerceProduct,
  type CommerceUom,
} from '../data/commerceRepository';
import { loadBranchStock, type BranchStockRow } from '../data/inventoryRepository';
import {
  isLikelyConnectivityError,
  loadBranchStockCache,
  loadCommerceProductCache,
  queueOfflinePosSale,
  saveBranchStockCache,
  saveCommerceProductCache,
} from '../data/offlineSalesRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type CartLine = {
  key: string;
  product: CommerceProduct;
  uom: CommerceUom;
  quantity: number;
};

type StockShortage = {
  productName: string;
  stockUom: string;
  required: number;
  available: number;
};

type Props = {
  tenantId: string;
  actorUserId: string;
  branch: CommerceBranch;
  currency: string;
  onDraftCreated?: (orderId: string) => void;
  onOfflineSaleQueued?: () => void;
};

const STOCK_EPSILON = 0.000001;

export function SellWorkspace({
  tenantId,
  actorUserId,
  branch,
  currency,
  onDraftCreated,
  onOfflineSaleQueued,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogCacheSavedAt, setCatalogCacheSavedAt] = useState<string | null>(null);
  const [usingCachedProducts, setUsingCachedProducts] = useState(false);
  const [stockRows, setStockRows] = useState<BranchStockRow[]>([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockCacheSavedAt, setStockCacheSavedAt] = useState<string | null>(null);
  const [usingCachedStock, setUsingCachedStock] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedUomByProduct, setSelectedUomByProduct] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [draftOrderId, setDraftOrderId] = useState<string | null>(null);
  const [saleClientReference, setSaleClientReference] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [heldNotice, setHeldNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setUsingCachedProducts(false);
    setCatalogCacheSavedAt(null);
    void loadCommerceProducts(tenantId)
      .then(async (rows) => {
        if (!active) return;
        setProducts(rows);
        setUsingCachedProducts(false);
        setCatalogCacheSavedAt(null);
        await saveCommerceProductCache(tenantId, rows).catch(() => undefined);
      })
      .catch(async (err) => {
        if (!active) return;
        if (isLikelyConnectivityError(err)) {
          const cached = await loadCommerceProductCache(tenantId);
          if (!active) return;
          if (cached) {
            setProducts(cached.data);
            setUsingCachedProducts(true);
            setCatalogCacheSavedAt(cached.savedAt);
            return;
          }
        }
        setError(err instanceof Error ? err.message : 'Unable to load products.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  useEffect(() => {
    setCart({});
    setDraftOrderId(null);
    setSaleClientReference(null);
    setCheckoutError(null);
    setHeldNotice(null);
  }, [branch.id]);

  useEffect(() => {
    let active = true;
    setStockLoading(true);
    setStockError(null);
    setUsingCachedStock(false);
    setStockCacheSavedAt(null);
    void loadBranchStock(tenantId, branch.id)
      .then(async (rows) => {
        if (!active) return;
        setStockRows(rows);
        setUsingCachedStock(false);
        setStockCacheSavedAt(null);
        await saveBranchStockCache(tenantId, branch.id, rows).catch(() => undefined);
      })
      .catch(async (err) => {
        if (!active) return;
        if (isLikelyConnectivityError(err)) {
          const cached = await loadBranchStockCache(tenantId, branch.id);
          if (!active) return;
          if (cached) {
            setStockRows(cached.data);
            setUsingCachedStock(true);
            setStockCacheSavedAt(cached.savedAt);
            return;
          }
        }
        setStockRows([]);
        setStockError(err instanceof Error ? err.message : 'Unable to load branch stock.');
      })
      .finally(() => {
        if (active) setStockLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId, branch.id]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = useMemo(() => {
    if (!normalizedQuery) return products;
    return products.filter((product) => {
      const searchable = [
        product.name,
        product.sku ?? '',
        product.category ?? '',
        ...product.uoms.map((uom) => uom.barcode ?? ''),
      ].join(' ').toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [normalizedQuery, products]);

  const stockByProduct = useMemo(
    () => new Map(stockRows.map((row) => [row.catalogItemId, row])),
    [stockRows],
  );
  const cartLines = Object.values(cart);
  const itemCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const total = cartLines.reduce(
    (sum, line) => sum + line.quantity * (line.uom.sellingPrice ?? 0),
    0,
  );
  const checkoutLocked = Boolean(draftOrderId);
  const stockReady = !stockLoading && !stockError;
  const cartShortage = stockReady ? findStockShortage(cartLines, stockRows) : null;
  const usingSavedData = usingCachedProducts || usingCachedStock;
  const savedAt = latestCacheTime(catalogCacheSavedAt, stockCacheSavedAt);

  function selectedUom(product: CommerceProduct): CommerceUom | null {
    const selectedId = selectedUomByProduct[product.id];
    return product.uoms.find((uom) => uom.id === selectedId)
      ?? product.uoms.find((uom) => uom.isDefaultSelling)
      ?? product.uoms[0]
      ?? null;
  }

  function stockQuantityInCart(productId: string): number {
    return cartLines.reduce(
      (sum, line) => line.product.id === productId
        ? sum + line.quantity * line.uom.conversionFactor
        : sum,
      0,
    );
  }

  function chooseUom(productId: string, uomId: string) {
    if (checkoutLocked) return;
    setSelectedUomByProduct((current) => ({ ...current, [productId]: uomId }));
  }

  function addToCart(product: CommerceProduct) {
    if (checkoutLocked || !stockReady) return;
    const uom = selectedUom(product);
    if (!uom || uom.sellingPrice === null) return;

    const onHand = stockByProduct.get(product.id)?.quantityOnHand ?? 0;
    const requested = stockQuantityInCart(product.id) + uom.conversionFactor;
    if (requested > onHand + STOCK_EPSILON) {
      setCheckoutError(
        `Not enough ${product.name} at ${branch.name}. ${formatQuantity(onHand)} ${product.stockUom} is available.`,
      );
      return;
    }

    const key = `${product.id}:${uom.id}`;
    setCheckoutError(null);
    setHeldNotice(null);
    setCart((current) => {
      const existing = current[key];
      const nextQuantity = existing ? existing.quantity + 1 : 1;
      return {
        ...current,
        [key]: { key, product, uom, quantity: nextQuantity },
      };
    });
  }

  function changeQuantity(line: CartLine, delta: number) {
    if (checkoutLocked || !stockReady) return;
    setCheckoutError(null);
    const step = line.uom.allowFractional ? 0.5 : 1;

    if (delta > 0) {
      const onHand = stockByProduct.get(line.product.id)?.quantityOnHand ?? 0;
      const requested = stockQuantityInCart(line.product.id) + step * line.uom.conversionFactor;
      if (requested > onHand + STOCK_EPSILON) {
        setCheckoutError(
          `Not enough ${line.product.name} at ${branch.name}. ${formatQuantity(onHand)} ${line.product.stockUom} is available.`,
        );
        return;
      }
    }

    setCart((current) => {
      const existing = current[line.key];
      if (!existing) return current;
      const next = Math.max(0, existing.quantity + delta * step);
      if (next <= 0) {
        const copy = { ...current };
        delete copy[line.key];
        return copy;
      }
      return { ...current, [line.key]: { ...existing, quantity: next } };
    });
  }

  async function refreshBranchStock(options?: { allowCache?: boolean }): Promise<BranchStockRow[]> {
    setStockLoading(true);
    if (!options?.allowCache) setStockError(null);
    try {
      const rows = await loadBranchStock(tenantId, branch.id);
      setStockRows(rows);
      setStockError(null);
      setUsingCachedStock(false);
      setStockCacheSavedAt(null);
      await saveBranchStockCache(tenantId, branch.id, rows).catch(() => undefined);
      return rows;
    } catch (err) {
      if (options?.allowCache && isLikelyConnectivityError(err)) {
        const cached = await loadBranchStockCache(tenantId, branch.id);
        if (cached) {
          setStockRows(cached.data);
          setStockError(null);
          setUsingCachedStock(true);
          setStockCacheSavedAt(cached.savedAt);
          return cached.data;
        }
      }
      if (!isLikelyConnectivityError(err)) {
        setStockError(err instanceof Error ? err.message : 'Unable to load branch stock.');
      }
      throw err;
    } finally {
      setStockLoading(false);
    }
  }

  function currentDraftInput(clientReference: string) {
    return {
      tenantId,
      branchId: branch.id,
      clientReference,
      items: cartLines.map((line) => ({
        catalogItemId: line.product.id,
        uomId: line.uom.id,
        quantity: line.quantity,
        expectedSellingPrice: line.uom.sellingPrice ?? 0,
        expectedConversionFactor: line.uom.conversionFactor,
      })),
    };
  }

  async function holdSaleForSync(clientReference: string) {
    if (!actorUserId) throw new Error('SellerTray cannot identify the cashier for offline sync.');
    await queueOfflinePosSale({
      clientReference,
      actorUserId,
      tenantId,
      branchId: branch.id,
      branchName: branch.name,
      currency,
      total,
      lines: cartLines.map((line) => ({
        catalogItemId: line.product.id,
        uomId: line.uom.id,
        quantity: line.quantity,
        expectedSellingPrice: line.uom.sellingPrice ?? 0,
        expectedConversionFactor: line.uom.conversionFactor,
        productName: line.product.name,
        uomName: line.uom.name,
      })),
    });
    setCart({});
    setSaleClientReference(null);
    setCheckoutError(null);
    setHeldNotice('Sale held on this device. It is not paid or completed. SellerTray will recheck Branch access, price, unit conversion and stock before creating the draft online.');
    onOfflineSaleQueued?.();
  }

  async function saveForCheckout() {
    if (saving || completing || checkoutLocked || cartLines.length === 0 || !stockReady) return;
    setSaving(true);
    setCheckoutError(null);
    const clientReference = saleClientReference ?? createPosClientReference();
    setSaleClientReference(clientReference);
    try {
      const latestStock = await refreshBranchStock();
      const shortage = findStockShortage(cartLines, latestStock);
      if (shortage) {
        throw new Error(
          `Not enough ${shortage.productName} at ${branch.name}. `
          + `${formatQuantity(shortage.available)} ${shortage.stockUom} is available; `
          + `${formatQuantity(shortage.required)} is needed.`,
        );
      }

      const orderId = await createPosDraft(currentDraftInput(clientReference));
      setDraftOrderId(orderId);
      setUsingCachedProducts(false);
      setHeldNotice(null);
    } catch (err) {
      if (isLikelyConnectivityError(err)) {
        try {
          await holdSaleForSync(clientReference);
        } catch (queueError) {
          setCheckoutError(queueError instanceof Error ? queueError.message : 'Unable to hold this sale for sync.');
        }
      } else {
        setCheckoutError(err instanceof Error ? err.message : 'Unable to prepare this sale.');
      }
    } finally {
      setSaving(false);
    }
  }

  function confirmCashReceived() {
    if (!draftOrderId || completing) return;
    Alert.alert(
      'Confirm cash received',
      `Complete this sale only after receiving ${formatMoney(total, currency)} in cash. Stock will be deducted immediately.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Cash received', onPress: () => void completeCashSale() },
      ],
    );
  }

  async function completeCashSale() {
    if (!draftOrderId || completing) return;
    const orderId = draftOrderId;
    setCompleting(true);
    setCheckoutError(null);
    try {
      await completePosCashSale(tenantId, orderId);
      setCart({});
      setDraftOrderId(null);
      setSaleClientReference(null);
      try {
        await refreshBranchStock({ allowCache: true });
      } catch {
        setStockError('Sale completed, but branch stock could not be refreshed. Refresh stock before starting another sale.');
      }
      onDraftCreated?.(orderId);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Unable to complete this cash sale.');
    } finally {
      setCompleting(false);
    }
  }

  function openSavedSale() {
    if (!draftOrderId || completing) return;
    const orderId = draftOrderId;
    setCart({});
    setDraftOrderId(null);
    setSaleClientReference(null);
    onDraftCreated?.(orderId);
  }

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SELL</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>New Sale</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Selling from {branch.name}. Prices follow the selected unit and availability follows this branch’s stock.
        </Text>
      </View>

      {usingSavedData ? (
        <View style={[styles.savedDataCard, dark && darkStyles.savedDataCard]}>
          <Ionicons name="cloud-offline-outline" size={21} color={theme.colors.warning} />
          <View style={styles.errorCopy}>
            <Text style={[styles.savedDataTitle, dark && darkStyles.titleText]}>Using saved selling data</Text>
            <Text style={[styles.savedDataText, dark && darkStyles.bodyText]}>
              {savedAt ? `Saved ${formatSavedAt(savedAt)}. ` : ''}You can hold a sale for sync, but SellerTray will not mark it paid or completed until the server revalidates it.
            </Text>
          </View>
        </View>
      ) : null}

      {heldNotice ? (
        <View style={[styles.heldCard, dark && darkStyles.heldCard]}>
          <Ionicons name="time-outline" size={21} color={theme.colors.greenDark} />
          <Text style={[styles.heldText, dark && darkStyles.bodyText]}>{heldNotice}</Text>
        </View>
      ) : null}

      <View style={[styles.searchBox, dark && darkStyles.input, checkoutLocked && styles.lockedControl]}>
        <Ionicons name="search-outline" size={20} color={theme.colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search product, SKU or barcode"
          placeholderTextColor={theme.colors.subtle}
          autoCorrect={false}
          editable={!checkoutLocked}
          style={[styles.searchInput, dark && darkStyles.inputText]}
        />
        <Pressable disabled={checkoutLocked} accessibilityLabel="Scan barcode" style={styles.scanButton}>
          <Ionicons name="barcode-outline" size={23} color={theme.colors.greenDark} />
        </Pressable>
      </View>

      {error ? (
        <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={21} color={theme.colors.danger} />
          <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{error}</Text>
        </View>
      ) : null}

      {stockError ? (
        <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={21} color={theme.colors.danger} />
          <View style={styles.errorCopy}>
            <Text style={[styles.errorText, dark && darkStyles.bodyText]}>
              Branch stock is unavailable. Selling is paused until availability can be verified or saved stock is available.
            </Text>
            <Pressable
              disabled={stockLoading || completing}
              onPress={() => void refreshBranchStock({ allowCache: true }).catch(() => undefined)}
              style={styles.retryStockButton}
            >
              <Text style={styles.retryStockText}>{stockLoading ? 'Checking…' : 'Check stock again'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {loading && products.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading products…</Text>
        </View>
      ) : null}

      {!loading && visibleProducts.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <Ionicons name="cube-outline" size={28} color={theme.colors.greenDark} />
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No matching products</Text>
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>
            Check the product name, SKU or barcode and try again.
          </Text>
        </View>
      ) : null}

      <View style={styles.productList}>
        {visibleProducts.map((product) => {
          const uom = selectedUom(product);
          const stockRow = stockByProduct.get(product.id);
          const onHand = stockRow?.quantityOnHand ?? 0;
          const inCart = stockQuantityInCart(product.id);
          const remaining = Math.max(0, onHand - inCart);
          const enoughForSelectedUom = Boolean(uom && remaining + STOCK_EPSILON >= uom.conversionFactor);
          const canAdd = Boolean(
            uom
            && uom.sellingPrice !== null
            && !checkoutLocked
            && stockReady
            && enoughForSelectedUom,
          );
          return (
            <View key={product.id} style={[styles.productCard, dark && darkStyles.card, checkoutLocked && styles.lockedControl]}>
              <View style={styles.productTopRow}>
                <View style={styles.productIdentity}>
                  <Text style={[styles.productName, dark && darkStyles.titleText]}>{product.name}</Text>
                  <Text style={[styles.productMeta, dark && darkStyles.bodyText]}>
                    {[product.sku, product.category].filter(Boolean).join(' · ') || `Stock unit: ${product.stockUom}`}
                  </Text>
                </View>
                <Text style={[styles.productPrice, dark && darkStyles.titleText]}>
                  {uom?.sellingPrice === null || !uom ? 'No price' : formatMoney(uom.sellingPrice, currency)}
                </Text>
              </View>

              <View style={[styles.stockBadge, !stockLoading && stockReady && onHand <= 0 && styles.stockBadgeOut]}>
                <Ionicons
                  name={stockLoading ? 'hourglass-outline' : onHand <= 0 ? 'alert-circle-outline' : 'cube-outline'}
                  size={15}
                  color={!stockLoading && stockReady && onHand <= 0 ? '#B42318' : theme.colors.greenDark}
                />
                <Text style={[styles.stockBadgeText, dark && darkStyles.bodyText, !stockLoading && stockReady && onHand <= 0 && styles.stockBadgeTextOut]}>
                  {stockLoading
                    ? 'Checking branch stock…'
                    : stockError
                      ? 'Stock unavailable'
                      : `${formatQuantity(onHand)} ${product.stockUom} on hand${usingCachedStock ? ' · saved' : ''}${inCart > 0 ? ` · ${formatQuantity(remaining)} left after cart` : ''}`}
                </Text>
              </View>

              {product.uoms.length > 0 ? (
                <View style={styles.uomRow}>
                  {product.uoms.map((candidate) => (
                    <Pressable
                      key={candidate.id}
                      disabled={checkoutLocked}
                      onPress={() => chooseUom(product.id, candidate.id)}
                      style={[styles.uomChip, dark && darkStyles.outlineButton, candidate.id === uom?.id && styles.uomChipActive]}
                    >
                      <Text style={[styles.uomChipText, dark && darkStyles.bodyText, candidate.id === uom?.id && styles.uomChipTextActive]}>
                        {candidate.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.warningText}>This product has no selling unit configured.</Text>
              )}

              {uom ? (
                <Text style={[styles.conversionText, dark && darkStyles.bodyText]}>
                  1 {uom.name} = {formatQuantity(uom.conversionFactor)} {product.stockUom}
                  {stockReady && !enoughForSelectedUom ? ` · Not enough stock for 1 ${uom.name}` : ''}
                </Text>
              ) : null}

              <Pressable
                disabled={!canAdd}
                onPress={() => addToCart(product)}
                style={({ pressed }) => [styles.addButton, !canAdd && styles.disabledButton, pressed && canAdd && styles.pressed]}
              >
                <Ionicons name="add" size={20} color={theme.colors.white} />
                <Text style={styles.addButtonText}>Add</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <View style={[styles.cartCard, dark && darkStyles.card]}>
        <View style={styles.cartHeadingRow}>
          <View>
            <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>CART</Text>
            <Text style={[styles.cartTitle, dark && darkStyles.titleText]}>
              {itemCount ? `${formatQuantity(itemCount)} item${itemCount === 1 ? '' : 's'}` : 'Cart is empty'}
            </Text>
          </View>
          <Text style={[styles.cartTotal, dark && darkStyles.titleText]}>{formatMoney(total, currency)}</Text>
        </View>

        {cartLines.length === 0 ? (
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Add products above to start the sale.</Text>
        ) : (
          <View style={styles.cartLines}>
            {cartLines.map((line) => {
              const onHand = stockByProduct.get(line.product.id)?.quantityOnHand ?? 0;
              return (
                <View key={line.key} style={[styles.cartLine, dark && darkStyles.subtleCard]}>
                  <View style={styles.cartLineCopy}>
                    <Text style={[styles.cartLineName, dark && darkStyles.titleText]}>{line.product.name}</Text>
                    <Text style={[styles.cartLineMeta, dark && darkStyles.bodyText]}>
                      {line.uom.name} · {formatQuantity(line.quantity * line.uom.conversionFactor)} {line.product.stockUom} stock quantity
                      {stockReady ? ` · ${formatQuantity(onHand)} on hand${usingCachedStock ? ' saved' : ''}` : ''}
                    </Text>
                    <Text style={[styles.cartLinePrice, dark && darkStyles.titleText]}>
                      {formatMoney(line.quantity * (line.uom.sellingPrice ?? 0), currency)}
                    </Text>
                  </View>
                  <View style={styles.quantityControls}>
                    <Pressable disabled={checkoutLocked || !stockReady} onPress={() => changeQuantity(line, -1)} style={[styles.quantityButton, (checkoutLocked || !stockReady) && styles.disabledButton]}>
                      <Ionicons name="remove" size={18} color={theme.colors.navy} />
                    </Pressable>
                    <Text style={[styles.quantityValue, dark && darkStyles.titleText]}>{formatQuantity(line.quantity)}</Text>
                    <Pressable disabled={checkoutLocked || !stockReady} onPress={() => changeQuantity(line, 1)} style={[styles.quantityButton, (checkoutLocked || !stockReady) && styles.disabledButton]}>
                      <Ionicons name="add" size={18} color={theme.colors.navy} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {cartShortage && !checkoutLocked ? (
          <View style={[styles.stockWarningCard, dark && darkStyles.errorCard]}>
            <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
            <Text style={[styles.errorText, dark && darkStyles.bodyText]}>
              {cartShortage.productName} exceeds current branch stock. Reduce the quantity before checkout.
            </Text>
          </View>
        ) : null}

        {draftOrderId ? (
          <View style={[styles.savedCheckoutCard, dark && darkStyles.subtleCard]}>
            <View style={styles.savedCheckoutIcon}>
              <Ionicons name="checkmark-circle-outline" size={22} color={theme.colors.greenDark} />
            </View>
            <View style={styles.savedCheckoutCopy}>
              <Text style={[styles.savedCheckoutTitle, dark && darkStyles.titleText]}>Sale saved for checkout</Text>
              <Text style={[styles.checkoutNoticeText, dark && darkStyles.bodyText]}>
                Items and prices are locked on the server. Confirm cash only after the full amount has been received. Final stock is checked again during completion.
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.checkoutNotice, dark && darkStyles.subtleCard]}>
            <Ionicons name="information-circle-outline" size={20} color={theme.colors.info} />
            <Text style={[styles.checkoutNoticeText, dark && darkStyles.bodyText]}>
              {usingSavedData
                ? 'Saved data can be used to hold this sale. SellerTray will recheck Branch access, price, unit conversion and stock before creating the online draft.'
                : 'SellerTray rechecks branch stock before saving, and checkout validates stock again before any payment or stock movement is committed.'}
            </Text>
          </View>
        )}

        {checkoutError ? (
          <View style={[styles.checkoutError, dark && darkStyles.errorCard]}>
            <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{checkoutError}</Text>
          </View>
        ) : null}

        {!draftOrderId ? (
          <Pressable
            disabled={cartLines.length === 0 || saving || completing || !stockReady || Boolean(cartShortage)}
            onPress={() => void saveForCheckout()}
            style={({ pressed }) => [
              styles.checkoutButton,
              (cartLines.length === 0 || saving || completing || !stockReady || Boolean(cartShortage)) && styles.disabledButton,
              pressed && cartLines.length > 0 && !saving && !completing && stockReady && !cartShortage && styles.pressed,
            ]}
          >
            {saving || stockLoading ? <ActivityIndicator color={theme.colors.white} /> : null}
            <Text style={styles.checkoutButtonText}>
              {saving ? 'Checking sale…' : stockLoading ? 'Checking stock…' : usingSavedData ? 'Hold sale for sync' : 'Save for checkout'}
            </Text>
            {!saving && !stockLoading ? <Ionicons name={usingSavedData ? 'cloud-upload-outline' : 'arrow-forward'} size={19} color={theme.colors.white} /> : null}
          </Pressable>
        ) : (
          <View style={styles.checkoutActions}>
            <Pressable
              disabled={completing}
              onPress={confirmCashReceived}
              style={({ pressed }) => [styles.checkoutButton, completing && styles.disabledButton, pressed && !completing && styles.pressed]}
            >
              {completing ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="cash-outline" size={20} color={theme.colors.white} />}
              <Text style={styles.checkoutButtonText}>{completing ? 'Completing sale…' : 'Cash received · Complete sale'}</Text>
            </Pressable>
            <Pressable disabled={completing} onPress={openSavedSale} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>View saved sale</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function findStockShortage(lines: CartLine[], rows: BranchStockRow[]): StockShortage | null {
  const availableByProduct = new Map(rows.map((row) => [row.catalogItemId, row.quantityOnHand]));
  const requested = new Map<string, StockShortage>();

  for (const line of lines) {
    const stockQuantity = line.quantity * line.uom.conversionFactor;
    const current = requested.get(line.product.id);
    if (current) {
      current.required += stockQuantity;
      continue;
    }
    requested.set(line.product.id, {
      productName: line.product.name,
      stockUom: line.product.stockUom,
      required: stockQuantity,
      available: availableByProduct.get(line.product.id) ?? 0,
    });
  }

  for (const shortage of requested.values()) {
    if (shortage.required > shortage.available + STOCK_EPSILON) return shortage;
  }
  return null;
}

function latestCacheTime(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'earlier';
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  title: { color: theme.colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
  savedDataCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FEC84B', backgroundColor: '#FFFAEB', padding: 12, flexDirection: 'row', gap: 9 },
  savedDataTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  savedDataText: { color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  heldCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft, padding: 12, flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  heldText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  searchBox: { minHeight: 52, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, paddingLeft: 13, paddingRight: 5, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 50, color: theme.colors.navy, fontSize: 14, paddingVertical: 0 },
  scanButton: { width: 43, height: 43, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 12, flexDirection: 'row', gap: 9 },
  errorCopy: { flex: 1, gap: 8 },
  errorText: { flex: 1, color: '#912018', fontSize: 12, lineHeight: 18 },
  retryStockButton: { alignSelf: 'flex-start', minHeight: 34, borderRadius: 10, backgroundColor: theme.colors.white, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  retryStockText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  emptyCard: { minHeight: 120, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 7 },
  emptyTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  productList: { gap: 9 },
  productCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 10 },
  productTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  productIdentity: { flex: 1, minWidth: 0 },
  productName: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  productMeta: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, marginTop: 2 },
  productPrice: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  stockBadge: { alignSelf: 'flex-start', minHeight: 30, borderRadius: theme.radius.pill, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  stockBadgeOut: { backgroundColor: theme.colors.dangerSoft },
  stockBadgeText: { color: theme.colors.greenDark, fontSize: 10.5, fontWeight: '800' },
  stockBadgeTextOut: { color: '#B42318' },
  uomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  uomChip: { minHeight: 34, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  uomChipActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  uomChipText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  uomChipTextActive: { color: theme.colors.greenDark },
  conversionText: { color: theme.colors.muted, fontSize: 11, fontWeight: '700' },
  warningText: { color: '#B54708', fontSize: 11, fontWeight: '800' },
  addButton: { alignSelf: 'flex-end', minHeight: 40, minWidth: 92, borderRadius: 12, backgroundColor: theme.colors.green, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  addButtonText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  disabledButton: { opacity: 0.42 },
  lockedControl: { opacity: 0.58 },
  cartCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 12 },
  cartHeadingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cartTitle: { color: theme.colors.navy, fontSize: 17, fontWeight: '900', marginTop: 2 },
  cartTotal: { color: theme.colors.navy, fontSize: 20, fontWeight: '900' },
  cartLines: { gap: 8 },
  cartLine: { minHeight: 78, borderRadius: theme.radius.md, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: theme.colors.border, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  cartLineCopy: { flex: 1 },
  cartLineName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  cartLineMeta: { color: theme.colors.muted, fontSize: 10.5, lineHeight: 16, marginTop: 2 },
  cartLinePrice: { color: theme.colors.navy, fontSize: 12, fontWeight: '900', marginTop: 3 },
  quantityControls: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  quantityButton: { width: 32, height: 32, borderRadius: 10, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  quantityValue: { minWidth: 28, textAlign: 'center', color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  stockWarningCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 10, flexDirection: 'row', gap: 8 },
  checkoutNotice: { borderRadius: theme.radius.md, backgroundColor: theme.colors.infoSoft, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  checkoutNoticeText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  savedCheckoutCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  savedCheckoutIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  savedCheckoutCopy: { flex: 1, gap: 2 },
  savedCheckoutTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  checkoutError: { borderRadius: theme.radius.md, backgroundColor: theme.colors.dangerSoft, padding: 10 },
  checkoutActions: { gap: 8 },
  checkoutButton: { minHeight: 50, borderRadius: 14, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  checkoutButtonText: { color: theme.colors.white, fontSize: 14, fontWeight: '900' },
  secondaryButton: { minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  pressed: { opacity: 0.74 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  input: { backgroundColor: theme.colors.navy, borderColor: '#475467' },
  inputText: { color: theme.colors.cloud },
  outlineButton: { backgroundColor: theme.colors.navy, borderColor: '#475467' },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  savedDataCard: { backgroundColor: '#3A2D12', borderColor: '#B54708' },
  heldCard: { backgroundColor: '#123524', borderColor: '#067647' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});