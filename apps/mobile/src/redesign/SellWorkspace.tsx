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

type SaleStage = 'products' | 'cart' | 'payment';
type ProductViewMode = 'grid' | 'list';

type Props = {
  tenantId: string;
  actorUserId: string;
  branch: CommerceBranch;
  currency: string;
  onDraftCreated?: (orderId: string) => void;
  onOfflineSaleQueued?: () => void;
};

const STOCK_EPSILON = 0.000001;
const PRODUCTS_PER_PAGE = 20;

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
  const [viewMode, setViewMode] = useState<ProductViewMode>('grid');
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState<SaleStage>('products');
  const [selectedUomByProduct, setSelectedUomByProduct] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
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
    setQuantityDrafts({});
    setDraftOrderId(null);
    setSaleClientReference(null);
    setCheckoutError(null);
    setHeldNotice(null);
    setStage('products');
    setPage(1);
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

  const pageCount = Math.max(1, Math.ceil(visibleProducts.length / PRODUCTS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pageProducts = visibleProducts.slice(
    (safePage - 1) * PRODUCTS_PER_PAGE,
    safePage * PRODUCTS_PER_PAGE,
  );

  useEffect(() => {
    setPage(1);
  }, [normalizedQuery]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const stockByProduct = useMemo(
    () => new Map(stockRows.map((row) => [row.catalogItemId, row])),
    [stockRows],
  );
  const cartLines = Object.values(cart);
  const lineCount = cartLines.length;
  const unitCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
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

  function stockQuantityInCart(productId: string, excludeLineKey?: string): number {
    return cartLines.reduce(
      (sum, line) => line.product.id === productId && line.key !== excludeLineKey
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
      setQuantityDrafts((drafts) => ({ ...drafts, [key]: formatQuantity(nextQuantity) }));
      return {
        ...current,
        [key]: { key, product, uom, quantity: nextQuantity },
      };
    });
  }

  function setLineQuantity(line: CartLine, quantity: number): boolean {
    if (checkoutLocked || !stockReady) return false;
    if (!Number.isFinite(quantity) || quantity < 0) {
      setCheckoutError('Enter a valid quantity.');
      return false;
    }
    if (!line.uom.allowFractional && quantity !== Math.trunc(quantity)) {
      setCheckoutError(`${line.uom.name} does not allow fractional quantity.`);
      return false;
    }
    if (quantity <= 0) {
      setCart((current) => {
        const copy = { ...current };
        delete copy[line.key];
        return copy;
      });
      setQuantityDrafts((current) => {
        const copy = { ...current };
        delete copy[line.key];
        return copy;
      });
      setCheckoutError(null);
      return true;
    }

    const onHand = stockByProduct.get(line.product.id)?.quantityOnHand ?? 0;
    const otherStock = stockQuantityInCart(line.product.id, line.key);
    const requested = otherStock + quantity * line.uom.conversionFactor;
    if (requested > onHand + STOCK_EPSILON) {
      setCheckoutError(
        `Not enough ${line.product.name} at ${branch.name}. ${formatQuantity(onHand)} ${line.product.stockUom} is available.`,
      );
      return false;
    }

    setCart((current) => ({
      ...current,
      [line.key]: { ...line, quantity },
    }));
    setQuantityDrafts((current) => ({ ...current, [line.key]: formatQuantity(quantity) }));
    setCheckoutError(null);
    return true;
  }

  function changeQuantity(line: CartLine, direction: -1 | 1) {
    const step = line.uom.allowFractional ? 0.5 : 1;
    const next = Math.max(0, Number((line.quantity + direction * step).toFixed(6)));
    setLineQuantity(line, next);
  }

  function commitTypedQuantity(line: CartLine) {
    const raw = quantityDrafts[line.key] ?? formatQuantity(line.quantity);
    const value = Number(raw);
    if (!setLineQuantity(line, value)) {
      setQuantityDrafts((current) => ({ ...current, [line.key]: formatQuantity(line.quantity) }));
    }
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
    setQuantityDrafts({});
    setSaleClientReference(null);
    setCheckoutError(null);
    setStage('products');
    setHeldNotice('Sale held on this device. It is not paid or completed. SellerTray will recheck Branch access, price, unit conversion and stock before creating the draft online.');
    onOfflineSaleQueued?.();
  }

  async function continueToPayment() {
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
      setStage('payment');
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
      setQuantityDrafts({});
      setDraftOrderId(null);
      setSaleClientReference(null);
      setStage('products');
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
    setQuantityDrafts({});
    setDraftOrderId(null);
    setSaleClientReference(null);
    setStage('products');
    onDraftCreated?.(orderId);
  }

  const stepLabel = stage === 'products' ? 'Products' : stage === 'cart' ? 'Cart' : 'Payment';

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SELL · {stepLabel.toUpperCase()}</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>
          {stage === 'products' ? 'New Sale' : stage === 'cart' ? 'Review Cart' : 'Take Payment'}
        </Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          {stage === 'products'
            ? `Selling from ${branch.name}. Choose products and units.`
            : stage === 'cart'
              ? 'Review quantities before creating the checkout draft.'
              : `Collect ${formatMoney(total, currency)} before completing this sale.`}
        </Text>
      </View>

      <View style={styles.stepRow}>
        {(['products', 'cart', 'payment'] as SaleStage[]).map((value, index) => {
          const active = value === stage;
          const available = value === 'products'
            || (value === 'cart' && !checkoutLocked)
            || (value === 'payment' && checkoutLocked);
          return (
            <View key={value} style={styles.stepItem}>
              <View style={[styles.stepDot, active && styles.stepDotActive]}>
                <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>{index + 1}</Text>
              </View>
              <Text style={[styles.stepText, active && styles.stepTextActive, !available && styles.stepTextMuted]}>
                {value === 'products' ? 'Products' : value === 'cart' ? 'Cart' : 'Payment'}
              </Text>
            </View>
          );
        })}
      </View>

      {usingSavedData ? (
        <View style={[styles.savedDataCard, dark && darkStyles.savedDataCard]}>
          <Ionicons name="cloud-offline-outline" size={21} color={theme.colors.warning} />
          <View style={styles.flexCopy}>
            <Text style={[styles.noticeTitle, dark && darkStyles.titleText]}>Using saved selling data</Text>
            <Text style={[styles.noticeText, dark && darkStyles.bodyText]}>
              {savedAt ? `Saved ${formatSavedAt(savedAt)}. ` : ''}A sale can be held for sync, but it is not paid or completed until the server revalidates it.
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

      {checkoutError ? (
        <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={21} color={theme.colors.danger} />
          <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{checkoutError}</Text>
        </View>
      ) : null}

      {stage === 'products' ? (
        <>
          <View style={[styles.searchBox, dark && darkStyles.input]}>
            <Ionicons name="search-outline" size={20} color={theme.colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search product, SKU or barcode"
              placeholderTextColor={theme.colors.subtle}
              autoCorrect={false}
              style={[styles.searchInput, dark && darkStyles.inputText]}
            />
            <Pressable accessibilityLabel="Scan barcode" style={styles.scanButton}>
              <Ionicons name="barcode-outline" size={23} color={theme.colors.greenDark} />
            </Pressable>
          </View>

          <View style={styles.catalogueToolbar}>
            <View style={styles.catalogueCountWrap}>
              <Text style={[styles.catalogueCount, dark && darkStyles.titleText]}>{visibleProducts.length} products</Text>
              <Text style={[styles.cataloguePageText, dark && darkStyles.bodyText]}>Page {safePage} of {pageCount}</Text>
            </View>
            <View style={[styles.viewToggle, dark && darkStyles.subtleCard]}>
              <Pressable
                accessibilityLabel="Tile product view"
                onPress={() => setViewMode('grid')}
                style={[styles.viewButton, viewMode === 'grid' && styles.viewButtonActive]}
              >
                <Ionicons name="grid-outline" size={18} color={viewMode === 'grid' ? theme.colors.white : theme.colors.navy} />
              </Pressable>
              <Pressable
                accessibilityLabel="List product view"
                onPress={() => setViewMode('list')}
                style={[styles.viewButton, viewMode === 'list' && styles.viewButtonActive]}
              >
                <Ionicons name="list-outline" size={20} color={viewMode === 'list' ? theme.colors.white : theme.colors.navy} />
              </Pressable>
            </View>
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
              <View style={styles.flexCopy}>
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
              <Text style={[styles.muted, dark && darkStyles.bodyText]}>Check the product name, SKU or barcode and try again.</Text>
            </View>
          ) : null}

          <View style={viewMode === 'grid' ? styles.productGrid : styles.productList}>
            {pageProducts.map((product) => {
              const uom = selectedUom(product);
              const onHand = stockByProduct.get(product.id)?.quantityOnHand ?? 0;
              const inCart = stockQuantityInCart(product.id);
              const remaining = Math.max(0, onHand - inCart);
              const enough = Boolean(uom && remaining + STOCK_EPSILON >= uom.conversionFactor);
              const canAdd = Boolean(uom && uom.sellingPrice !== null && stockReady && enough);
              return (
                <View
                  key={product.id}
                  style={[
                    viewMode === 'grid' ? styles.productTile : styles.productCard,
                    dark && darkStyles.card,
                  ]}
                >
                  <View style={styles.productTopRow}>
                    <View style={styles.flexCopy}>
                      <Text numberOfLines={2} style={[styles.productName, dark && darkStyles.titleText]}>{product.name}</Text>
                      {viewMode === 'list' ? (
                        <Text style={[styles.productMeta, dark && darkStyles.bodyText]}>
                          {[product.sku, product.category].filter(Boolean).join(' · ') || `Stock unit: ${product.stockUom}`}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.productPrice, dark && darkStyles.titleText]}>
                      {uom?.sellingPrice === null || !uom ? 'No price' : formatMoney(uom.sellingPrice, currency)}
                    </Text>
                  </View>

                  <View style={[styles.stockBadge, stockReady && onHand <= 0 && styles.stockBadgeOut]}>
                    <Text style={[styles.stockBadgeText, stockReady && onHand <= 0 && styles.stockBadgeTextOut]} numberOfLines={1}>
                      {stockLoading ? 'Checking stock…' : stockError ? 'Stock unavailable' : `${formatQuantity(remaining)} ${product.stockUom} available`}
                    </Text>
                  </View>

                  {product.uoms.length > 0 ? (
                    <View style={styles.uomRow}>
                      {product.uoms.map((candidate) => (
                        <Pressable
                          key={candidate.id}
                          onPress={() => chooseUom(product.id, candidate.id)}
                          style={[styles.uomChip, candidate.id === uom?.id && styles.uomChipActive]}
                        >
                          <Text style={[styles.uomChipText, candidate.id === uom?.id && styles.uomChipTextActive]}>{candidate.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.warningText}>No selling unit configured.</Text>
                  )}

                  {viewMode === 'list' && uom ? (
                    <Text style={[styles.conversionText, dark && darkStyles.bodyText]}>
                      1 {uom.name} = {formatQuantity(uom.conversionFactor)} {product.stockUom}
                    </Text>
                  ) : null}

                  <Pressable
                    disabled={!canAdd}
                    onPress={() => addToCart(product)}
                    style={({ pressed }) => [styles.addButton, !canAdd && styles.disabledButton, pressed && canAdd && styles.pressed]}
                  >
                    <Ionicons name="add" size={18} color={theme.colors.white} />
                    <Text style={styles.addButtonText}>{inCart > 0 ? 'Add more' : 'Add'}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          {visibleProducts.length > PRODUCTS_PER_PAGE ? (
            <View style={styles.paginationRow}>
              <Pressable disabled={safePage <= 1} onPress={() => setPage((current) => Math.max(1, current - 1))} style={[styles.pageButton, safePage <= 1 && styles.disabledButton]}>
                <Ionicons name="chevron-back" size={18} color={theme.colors.navy} />
                <Text style={styles.pageButtonText}>Previous</Text>
              </Pressable>
              <Text style={[styles.pageNumber, dark && darkStyles.bodyText]}>{safePage} / {pageCount}</Text>
              <Pressable disabled={safePage >= pageCount} onPress={() => setPage((current) => Math.min(pageCount, current + 1))} style={[styles.pageButton, safePage >= pageCount && styles.disabledButton]}>
                <Text style={styles.pageButtonText}>Next</Text>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.navy} />
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.cartSummaryBar, dark && darkStyles.card]}>
            <View style={styles.flexCopy}>
              <Text style={[styles.cartSummaryTitle, dark && darkStyles.titleText]}>
                {lineCount === 0 ? 'Cart is empty' : `${lineCount} product${lineCount === 1 ? '' : 's'} · ${formatQuantity(unitCount)} units`}
              </Text>
              <Text style={[styles.cartSummaryAmount, dark && darkStyles.bodyText]}>{formatMoney(total, currency)}</Text>
            </View>
            <Pressable disabled={lineCount === 0} onPress={() => setStage('cart')} style={[styles.primarySmallButton, lineCount === 0 && styles.disabledButton]}>
              <Text style={styles.primarySmallButtonText}>View cart</Text>
              <Ionicons name="arrow-forward" size={18} color={theme.colors.white} />
            </Pressable>
          </View>
        </>
      ) : null}

      {stage === 'cart' ? (
        <View style={styles.stageStack}>
          <Pressable disabled={saving} onPress={() => setStage('products')} style={styles.backLink}>
            <Ionicons name="arrow-back" size={19} color={theme.colors.greenDark} />
            <Text style={styles.backLinkText}>Continue shopping</Text>
          </Pressable>

          <View style={[styles.cartCard, dark && darkStyles.card]}>
            <View style={styles.cartHeadingRow}>
              <View>
                <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>CART</Text>
                <Text style={[styles.cartTitle, dark && darkStyles.titleText]}>
                  {lineCount} product{lineCount === 1 ? '' : 's'} · {formatQuantity(unitCount)} units
                </Text>
              </View>
              <Text style={[styles.cartTotal, dark && darkStyles.titleText]}>{formatMoney(total, currency)}</Text>
            </View>

            <View style={styles.cartLines}>
              {cartLines.map((line) => {
                const onHand = stockByProduct.get(line.product.id)?.quantityOnHand ?? 0;
                return (
                  <View key={line.key} style={[styles.cartLine, dark && darkStyles.subtleCard]}>
                    <View style={styles.flexCopy}>
                      <Text style={[styles.cartLineName, dark && darkStyles.titleText]}>{line.product.name}</Text>
                      <Text style={[styles.cartLineMeta, dark && darkStyles.bodyText]}>
                        {line.uom.name} · {formatQuantity(line.quantity * line.uom.conversionFactor)} {line.product.stockUom} stock · {formatQuantity(onHand)} on hand
                      </Text>
                      <Text style={[styles.cartLinePrice, dark && darkStyles.titleText]}>{formatMoney(line.quantity * (line.uom.sellingPrice ?? 0), currency)}</Text>
                    </View>
                    <View style={styles.quantityControls}>
                      <Pressable disabled={!stockReady} onPress={() => changeQuantity(line, -1)} style={[styles.quantityButton, !stockReady && styles.disabledButton]}>
                        <Ionicons name="remove" size={18} color={theme.colors.navy} />
                      </Pressable>
                      <TextInput
                        value={quantityDrafts[line.key] ?? formatQuantity(line.quantity)}
                        onChangeText={(value) => setQuantityDrafts((current) => ({ ...current, [line.key]: value.replace(/[^0-9.]/g, '') }))}
                        onBlur={() => commitTypedQuantity(line)}
                        onSubmitEditing={() => commitTypedQuantity(line)}
                        keyboardType="decimal-pad"
                        selectTextOnFocus
                        style={[styles.quantityInput, dark && darkStyles.input, dark && darkStyles.inputText]}
                        accessibilityLabel={`Quantity for ${line.product.name}`}
                      />
                      <Pressable disabled={!stockReady} onPress={() => changeQuantity(line, 1)} style={[styles.quantityButton, !stockReady && styles.disabledButton]}>
                        <Ionicons name="add" size={18} color={theme.colors.navy} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>

            {cartShortage ? (
              <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
                <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
                <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{cartShortage.productName} exceeds current branch stock. Reduce the quantity before checkout.</Text>
              </View>
            ) : null}

            <View style={[styles.infoCard, dark && darkStyles.subtleCard]}>
              <Ionicons name="information-circle-outline" size={20} color={theme.colors.info} />
              <Text style={[styles.noticeText, dark && darkStyles.bodyText]}>
                SellerTray rechecks branch stock, selling price and unit conversion before creating the checkout draft.
              </Text>
            </View>

            <Pressable
              disabled={lineCount === 0 || saving || !stockReady || Boolean(cartShortage)}
              onPress={() => void continueToPayment()}
              style={({ pressed }) => [styles.checkoutButton, (lineCount === 0 || saving || !stockReady || Boolean(cartShortage)) && styles.disabledButton, pressed && !saving && styles.pressed]}
            >
              {saving || stockLoading ? <ActivityIndicator color={theme.colors.white} /> : null}
              <Text style={styles.checkoutButtonText}>
                {saving ? 'Preparing payment…' : usingSavedData ? 'Hold sale for sync' : 'Continue to payment'}
              </Text>
              {!saving && !stockLoading ? <Ionicons name={usingSavedData ? 'cloud-upload-outline' : 'arrow-forward'} size={19} color={theme.colors.white} /> : null}
            </Pressable>
          </View>
        </View>
      ) : null}

      {stage === 'payment' ? (
        <View style={styles.stageStack}>
          <View style={[styles.paymentCard, dark && darkStyles.card]}>
            <View style={styles.paymentAmountWrap}>
              <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>AMOUNT DUE</Text>
              <Text style={[styles.paymentAmount, dark && darkStyles.titleText]}>{formatMoney(total, currency)}</Text>
              <Text style={[styles.muted, dark && darkStyles.bodyText]}>{lineCount} product{lineCount === 1 ? '' : 's'} · {formatQuantity(unitCount)} units</Text>
            </View>

            <View style={[styles.paymentMethodCard, dark && darkStyles.subtleCard]}>
              <View style={styles.paymentMethodIcon}><Ionicons name="cash-outline" size={24} color={theme.colors.greenDark} /></View>
              <View style={styles.flexCopy}>
                <Text style={[styles.paymentMethodTitle, dark && darkStyles.titleText]}>Cash</Text>
                <Text style={[styles.noticeText, dark && darkStyles.bodyText]}>Cash checkout is enabled for this POS flow.</Text>
              </View>
              <Ionicons name="checkmark-circle" size={23} color={theme.colors.green} />
            </View>

            <View style={[styles.infoCard, dark && darkStyles.subtleCard]}>
              <Ionicons name="shield-checkmark-outline" size={20} color={theme.colors.info} />
              <Text style={[styles.noticeText, dark && darkStyles.bodyText]}>
                The draft is locked on the server. Payment completion validates stock again before payment and stock movement are committed.
              </Text>
            </View>

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
        </View>
      ) : null}
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
  stageStack: { gap: 12 },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  title: { color: theme.colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  stepItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.green },
  stepNumber: { color: theme.colors.muted, fontSize: 11, fontWeight: '900' },
  stepNumberActive: { color: theme.colors.white },
  stepText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  stepTextActive: { color: theme.colors.greenDark },
  stepTextMuted: { opacity: 0.45 },
  savedDataCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FEC84B', backgroundColor: '#FFFAEB', padding: 12, flexDirection: 'row', gap: 9 },
  heldCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft, padding: 12, flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  heldText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  flexCopy: { flex: 1, minWidth: 0 },
  noticeTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  noticeText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  searchBox: { minHeight: 52, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, paddingLeft: 13, paddingRight: 5, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 50, color: theme.colors.navy, fontSize: 14, paddingVertical: 0 },
  scanButton: { width: 43, height: 43, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  catalogueToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  catalogueCountWrap: { gap: 1 },
  catalogueCount: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  cataloguePageText: { color: theme.colors.muted, fontSize: 10.5 },
  viewToggle: { flexDirection: 'row', borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: 12, padding: 3 },
  viewButton: { width: 38, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  viewButtonActive: { backgroundColor: theme.colors.green },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 12, flexDirection: 'row', gap: 9 },
  errorText: { flex: 1, color: '#912018', fontSize: 12, lineHeight: 18 },
  retryStockButton: { alignSelf: 'flex-start', minHeight: 34, borderRadius: 10, backgroundColor: theme.colors.white, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  retryStockText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  emptyCard: { minHeight: 120, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 7 },
  emptyTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  productList: { gap: 9 },
  productTile: { width: '48.3%', minHeight: 205, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 11, gap: 9 },
  productCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 10 },
  productTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  productName: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  productMeta: { color: theme.colors.muted, fontSize: 10.5, lineHeight: 16, marginTop: 2 },
  productPrice: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  stockBadge: { alignSelf: 'stretch', minHeight: 28, borderRadius: theme.radius.pill, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 8, justifyContent: 'center' },
  stockBadgeOut: { backgroundColor: theme.colors.dangerSoft },
  stockBadgeText: { color: theme.colors.greenDark, fontSize: 10, fontWeight: '800' },
  stockBadgeTextOut: { color: '#B42318' },
  uomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  uomChip: { minHeight: 31, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  uomChipActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  uomChipText: { color: theme.colors.slate, fontSize: 10.5, fontWeight: '800' },
  uomChipTextActive: { color: theme.colors.greenDark },
  conversionText: { color: theme.colors.muted, fontSize: 10.5, fontWeight: '700' },
  warningText: { color: '#B54708', fontSize: 10.5, fontWeight: '800' },
  addButton: { marginTop: 'auto', alignSelf: 'stretch', minHeight: 38, borderRadius: 11, backgroundColor: theme.colors.green, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  addButtonText: { color: theme.colors.white, fontSize: 11.5, fontWeight: '900' },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pageButton: { minHeight: 40, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
  pageButtonText: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' },
  pageNumber: { color: theme.colors.muted, fontSize: 11, fontWeight: '800' },
  cartSummaryBar: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cartSummaryTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  cartSummaryAmount: { color: theme.colors.slate, fontSize: 12, fontWeight: '800', marginTop: 2 },
  primarySmallButton: { minHeight: 42, borderRadius: 12, backgroundColor: theme.colors.green, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 5 },
  primarySmallButtonText: { color: theme.colors.white, fontSize: 11.5, fontWeight: '900' },
  backLink: { alignSelf: 'flex-start', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5 },
  backLinkText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  cartCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 12 },
  cartHeadingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cartTitle: { color: theme.colors.navy, fontSize: 16, fontWeight: '900', marginTop: 2 },
  cartTotal: { color: theme.colors.navy, fontSize: 20, fontWeight: '900' },
  cartLines: { gap: 8 },
  cartLine: { minHeight: 96, borderRadius: theme.radius.md, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: theme.colors.border, padding: 10, gap: 9 },
  cartLineName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  cartLineMeta: { color: theme.colors.muted, fontSize: 10.5, lineHeight: 16, marginTop: 2 },
  cartLinePrice: { color: theme.colors.navy, fontSize: 12, fontWeight: '900', marginTop: 3 },
  quantityControls: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-end' },
  quantityButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  quantityInput: { width: 82, minHeight: 42, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, backgroundColor: theme.colors.white, color: theme.colors.navy, textAlign: 'center', fontSize: 14, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 0 },
  infoCard: { borderRadius: theme.radius.md, backgroundColor: '#EFF8FF', padding: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  checkoutButton: { minHeight: 54, borderRadius: 14, backgroundColor: theme.colors.green, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  checkoutButtonText: { color: theme.colors.white, fontSize: 14, fontWeight: '900' },
  secondaryButton: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  paymentCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 16, gap: 14 },
  paymentAmountWrap: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  paymentAmount: { color: theme.colors.navy, fontSize: 34, lineHeight: 40, fontWeight: '900' },
  paymentMethodCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#F9FAFB', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  paymentMethodIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  paymentMethodTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  disabledButton: { opacity: 0.42 },
  pressed: { opacity: 0.82 },
});

const darkStyles = StyleSheet.create({
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#CBD5E1' },
  card: { backgroundColor: '#111827', borderColor: '#334155' },
  subtleCard: { backgroundColor: '#172033', borderColor: '#334155' },
  input: { backgroundColor: '#111827', borderColor: '#334155' },
  inputText: { color: '#F8FAFC' },
  errorCard: { backgroundColor: '#3F1D1D', borderColor: '#7F1D1D' },
  savedDataCard: { backgroundColor: '#3A2F12', borderColor: '#854D0E' },
  heldCard: { backgroundColor: '#102E24', borderColor: '#166534' },
});
