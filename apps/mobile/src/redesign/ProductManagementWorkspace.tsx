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
  loadManagedProducts,
  saveManagedProduct,
  setManagedProductActive,
  type MobileProductDraft,
} from '../data/productManagementRepository';
import { sellerTrayBackgroundError, sellerTrayUserMessage } from '../data/userFacingError';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { BarcodeScannerSheet } from './BarcodeScannerSheet';

type Props = { tenantId: string; currency: string; onClose: () => void };
type EditorState = { product: CommerceProduct | null; barcode: string };

const EMPTY: MobileProductDraft = { name: '', sku: null, category: null, stockUom: 'Each', allowFractionalStock: false, sellingPrice: 0 };

export function ProductManagementWorkspace({ tenantId, currency, onClose }: Props) {
  const dark = useSellerTrayAppearance().dark;
  const [products, setProducts] = useState<CommerceProduct[]>([]);
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
    setLoading(true); setError(null);
    try {
      const next = await loadManagedProducts(tenantId);
      setProducts(next); setReadOnly(false);
      await saveCommerceProductCache(tenantId, next).catch(() => undefined);
    } catch (cause) {
      if (isLikelyConnectivityError(cause)) {
        const cached = await loadCommerceProductCache(tenantId);
        setReadOnly(true);
        if (cached) setProducts(cached.data);
        setError(null);
        return;
      }
      setError(sellerTrayBackgroundError(cause, 'Products are unavailable right now.'));
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [tenantId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => (showInactive || product.isActive) && (!needle || [product.name, product.sku ?? '', product.category ?? '', ...product.uoms.map((uom) => uom.barcode ?? '')].join(' ').toLowerCase().includes(needle)));
  }, [products, query, showInactive]);

  const categories = useMemo(() => Array.from(new Set(products.map((product) => product.category?.trim()).filter((category): category is string => Boolean(category)))).sort((a, b) => a.localeCompare(b)), [products]);

  function begin(product: CommerceProduct | null, barcode = '') {
    if (readOnly) { setNotice('Connect to continue.'); return; }
    setEditor({ product, barcode }); setError(null); setNotice(null);
    if (!product) { setDraft(EMPTY); setPrice('0'); return; }
    const selling = product.uoms.find((uom) => uom.isDefaultSelling)?.sellingPrice ?? product.uoms.find((uom) => uom.isStockUom)?.sellingPrice ?? 0;
    setDraft({ name: product.name, sku: product.sku, category: product.category, stockUom: product.stockUom, allowFractionalStock: product.allowFractionalStock, sellingPrice: selling ?? 0 });
    setPrice(String(selling ?? 0));
  }

  function handleBarcode(rawBarcode: string) {
    setScannerOpen(false);
    const barcode = rawBarcode.trim();
    if (!barcode) { setError('The scanned barcode is empty. Try scanning again.'); return; }
    const match = products.find((product) => product.uoms.some((uom) => uom.barcode?.trim() === barcode));
    if (match) { begin(match, barcode); if (!readOnly) setNotice(`Barcode matched ${match.name}.`); return; }
    if (readOnly) { setNotice('Connect to add this product.'); return; }
    begin(null, barcode); setNotice('Barcode captured. Add the product details to finish creating it.');
  }

  async function save() {
    if (!editor || saving || readOnly) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const productId = await saveManagedProduct(tenantId, editor.product?.id ?? null, { ...draft, sellingPrice: Number(price) });
      let next = await loadManagedProducts(tenantId);
      const saved = next.find((product) => product.id === productId);
      if (!saved) throw new Error('SellerTray could not reload the saved product.');
      if (editor.barcode && !saved.uoms.some((uom) => uom.barcode?.trim() === editor.barcode.trim())) {
        const conflict = next.find((product) => product.id !== saved.id && product.uoms.some((uom) => uom.barcode?.trim() === editor.barcode.trim()));
        if (conflict) throw new Error(`This barcode is already linked to ${conflict.name}.`);
        await assignStockUomBarcode(tenantId, saved, editor.barcode);
        next = await loadManagedProducts(tenantId);
      }
      const wasEdit = Boolean(editor.product);
      setEditor(null); setProducts(next); setReadOnly(false);
      await saveCommerceProductCache(tenantId, next).catch(() => undefined);
      setNotice(wasEdit ? 'Product updated.' : 'Product created. Stock was not changed.');
    } catch (cause) { setError(sellerTrayUserMessage(cause, 'Unable to save this product.')); }
    finally { setSaving(false); }
  }

  async function toggleActive() {
    if (!editor?.product || saving || readOnly) return;
    const wasActive = editor.product.isActive;
    setSaving(true); setError(null);
    try { await setManagedProductActive(tenantId, editor.product.id, !wasActive); setEditor(null); await refresh(); setNotice(wasActive ? 'Product deactivated.' : 'Product activated.'); }
    catch (cause) { setError(sellerTrayUserMessage(cause, 'Unable to change this product.')); }
    finally { setSaving(false); }
  }

  const priceLabel = currency.trim() ? `Selling price (${currency.trim()})` : 'Selling price';
  if (editor) return <View style={styles.stack}>
    <Pressable onPress={() => setEditor(null)} style={styles.back}><Ionicons name="arrow-back" size={18} color={theme.colors.greenDark}/><Text style={styles.backText}>Products</Text></Pressable>
    <View><Text style={[styles.eyebrow,dark&&darkStyles.body]}>PRODUCT</Text><Text style={[styles.title,dark&&darkStyles.title]}>{editor.product?'Edit product':'Add product'}</Text><Text style={[styles.help,dark&&darkStyles.body]}>Quick product details only. Advanced units, multiple barcodes and detailed pricing stay on Merchant Web.</Text></View>
    {editor.barcode?<View style={[styles.barcodeCard,dark&&darkStyles.card]}><Ionicons name="barcode-outline" size={20} color={theme.colors.greenDark}/><Text style={[styles.body,dark&&darkStyles.body]}>Barcode {editor.barcode} will be linked to the Stock UOM.</Text></View>:null}
    <Field label="Product name"><TextInput value={draft.name} onChangeText={(name)=>setDraft(c=>({...c,name}))} placeholder="Product name" placeholderTextColor={theme.colors.subtle} style={[styles.input,dark&&darkStyles.input]}/></Field>
    <Field label="SKU (optional)"><TextInput value={draft.sku??''} onChangeText={(sku)=>setDraft(c=>({...c,sku}))} placeholder="SKU" placeholderTextColor={theme.colors.subtle} style={[styles.input,dark&&darkStyles.input]}/></Field>
    <Field label="Category (optional)">
      <View style={styles.categoryList}>
        <Pressable onPress={()=>setDraft(c=>({...c,category:null}))} style={[styles.categoryOption,dark&&darkStyles.card,draft.category===null&&styles.categoryOptionActive]}><Text style={[styles.categoryText,dark&&darkStyles.body,draft.category===null&&styles.categoryTextActive]}>No category</Text></Pressable>
        {categories.map((category)=><Pressable key={category} onPress={()=>setDraft(c=>({...c,category}))} style={[styles.categoryOption,dark&&darkStyles.card,draft.category===category&&styles.categoryOptionActive]}><Text style={[styles.categoryText,dark&&darkStyles.body,draft.category===category&&styles.categoryTextActive]}>{category}</Text></Pressable>)}
      </View>
      {categories.length===0?<Text style={[styles.help,dark&&darkStyles.body]}>No categories are configured yet. Create categories from Merchant Web, then select them here.</Text>:<Text style={[styles.help,dark&&darkStyles.body]}>Select an existing catalogue category. Category administration stays on Merchant Web.</Text>}
    </Field>
    <Field label="Stock unit"><TextInput value={draft.stockUom} editable={!editor.product} onChangeText={(stockUom)=>setDraft(c=>({...c,stockUom}))} placeholder="Each" placeholderTextColor={theme.colors.subtle} style={[styles.input,dark&&darkStyles.input,editor.product&&styles.readonly]}/></Field>
    <Field label={priceLabel}><TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.colors.subtle} style={[styles.input,dark&&darkStyles.input]}/></Field>
    <Text style={[styles.help,dark&&darkStyles.body]}>Creating or editing a product never adds stock. Receive, transfer, count or adjust stock through governed Inventory workflows.</Text>
    {error?<Text style={styles.error}>{error}</Text>:null}
    <Pressable disabled={saving} onPress={()=>void save()} style={[styles.primary,saving&&styles.disabled]}><Text style={styles.primaryText}>{saving?'Saving…':'Save product'}</Text></Pressable>
    {editor.product?<Pressable disabled={saving} onPress={()=>void toggleActive()} style={styles.secondary}><Text style={styles.secondaryText}>{editor.product.isActive?'Deactivate product':'Activate product'}</Text></Pressable>:null}
  </View>;

  return <View style={styles.stack}>
    <View style={styles.heading}><View style={styles.headingCopy}><Text style={[styles.eyebrow,dark&&darkStyles.body]}>INVENTORY</Text><Text style={[styles.title,dark&&darkStyles.title]}>Products</Text><Text style={[styles.help,dark&&darkStyles.body]}>Search, add and maintain everyday product details.</Text></View><Pressable onPress={onClose} style={styles.icon}><Ionicons name="close" size={21} color={theme.colors.navy}/></Pressable></View>
    <View style={styles.actions}><Pressable disabled={readOnly} onPress={()=>begin(null)} style={[styles.primarySmall,readOnly&&styles.disabled]}><Ionicons name="add" size={18} color={theme.colors.white}/><Text style={styles.primaryText}>Add product</Text></Pressable><Pressable onPress={()=>setScannerOpen(true)} style={styles.secondarySmall}><Ionicons name="barcode-outline" size={19} color={theme.colors.greenDark}/><Text style={styles.secondaryText}>Scan barcode</Text></Pressable></View>
    <TextInput value={query} onChangeText={setQuery} placeholder="Search name, SKU, category or barcode" placeholderTextColor={theme.colors.subtle} style={[styles.input,dark&&darkStyles.input]}/>
    <Pressable onPress={()=>setShowInactive(v=>!v)} style={styles.toggle}><Ionicons name={showInactive?'checkbox':'square-outline'} size={20} color={theme.colors.greenDark}/><Text style={[styles.body,dark&&darkStyles.body]}>Show inactive products</Text></Pressable>
    {notice?<Text style={styles.notice}>{notice}</Text>:null}{error?<Text style={styles.error}>{error}</Text>:null}
    {loading?<ActivityIndicator/>:visible.length===0?<Text style={[styles.help,dark&&darkStyles.body]}>{readOnly?'No saved products are available on this device.':'No products found.'}</Text>:visible.map(product=><Pressable key={product.id} onPress={()=>begin(product)} style={[styles.product,dark&&darkStyles.card]}><View style={styles.productCopy}><Text style={[styles.productName,dark&&darkStyles.title]}>{product.name}</Text><Text style={[styles.help,dark&&darkStyles.body]}>{[product.sku,product.category,product.stockUom].filter(Boolean).join(' · ')}</Text></View><Text style={product.isActive?styles.activeText:styles.inactive}>{product.isActive?'Active':'Inactive'}</Text><Ionicons name={readOnly?'eye-outline':'chevron-forward'} size={18} color={theme.colors.subtle}/></Pressable>)}
    <BarcodeScannerSheet visible={scannerOpen} onClose={()=>setScannerOpen(false)} onBarcode={handleBarcode}/>
  </View>;
}

function Field({label,children}:{label:string;children:ReactNode}){return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>}
const styles=StyleSheet.create({stack:{gap:14},heading:{flexDirection:'row',gap:12,alignItems:'flex-start'},headingCopy:{flex:1},eyebrow:{fontSize:11,fontWeight:'900',letterSpacing:1,color:theme.colors.muted},title:{fontSize:25,fontWeight:'900',color:theme.colors.navy},help:{fontSize:12,lineHeight:18,color:theme.colors.muted},body:{fontSize:13,color:theme.colors.slate},back:{flexDirection:'row',gap:6,alignItems:'center'},backText:{color:theme.colors.greenDark,fontWeight:'900'},icon:{width:42,height:42,borderRadius:13,backgroundColor:theme.colors.white,borderWidth:1,borderColor:theme.colors.border,alignItems:'center',justifyContent:'center'},actions:{flexDirection:'row',gap:8},primarySmall:{flex:1,minHeight:46,borderRadius:14,backgroundColor:theme.colors.green,flexDirection:'row',gap:6,alignItems:'center',justifyContent:'center'},secondarySmall:{flex:1,minHeight:46,borderRadius:14,borderWidth:1,borderColor:theme.colors.green,flexDirection:'row',gap:6,alignItems:'center',justifyContent:'center'},primary:{minHeight:50,borderRadius:14,backgroundColor:theme.colors.green,alignItems:'center',justifyContent:'center'},primaryText:{color:theme.colors.white,fontWeight:'900'},secondary:{minHeight:48,borderRadius:14,borderWidth:1,borderColor:theme.colors.border,alignItems:'center',justifyContent:'center'},secondaryText:{color:theme.colors.greenDark,fontWeight:'900'},input:{minHeight:48,borderWidth:1,borderColor:theme.colors.border,borderRadius:13,paddingHorizontal:12,color:theme.colors.navy,backgroundColor:theme.colors.white},readonly:{opacity:.7},field:{gap:6},label:{fontSize:12,fontWeight:'800',color:theme.colors.slate},categoryList:{flexDirection:'row',flexWrap:'wrap',gap:7},categoryOption:{minHeight:38,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,paddingHorizontal:11,alignItems:'center',justifyContent:'center'},categoryOptionActive:{borderColor:theme.colors.green,backgroundColor:theme.colors.mintSoft},categoryText:{fontSize:12,fontWeight:'800',color:theme.colors.slate},categoryTextActive:{color:theme.colors.greenDark},barcodeCard:{borderWidth:1,borderColor:theme.colors.border,borderRadius:14,backgroundColor:theme.colors.white,padding:12,flexDirection:'row',alignItems:'center',gap:8},toggle:{flexDirection:'row',gap:8,alignItems:'center'},notice:{color:theme.colors.greenDark,fontSize:12,fontWeight:'700'},error:{color:theme.colors.danger,fontSize:12,fontWeight:'700'},product:{minHeight:64,borderRadius:14,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:12,flexDirection:'row',alignItems:'center',gap:8},productCopy:{flex:1,minWidth:0},productName:{color:theme.colors.navy,fontWeight:'900'},activeText:{color:theme.colors.greenDark,fontSize:11,fontWeight:'900'},inactive:{color:theme.colors.muted,fontSize:11,fontWeight:'800'},disabled:{opacity:.45}});
const darkStyles=StyleSheet.create({card:{backgroundColor:theme.colors.navy,borderColor:'#344054'},title:{color:theme.colors.cloud},body:{color:'#D0D5DD'},input:{backgroundColor:'#162F46',borderColor:'#344054',color:theme.colors.cloud}});