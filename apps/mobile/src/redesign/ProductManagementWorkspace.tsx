import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SellerTrayText as Text } from '../components/SellerTrayText';
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
  loadCatalogueMasters,
  loadManagedProducts,
  saveManagedProduct,
  setManagedProductActive,
  type CatalogueMasterOption,
  type CatalogueMasters,
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
const EMPTY_MASTERS: CatalogueMasters = { categories: [], uoms: [] };

export function ProductManagementWorkspace({ tenantId, currency, onClose }: Props) {
  const dark = useSellerTrayAppearance().dark;
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [masters, setMasters] = useState<CatalogueMasters>(EMPTY_MASTERS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [masterSaving, setMasterSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draft, setDraft] = useState<MobileProductDraft>(EMPTY);
  const [price, setPrice] = useState('0');
  const [newCategory, setNewCategory] = useState('');
  const [newUom, setNewUom] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [next, nextMasters] = await Promise.all([
        loadManagedProducts(tenantId),
        loadCatalogueMasters(tenantId),
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
          setMasters(deriveMasters(cached.data));
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
    setNewCategory('');
    setNewUom('');
    if (!product) {
      const defaultUom = masters.uoms.find((item) => item.name.trim().toLowerCase() === 'each')?.name
        ?? masters.uoms[0]?.name
        ?? 'Each';
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

  async function addCategory() {
    if (masterSaving || readOnly) return;
    setMasterSaving(true);
    setError(null);
    try {
      const created = await createProductCategory(tenantId, newCategory);
      const next = await loadCatalogueMasters(tenantId);
      setMasters(next);
      setDraft((current) => ({ ...current, category: created.name }));
      setNewCategory('');
      setNotice(`Category “${created.name}” created and selected.`);
    } catch (cause) {
      setError(sellerTrayUserMessage(cause, 'Unable to create this category.'));
    } finally {
      setMasterSaving(false);
    }
  }

  async function addUom() {
    if (masterSaving || readOnly || editor?.product) return;
    setMasterSaving(true);
    setError(null);
    try {
      const created = await createBusinessUom(tenantId, newUom);
      const next = await loadCatalogueMasters(tenantId);
      setMasters(next);
      setDraft((current) => ({ ...current, stockUom: created.name }));
      setNewUom('');
      setNotice(`Unit “${created.name}” created and selected.`);
    } catch (cause) {
      setError(sellerTrayUserMessage(cause, 'Unable to create this unit.'));
    } finally {
      setMasterSaving(false);
    }
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
      setMasters(await loadCatalogueMasters(tenantId));
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
            Categories and units use the same governed Business masters as Merchant Web. Advanced conversions, multiple barcodes and detailed pricing stay on Merchant Web.
          </Text>
        </View>
        {editor.barcode ? (
          <View style={[styles.barcodeCard, dark && darkStyles.card]}>
            <Ionicons name="barcode-outline" size={20} color={theme.colors.greenDark} />
            <Text style={[styles.body, dark && darkStyles.body]}>Barcode {editor.barcode} will be linked to the Stock UOM.</Text>
          </View>
        ) : null}
        <Field label="Product name">
          <TextInput value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} placeholder="Product name" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
        </Field>
        <Field label="SKU (optional)">
          <TextInput value={draft.sku ?? ''} onChangeText={(sku) => setDraft((current) => ({ ...current, sku }))} placeholder="SKU" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
        </Field>
        <Field label="Category (optional)">
          <MasterChoices
            options={masters.categories}
            selected={draft.category}
            onSelect={(category) => setDraft((current) => ({ ...current, category }))}
            allowNone
            dark={dark}
          />
          <MasterCreator value={newCategory} onChange={setNewCategory} onAdd={() => void addCategory()} placeholder="New category" disabled={masterSaving} dark={dark} />
        </Field>
        <Field label="Stock unit">
          {editor.product ? (
            <View style={[styles.readonlyBox, dark && darkStyles.input]}><Text style={[styles.body, dark && darkStyles.title]}>{draft.stockUom}</Text></View>
          ) : (
            <>
              <MasterChoices options={masters.uoms} selected={draft.stockUom} onSelect={(stockUom) => setDraft((current) => ({ ...current, stockUom }))} dark={dark} />
              <MasterCreator value={newUom} onChange={setNewUom} onAdd={() => void addUom()} placeholder="New unit, e.g. Carton" disabled={masterSaving} dark={dark} />
            </>
          )}
        </Field>
        <Field label={priceLabel}>
          <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
        </Field>
        <Text style={[styles.help, dark && darkStyles.body]}>
          Creating or editing a product never adds stock. Receive, transfer, count or adjust stock through governed Inventory workflows.
        </Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable disabled={saving || masterSaving} onPress={() => void save()} style={[styles.primary, (saving || masterSaving) && styles.disabled]}>
          <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save product'}</Text>
        </Pressable>
        {editor.product ? (
          <Pressable disabled={saving || masterSaving} onPress={() => void toggleActive()} style={styles.secondary}>
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
      <TextInput value={query} onChangeText={setQuery} placeholder="Search name, SKU, category or barcode" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
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

function MasterChoices({
  options,
  selected,
  onSelect,
  allowNone = false,
  dark,
}: {
  options: CatalogueMasterOption[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  allowNone?: boolean;
  dark: boolean;
}) {
  return <View style={styles.masterOptions}>
    {allowNone ? <Pressable onPress={() => onSelect(null)} style={[styles.masterChoice, !selected && styles.masterChoiceActive, dark && darkStyles.choice]}><Text style={[styles.masterChoiceText, !selected && styles.masterChoiceTextActive]}>No category</Text></Pressable> : null}
    {options.map((option) => {
      const active = (selected ?? '').trim().toLowerCase() === option.name.trim().toLowerCase();
      return <Pressable key={option.id} onPress={() => onSelect(option.name)} style={[styles.masterChoice, active && styles.masterChoiceActive, dark && darkStyles.choice]}>
        <Text style={[styles.masterChoiceText, active && styles.masterChoiceTextActive]}>{option.name}</Text>
      </Pressable>;
    })}
  </View>;
}

function MasterCreator({
  value,
  onChange,
  onAdd,
  placeholder,
  disabled,
  dark,
}: {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  placeholder: string;
  disabled: boolean;
  dark: boolean;
}) {
  return <View style={styles.masterCreator}>
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={theme.colors.subtle} style={[styles.input, styles.masterCreatorInput, dark && darkStyles.input]} />
    <Pressable disabled={disabled || !value.trim()} onPress={onAdd} style={[styles.masterAdd, (disabled || !value.trim()) && styles.disabled]}>
      <Ionicons name="add" size={18} color={theme.colors.greenDark} />
      <Text style={styles.secondaryText}>Create</Text>
    </Pressable>
  </View>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>;
}

function deriveMasters(products: CommerceProduct[]): CatalogueMasters {
  const categoryMap = new Map<string, string>();
  const uomMap = new Map<string, string>();
  for (const product of products) {
    if (product.category?.trim()) categoryMap.set(product.category.trim().toLowerCase(), product.category.trim());
    if (product.stockUom.trim()) uomMap.set(product.stockUom.trim().toLowerCase(), product.stockUom.trim());
    for (const uom of product.uoms) if (uom.name.trim()) uomMap.set(uom.name.trim().toLowerCase(), uom.name.trim());
  }
  return {
    categories: [...categoryMap.values()].sort().map((name) => ({ id: `cached-category-${name.toLowerCase()}`, name })),
    uoms: [...uomMap.values()].sort().map((name) => ({ id: `cached-uom-${name.toLowerCase()}`, name })),
  };
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
  readonlyBox: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 13, paddingHorizontal: 12, backgroundColor: theme.colors.cloud, justifyContent: 'center' },
  field: { gap: 8 },
  label: { fontSize: 12, fontWeight: '900', color: theme.colors.navy },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  product: { minHeight: 68, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 12, backgroundColor: theme.colors.white, flexDirection: 'row', alignItems: 'center', gap: 8 },
  productCopy: { flex: 1 },
  productName: { fontSize: 14, fontWeight: '900', color: theme.colors.navy },
  activeText: { fontSize: 10, fontWeight: '900', color: theme.colors.greenDark },
  inactive: { fontSize: 10, fontWeight: '900', color: theme.colors.muted },
  barcodeCard: { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.mintSoft, flexDirection: 'row', gap: 8, alignItems: 'center' },
  masterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  masterChoice: { minHeight: 38, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, justifyContent: 'center', backgroundColor: theme.colors.white },
  masterChoiceActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  masterChoiceText: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  masterChoiceTextActive: { color: theme.colors.greenDark },
  masterCreator: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  masterCreatorInput: { flex: 1 },
  masterAdd: { minHeight: 48, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1, borderColor: theme.colors.green, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center' },
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
  choice: { backgroundColor: '#162F46', borderColor: '#344054' },
});
