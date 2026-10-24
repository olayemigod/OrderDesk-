import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadSubscriptionAccess } from '../data/subscriptionRepository';
import { assertCachedOperationalAccess } from '../data/operationalAccessCache';

import {
  completePosSale,
  createPosClientReference,
  loadBranchPosPaymentMethods,
  loadCommerceProducts,
  type CommerceBranch,
  type CommerceProduct,
  type CommerceUom,
  type PosPaymentMethod,
} from '../data/commerceRepository';
import { loadBranchStock, type BranchStockRow } from '../data/inventoryRepository';
import { sellerTrayUserMessage } from '../data/userFacingError';
import {
  isLikelyConnectivityError,
  loadBranchStockCache,
  loadCommerceProductCache,
  loadPosPaymentMethodsCache,
  loadPosPolicyCache,
  loadTaxContextCache,
  queueOfflinePosSale,
  saveBranchStockCache,
  saveCommerceProductCache,
  savePosPaymentMethodsCache,
  savePosPolicyCache,
  saveTaxContextCache,
  type OfflinePaymentPlan,
} from '../data/offlineSalesRepository';
import { prepareGovernedPosDraft } from '../data/posDraftPreparationRepository';
import { loadPosPaymentPolicy, type PosAllocationCheckoutResult, type PosPaymentPolicy } from '../data/posPaymentRepository';
import {
  loadSellerTrayTaxQuote,
  previewTaxFromContext,
  taxContextFromQuote,
  type SellerTrayTaxContext,
} from '../data/taxRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { PosCustomerSelector, type PosCustomerSelection } from './PosCustomerSelector';
import { BarcodeScannerSheet } from './BarcodeScannerSheet';
import { OfflinePosPaymentAllocator } from './OfflinePosPaymentAllocator';
import { PosPaymentAllocator } from './PosPaymentAllocator';

type CartLine = { key: string; product: CommerceProduct; uom: CommerceUom; quantity: number; sellingPrice: number };
type SaleStage = 'products' | 'cart' | 'payment';
type StockShortage = { productName: string; stockUom: string; required: number; available: number };
type Props = { tenantId: string; actorUserId: string; branch: CommerceBranch; currency: string; onDraftCreated?: (orderId: string) => void; onOfflineSaleQueued?: () => void };

const STOCK_EPSILON = 0.000001;

export function SellWorkspace({ tenantId, actorUserId, branch, currency, onDraftCreated, onOfflineSaleQueued }: Props) {
  const dark = useSellerTrayAppearance().dark;
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [stockRows, setStockRows] = useState<BranchStockRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PosPaymentMethod[]>([]);
  const [posPolicy, setPosPolicy] = useState<PosPaymentPolicy | null>(null);
  const [taxContext, setTaxContext] = useState<SellerTrayTaxContext | null>(null);
  const [usingCachedProducts, setUsingCachedProducts] = useState(false);
  const [usingCachedStock, setUsingCachedStock] = useState(false);
  const [usingCachedPayments, setUsingCachedPayments] = useState(false);
  const [usingCachedPolicy, setUsingCachedPolicy] = useState(false);
  const [usingCachedTax, setUsingCachedTax] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<SaleStage>('products');
  const [selectedUomByProduct, setSelectedUomByProduct] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [customer, setCustomer] = useState<PosCustomerSelection | null>(null);
  const [draftOrderId, setDraftOrderId] = useState<string | null>(null);
  const [saleClientReference, setSaleClientReference] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [catalogueView, setCatalogueView] = useState<'grid' | 'list'>('grid');
  const [offlinePaymentOpen, setOfflinePaymentOpen] = useState(false);
  const [accessSubject, setAccessSubject] = useState<string | null>(null);
  const [accessRevision, setAccessRevision] = useState(0);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') setAccessRevision((n) => n + 1); });
    return () => listener.remove();
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setAccessSubject(null);
    void Promise.all([
      loadProductsWithCache(tenantId),
      loadStockWithCache(tenantId, branch.id),
      loadPaymentsWithCache(tenantId, branch.id),
      loadPolicyWithCache(tenantId),
      loadTaxWithCache(tenantId),
      confirmOperationalAccess(tenantId, actorUserId),
    ]).then(([catalog, stock, payments, policy, tax]) => {
      if (!active) return;
      setAccessSubject(`${tenantId}:${branch.id}:${actorUserId}`);
      setProducts(catalog.data); setUsingCachedProducts(catalog.cached);
      setStockRows(stock.data); setUsingCachedStock(stock.cached);
      setPaymentMethods(payments.data); setUsingCachedPayments(payments.cached);
      setPosPolicy(policy.data); setUsingCachedPolicy(policy.cached);
      setTaxContext(tax.data); setUsingCachedTax(tax.cached);
    }).catch((cause) => {
      if (active) setError(sellerTrayUserMessage(cause, 'Selling data is unavailable right now.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId, branch.id, actorUserId, accessRevision]);

  useEffect(() => {
    setCart({}); setQuantityDrafts({}); setPriceDrafts({}); setCustomer(null); setDraftOrderId(null);
    setSaleClientReference(null); setStage('products'); setError(null); setNotice(null); setOfflinePaymentOpen(false);
  }, [branch.id]);

  const stockByProduct = useMemo(() => new Map(stockRows.map((row) => [row.catalogItemId, row])), [stockRows]);
  const cartLines = Object.values(cart);
  const subtotal = roundMoney(cartLines.reduce((sum, line) => sum + roundMoney(line.quantity * line.sellingPrice), 0));
  const taxQuote = taxContext
    ? previewTaxFromContext(subtotal, taxContext)
    : { configurationId: null, revision: 0, taxApplied: false, ratePercent: 0, displayTaxBreakdown: false, subtotal, taxAmount: 0, grossAmount: subtotal };
  const total = taxQuote.grossAmount;
  const unitCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = useMemo(() => products.filter((product) => !normalizedQuery || [product.name, product.sku ?? '', product.category ?? '', ...product.uoms.map((uom) => uom.barcode ?? '')].join(' ').toLowerCase().includes(normalizedQuery)), [products, normalizedQuery]);
  const usingSavedData = usingCachedProducts || usingCachedStock || usingCachedPayments || usingCachedPolicy || usingCachedTax;
  const canOverridePrice = posPolicy?.allowPriceOverride === true && posPolicy.canOverridePrice === true;
  const hasPriceOverride = cartLines.some((line) => Math.abs(line.sellingPrice - (line.uom.sellingPrice ?? 0)) > 0.005);

  function selectedUom(product: CommerceProduct): CommerceUom | null {
    const id = selectedUomByProduct[product.id];
    return product.uoms.find((uom) => uom.id === id) ?? product.uoms.find((uom) => uom.isDefaultSelling) ?? product.uoms[0] ?? null;
  }

  function stockInCart(productId: string, exclude?: string) {
    return cartLines.reduce((sum, line) => line.product.id === productId && line.key !== exclude ? sum + line.quantity * line.uom.conversionFactor : sum, 0);
  }

  function addToCart(product: CommerceProduct) {
    const uom = selectedUom(product);
    if (!uom || uom.sellingPrice === null || draftOrderId) return;
    const key = `${product.id}:${uom.id}`;
    const available = stockByProduct.get(product.id)?.quantityOnHand ?? 0;
    if (available <= STOCK_EPSILON) return;
    const nextQuantity = (cart[key]?.quantity ?? 0) + 1;
    if (stockInCart(product.id, key) + nextQuantity * uom.conversionFactor > available + STOCK_EPSILON) {
      setError(`Not enough ${product.name} at ${branch.name}. ${formatQuantity(available)} ${product.stockUom} is available.`); return;
    }
    setCart((current) => ({ ...current, [key]: { key, product, uom, quantity: nextQuantity, sellingPrice: current[key]?.sellingPrice ?? uom.sellingPrice! } }));
    setQuantityDrafts((current) => ({ ...current, [key]: formatQuantity(nextQuantity) }));
    setPriceDrafts((current) => ({ ...current, [key]: current[key] ?? formatEditablePrice(uom.sellingPrice!) }));
    setError(null);
  }

  function setQuantity(line: CartLine, quantity: number) {
    if (!Number.isFinite(quantity) || quantity < 0) { setError('Enter a valid quantity.'); return false; }
    if (!line.uom.allowFractional && quantity !== Math.trunc(quantity)) { setError(`${line.uom.name} does not allow fractional quantity.`); return false; }
    if (quantity <= 0) {
      setCart((current) => { const next = { ...current }; delete next[line.key]; return next; });
      setQuantityDrafts((current) => { const next = { ...current }; delete next[line.key]; return next; });
      setPriceDrafts((current) => { const next = { ...current }; delete next[line.key]; return next; });
      return true;
    }
    const available = stockByProduct.get(line.product.id)?.quantityOnHand ?? 0;
    if (stockInCart(line.product.id, line.key) + quantity * line.uom.conversionFactor > available + STOCK_EPSILON) { setError(`Not enough ${line.product.name} at ${branch.name}.`); return false; }
    setCart((current) => ({ ...current, [line.key]: { ...line, quantity } }));
    setQuantityDrafts((current) => ({ ...current, [line.key]: formatQuantity(quantity) })); setError(null); return true;
  }

  function setPrice(line: CartLine, value: string) {
    if (!canOverridePrice || draftOrderId) return;
    const clean = value.replace(/[^0-9.]/g, '');
    setPriceDrafts((current) => ({ ...current, [line.key]: clean }));
    const parsed = Number(clean);
    if (clean !== '' && Number.isFinite(parsed) && parsed >= 0) setCart((current) => ({ ...current, [line.key]: { ...line, sellingPrice: parsed } }));
    setError(null);
  }

  function commitPrice(line: CartLine) {
    const parsed = Number(priceDrafts[line.key] ?? line.sellingPrice);
    if (!Number.isFinite(parsed) || parsed < 0) { setPriceDrafts((current) => ({ ...current, [line.key]: formatEditablePrice(line.sellingPrice) })); setError('Enter a valid selling price.'); return; }
    setCart((current) => ({ ...current, [line.key]: { ...line, sellingPrice: parsed } }));
  }

  function draftInput(clientReference: string) {
    return {
      tenantId, branchId: branch.id, clientReference,
      customerId: customer?.id ?? null, customerName: customer?.name ?? null, customerPhone: customer?.phone ?? null,
      items: cartLines.map((line) => ({ catalogItemId: line.product.id, uomId: line.uom.id, uomName: line.uom.name, quantity: line.quantity, expectedSellingPrice: line.uom.sellingPrice ?? 0, sellingPrice: line.sellingPrice, expectedConversionFactor: line.uom.conversionFactor })),
    };
  }

  async function queueOfflinePaymentSale(clientReference: string, paymentPlan: OfflinePaymentPlan) {
    if (!actorUserId) throw new Error('SellerTray cannot identify the cashier for offline sync.');
    if (!taxContext) throw new Error('Reconnect once to refresh SellerTray tax settings before selling offline.');
    if (!posPolicy) throw new Error('Reconnect once to refresh SellerTray POS payment settings before selling offline.');
    if (hasPriceOverride && !canOverridePrice) throw new Error('Selling-price authority is not available offline for this sale.');

    const offlineQuote = previewTaxFromContext(subtotal, taxContext);
    const offlineTotal = offlineQuote.grossAmount;
    if (paymentPlan.payLater && !posPolicy.allowPayLater) throw new Error('Pay later is disabled in SellerTray settings.');
    if (paymentPlan.allocations.length > 1 && !posPolicy.allowSplitPayments) throw new Error('Split payment is disabled in SellerTray settings.');
    const allocated = roundMoney(paymentPlan.allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
    if (allocated > offlineTotal + 0.005) throw new Error('Payment allocations exceed the amount due.');
    if (allocated > 0.005 && allocated < offlineTotal - 0.005 && !posPolicy.allowPartialPayments) throw new Error('Partial payment is disabled in SellerTray settings.');
    if (allocated <= 0.005 && !paymentPlan.payLater) throw new Error('Add a payment or choose Pay later.');
    if (allocated >= offlineTotal - 0.005 && paymentPlan.payLater) throw new Error('Pay later is unnecessary when the sale is fully allocated.');

    for (const allocation of paymentPlan.allocations) {
      if (allocation.methodSnapshot.methodType === 'cash') {
        if (allocation.paymentMethodId !== null) throw new Error('Offline Cash payment configuration is invalid.');
        continue;
      }
      const cachedMethod = paymentMethods.find((method) => method.paymentMethodId === allocation.paymentMethodId);
      if (!cachedMethod || cachedMethod.methodType !== allocation.methodSnapshot.methodType) {
        throw new Error('The selected payment method is not available in the cached Branch payment configuration.');
      }
    }

    await queueOfflinePosSale({
      clientReference, actorUserId, tenantId, branchId: branch.id, branchName: branch.name,
      customerId: customer?.id ?? null, customerName: customer?.name ?? null, customerPhone: customer?.phone ?? null,
      currency, subtotal: offlineQuote.subtotal, taxContext, taxAmount: offlineQuote.taxAmount,
      total: offlineTotal, completionIntent: 'payment', paymentPlan,
      lines: cartLines.map((line) => ({ catalogItemId: line.product.id, uomId: line.uom.id, quantity: line.quantity, expectedSellingPrice: line.uom.sellingPrice ?? 0, sellingPrice: line.sellingPrice, expectedConversionFactor: line.uom.conversionFactor, productName: line.product.name, uomName: line.uom.name })),
    });

    const outstanding = roundMoney(Math.max(0, offlineTotal - allocated));
    const pendingNonCash = paymentPlan.allocations.some((allocation) => !allocation.confirmNow);
    clearSale();
    if (pendingNonCash) {
      setNotice(`Offline sale recorded for ${formatMoney(offlineTotal, currency)}. Non-cash payment will follow governed confirmation when SellerTray reconnects; stock stays unchanged until settlement allows finalization.`);
    } else if (outstanding > 0.005) {
      setNotice(`Offline sale recorded with ${formatMoney(outstanding, currency)} outstanding. Partial payment and Pay later remain governed by SellerTray settings when the sale syncs.`);
    } else {
      setNotice(`Sale recorded offline for ${formatMoney(offlineTotal, currency)}. It will sync automatically when SellerTray reconnects.`);
    }
    onOfflineSaleQueued?.();
  }

  async function continueToPayment() {
    if (saving || draftOrderId || !cartLines.length) return;
    if (hasPriceOverride && !canOverridePrice) { setError('You do not have permission to change selling prices.'); return; }
    setSaving(true); setError(null);
    const clientReference = saleClientReference ?? createPosClientReference(); setSaleClientReference(clientReference);
    try {
      const currentTaxQuote = await loadSellerTrayTaxQuote(tenantId, subtotal);
      const currentTaxContext = taxContextFromQuote(currentTaxQuote);
      setTaxContext(currentTaxContext); setUsingCachedTax(false);
      await saveTaxContextCache(tenantId, currentTaxContext).catch(() => undefined);

      const latest = await loadBranchStock(tenantId, branch.id);
      setStockRows(latest); setUsingCachedStock(false); await saveBranchStockCache(tenantId, branch.id, latest).catch(() => undefined);
      const shortage = findStockShortage(cartLines, latest);
      if (shortage) throw new Error(`Not enough ${shortage.productName} at ${branch.name}. ${formatQuantity(shortage.available)} ${shortage.stockUom} is available; ${formatQuantity(shortage.required)} is needed.`);
      const orderId = await prepareGovernedPosDraft(draftInput(clientReference));
      setDraftOrderId(orderId); setStage('payment'); setNotice(null);
    } catch (cause) {
      if (isLikelyConnectivityError(cause)) {
        if (!posPolicy) {
          setError('Reconnect once to establish SellerTray POS payment settings before selling offline.');
        } else {
          setOfflinePaymentOpen(true);
          setNotice('SellerTray is offline. Use the cached Branch payment methods and POS controls below; the same server rules are re-checked when this sale reconnects.');
        }
      } else setError(sellerTrayUserMessage(cause, 'This sale could not be prepared. Please try again.'));
    } finally { setSaving(false); }
  }

  async function completeCash() {
    if (!draftOrderId || completing) return;
    const orderId = draftOrderId; setCompleting(true); setError(null);
    try {
      const result = await completePosSale(tenantId, orderId, null);
      if (result.status !== 'completed') throw new Error('Cash sale did not complete.');
      clearSale(); onDraftCreated?.(orderId);
    } catch (cause) { setError(sellerTrayUserMessage(cause, 'This cash sale could not be completed.')); }
    finally { setCompleting(false); }
  }

  async function handleAllocatedCheckout(result: PosAllocationCheckoutResult) {
    const orderId = result.orderId; clearSale();
    if (result.status === 'awaiting_payment_confirmation') setNotice('Payment recorded and awaiting confirmation. Stock remains unchanged until payment is confirmed.');
    else if (result.outstandingAmount > 0.005) setNotice(`${formatMoney(result.outstandingAmount, currency)} remains outstanding on this sale.`);
    onDraftCreated?.(orderId);
  }

  function clearSale() { setCart({}); setQuantityDrafts({}); setPriceDrafts({}); setCustomer(null); setDraftOrderId(null); setSaleClientReference(null); setOfflinePaymentOpen(false); setStage('products'); setError(null); }

  function handleBarcode(barcode: string) {
    const clean = barcode.trim(); const match = products.flatMap((product) => product.uoms.map((uom) => ({ product, uom }))).find(({ uom }) => uom.barcode?.trim() === clean);
    if (match) setSelectedUomByProduct((current) => ({ ...current, [match.product.id]: match.uom.id }));
    setQuery(clean); setScannerOpen(false);
  }

  if (loading) return <View style={styles.empty}><ActivityIndicator /><Text style={[styles.muted, dark && darkStyles.body]}>Loading selling workspace…</Text></View>;
  if (accessSubject !== `${tenantId}:${branch.id}:${actorUserId}`) return <View style={styles.stack}><Notice text="Preparation mode — selling becomes available after SellerTray confirms your Business is ready." /><ErrorCard text={error ?? 'Connect to refresh setup and plan access.'} /><Pressable accessibilityRole="button" onPress={() => setAccessRevision((n) => n + 1)} style={styles.iconButton}><Text style={[styles.muted, dark && darkStyles.body]}>Check selling access</Text></Pressable></View>;

  return <View style={styles.stack}>
    <BarcodeScannerSheet visible={scannerOpen} onClose={() => setScannerOpen(false)} onBarcode={handleBarcode} />
    <View><Text style={[styles.eyebrow, dark && darkStyles.body]}>SELL · {stage.toUpperCase()}</Text><Text style={[styles.title, dark && darkStyles.title]}>{stage === 'products' ? 'New Sale' : stage === 'cart' ? 'Review Cart' : 'Take Payment'}</Text><Text style={[styles.muted, dark && darkStyles.body]}>Selling from {branch.name}</Text></View>
    {usingSavedData ? <Notice text="Offline-ready data is in use. Cached Branch payment methods and POS controls remain available; non-cash payments retain their governed confirmation rules." warning /> : null}
    {notice ? <Notice text={notice} /> : null}
    {error ? <ErrorCard text={error} /> : null}

    {stage === 'products' ? <>
      <View style={styles.catalogueToolbar}>
        <View style={[styles.search, styles.searchGrow, dark && darkStyles.card]}>
          <Ionicons name="search-outline" size={20} color={dark ? theme.dark.textSubtle : theme.colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search product, SKU or barcode" placeholderTextColor={theme.colors.subtle} style={[styles.searchInput, dark && darkStyles.title]} />
          <Pressable onPress={() => setScannerOpen(true)} style={styles.iconButton}><Ionicons name="barcode-outline" size={22} color={dark ? theme.dark.accentText : theme.colors.greenDark} /></Pressable>
        </View>
        <View style={[styles.viewToggle, dark && darkStyles.card]}>
          <Pressable accessibilityLabel="Tile view" onPress={() => setCatalogueView('grid')} style={[styles.viewButton, catalogueView === 'grid' && (dark ? darkStyles.viewButtonActive : styles.viewButtonActive)]}><Ionicons name="grid-outline" size={18} color={catalogueView === 'grid' ? (dark ? theme.dark.accentText : theme.colors.greenDark) : (dark ? theme.dark.textSubtle : theme.colors.muted)} /></Pressable>
          <Pressable accessibilityLabel="List view" onPress={() => setCatalogueView('list')} style={[styles.viewButton, catalogueView === 'list' && (dark ? darkStyles.viewButtonActive : styles.viewButtonActive)]}><Ionicons name="list-outline" size={20} color={catalogueView === 'list' ? (dark ? theme.dark.accentText : theme.colors.greenDark) : (dark ? theme.dark.textSubtle : theme.colors.muted)} /></Pressable>
        </View>
      </View>
      <View style={catalogueView === 'grid' ? styles.productGrid : styles.productList}>{visibleProducts.map((product) => {
        const uom = selectedUom(product);
        const available = stockByProduct.get(product.id)?.quantityOnHand ?? 0;
        const remaining = Math.max(0, available - stockInCart(product.id));
        const outOfStock = remaining <= STOCK_EPSILON;
        const addDisabled = outOfStock || !uom || uom.sellingPrice == null;
        return <View key={product.id} style={[
          styles.card,
          catalogueView === 'grid' && styles.productTile,
          dark && darkStyles.card,
          outOfStock && (dark ? darkStyles.unavailableCard : styles.productUnavailable),
        ]}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text numberOfLines={2} style={[styles.productName, dark && darkStyles.title, outOfStock && (dark ? darkStyles.unavailableText : styles.unavailableText)]}>{product.name}</Text>
              <Text style={[styles.muted, dark && darkStyles.body, outOfStock && (dark ? darkStyles.unavailableText : styles.unavailableText)]}>{outOfStock ? 'Out of stock' : `${formatQuantity(remaining)} ${product.stockUom} available`}</Text>
            </View>
            {catalogueView === 'list' ? <Text style={[styles.price, dark && darkStyles.title, outOfStock && (dark ? darkStyles.unavailableText : styles.unavailableText)]}>{uom?.sellingPrice == null ? 'No price' : formatMoney(uom.sellingPrice, currency)}</Text> : null}
          </View>
          {catalogueView === 'grid' ? <Text style={[styles.tilePrice, dark && darkStyles.title, outOfStock && (dark ? darkStyles.unavailableText : styles.unavailableText)]}>{uom?.sellingPrice == null ? 'No price' : formatMoney(uom.sellingPrice, currency)}</Text> : null}
          <View style={styles.chips}>{product.uoms.map((candidate) => {
            const selected = candidate.id === uom?.id;
            return <Pressable
              key={candidate.id}
              onPress={() => setSelectedUomByProduct((current) => ({ ...current, [product.id]: candidate.id }))}
              style={[
                styles.chip,
                dark && darkStyles.chip,
                selected && (dark ? darkStyles.chipActive : styles.chipActive),
                outOfStock && (dark ? darkStyles.chipUnavailable : styles.chipUnavailable),
              ]}
            >
              <Text numberOfLines={1} style={[
                styles.chipText,
                dark && darkStyles.chipText,
                selected && dark && darkStyles.chipTextActive,
                outOfStock && (dark ? darkStyles.unavailableText : styles.unavailableText),
              ]}>{candidate.name}</Text>
            </Pressable>;
          })}</View>
          <Pressable disabled={addDisabled} onPress={() => addToCart(product)} style={[styles.primary, styles.addButton, addDisabled && styles.disabled]}><Ionicons name={outOfStock ? 'ban-outline' : 'add'} size={18} color={theme.colors.white} /><Text style={styles.primaryText}>{outOfStock ? 'Out of stock' : 'Add'}</Text></Pressable>
        </View>;
      })}</View>
      {cartLines.length ? <Pressable onPress={() => setStage('cart')} style={styles.checkout}><View><Text style={styles.primaryText}>{cartLines.length} product{cartLines.length === 1 ? '' : 's'} · {formatQuantity(unitCount)} units</Text><Text style={styles.checkoutTotal}>{formatMoney(total, currency)}</Text></View><Ionicons name="arrow-forward" size={22} color={theme.colors.white} /></Pressable> : null}
    </> : null}

    {stage === 'cart' ? <>
      <Pressable onPress={() => { setOfflinePaymentOpen(false); setStage('products'); }} style={styles.back}><Ionicons name="arrow-back" size={18} color={dark ? theme.dark.accentText : theme.colors.greenDark} /><Text style={[styles.backText, dark && darkStyles.backText]}>Products</Text></Pressable>
      <View style={[styles.card, dark && darkStyles.card]}>{cartLines.map((line) => <View key={line.key} style={[styles.cartLine, dark && darkStyles.subtleCard]}>
        <View style={styles.flex}>
          <Text style={[styles.productName, dark && darkStyles.title]}>{line.product.name}</Text>
          <Text style={[styles.muted, dark && darkStyles.body]}>{line.uom.name} · configured {formatMoney(line.uom.sellingPrice ?? 0, currency)}</Text>
          <View style={styles.editRow}>
            <View>
              <Text style={[styles.fieldLabel, dark && darkStyles.fieldLabel]}>Quantity</Text>
              <TextInput
                keyboardType="decimal-pad"
                value={quantityDrafts[line.key] ?? formatQuantity(line.quantity)}
                onChangeText={(value) => setQuantityDrafts((current) => ({ ...current, [line.key]: value.replace(/[^0-9.]/g, '') }))}
                onEndEditing={() => { const value = Number(quantityDrafts[line.key] ?? line.quantity); if (!setQuantity(line, value)) setQuantityDrafts((current) => ({ ...current, [line.key]: formatQuantity(line.quantity) })); }}
                style={[styles.editInput, dark && darkStyles.input]}
              />
            </View>
            <View>
              <Text style={[styles.fieldLabel, dark && darkStyles.fieldLabel]}>Unit price</Text>
              <TextInput
                editable={canOverridePrice && !draftOrderId}
                keyboardType="decimal-pad"
                value={priceDrafts[line.key] ?? formatEditablePrice(line.sellingPrice)}
                onChangeText={(value) => setPrice(line, value)}
                onEndEditing={() => commitPrice(line)}
                style={[
                  styles.priceInput,
                  dark && darkStyles.input,
                  !canOverridePrice && styles.readOnly,
                  dark && !canOverridePrice && darkStyles.readOnly,
                ]}
              />
            </View>
          </View>
          {canOverridePrice
            ? <Text style={[styles.permissionText, dark && darkStyles.body]}>Price can be changed for this sale.</Text>
            : <Text style={[styles.permissionText, dark && darkStyles.body]}>Configured price applies. Price changes require authorised access.</Text>}
        </View>
        <View style={styles.lineTotal}><Text style={[styles.price, dark && darkStyles.title]}>{formatMoney(line.quantity * line.sellingPrice, currency)}</Text><Pressable onPress={() => setQuantity(line, 0)}><Ionicons name="trash-outline" size={20} color={theme.colors.danger} /></Pressable></View>
      </View>)}</View>
      <PosCustomerSelector tenantId={tenantId} value={customer} disabled={saving} onChange={setCustomer} />
      <View style={[styles.summary, dark && darkStyles.card]}><View><Text style={[styles.productName, dark && darkStyles.title]}>Sale total</Text>{taxQuote.taxApplied ? <Text style={[styles.muted, dark && darkStyles.body]}>Subtotal {formatMoney(subtotal, currency)} · Tax {formatMoney(taxQuote.taxAmount, currency)} ({formatRate(taxQuote.ratePercent)}%)</Text> : null}</View><Text style={[styles.summaryTotal, dark && darkStyles.title]}>{formatMoney(total, currency)}</Text></View>
      {offlinePaymentOpen && posPolicy ? <OfflinePosPaymentAllocator
        amountDue={total}
        currency={currency}
        paymentMethods={paymentMethods}
        policy={posPolicy}
        disabled={saving}
        onQueue={(plan) => queueOfflinePaymentSale(saleClientReference ?? createPosClientReference(), plan)}
        onCancel={() => { setOfflinePaymentOpen(false); setNotice(null); setError(null); }}
        onError={(message) => setError(message)}
      /> : null}
      {!offlinePaymentOpen ? <Pressable disabled={saving || !cartLines.length} onPress={() => void continueToPayment()} style={[styles.primary, (saving || !cartLines.length) && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="card-outline" size={19} color={theme.colors.white} />}<Text style={styles.primaryText}>{saving ? 'Preparing sale…' : 'Continue to payment'}</Text></Pressable> : null}
    </> : null}

    {stage === 'payment' && draftOrderId ? <>
      <View style={[styles.summary, dark && darkStyles.card]}><View><Text style={[styles.productName, dark && darkStyles.title]}>Amount due</Text>{taxQuote.taxApplied ? <Text style={[styles.muted, dark && darkStyles.body]}>Subtotal {formatMoney(subtotal, currency)} · Tax {formatMoney(taxQuote.taxAmount, currency)}</Text> : null}</View><Text style={[styles.summaryTotal, dark && darkStyles.title]}>{formatMoney(total, currency)}</Text></View>
      {posPolicy ? <PosPaymentAllocator tenantId={tenantId} orderId={draftOrderId} amountDue={total} currency={currency} paymentMethods={paymentMethods} policy={posPolicy} disabled={completing} onResult={(result) => void handleAllocatedCheckout(result)} onError={(message) => setError(message || null)} /> : <Pressable disabled={completing} onPress={() => Alert.alert('Confirm cash payment', `Confirm ${formatMoney(total, currency)} cash has been received.`, [{ text: 'Not yet', style: 'cancel' }, { text: 'Payment confirmed', onPress: () => void completeCash() }])} style={styles.primary}><Text style={styles.primaryText}>Complete cash sale</Text></Pressable>}
      <Pressable onPress={() => onDraftCreated?.(draftOrderId)} style={[styles.secondary, dark && darkStyles.secondary]}><Text style={[styles.backText, dark && darkStyles.backText]}>Save and open sale</Text></Pressable>
    </> : null}
  </View>;
}

async function confirmOperationalAccess(tenantId: string, actorUserId: string): Promise<void> {
  try {
    const access = await loadSubscriptionAccess(tenantId);
    if (access.accessMode !== 'full') throw new Error('Complete Business setup and payment before starting live sales.');
  } catch (error) {
    if (!isLikelyConnectivityError(error)) throw error;
    await assertCachedOperationalAccess(tenantId, actorUserId);
  }
}
async function loadProductsWithCache(tenantId: string) { try { const data = await loadCommerceProducts(tenantId); await saveCommerceProductCache(tenantId, data).catch(() => undefined); return { data, cached: false }; } catch (error) { if (!isLikelyConnectivityError(error)) throw error; const cached = await loadCommerceProductCache(tenantId); if (!cached) throw error; return { data: cached.data, cached: true }; } }
async function loadStockWithCache(tenantId: string, branchId: string) { try { const data = await loadBranchStock(tenantId, branchId); await saveBranchStockCache(tenantId, branchId, data).catch(() => undefined); return { data, cached: false }; } catch (error) { if (!isLikelyConnectivityError(error)) throw error; const cached = await loadBranchStockCache(tenantId, branchId); if (!cached) throw error; return { data: cached.data, cached: true }; } }
async function loadPaymentsWithCache(tenantId: string, branchId: string) { try { const data = await loadBranchPosPaymentMethods(tenantId, branchId); await savePosPaymentMethodsCache(tenantId, branchId, data).catch(() => undefined); return { data, cached: false }; } catch (error) { if (!isLikelyConnectivityError(error)) throw error; const cached = await loadPosPaymentMethodsCache(tenantId, branchId); return { data: cached?.data ?? [cashFallback()], cached: true }; } }
async function loadPolicyWithCache(tenantId: string) { try { const data = await loadPosPaymentPolicy(tenantId); await savePosPolicyCache(tenantId, data).catch(() => undefined); return { data, cached: false }; } catch (error) { if (!isLikelyConnectivityError(error)) throw error; const cached = await loadPosPolicyCache(tenantId); if (!cached) throw new Error('Reconnect once to establish POS permissions before selling offline.'); return { data: cached.data, cached: true }; } }
async function loadTaxWithCache(tenantId: string) { try { const quote = await loadSellerTrayTaxQuote(tenantId, 0); const data = taxContextFromQuote(quote); await saveTaxContextCache(tenantId, data).catch(() => undefined); return { data, cached: false }; } catch (error) { if (!isLikelyConnectivityError(error)) throw error; const cached = await loadTaxContextCache(tenantId); if (!cached) throw new Error('Reconnect once to establish tax settings before selling offline.'); return { data: cached.data, cached: true }; } }

function findStockShortage(lines: CartLine[], stock: BranchStockRow[]): StockShortage | null { const available = new Map(stock.map((row) => [row.catalogItemId, row.quantityOnHand])); const required = new Map<string, number>(); for (const line of lines) required.set(line.product.id, (required.get(line.product.id) ?? 0) + line.quantity * line.uom.conversionFactor); for (const [id, quantity] of required) { const onHand = available.get(id) ?? 0; if (quantity > onHand + STOCK_EPSILON) { const line = lines.find((entry) => entry.product.id === id)!; return { productName: line.product.name, stockUom: line.product.stockUom, required: quantity, available: onHand }; } } return null; }
function cashFallback(): PosPaymentMethod { return { paymentMethodId: null, methodType: 'cash', displayName: 'Cash', sortOrder: 0, isDefault: true, bankName: null, bankAccountName: null, bankAccountNumber: null, instructions: null }; }
function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function formatMoney(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
function formatRate(value: number) { return Number(value.toFixed(6)).toString(); }
function formatQuantity(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''); }
function formatEditablePrice(value: number) { return Number(value.toFixed(2)).toString(); }
function Notice({ text, warning = false }: { text: string; warning?: boolean }) { return <View style={[styles.notice, warning && styles.warning]}><Ionicons name={warning ? 'cloud-offline-outline' : 'information-circle-outline'} size={20} color={warning ? theme.colors.warning : theme.colors.info} /><Text style={styles.noticeText}>{text}</Text></View>; }
function ErrorCard({ text }: { text: string }) { return <View style={styles.errorCard}><Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} /><Text style={styles.errorText}>{text}</Text></View>; }

const styles = StyleSheet.create({
  stack: { gap: 14 },
  catalogueToolbar: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchGrow: { flex: 1 },
  viewToggle: { flexDirection: 'row', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, padding: 3 },
  viewButton: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  viewButtonActive: { backgroundColor: theme.colors.mintSoft },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  productList: { gap: 10 },
  productTile: { width: '48%', minWidth: 0, justifyContent: 'space-between' },
  tilePrice: { color: theme.colors.navy, fontSize: 16, fontWeight: '900' },
  addButton: { minHeight: 42 },
  productUnavailable: { backgroundColor: '#F2F4F7', borderColor: '#D0D5DD' },
  unavailableText: { color: '#98A2B3' },
  chipUnavailable: { backgroundColor: '#EAECF0', borderColor: '#D0D5DD' },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: theme.colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
  search: { minHeight: 52, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 50, color: theme.colors.navy },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 10 },
  productName: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  price: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 30, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.pill, paddingHorizontal: 9, justifyContent: 'center' },
  chipActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  chipText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  primary: { minHeight: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  primaryText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  checkout: { minHeight: 66, borderRadius: theme.radius.lg, backgroundColor: theme.colors.green, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkoutTotal: { color: theme.colors.white, fontSize: 20, fontWeight: '900' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36 },
  backText: { color: theme.colors.greenDark, fontWeight: '900', fontSize: 12 },
  cartLine: { backgroundColor: theme.colors.cloud, borderRadius: theme.radius.md, padding: 11, flexDirection: 'row', gap: 8 },
  editRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  fieldLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '800', marginBottom: 3 },
  editInput: { width: 72, minHeight: 40, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, backgroundColor: theme.colors.white, color: theme.colors.navy, textAlign: 'center' },
  priceInput: { width: 112, minHeight: 40, borderWidth: 1, borderColor: theme.colors.green, borderRadius: 10, backgroundColor: theme.colors.white, color: theme.colors.navy, textAlign: 'right', paddingHorizontal: 9 },
  readOnly: { borderColor: theme.colors.border, backgroundColor: theme.colors.cloud },
  permissionText: { color: theme.colors.muted, fontSize: 10, marginTop: 5 },
  lineTotal: { alignItems: 'flex-end', gap: 10 },
  summary: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  summaryTotal: { color: theme.colors.navy, fontSize: 24, fontWeight: '900' },
  secondary: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  notice: { borderRadius: theme.radius.md, backgroundColor: '#EFF8FF', padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  warning: { backgroundColor: '#FFFAEB' },
  noticeText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 11, flexDirection: 'row', gap: 8 },
  errorText: { flex: 1, color: '#B42318', fontSize: 11, lineHeight: 17 },
  empty: { minHeight: 150, justifyContent: 'center', alignItems: 'center', gap: 8 },
  disabled: { opacity: 0.45 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  subtleCard: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.border },
  title: { color: theme.dark.text },
  body: { color: theme.dark.textMuted },
  fieldLabel: { color: theme.dark.textMuted },
  input: { backgroundColor: theme.dark.surfaceRaised, borderColor: theme.dark.borderStrong, color: theme.dark.text },
  readOnly: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.border },
  secondary: { borderColor: theme.dark.borderStrong },
  backText: { color: theme.dark.accentText },
  viewButtonActive: { backgroundColor: theme.dark.accentSoft },
  chip: { borderColor: theme.dark.borderStrong },
  chipActive: { backgroundColor: theme.dark.accentSoft, borderColor: theme.colors.green },
  chipText: { color: theme.dark.textMuted },
  chipTextActive: { color: theme.dark.accentText },
  unavailableCard: { backgroundColor: theme.dark.surfaceRaised, borderColor: theme.dark.border },
  unavailableText: { color: theme.dark.textSubtle },
  chipUnavailable: { backgroundColor: theme.dark.surfaceRaised, borderColor: theme.dark.border },
});
