import fs from 'node:fs';

const sellPath = 'apps/mobile/src/redesign/SellWorkspace.tsx';
let sell = fs.readFileSync(sellPath, 'utf8');

function replaceOne(source, before, after, label) {
  const parts = source.split(before);
  if (parts.length !== 2) throw new Error(`Expected exactly one ${label}`);
  return parts[0] + after + parts[1];
}

sell = replaceOne(
  sell,
  "import { PosCustomerSelector, type PosCustomerSelection } from './PosCustomerSelector';\n",
  "import { PosCustomerSelector, type PosCustomerSelection } from './PosCustomerSelector';\nimport { BarcodeScannerSheet } from './BarcodeScannerSheet';\n",
  'barcode scanner import',
);

sell = replaceOne(
  sell,
  "  const [heldNotice, setHeldNotice] = useState<string | null>(null);\n",
  "  const [heldNotice, setHeldNotice] = useState<string | null>(null);\n  const [scannerOpen, setScannerOpen] = useState(false);\n",
  'barcode scanner state',
);

sell = replaceOne(
  sell,
  `    }).catch(async (err) => {\n      if (!active) return;\n      if (isLikelyConnectivityError(err)) {\n        const cached = await loadCommerceProductCache(tenantId);\n        if (active && cached) {\n          setProducts(cached.data);\n          setUsingCachedProducts(true);\n          setCatalogCacheSavedAt(cached.savedAt);\n          return;\n        }\n      }\n      setError(err instanceof Error ? err.message : 'Unable to load products.');\n    }).finally(() => { if (active) setLoading(false); });`,
  `    }).catch(async (err) => {\n      if (!active) return;\n      const cached = await loadCommerceProductCache(tenantId);\n      if (active && cached) {\n        setProducts(cached.data);\n        setUsingCachedProducts(true);\n        setCatalogCacheSavedAt(cached.savedAt);\n        setError(null);\n        return;\n      }\n      setError(err instanceof Error ? err.message : 'Unable to load products.');\n    }).finally(() => { if (active) setLoading(false); });`,
  'catalogue cache fallback',
);

sell = replaceOne(
  sell,
  `    }).catch(async (err) => {\n      if (!active) return;\n      if (isLikelyConnectivityError(err)) {\n        const cached = await loadBranchStockCache(tenantId, branch.id);\n        if (active && cached) {\n          setStockRows(cached.data);\n          setUsingCachedStock(true);\n          setStockCacheSavedAt(cached.savedAt);\n          return;\n        }\n      }\n      setStockRows([]);\n      setStockError(err instanceof Error ? err.message : 'Unable to load branch stock.');\n    }).finally(() => { if (active) setStockLoading(false); });`,
  `    }).catch(async (err) => {\n      if (!active) return;\n      const cached = await loadBranchStockCache(tenantId, branch.id);\n      if (active && cached) {\n        setStockRows(cached.data);\n        setUsingCachedStock(true);\n        setStockCacheSavedAt(cached.savedAt);\n        setStockError(null);\n        return;\n      }\n      setStockRows([]);\n      setStockError(err instanceof Error ? err.message : 'Unable to load branch stock.');\n    }).finally(() => { if (active) setStockLoading(false); });`,
  'stock cache fallback',
);

sell = replaceOne(
  sell,
  `      if (options?.allowCache && isLikelyConnectivityError(err)) {\n        const cached = await loadBranchStockCache(tenantId, branch.id);\n        if (cached) { setStockRows(cached.data); setStockError(null); setUsingCachedStock(true); setStockCacheSavedAt(cached.savedAt); return cached.data; }\n      }`,
  `      if (options?.allowCache) {\n        const cached = await loadBranchStockCache(tenantId, branch.id);\n        if (cached) { setStockRows(cached.data); setStockError(null); setUsingCachedStock(true); setStockCacheSavedAt(cached.savedAt); return cached.data; }\n      }`,
  'checkout stock cache fallback',
);

sell = replaceOne(
  sell,
  "  const stepLabel = stage === 'products' ? 'Products' : stage === 'cart' ? 'Cart' : 'Payment';\n",
  `  function handleScannedBarcode(barcode: string) {\n    const clean = barcode.trim();\n    if (!clean) return;\n    const match = products.flatMap((product) => product.uoms.map((uom) => ({ product, uom }))).find(({ uom }) => uom.barcode?.trim() === clean);\n    if (match) {\n      setSelectedUomByProduct((current) => ({ ...current, [match.product.id]: match.uom.id }));\n    }\n    setQuery(clean);\n    setPage(1);\n    setScannerOpen(false);\n  }\n\n  const stepLabel = stage === 'products' ? 'Products' : stage === 'cart' ? 'Cart' : 'Payment';\n`,
  'barcode handler',
);

sell = replaceOne(
  sell,
  "    <View style={styles.stack}>\n",
  "    <View style={styles.stack}>\n      <BarcodeScannerSheet visible={scannerOpen} onClose={() => setScannerOpen(false)} onBarcode={handleScannedBarcode} />\n",
  'barcode scanner sheet render',
);

sell = replaceOne(
  sell,
  '<View style={styles.scanButton}><Ionicons name="barcode-outline" size={23} color={theme.colors.greenDark} /></View>',
  '<Pressable accessibilityRole="button" accessibilityLabel="Scan product barcode" onPress={() => setScannerOpen(true)} style={styles.scanButton}><Ionicons name="barcode-outline" size={23} color={theme.colors.greenDark} /></Pressable>',
  'barcode scan button',
);

fs.writeFileSync(sellPath, sell);
console.log('Applied SellerTray Sell device-QA hotfixes.');
