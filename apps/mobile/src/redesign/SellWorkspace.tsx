import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  completePosCashSale,
  createPosDraft,
  loadCommerceProducts,
  type CommerceBranch,
  type CommerceProduct,
  type CommerceUom,
} from '../data/commerceRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type CartLine = {
  key: string;
  product: CommerceProduct;
  uom: CommerceUom;
  quantity: number;
};

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  currency: string;
  onDraftCreated?: (orderId: string) => void;
};

export function SellWorkspace({ tenantId, branch, currency, onDraftCreated }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedUomByProduct, setSelectedUomByProduct] = useState<Record<string, string>>({});
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [draftOrderId, setDraftOrderId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadCommerceProducts(tenantId)
      .then((rows) => {
        if (!active) return;
        setProducts(rows);
      })
      .catch((err) => {
        if (!active) return;
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
    setCheckoutError(null);
  }, [branch.id]);

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

  const cartLines = Object.values(cart);
  const itemCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const total = cartLines.reduce(
    (sum, line) => sum + line.quantity * (line.uom.sellingPrice ?? 0),
    0,
  );
  const checkoutLocked = Boolean(draftOrderId);

  function selectedUom(product: CommerceProduct): CommerceUom | null {
    const selectedId = selectedUomByProduct[product.id];
    return product.uoms.find((uom) => uom.id === selectedId)
      ?? product.uoms.find((uom) => uom.isDefaultSelling)
      ?? product.uoms[0]
      ?? null;
  }

  function chooseUom(productId: string, uomId: string) {
    if (checkoutLocked) return;
    setSelectedUomByProduct((current) => ({ ...current, [productId]: uomId }));
  }

  function addToCart(product: CommerceProduct) {
    if (checkoutLocked) return;
    const uom = selectedUom(product);
    if (!uom || uom.sellingPrice === null) return;
    const key = `${product.id}:${uom.id}`;
    setCheckoutError(null);
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
    if (checkoutLocked) return;
    setCheckoutError(null);
    setCart((current) => {
      const existing = current[line.key];
      if (!existing) return current;
      const step = existing.uom.allowFractional ? 0.5 : 1;
      const next = Math.max(0, existing.quantity + delta * step);
      if (next <= 0) {
        const copy = { ...current };
        delete copy[line.key];
        return copy;
      }
      return { ...current, [line.key]: { ...existing, quantity: next } };
    });
  }

  async function saveForCheckout() {
    if (saving || completing || checkoutLocked || cartLines.length === 0) return;
    setSaving(true);
    setCheckoutError(null);
    try {
      const orderId = await createPosDraft({
        tenantId,
        branchId: branch.id,
        items: cartLines.map((line) => ({
          catalogItemId: line.product.id,
          uomId: line.uom.id,
          quantity: line.quantity,
        })),
      });
      setDraftOrderId(orderId);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Unable to prepare this sale.');
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
    onDraftCreated?.(orderId);
  }

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SELL</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>New Sale</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Selling from {branch.name}. Prices follow the unit selected for each product.
        </Text>
      </View>

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
          const canAdd = Boolean(uom && uom.sellingPrice !== null && !checkoutLocked);
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
                  {uom?.sellingPrice === null || !uom
                    ? 'No price'
                    : formatMoney(uom.sellingPrice, currency)}
                </Text>
              </View>

              {product.uoms.length > 0 ? (
                <View style={styles.uomRow}>
                  {product.uoms.map((candidate) => (
                    <Pressable
                      key={candidate.id}
                      disabled={checkoutLocked}
                      onPress={() => chooseUom(product.id, candidate.id)}
                      style={[
                        styles.uomChip,
                        dark && darkStyles.outlineButton,
                        candidate.id === uom?.id && styles.uomChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.uomChipText,
                          dark && darkStyles.bodyText,
                          candidate.id === uom?.id && styles.uomChipTextActive,
                        ]}
                      >
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
                </Text>
              ) : null}

              <Pressable
                disabled={!canAdd}
                onPress={() => addToCart(product)}
                style={({ pressed }) => [
                  styles.addButton,
                  !canAdd && styles.disabledButton,
                  pressed && canAdd && styles.pressed,
                ]}
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
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>
            Add products above to start the sale.
          </Text>
        ) : (
          <View style={styles.cartLines}>
            {cartLines.map((line) => (
              <View key={line.key} style={[styles.cartLine, dark && darkStyles.subtleCard]}>
                <View style={styles.cartLineCopy}>
                  <Text style={[styles.cartLineName, dark && darkStyles.titleText]}>{line.product.name}</Text>
                  <Text style={[styles.cartLineMeta, dark && darkStyles.bodyText]}>
                    {line.uom.name} · {formatQuantity(line.quantity * line.uom.conversionFactor)} {line.product.stockUom} stock quantity
                  </Text>
                  <Text style={[styles.cartLinePrice, dark && darkStyles.titleText]}>
                    {formatMoney(line.quantity * (line.uom.sellingPrice ?? 0), currency)}
                  </Text>
                </View>
                <View style={styles.quantityControls}>
                  <Pressable disabled={checkoutLocked} onPress={() => changeQuantity(line, -1)} style={[styles.quantityButton, checkoutLocked && styles.disabledButton]}>
                    <Ionicons name="remove" size={18} color={theme.colors.navy} />
                  </Pressable>
                  <Text style={[styles.quantityValue, dark && darkStyles.titleText]}>{formatQuantity(line.quantity)}</Text>
                  <Pressable disabled={checkoutLocked} onPress={() => changeQuantity(line, 1)} style={[styles.quantityButton, checkoutLocked && styles.disabledButton]}>
                    <Ionicons name="add" size={18} color={theme.colors.navy} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {draftOrderId ? (
          <View style={[styles.savedCheckoutCard, dark && darkStyles.subtleCard]}>
            <View style={styles.savedCheckoutIcon}>
              <Ionicons name="checkmark-circle-outline" size={22} color={theme.colors.greenDark} />
            </View>
            <View style={styles.savedCheckoutCopy}>
              <Text style={[styles.savedCheckoutTitle, dark && darkStyles.titleText]}>Sale saved for checkout</Text>
              <Text style={[styles.checkoutNoticeText, dark && darkStyles.bodyText]}>
                Items and prices are now locked. Confirm cash only after the full amount has been received.
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.checkoutNotice, dark && darkStyles.subtleCard]}>
            <Ionicons name="information-circle-outline" size={20} color={theme.colors.info} />
            <Text style={[styles.checkoutNoticeText, dark && darkStyles.bodyText]}>
              Saving prepares this sale for checkout. Payment and stock remain unchanged until checkout is completed.
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
            disabled={cartLines.length === 0 || saving || completing}
            onPress={() => void saveForCheckout()}
            style={({ pressed }) => [
              styles.checkoutButton,
              (cartLines.length === 0 || saving || completing) && styles.disabledButton,
              pressed && cartLines.length > 0 && !saving && !completing && styles.pressed,
            ]}
          >
            {saving ? <ActivityIndicator color={theme.colors.white} /> : null}
            <Text style={styles.checkoutButtonText}>{saving ? 'Saving…' : 'Save for checkout'}</Text>
            {!saving ? <Ionicons name="arrow-forward" size={19} color={theme.colors.white} /> : null}
          </Pressable>
        ) : (
          <View style={styles.checkoutActions}>
            <Pressable
              disabled={completing}
              onPress={confirmCashReceived}
              style={({ pressed }) => [
                styles.checkoutButton,
                completing && styles.disabledButton,
                pressed && !completing && styles.pressed,
              ]}
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
  searchBox: { minHeight: 52, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, paddingLeft: 13, paddingRight: 5, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 50, color: theme.colors.navy, fontSize: 14, paddingVertical: 0 },
  scanButton: { width: 43, height: 43, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 12, flexDirection: 'row', gap: 9 },
  errorText: { flex: 1, color: '#912018', fontSize: 12, lineHeight: 18 },
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
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});
