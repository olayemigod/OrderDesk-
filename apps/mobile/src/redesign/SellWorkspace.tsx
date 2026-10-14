import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  completePosSale,
  createPosClientReference,
  createPosDraft,
  loadBranchPosPaymentMethods,
  loadCommerceProducts,
  type CommerceBranch,
  type CommerceProduct,
  type CommerceUom,
  type PosPaymentMethod,
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
import { PosCustomerSelector, type PosCustomerSelection } from './PosCustomerSelector';

type CartLine = { key: string; product: CommerceProduct; uom: CommerceUom; quantity: number };
type StockShortage = { productName: string; stockUom: string; required: number; available: number };
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

export function SellWorkspace({ tenantId, actorUserId, branch, currency, onDraftCreated, onOfflineSaleQueued }: Props) {
  const dark = useSellerTrayAppearance().dark;
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
  const [paymentMethods, setPaymentMethods] = useState<PosPaymentMethod[]>([]);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(true);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);
  const [selectedPaymentKey, setSelectedPaymentKey] = useState('cash');
  const [customer, setCustomer] = useState<PosCustomerSelection | null>(null);
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
    void loadCommerceProducts(tenantId).then(async (rows) => {
      if (!active) return;
      setProducts(rows);
      await saveCommerceProductCache(tenantId, rows).catch(() => undefined);
    }).catch(async (err) => {
      if (!active) return;
      if (isLikelyConnectivityError(err)) {
        const cached = await loadCommerceProductCache(tenantId);
        if (active && cached) {
          setProducts(cached.data);
          setUsingCachedProducts(true);
          setCatalogCacheSavedAt(cached.savedAt);
          return;
        }
      }
      setError(err instanceof Error ? err.message : 'Unable to load products.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId]);

  useEffect(() => {
    setCart({});
    setQuantityDrafts({});
    setDraftOrderId(null);
    setSaleClientReference(null);
    setCustomer(null);
    setCheckoutError(null);
    setHeldNotice(null);
    setStage('products');
    setPage(1);
    setSelectedPaymentKey('cash');
  }, [branch.id]);

  useEffect(() => {
    let active = true;
    setStockLoading(true);
    setStockError(null);
    setUsingCachedStock(false);
    setStockCacheSavedAt(null);
    void loadBranchStock(tenantId, branch.id).then(async (rows) => {
      if (!active) return;
      setStockRows(rows);
      await saveBranchStockCache(tenantId, branch.id, rows).catch(() => undefined);
    }).catch(async (err) => {
      if (!active) return;
      if (isLikelyConnectivityError(err)) {
        const cached = await loadBranchStockCache(tenantId, branch.id);
        if (active && cached) {
          setStockRows(cached.data);
          setUsingCachedStock(true);
          setStockCacheSavedAt(cached.savedAt);
          return;
        }
      }
      setStockRows([]);
      setStockError(err instanceof Error ? err.message : 'Unable to load branch stock.');
    }).finally(() => { if (active) setStockLoading(false); });
    return () => { active = false; };
  }, [tenantId, branch.id]);

  useEffect(() => {
    let active = true;
    setPaymentMethodsLoading(true);
    setPaymentMethodError(null);
    void loadBranchPosPaymentMethods(tenantId, branch.id).then((rows) => {
      if (!active) return;
      setPaymentMethods(rows);
      setSelectedPaymentKey((current) => rows.some((entry) => paymentKey(entry) === current)
        ? current
        : paymentKey(rows.find((entry) => entry.isDefault) ?? rows[0] ?? cashFallback()));
    }).catch((err) => {
      if (!active) return;
      setPaymentMethods([]);
      setPaymentMethodError(err instanceof Error ? err.message : 'Unable to load branch payment methods.');
    }).finally(() => { if (active) setPaymentMethodsLoading(false); });
    return () => { active = false; };
  }, [tenantId, branch.id]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = useMemo(() => !normalizedQuery ? products : products.filter((product) => [product.name, product.sku ?? '', product.category ?? '', ...product.uoms.map((uom) => uom.barcode ?? '')].join(' ').toLowerCase().includes(normalizedQuery)), [normalizedQuery, products]);
  const pageCount = Math.max(1, Math.ceil(visibleProducts.length / PRODUCTS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pageProducts = visibleProducts.slice((safePage - 1) * PRODUCTS_PER_PAGE, safePage * PRODUCTS_PER_PAGE);
  useEffect(() => { setPage(1); }, [normalizedQuery]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const stockByProduct = useMemo(() => new Map(stockRows.map((row) => [row.catalogItemId, row])), [stockRows]);
  const cartLines = Object.values(cart);
  const lineCount = cartLines.length;
  const unitCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const total = cartLines.reduce((sum, line) => sum + line.quantity * (line.uom.sellingPrice ?? 0), 0);
  const checkoutLocked = Boolean(draftOrderId);
  const stockReady = !stockLoading && !stockError;
  const cartShortage = stockReady ? findStockShortage(cartLines, stockRows) : null;
  const usingSavedData = usingCachedProducts || usingCachedStock;
  const savedAt = latestCacheTime(catalogCacheSavedAt, stockCacheSavedAt);
  const selectedPayment = paymentMethods.find((entry) => paymentKey(entry) === selectedPaymentKey) ?? paymentMethods[0] ?? null;

  function selectedUom(product: CommerceProduct): CommerceUom | null {
    const selectedId = selectedUomByProduct[product.id];
    return product.uoms.find((uom) => uom.id === selectedId) ?? product.uoms.find((uom) => uom.isDefaultSelling) ?? product.uoms[0] ?? null;
  }

  function stockQuantityInCart(productId: string, excludeLineKey?: string): number {
    return cartLines.reduce((sum, line) => line.product.id === productId && line.key !== excludeLineKey ? sum + line.quantity * line.uom.conversionFactor : sum, 0);
  }

  function addToCart(product: CommerceProduct) {
    if (checkoutLocked || !stockReady) return;
    const uom = selectedUom(product);
    if (!uom || uom.sellingPrice === null) return;
    const onHand = stockByProduct.get(product.id)?.quantityOnHand ?? 0;
    if (stockQuantityInCart(product.id) + uom.conversionFactor > onHand + STOCK_EPSILON) {
      setCheckoutError(`Not enough ${product.name} at ${branch.name}. ${formatQuantity(onHand)} ${product.stockUom} is available.`);
      return;
    }
    const key = `${product.id}:${uom.id}`;
    setCheckoutError(null);
    setHeldNotice(null);
    setCart((current) => {
      const nextQuantity = (current[key]?.quantity ?? 0) + 1;
      setQuantityDrafts((drafts) => ({ ...drafts, [key]: formatQuantity(nextQuantity) }));
      return { ...current, [key]: { key, product, uom, quantity: nextQuantity } };
    });
  }

  function setLineQuantity(line: CartLine, quantity: number): boolean {
    if (checkoutLocked || !stockReady) return false;
    if (!Number.isFinite(quantity) || quantity < 0) { setCheckoutError('Enter a valid quantity.'); return false; }
    if (!line.uom.allowFractional && quantity !== Math.trunc(quantity)) { setCheckoutError(`${line.uom.name} does not allow fractional quantity.`); return false; }
    if (quantity <= 0) {
      setCart((current) => { const copy = { ...current }; delete copy[line.key]; return copy; });
      setQuantityDrafts((current) => { const copy = { ...current }; delete copy[line.key]; return copy; });
      setCheckoutError(null);
      return true;
    }
    const onHand = stockByProduct.get(line.product.id)?.quantityOnHand ?? 0;
    const requested = stockQuantityInCart(line.product.id, line.key) + quantity * line.uom.conversionFactor;
    if (requested > onHand + STOCK_EPSILON) { setCheckoutError(`Not enough ${line.product.name} at ${branch.name}. ${formatQuantity(onHand)} ${line.product.stockUom} is available.`); return false; }
    setCart((current) => ({ ...current, [line.key]: { ...line, quantity } }));
    setQuantityDrafts((current) => ({ ...current, [line.key]: formatQuantity(quantity) }));
    setCheckoutError(null);
    return true;
  }

  function changeQuantity(line: CartLine, direction: -1 | 1) {
    const step = line.uom.allowFractional ? 0.5 : 1;
    setLineQuantity(line, Math.max(0, Number((line.quantity + direction * step).toFixed(6))));
  }

  function commitTypedQuantity(line: CartLine) {
    const value = Number(quantityDrafts[line.key] ?? formatQuantity(line.quantity));
    if (!setLineQuantity(line, value)) setQuantityDrafts((current) => ({ ...current, [line.key]: formatQuantity(line.quantity) }));
  }

  async function refreshBranchStock(options?: { allowCache?: boolean }): Promise<BranchStockRow[]> {
    setStockLoading(true);
    if (!options?.allowCache) setStockError(null);
    try {
      const rows = await loadBranchStock(tenantId, branch.id);
      setStockRows(rows); setStockError(null); setUsingCachedStock(false); setStockCacheSavedAt(null);
      await saveBranchStockCache(tenantId, branch.id, rows).catch(() => undefined);
      return rows;
    } catch (err) {
      if (options?.allowCache && isLikelyConnectivityError(err)) {
        const cached = await loadBranchStockCache(tenantId, branch.id);
        if (cached) { setStockRows(cached.data); setStockError(null); setUsingCachedStock(true); setStockCacheSavedAt(cached.savedAt); return cached.data; }
      }
      if (!isLikelyConnectivityError(err)) setStockError(err instanceof Error ? err.message : 'Unable to load branch stock.');
      throw err;
    } finally { setStockLoading(false); }
  }

  function currentDraftInput(clientReference: string) {
    return {
      tenantId,
      branchId: branch.id,
      clientReference,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
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
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
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
    clearSale();
    setHeldNotice('Sale held on this device. It is not paid or completed. SellerTray will recheck Branch access, customer, price, unit conversion and stock before creating the draft online.');
    onOfflineSaleQueued?.();
  }

  async function continueToPayment() {
    if (saving || completing || checkoutLocked || !cartLines.length || !stockReady) return;
    setSaving(true); setCheckoutError(null);
    const clientReference = saleClientReference ?? createPosClientReference();
    setSaleClientReference(clientReference);
    try {
      const latestStock = await refreshBranchStock();
      const shortage = findStockShortage(cartLines, latestStock);
      if (shortage) throw new Error(`Not enough ${shortage.productName} at ${branch.name}. ${formatQuantity(shortage.available)} ${shortage.stockUom} is available; ${formatQuantity(shortage.required)} is needed.`);
      const orderId = await createPosDraft(currentDraftInput(clientReference));
      setDraftOrderId(orderId); setUsingCachedProducts(false); setHeldNotice(null); setStage('payment');
    } catch (err) {
      if (isLikelyConnectivityError(err)) {
        try { await holdSaleForSync(clientReference); }
        catch (queueError) { setCheckoutError(queueError instanceof Error ? queueError.message : 'Unable to hold this sale for sync.'); }
      } else setCheckoutError(err instanceof Error ? err.message : 'Unable to prepare this sale.');
    } finally { setSaving(false); }
  }

  function confirmSelectedPayment() {
    if (!draftOrderId || completing || !selectedPayment) return;
    const confirmation = selectedPayment.methodType === 'cash'
      ? `Confirm that ${formatMoney(total, currency)} cash has been received.`
      : selectedPayment.methodType === 'card_terminal'
        ? `Confirm the ${selectedPayment.displayName} terminal shows an approved payment of ${formatMoney(total, currency)}.`
        : `Confirm ${formatMoney(total, currency)} has been received in ${selectedPayment.displayName}.`;
    Alert.alert(`Confirm ${selectedPayment.displayName}`, `${confirmation} Stock will be deducted when the sale completes.`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Payment confirmed', onPress: () => void completeSelectedSale() },
    ]);
  }

  async function completeSelectedSale() {
    if (!draftOrderId || completing || !selectedPayment) return;
    const orderId = draftOrderId;
    setCompleting(true); setCheckoutError(null);
    try {
      await completePosSale(tenantId, orderId, selectedPayment.paymentMethodId);
      clearSale();
      try { await refreshBranchStock({ allowCache: true }); }
      catch { setStockError('Sale completed, but branch stock could not be refreshed. Refresh stock before starting another sale.'); }
      onDraftCreated?.(orderId);
    } catch (err) { setCheckoutError(err instanceof Error ? err.message : 'Unable to complete this sale.'); }
    finally { setCompleting(false); }
  }

  function clearSale() {
    setCart({});
    setQuantityDrafts({});
    setDraftOrderId(null);
    setSaleClientReference(null);
    setCustomer(null);
    setCheckoutError(null);
    setStage('products');
  }

  function openSavedSale() {
    if (!draftOrderId || completing) return;
    const orderId = draftOrderId; clearSale(); onDraftCreated?.(orderId);
  }

  const stepLabel = stage === 'products' ? 'Products' : stage === 'cart' ? 'Cart' : 'Payment';

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SELL · {stepLabel.toUpperCase()}</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>{stage === 'products' ? 'New Sale' : stage === 'cart' ? 'Review Cart' : 'Take Payment'}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>{stage === 'products' ? `Selling from ${branch.name}. Choose products and units.` : stage === 'cart' ? 'Review quantities and customer before preparing payment.' : `Collect ${formatMoney(total, currency)} using a payment method available at ${branch.name}.`}</Text>
      </View>

      <View style={styles.stepRow}>{(['products', 'cart', 'payment'] as SaleStage[]).map((value, index) => <View key={value} style={styles.stepItem}><View style={[styles.stepDot, value === stage && styles.stepDotActive]}><Text style={[styles.stepNumber, value === stage && styles.stepNumberActive]}>{index + 1}</Text></View><Text style={[styles.stepText, value === stage && styles.stepTextActive]}>{value === 'products' ? 'Products' : value === 'cart' ? 'Cart' : 'Payment'}</Text></View>)}</View>

      {usingSavedData ? <Notice icon="cloud-offline-outline" text={`${savedAt ? `Saved ${formatSavedAt(savedAt)}. ` : ''}A sale can be held for sync, but it is not paid or completed until the server revalidates it.`} dark={dark} warning /> : null}
      {heldNotice ? <Notice icon="time-outline" text={heldNotice} dark={dark} /> : null}
      {checkoutError ? <ErrorCard text={checkoutError} dark={dark} /> : null}

      {stage === 'products' ? <>
        <View style={[styles.searchBox, dark && darkStyles.input]}><Ionicons name="search-outline" size={20} color={theme.colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Search product, SKU or barcode" placeholderTextColor={theme.colors.subtle} autoCorrect={false} style={[styles.searchInput, dark && darkStyles.inputText]} /><View style={styles.scanButton}><Ionicons name="barcode-outline" size={23} color={theme.colors.greenDark} /></View></View>
        <View style={styles.toolbar}><View><Text style={[styles.catalogueCount, dark && darkStyles.titleText]}>{visibleProducts.length} products</Text><Text style={[styles.small, dark && darkStyles.bodyText]}>Page {safePage} of {pageCount}</Text></View><View style={[styles.viewToggle, dark && darkStyles.card]}><ToggleIcon name="grid-outline" active={viewMode === 'grid'} onPress={() => setViewMode('grid')} /><ToggleIcon name="list-outline" active={viewMode === 'list'} onPress={() => setViewMode('list')} /></View></View>
        {error ? <ErrorCard text={error} dark={dark} /> : null}
        {stockError ? <ErrorCard text="Branch stock is unavailable. Selling is paused until availability can be verified." dark={dark} /> : null}
        {loading && !products.length ? <Empty text="Loading products…" dark={dark} loading /> : null}
        {!loading && !visibleProducts.length ? <Empty text="No matching products" dark={dark} /> : null}
        <View style={viewMode === 'grid' ? styles.productGrid : styles.productList}>{pageProducts.map((product) => {
          const uom = selectedUom(product); const onHand = stockByProduct.get(product.id)?.quantityOnHand ?? 0; const inCart = stockQuantityInCart(product.id); const remaining = Math.max(0, onHand - inCart); const canAdd = Boolean(uom && uom.sellingPrice !== null && stockReady && remaining + STOCK_EPSILON >= uom.conversionFactor);
          return <View key={product.id} style={[viewMode === 'grid' ? styles.productTile : styles.productCard, dark && darkStyles.card]}>
            <View style={styles.row}><View style={styles.flex}><Text numberOfLines={2} style={[styles.productName, dark && darkStyles.titleText]}>{product.name}</Text>{viewMode === 'list' ? <Text style={[styles.small, dark && darkStyles.bodyText]}>{[product.sku, product.category].filter(Boolean).join(' · ') || `Stock unit: ${product.stockUom}`}</Text> : null}</View><Text style={[styles.productPrice, dark && darkStyles.titleText]}>{uom?.sellingPrice === null || !uom ? 'No price' : formatMoney(uom.sellingPrice, currency)}</Text></View>
            <Text style={[styles.stockText, onHand <= 0 && styles.dangerText]}>{stockLoading ? 'Checking stock…' : `${formatQuantity(remaining)} ${product.stockUom} available`}</Text>
            <View style={styles.chips}>{product.uoms.map((candidate) => <Pressable key={candidate.id} onPress={() => setSelectedUomByProduct((current) => ({ ...current, [product.id]: candidate.id }))} style={[styles.chip, candidate.id === uom?.id && styles.chipActive]}><Text style={[styles.chipText, candidate.id === uom?.id && styles.chipTextActive]}>{candidate.name}</Text></Pressable>)}</View>
            <Pressable disabled={!canAdd} onPress={() => addToCart(product)} style={[styles.addButton, !canAdd && styles.disabled]}><Ionicons name="add" size={18} color={theme.colors.white} /><Text style={styles.buttonText}>{inCart > 0 ? 'Add more' : 'Add'}</Text></Pressable>
          </View>;
        })}</View>
        {visibleProducts.length > PRODUCTS_PER_PAGE ? <View style={styles.pagination}><PageButton label="Previous" disabled={safePage <= 1} onPress={() => setPage((value) => Math.max(1, value - 1))} /><Text style={[styles.small, dark && darkStyles.bodyText]}>{safePage} / {pageCount}</Text><PageButton label="Next" disabled={safePage >= pageCount} onPress={() => setPage((value) => Math.min(pageCount, value + 1))} /></View> : null}
        <View style={[styles.bottomBar, dark && darkStyles.card]}><View style={styles.flex}><Text style={[styles.cartTitle, dark && darkStyles.titleText]}>{lineCount ? `${lineCount} product${lineCount === 1 ? '' : 's'} · ${formatQuantity(unitCount)} units` : 'Cart is empty'}</Text><Text style={[styles.cartTotal, dark && darkStyles.titleText]}>{formatMoney(total, currency)}</Text></View><Pressable disabled={!lineCount} onPress={() => setStage('cart')} style={[styles.primarySmall, !lineCount && styles.disabled]}><Text style={styles.buttonText}>View cart</Text><Ionicons name="arrow-forward" size={18} color={theme.colors.white} /></Pressable></View>
      </> : null}

      {stage === 'cart' ? <View style={styles.stageStack}>
        <BackLink label="Continue shopping" onPress={() => setStage('products')} />
        <View style={[styles.card, dark && darkStyles.card]}>
          <View style={styles.row}><View style={styles.flex}><Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>CART</Text><Text style={[styles.cartTitle, dark && darkStyles.titleText]}>{lineCount} product{lineCount === 1 ? '' : 's'} · {formatQuantity(unitCount)} units</Text></View><Text style={[styles.cartTotal, dark && darkStyles.titleText]}>{formatMoney(total, currency)}</Text></View>
          {cartLines.map((line) => <View key={line.key} style={[styles.cartLine, dark && darkStyles.subtle]}><View style={styles.flex}><Text style={[styles.productName, dark && darkStyles.titleText]}>{line.product.name}</Text><Text style={[styles.small, dark && darkStyles.bodyText]}>{line.uom.name} · {formatQuantity(line.quantity * line.uom.conversionFactor)} {line.product.stockUom}</Text><Text style={[styles.productPrice, dark && darkStyles.titleText]}>{formatMoney(line.quantity * (line.uom.sellingPrice ?? 0), currency)}</Text></View><View style={styles.qty}><Pressable onPress={() => changeQuantity(line, -1)} style={styles.qtyButton}><Ionicons name="remove" size={18} color={theme.colors.navy} /></Pressable><TextInput value={quantityDrafts[line.key] ?? formatQuantity(line.quantity)} onChangeText={(value) => setQuantityDrafts((current) => ({ ...current, [line.key]: value.replace(/[^0-9.]/g, '') }))} onBlur={() => commitTypedQuantity(line)} keyboardType="decimal-pad" style={[styles.qtyInput, dark && darkStyles.input]} /><Pressable onPress={() => changeQuantity(line, 1)} style={styles.qtyButton}><Ionicons name="add" size={18} color={theme.colors.navy} /></Pressable></View></View>)}
          <View style={styles.customerSection}>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Customer</Text>
            <PosCustomerSelector tenantId={tenantId} value={customer} onChange={setCustomer} disabled={saving || checkoutLocked} />
          </View>
          {cartShortage ? <ErrorCard text={`${cartShortage.productName} exceeds current branch stock. Reduce the quantity before checkout.`} dark={dark} /> : null}
          <Notice icon="information-circle-outline" text="SellerTray rechecks customer, branch stock, selling price and unit conversion before creating the checkout draft." dark={dark} />
          <Pressable disabled={!lineCount || saving || !stockReady || Boolean(cartShortage)} onPress={() => void continueToPayment()} style={[styles.checkoutButton, (!lineCount || saving || !stockReady || Boolean(cartShortage)) && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.white} /> : null}<Text style={styles.buttonText}>{saving ? 'Preparing payment…' : usingSavedData ? 'Hold sale for sync' : 'Continue to payment'}</Text></Pressable>
        </View>
      </View> : null}

      {stage === 'payment' ? <View style={styles.stageStack}>
        <View style={[styles.card, dark && darkStyles.card]}>
          <View style={styles.center}><Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>AMOUNT DUE</Text><Text style={[styles.paymentAmount, dark && darkStyles.titleText]}>{formatMoney(total, currency)}</Text><Text style={[styles.small, dark && darkStyles.bodyText]}>{lineCount} products · {formatQuantity(unitCount)} units</Text><Text style={[styles.paymentCustomer, dark && darkStyles.bodyText]}>{customer?.name || customer?.phone || 'Walk-in Customer'}</Text></View>
          <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Payment method</Text>
          {paymentMethodsLoading ? <View style={styles.loadingRow}><ActivityIndicator /><Text style={[styles.small, dark && darkStyles.bodyText]}>Loading branch payment methods…</Text></View> : null}
          {paymentMethodError ? <ErrorCard text={paymentMethodError} dark={dark} /> : null}
          <View style={styles.paymentList}>{paymentMethods.map((method) => <Pressable key={paymentKey(method)} onPress={() => setSelectedPaymentKey(paymentKey(method))} style={[styles.paymentMethod, dark && darkStyles.subtle, selectedPaymentKey === paymentKey(method) && styles.paymentMethodActive]}><View style={styles.paymentIcon}><Ionicons name={method.methodType === 'cash' ? 'cash-outline' : method.methodType === 'card_terminal' ? 'card-outline' : 'business-outline'} size={22} color={theme.colors.greenDark} /></View><View style={styles.flex}><Text style={[styles.productName, dark && darkStyles.titleText]}>{method.displayName}</Text><Text style={[styles.small, dark && darkStyles.bodyText]}>{paymentDescription(method)}</Text></View>{selectedPaymentKey === paymentKey(method) ? <Ionicons name="checkmark-circle" size={23} color={theme.colors.green} /> : null}</Pressable>)}</View>
          {selectedPayment?.methodType === 'bank_transfer' ? <View style={[styles.instructions, dark && darkStyles.subtle]}><Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{selectedPayment.bankName ?? selectedPayment.displayName}</Text>{selectedPayment.bankAccountName ? <Text style={[styles.small, dark && darkStyles.bodyText]}>{selectedPayment.bankAccountName}</Text> : null}{selectedPayment.bankAccountNumber ? <Text selectable style={[styles.accountNumber, dark && darkStyles.titleText]}>{selectedPayment.bankAccountNumber}</Text> : null}{selectedPayment.instructions ? <Text style={[styles.small, dark && darkStyles.bodyText]}>{selectedPayment.instructions}</Text> : null}</View> : selectedPayment?.instructions ? <Text style={[styles.small, dark && darkStyles.bodyText]}>{selectedPayment.instructions}</Text> : null}
          <Notice icon="shield-checkmark-outline" text="Confirm the payment only after cash is received, the transfer is visible, or the terminal shows approval. Payment, order completion and stock deduction are committed together." dark={dark} />
          <Pressable disabled={completing || !selectedPayment || paymentMethodsLoading} onPress={confirmSelectedPayment} style={[styles.checkoutButton, (completing || !selectedPayment || paymentMethodsLoading) && styles.disabled]}>{completing ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.white} />}<Text style={styles.buttonText}>{completing ? 'Completing sale…' : selectedPayment ? `Confirm ${selectedPayment.displayName} · Complete sale` : 'Choose payment method'}</Text></Pressable>
          <Pressable disabled={completing} onPress={openSavedSale} style={styles.secondaryButton}><Text style={styles.secondaryText}>View saved sale</Text></Pressable>
        </View>
      </View> : null}
    </View>
  );
}

function cashFallback(): PosPaymentMethod { return { paymentMethodId: null, methodType: 'cash', displayName: 'Cash', sortOrder: -1, isDefault: true, bankName: null, bankAccountName: null, bankAccountNumber: null, instructions: null }; }
function paymentKey(method: PosPaymentMethod): string { return method.paymentMethodId ?? 'cash'; }
function paymentDescription(method: PosPaymentMethod): string { if (method.methodType === 'cash') return 'Physical drawer cash'; if (method.methodType === 'card_terminal') return 'Confirm approval on the payment terminal'; return 'Confirm the transfer has reached this account'; }
function findStockShortage(lines: CartLine[], rows: BranchStockRow[]): StockShortage | null { const available = new Map(rows.map((row) => [row.catalogItemId, row.quantityOnHand])); const requested = new Map<string, StockShortage>(); for (const line of lines) { const quantity = line.quantity * line.uom.conversionFactor; const current = requested.get(line.product.id); if (current) current.required += quantity; else requested.set(line.product.id, { productName: line.product.name, stockUom: line.product.stockUom, required: quantity, available: available.get(line.product.id) ?? 0 }); } for (const row of requested.values()) if (row.required > row.available + STOCK_EPSILON) return row; return null; }
function latestCacheTime(left: string | null, right: string | null): string | null { if (!left) return right; if (!right) return left; return new Date(left).getTime() >= new Date(right).getTime() ? left : right; }
function formatSavedAt(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'earlier' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function formatMoney(value: number, currency: string): string { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
function formatQuantity(value: number): string { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))); }
function BackLink({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.backLink}><Ionicons name="arrow-back" size={19} color={theme.colors.greenDark} /><Text style={styles.backLinkText}>{label}</Text></Pressable>; }
function ToggleIcon({ name, active, onPress }: { name: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.viewButton, active && styles.viewButtonActive]}><Ionicons name={name as never} size={19} color={active ? theme.colors.white : theme.colors.navy} /></Pressable>; }
function PageButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.pageButton, disabled && styles.disabled]}><Text style={styles.pageButtonText}>{label}</Text></Pressable>; }
function Empty({ text, dark, loading = false }: { text: string; dark: boolean; loading?: boolean }) { return <View style={[styles.empty, dark && darkStyles.card]}>{loading ? <ActivityIndicator /> : <Ionicons name="cube-outline" size={26} color={theme.colors.greenDark} />}<Text style={[styles.small, dark && darkStyles.bodyText]}>{text}</Text></View>; }
function ErrorCard({ text, dark }: { text: string; dark: boolean }) { return <View style={[styles.errorCard, dark && darkStyles.error]}><Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} /><Text style={[styles.errorText, dark && darkStyles.bodyText]}>{text}</Text></View>; }
function Notice({ icon, text, dark, warning = false }: { icon: string; text: string; dark: boolean; warning?: boolean }) { return <View style={[styles.notice, warning && styles.warning, dark && darkStyles.subtle]}><Ionicons name={icon as never} size={20} color={warning ? theme.colors.warning : theme.colors.info} /><Text style={[styles.noticeText, dark && darkStyles.bodyText]}>{text}</Text></View>; }

const styles = StyleSheet.create({
  stack: { gap: 14 }, stageStack: { gap: 12 }, heading: { gap: 3 }, eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 }, title: { color: theme.colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '900' }, subtitle: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 }, flex: { flex: 1, minWidth: 0 }, row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, center: { alignItems: 'center', gap: 3 }, small: { color: theme.colors.muted, fontSize: 11, lineHeight: 16 }, sectionTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  stepRow: { flexDirection: 'row', gap: 8 }, stepItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }, stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' }, stepDotActive: { backgroundColor: theme.colors.green, borderColor: theme.colors.green }, stepNumber: { color: theme.colors.muted, fontSize: 11, fontWeight: '900' }, stepNumberActive: { color: theme.colors.white }, stepText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' }, stepTextActive: { color: theme.colors.greenDark },
  searchBox: { minHeight: 52, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, paddingLeft: 13, paddingRight: 5, flexDirection: 'row', alignItems: 'center', gap: 8 }, searchInput: { flex: 1, minHeight: 50, color: theme.colors.navy, fontSize: 14 }, scanButton: { width: 43, height: 43, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, catalogueCount: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' }, viewToggle: { flexDirection: 'row', borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: 12, padding: 3 }, viewButton: { width: 38, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, viewButtonActive: { backgroundColor: theme.colors.green },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }, productList: { gap: 9 }, productTile: { width: '48.3%', minHeight: 190, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 11, gap: 9 }, productCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 10 }, productName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' }, productPrice: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' }, stockText: { color: theme.colors.greenDark, fontSize: 10, fontWeight: '800' }, dangerText: { color: '#B42318' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 }, chip: { minHeight: 30, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 8, justifyContent: 'center' }, chipActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft }, chipText: { color: theme.colors.slate, fontSize: 10, fontWeight: '800' }, chipTextActive: { color: theme.colors.greenDark }, addButton: { marginTop: 'auto', minHeight: 38, borderRadius: 11, backgroundColor: theme.colors.green, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5 },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, pageButton: { minHeight: 38, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 14, justifyContent: 'center' }, pageButtonText: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' }, bottomBar: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: 12, backgroundColor: theme.colors.white, flexDirection: 'row', alignItems: 'center', gap: 10 }, cartTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' }, cartTotal: { color: theme.colors.navy, fontSize: 18, fontWeight: '900' }, primarySmall: { minHeight: 42, borderRadius: 11, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13 },
  card: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 12 }, cartLine: { borderRadius: theme.radius.md, backgroundColor: theme.colors.cloud, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'center' }, customerSection: { gap: 8, paddingTop: 2 }, paymentCustomer: { color: theme.colors.slate, fontSize: 11, fontWeight: '800', marginTop: 3 }, qty: { flexDirection: 'row', alignItems: 'center', gap: 5 }, qtyButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' }, qtyInput: { width: 58, minHeight: 38, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, textAlign: 'center', color: theme.colors.navy, backgroundColor: theme.colors.white }, backLink: { alignSelf: 'flex-start', flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 36 }, backLinkText: { color: theme.colors.greenDark, fontWeight: '900', fontSize: 12 },
  paymentAmount: { color: theme.colors.navy, fontSize: 32, fontWeight: '900' }, paymentList: { gap: 8 }, paymentMethod: { minHeight: 68, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 }, paymentMethodActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft }, paymentIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' }, instructions: { borderRadius: theme.radius.md, backgroundColor: theme.colors.cloud, padding: 12, gap: 5 }, accountNumber: { color: theme.colors.navy, fontSize: 20, fontWeight: '900', letterSpacing: 1 }, loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkoutButton: { minHeight: 50, borderRadius: theme.radius.md, backgroundColor: theme.colors.green, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, paddingHorizontal: 12 }, buttonText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' }, secondaryButton: { minHeight: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, justifyContent: 'center', alignItems: 'center' }, secondaryText: { color: theme.colors.greenDark, fontWeight: '900', fontSize: 12 },
  notice: { borderRadius: theme.radius.md, backgroundColor: '#EFF8FF', padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' }, warning: { backgroundColor: '#FFFAEB' }, noticeText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 }, errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 11, flexDirection: 'row', gap: 8 }, errorText: { flex: 1, color: '#B42318', fontSize: 11, lineHeight: 17 }, empty: { minHeight: 110, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, justifyContent: 'center', alignItems: 'center', gap: 6 }, disabled: { opacity: 0.45 },
});

const darkStyles = StyleSheet.create({ card: { backgroundColor: theme.colors.navy, borderColor: '#344054' }, subtle: { backgroundColor: '#162F46', borderColor: '#344054' }, input: { backgroundColor: '#162F46', borderColor: '#344054', color: theme.colors.cloud }, inputText: { color: theme.colors.cloud }, titleText: { color: theme.colors.cloud }, bodyText: { color: '#D0D5DD' }, error: { backgroundColor: '#3A1717', borderColor: '#7A271A' } });
