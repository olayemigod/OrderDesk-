from pathlib import Path
import json

sell_path = Path('apps/mobile/src/redesign/SellWorkspace.tsx')
sell = sell_path.read_text()

import_anchor = "import { PosCustomerSelector, type PosCustomerSelection } from './PosCustomerSelector';\n"
imports = """import { PosCustomerSelector, type PosCustomerSelection } from './PosCustomerSelector';
import { BarcodeScannerSheet } from './BarcodeScannerSheet';
import { QuickProductCreateSheet, type QuickProductDraft } from './QuickProductCreateSheet';
import {
  createProductFromBarcode,
  loadProductCapabilities,
  resolveProductBarcode,
  type ProductCapabilities,
} from '../data/productCatalogRepository';
"""
if import_anchor not in sell:
    raise SystemExit('Sell import anchor missing')
sell = sell.replace(import_anchor, imports, 1)

state_anchor = "  const [heldNotice, setHeldNotice] = useState<string | null>(null);\n"
states = state_anchor + """  const [productCapabilities, setProductCapabilities] = useState<ProductCapabilities>({ canManageProducts: false });
  const [scannerVisible, setScannerVisible] = useState(false);
  const [capturedBarcode, setCapturedBarcode] = useState('');
  const [productCaptureSaving, setProductCaptureSaving] = useState(false);
  const [productCaptureError, setProductCaptureError] = useState<string | null>(null);
"""
if state_anchor not in sell:
    raise SystemExit('Sell state anchor missing')
sell = sell.replace(state_anchor, states, 1)

normalized_anchor = "  const normalizedQuery = query.trim().toLowerCase();\n"
capability_effect = """  useEffect(() => {
    let active = true;
    void loadProductCapabilities(tenantId).then((capabilities) => {
      if (active) setProductCapabilities(capabilities);
    }).catch(() => {
      if (active) setProductCapabilities({ canManageProducts: false });
    });
    return () => { active = false; };
  }, [tenantId]);

""" + normalized_anchor
if normalized_anchor not in sell:
    raise SystemExit('Sell normalized-query anchor missing')
sell = sell.replace(normalized_anchor, capability_effect, 1)

start = sell.index("  function addToCart(product: CommerceProduct) {")
end = sell.index("  function setLineQuantity", start)
replacement = """  function addLineToCart(product: CommerceProduct, uom: CommerceUom) {
    if (checkoutLocked || !stockReady) return;
    if (uom.sellingPrice === null) {
      setCheckoutError(`${product.name} does not have a selling price for ${uom.name}.`);
      return;
    }
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

  function addToCart(product: CommerceProduct) {
    const uom = selectedUom(product);
    if (!uom) return;
    addLineToCart(product, uom);
  }

"""
sell = sell[:start] + replacement + sell[end:]

refresh_anchor = "  async function refreshBranchStock(options?: { allowCache?: boolean }): Promise<BranchStockRow[]> {\n"
barcode_helpers = """  async function refreshCommerceProducts(): Promise<CommerceProduct[]> {
    const rows = await loadCommerceProducts(tenantId);
    setProducts(rows);
    setUsingCachedProducts(false);
    setCatalogCacheSavedAt(null);
    await saveCommerceProductCache(tenantId, rows).catch(() => undefined);
    return rows;
  }

  function localBarcodeMatch(barcode: string): { product: CommerceProduct; uom: CommerceUom } | null {
    const clean = barcode.trim();
    for (const product of products) {
      const uom = product.uoms.find((candidate) => candidate.barcode?.trim() === clean);
      if (uom) return { product, uom };
    }
    return null;
  }

  function useMatchedProduct(product: CommerceProduct, uom: CommerceUom) {
    setSelectedUomByProduct((current) => ({ ...current, [product.id]: uom.id }));
    setQuery('');
    if (!stockReady) {
      setCheckoutError(`Product found, but stock at ${branch.name} is not ready. Try again when stock is available.`);
      return;
    }
    addLineToCart(product, uom);
  }

  async function handleScannedBarcode(rawBarcode: string) {
    const barcode = rawBarcode.trim();
    setScannerVisible(false);
    setProductCaptureError(null);
    setCheckoutError(null);
    if (!barcode) return;

    const local = localBarcodeMatch(barcode);
    if (local) {
      useMatchedProduct(local.product, local.uom);
      return;
    }

    try {
      const match = await resolveProductBarcode(tenantId, barcode);
      if (!match) {
        if (!productCapabilities.canManageProducts) {
          Alert.alert('Barcode not found', 'This barcode is not in the catalogue. Ask an Owner, Manager or permitted staff member to add the product.');
          return;
        }
        setCapturedBarcode(barcode);
        return;
      }
      if (!match.itemActive) {
        Alert.alert('Product is archived', `${match.productName} already uses this barcode. Restore the existing product instead of creating a duplicate.`);
        return;
      }

      let currentProducts = products;
      let product = currentProducts.find((entry) => entry.id === match.productId);
      let uom = product?.uoms.find((entry) => entry.id === match.uomId) ?? null;
      if (!product || !uom) {
        currentProducts = await refreshCommerceProducts();
        product = currentProducts.find((entry) => entry.id === match.productId);
        uom = product?.uoms.find((entry) => entry.id === match.uomId) ?? null;
      }
      if (!product || !uom) throw new Error('The product exists but the catalogue could not refresh. Try again.');
      useMatchedProduct(product, uom);
    } catch (cause) {
      setQuery(barcode);
      setCheckoutError(isLikelyConnectivityError(cause)
        ? 'SellerTray could not verify this barcode online. Existing saved products remain searchable, but a new product cannot be added until you reconnect.'
        : cause instanceof Error ? cause.message : 'Unable to verify this barcode.');
    }
  }

  async function createCapturedProduct(draft: QuickProductDraft) {
    const price = Number(draft.sellingPrice);
    if (!draft.name.trim() || !draft.stockUom.trim() || !draft.barcode.trim() || !Number.isFinite(price) || price < 0) {
      setProductCaptureError('Enter the product name, Stock UOM, barcode and a valid selling price.');
      return;
    }
    setProductCaptureSaving(true);
    setProductCaptureError(null);
    try {
      const created = await createProductFromBarcode({
        tenantId,
        name: draft.name,
        sku: draft.sku,
        category: draft.category,
        stockUom: draft.stockUom,
        sellingPrice: price,
        barcode: draft.barcode,
        allowFractionalStock: draft.allowFractionalStock,
      });
      const rows = await refreshCommerceProducts();
      const product = rows.find((entry) => entry.id === created.productId);
      if (product) setSelectedUomByProduct((current) => ({ ...current, [product.id]: created.uomId }));
      setCapturedBarcode('');
      setQuery(product?.name ?? draft.name.trim());
      setHeldNotice(`${product?.name ?? draft.name.trim()} was added. Record opening or received stock in Inventory before selling it.`);
    } catch (cause) {
      setProductCaptureError(cause instanceof Error ? cause.message : 'Unable to add this product.');
    } finally {
      setProductCaptureSaving(false);
    }
  }

""" + refresh_anchor
if refresh_anchor not in sell:
    raise SystemExit('Sell refresh anchor missing')
sell = sell.replace(refresh_anchor, barcode_helpers, 1)

old_scan = '<View style={styles.scanButton}><Ionicons name="barcode-outline" size={23} color={theme.colors.greenDark} /></View>'
new_scan = '<Pressable accessibilityRole="button" accessibilityLabel="Scan product barcode" onPress={() => setScannerVisible(true)} style={styles.scanButton}><Ionicons name="barcode-outline" size={23} color={theme.colors.greenDark} /></Pressable>'
if old_scan not in sell:
    raise SystemExit('Sell scan control anchor missing')
sell = sell.replace(old_scan, new_scan, 1)

close_anchor = "    </View>\n  );\n}\n\nfunction cashFallback"
modal_block = """      <BarcodeScannerSheet visible={scannerVisible} onClose={() => setScannerVisible(false)} onBarcode={(barcode) => void handleScannedBarcode(barcode)} />
      <QuickProductCreateSheet
        visible={Boolean(capturedBarcode)}
        barcode={capturedBarcode}
        saving={productCaptureSaving}
        error={productCaptureError}
        onClose={() => { if (!productCaptureSaving) { setCapturedBarcode(''); setProductCaptureError(null); } }}
        onSubmit={(draft) => void createCapturedProduct(draft)}
      />
    </View>
  );
}

function cashFallback"""
if close_anchor not in sell:
    raise SystemExit('Sell component close anchor missing')
sell = sell.replace(close_anchor, modal_block, 1)
sell_path.write_text(sell)

quick_path = Path('apps/mobile/src/redesign/QuickProductCreateSheet.tsx')
quick = quick_path.read_text()
quick = quick.replace("import { useEffect, useState } from 'react';", "import { useEffect, useState, type ComponentProps } from 'react';", 1)
quick = quick.replace('type QuickProductDraft = {', 'export type QuickProductDraft = {', 1)
quick = quick.replace("} & React.ComponentProps<typeof TextInput>)", "} & ComponentProps<typeof TextInput>)", 1)
quick_path.write_text(quick)

app_path = Path('apps/mobile/app.json')
app = json.loads(app_path.read_text())
expo = app['expo']
android = expo['android']
android['versionCode'] = 23
android['blockedPermissions'] = [p for p in android.get('blockedPermissions', []) if p != 'android.permission.CAMERA']
plugins = expo.setdefault('plugins', [])
plugins = [p for p in plugins if not ((isinstance(p, str) and p == 'expo-camera') or (isinstance(p, list) and p and p[0] == 'expo-camera'))]
plugins.append(['expo-camera', {
    'cameraPermission': 'Allow SellerTray to scan product barcodes.',
    'recordAudioAndroid': False,
    'barcodeScannerEnabled': True,
}])
expo['plugins'] = plugins
app_path.write_text(json.dumps(app, indent=2) + '\n')

more_path = Path('apps/mobile/src/redesign/MoreWorkspace.tsx')
more = more_path.read_text().replace('Android build 22', 'Android build 23')
more_path.write_text(more)
