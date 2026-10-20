import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { SellerTraySelectField } from '../components/SellerTraySelectField';
import { SellerTrayText as Text } from '../components/SellerTrayText';
import { SellerTrayTextInput } from '../components/SellerTrayTextInput';
import type { CommerceProduct } from '../data/commerceRepository';
import {
  isLikelyConnectivityError,
  loadCommerceProductCache,
  saveCommerceProductCache,
} from '../data/offlineSalesRepository';
import {
  assignStockUomBarcode,
  createBusinessUom,
  createProductCategory,
  loadCatalogueMasterData,
  loadManagedProducts,
  saveManagedProduct,
  setManagedProductActive,
  type CatalogueMasterData,
  type MobileProductDraft,
} from '../data/productManagementRepository';
import { sellerTrayUserMessage } from '../data/userFacingError';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { BarcodeScannerSheet } from './BarcodeScannerSheet';

type Props = { tenantId: string; currency: string; onClose: () => void };
type EditorState = { product: CommerceProduct | null; barcode: string };

const EMPTY: MobileProductDraft = {
  name: '',
  sku: null,
  category: null,
  stockUom: 'Each',
  allowFractionalStock: false,
  sellingPrice: 0,
};

const EMPTY_MASTERS: CatalogueMasterData = { categories: [], uoms: [] };

export function ProductManagementWorkspace({ tenantId, currency, onClose }: Props) {
  const dark = useSellerTrayAppearance().dark;
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [masters, setMasters] = useState<CatalogueMasterData>(EMPTY_MASTERS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draft, setDraft] = useState<MobileProductDraft>(EMPTY);
  const [price, setPrice] = useState('0');
  const [scannerOpen, setScannerOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [next, nextMasters] = await Promise.all([
        loadManagedProducts(tenantId),
        loadCatalogueMasterData(tenantId),
      ]);
      setProducts(next);
      setMasters(nextMasters);
      setReadOnly(false);
      await saveCommerceProductCache(tenantId, next).catch(() => undefined);
    } catch (cause) {
      if (isLikelyConnectivityError(cause)) {
        const cached = await loadCommerceProductCache(tenantId);
        if (cached) {
          setProducts(cached.data);
          setMasters(EMPTY_MASTERS);
          setReadOnly(true);
          setNotice('Offline: showing saved products. Connect to add or change products.');
          return;
        }
      }
      setError(sellerTrayUserMessage(cause, 'Products are unavailable right now.'));
    } finally {
      setLoading(false);
    }
  }

  async function refreshMasters() {
    const next = await loadCatalogueMasterData(tenantId);
    setMasters(next);
  }

  useEffect(() => {
    void refresh();
  }, [tenantId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) =>
      (showInactive || product.isActive)
      && (!needle || [product.name, product.sku ?? '', product.category ?? '', ...product.uoms.map((uom) => uom.barcode ?? '')]
        .join(' ')
        .toLowerCase()
        .includes(needle)),
    );
  }, [products, query, showInactive]);

  function begin(product: CommerceProduct | null, barcode = '') {
    if (readOnly) {
      setNotice('Connect to the internet to add or change products.');
      return;
    }
    setEditor({ product, barcode });
    setError(null);
    setNotice(null);
    if (!product) {
      const defaultUom = masters.uoms.find((item) => item.name.toLowerCase() === 'each')?.name
        ?? masters.uoms[0]?.name
        ?? EMPTY.stockUom;
      setDraft({ ...EMPTY, stockUom: defaultUom });
      setPrice('0');
      return;
    }
    const selling = product.uoms.find((uom) => uom.isDefaultSelling)?.sellingPrice
      ?? product.uoms.find((uom) => uom.isStockUom)?.sellingPrice
      ?? 0;
    setDraft({
      name: product.name,
      sku: product.sku,
      category: product.category,
      stockUom: product.stockUom,
      allowFractionalStock: product.allowFractionalStock,
      sellingPrice: selling ?? 0,
    });
    setPrice(String(selling ?? 0));
  }

  function handleBarcode(rawBarcode: string) {
    setScannerOpen(false);
    const barcode = rawBarcode.trim();
    if (!barcode) {
      setError('The scanned barcode is empty. Try scanning again.');
      return;
    }
    const match = products.find((product) => product.uoms.some((uom) => uom.barcode?.trim() === barcode));
    if (match) {
      begin(match, barcode);
      if (!readOnly) setNotice(`Barcode matched ${match.name}.`);
      return;
    }
    if (readOnly) {
      setNotice('This barcode is not in the saved catalogue. Connect to add a new product.');
      return;
    }
    begin(null, barcode);
    setNotice('Barcode captured. Add the product details to finish creating it.');
  }

  async function addCategory(name: string) {
    await createProductCategory(tenantId, name);
    await refreshMasters();
  }

  async function addUom(name: string) {
    await createBusinessUom(tenantId, name);
    await refreshMasters();
  }

  async function save() {
    if (!editor || saving || readOnly) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const productId = await saveManagedProduct(tenantId, editor.product?.id ?? null, {
        ...draft,
        sellingPrice: Number(price),
      });
      let next = await loadManagedProducts(tenantId);
      const saved = next.find((product) => product.id === productId);
      if (!saved) throw new Error('SellerTray could not reload the saved product.');

      if (editor.barcode && !saved.uoms.some((uom) => uom.barcode?.trim() === editor.barcode.trim())) {
        const conflict = next.find((product) =>
          product.id !== saved.id && product.uoms.some((uom) => uom.barcode?.trim() === editor.barcode.trim()),
        );
        if (conflict) throw new Error(`This barcode is already linked to ${conflict.name}.`);
        await assignStockUomBarcode(tenantId, saved, editor.barcode);
        next = await loadManagedProducts(tenantId);
      }

      const wasEdit = Boolean(editor.product);
      setEditor(null);
      setProducts(next);
      setReadOnly(false);
      await saveCommerceProductCache(tenantId, next).catch(() => undefined);
      setNotice(wasEdit ? 'Product updated.' : 'Product created. Stock was not changed.');
    } catch (cause) {
      setError(sellerTrayUserMessage(cause, 'Unable to save this product.'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!editor?.product || saving || readOnly) return;
    const wasActive = editor.product.isActive;
    setSaving(true);
    setError(null);
    try {
      await setManagedProductActive(tenantId, editor.product.id, !wasActive);
      setEditor(null);
      await refresh();
      setNotice(wasActive ? 'Product deactivated.' : 'Product activated.');
    } catch (cause) {
      setError(sellerTrayUserMessage(cause, 'Unable to change this product.'));
    } finally {
      setSaving(false);
    }
  }

  const priceLabel = currency.trim() ? `Selling price (${currency.trim()})` : 'Selling price';

  if (editor) {
    return (
      <View style={styles.stack}>
        <Pressable onPress={() => setEditor(null)} style={styles.back}>
          <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
          <Text style={styles.backText}>Products</Text>
        </Pressable>
        <View>
          <Text style={[styles.eyebrow, dark && darkStyles.body]}>PRODUCT</Text>
          <Text style={[styles.title, dark && darkStyles.title]}>{editor.product ? 'Edit product' : 'Add product'}</Text>
          <Text style={[styles.help, dark && darkStyles.body]}>
            Quick product details only. Advanced conversions, multiple barcodes and detailed pricing stay on Merchant Web.
          </Text>
        </View>
        {editor.barcode ? (
          <View style={[styles.barcodeCard, dark && darkStyles.card]}>
            <Ionicons name="barcode-outline" size={20} color={theme.colors.greenDark} />
            <Text style={[styles.body, dark && darkStyles.body]}>Barcode {editor.barcode} will be linked to the Stock UOM.</Text>
          </View>
        ) : null}
        <Field label="Product name">
          <SellerTrayTextInput value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} placeholder="Product name" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
        </Field>
        <Field label="SKU (optional)">
          <SellerTrayTextInput value={draft.sku ?? ''} onChangeText={(sku) => setDraft((current) => ({ ...current, sku }))} placeholder="SKU" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
        </Field>
        <SellerTraySelectField
          label="Category (optional)"
          value={draft.category}
          options={masters.categories}
          allowEmpty
          emptyLabel="No category"
          placeholder="Select category"
          createLabel="Add product category"
          onCreate={addCategory}
          onChange={(category) => setDraft((current) => ({ ...current, category }))}
        />
        <SellerTraySelectField
          label="Stock unit"
          value={draft.stockUom}
          options={masters.uoms}
          placeholder="Select unit"
          createLabel="Add Business unit"
          onCreate={addUom}
          onChange={(stockUom) => setDraft((current) => ({ ...current, stockUom: stockUom ?? current.stockUom }))}
        />
        {editor.product ? (
          <Text style={[styles.help, dark && darkStyles.body]}>
            SellerTray will reject a Stock UOM change when transaction history makes that change unsafe.
          </Text>
        ) : null}
        <Field label={priceLabel}>
          <SellerTrayTextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
        </Field>
        <Text style={[styles.help, dark && darkStyles.body]}>
          Creating or editing a product never adds stock. Receive, transfer, count or adjust stock through governed Inventory workflows.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable disabled={saving} onPress={() => void save()} style={[styles.primary, saving && styles.disabled]}>
          <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save product'}</Text>
        </Pressable>
        {editor.product ? (
          <Pressable disabled={saving} onPress={() => void toggleActive()} style={styles.secondary}>
            <Text style={styles.secondaryText}>{editor.product.isActive ? 'Deactivate product' : 'Activate product'}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={[styles.eyebrow, dark && darkStyles.body]}>INVENTORY</Text>
          <Text style={[styles.title, dark && darkStyles.title]}>Products</Text>
          <Text style={[styles.help, dark && darkStyles.body]}>Search, add and maintain everyday product details.</Text>
        </View>
        <Pressable onPress={onClose} style={styles.icon}>
          <Ionicons name="close" size={21} color={theme.colors.navy} />
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable disabled={readOnly} onPress={() => begin(null)} style={[styles.primarySmall, readOnly && styles.disabled]}>
          <Ionicons name="add" size={18} color={theme.colors.white} />
          <Text style={styles.primaryText}>Add product</Text>
        </Pressable>
        <Pressable onPress={() => setScannerOpen(true)} style={styles.secondarySmall}>
          <Ionicons name="barcode-outline" size={19} color={theme.colors.greenDark} />
          <Text style={styles.secondaryText}>Scan barcode</Text>
        </Pressable>
      </View>
      <SellerTrayTextInput value={query} onChangeText={setQuery} placeholder="Search name, SKU, category or barcode" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
      <Pressable onPress={() => setShowInactive((value) => !value)} style={styles.toggle}>
        <Ionicons name={showInactive ? 'checkbox' : 'square-outline'} size={20} color={theme.colors.greenDark} />
        <Text style={[styles.body, dark && darkStyles.body]}>Show inactive products</Text>
      </Pressable>
      {notice ? <Text style={readOnly ? styles.offlineNotice : styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <ActivityIndicator />
      ) : visible.length === 0 ? (
        <Text style={[styles.help, dark && darkStyles.body]}>No products found.</Text>
      ) : visible.map((product) => (
        <Pressable key={product.id} onPress={() => begin(product)} style={[styles.product, dark && darkStyles.card]}>
          <View style={styles.productCopy}>
            <Text style={[styles.productName, dark && darkStyles.title]}>{product.name}</Text>
            <Text style={[styles.help, dark && darkStyles.body]}>{[product.sku, product.category, product.stockUom].filter(Boolean).join(' · ')}</Text>
          </View>
          <Text style={product.isActive ? styles.activeText : styles.inactive}>{product.isActive ? 'Active' : 'Inactive'}</Text>
          <Ionicons name={readOnly ? 'eye-outline' : 'chevron-forward'} size={18} color={theme.colors.subtle} />
        </Pressable>
      ))}
      <BarcodeScannerSheet visible={scannerOpen} onClose={() => setScannerOpen(false)} onBarcode={handleBarcode} />
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  heading: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  headingCopy: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: theme.colors.muted },
  title: { fontSize: 25, fontWeight: '900', color: theme.colors.navy },
  help: { fontSize: 12, lineHeight: 18, color: theme.colors.muted },
  body: { fontSize: 13, color: theme.colors.slate },
  back: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  backText: { color: theme.colors.greenDark, fontWeight: '900' },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 8 },
  primarySmall: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: theme.colors.green, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  secondarySmall: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.green, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 50, borderRadius: 14, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: theme.colors.white, fontWeight: '900' },
  secondary: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.colors.greenDark, fontWeight: '900' },
  input: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 13, paddingHorizontal: 12, color: theme.colors.navy, backgroundColor: theme.colors.white },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '900', color: theme.colors.navy },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  product: { minHeight: 68, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 12, backgroundColor: theme.colors.white, flexDirection: 'row', alignItems: 'center', gap: 8 },
  productCopy: { flex: 1 },
  productName: { fontSize: 14, fontWeight: '900', color: theme.colors.navy },
  activeText: { fontSize: 10, fontWeight: '900', color: theme.colors.greenDark },
  inactive: { fontSize: 10, fontWeight: '900', color: theme.colors.muted },
  barcodeCard: { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.mintSoft, flexDirection: 'row', gap: 8, alignItems: 'center' },
  notice: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '800' },
  offlineNotice: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  error: { color: theme.colors.danger, fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  title: { color: theme.colors.cloud },
  body: { color: '#D0D5DD' },
  input: { backgroundColor: '#162F46', borderColor: '#344054', color: theme.colors.cloud },
});
