import fs from 'node:fs';

function edit(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  fs.writeFileSync(path, after);
}
function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return source.replace(from, to);
}

const sellPath = 'apps/mobile/src/redesign/SellWorkspace.tsx';
edit(sellPath, (source) => {
  source = replaceOnce(source,
    "import { loadBranchStock, type BranchStockRow } from '../data/inventoryRepository';",
    "import { loadBranchStock, type BranchStockRow } from '../data/inventoryRepository';\nimport { sellerTrayUserMessage } from '../data/userFacingError';",
    'sell safe error import');
  source = replaceOnce(source,
    "  const [scannerOpen, setScannerOpen] = useState(false);",
    "  const [scannerOpen, setScannerOpen] = useState(false);\n  const [catalogueView, setCatalogueView] = useState<'grid' | 'list'>('grid');",
    'catalogue view state');
  source = source.replace("if (active) setError(cause instanceof Error ? cause.message : 'SellerTray could not load the selling workspace.');", "if (active) setError(sellerTrayUserMessage(cause, 'Selling data is unavailable right now.')); ");
  source = source.replace("} else setError(cause instanceof Error ? cause.message : 'Unable to prepare this sale.');", "} else setError(sellerTrayUserMessage(cause, 'This sale could not be prepared. Please try again.')); ");
  source = source.replace("onPress: () => void queueOfflineCashSale(clientReference).catch((err) => setError(err instanceof Error ? err.message : 'Unable to record this offline sale.'))", "onPress: () => void queueOfflineCashSale(clientReference).catch((err) => setError(sellerTrayUserMessage(err, 'This offline sale could not be saved.')))" );
  source = source.replace("} catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to complete this cash sale.'); }", "} catch (cause) { setError(sellerTrayUserMessage(cause, 'This cash sale could not be completed.')); }");

  const oldProducts = `      <View style={[styles.search, dark && darkStyles.card]}><Ionicons name="search-outline" size={20} color={theme.colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Search product, SKU or barcode" placeholderTextColor={theme.colors.subtle} style={[styles.searchInput, dark && darkStyles.title]} /><Pressable onPress={() => setScannerOpen(true)} style={styles.iconButton}><Ionicons name="barcode-outline" size={22} color={theme.colors.greenDark} /></Pressable></View>\n      {visibleProducts.map((product) => { const uom = selectedUom(product); const available = stockByProduct.get(product.id)?.quantityOnHand ?? 0; return <View key={product.id} style={[styles.card, dark && darkStyles.card]}><View style={styles.row}><View style={styles.flex}><Text style={[styles.productName, dark && darkStyles.title]}>{product.name}</Text><Text style={[styles.muted, dark && darkStyles.body]}>{formatQuantity(Math.max(0, available - stockInCart(product.id)))} {product.stockUom} available</Text></View><Text style={[styles.price, dark && darkStyles.title]}>{uom?.sellingPrice == null ? 'No price' : formatMoney(uom.sellingPrice, currency)}</Text></View><View style={styles.chips}>{product.uoms.map((candidate) => <Pressable key={candidate.id} onPress={() => setSelectedUomByProduct((current) => ({ ...current, [product.id]: candidate.id }))} style={[styles.chip, candidate.id === uom?.id && styles.chipActive]}><Text style={styles.chipText}>{candidate.name}</Text></Pressable>)}</View><Pressable disabled={!uom || uom.sellingPrice == null} onPress={() => addToCart(product)} style={[styles.primary, (!uom || uom.sellingPrice == null) && styles.disabled]}><Ionicons name="add" size={18} color={theme.colors.white} /><Text style={styles.primaryText}>Add</Text></Pressable></View>; })}`;
  const newProducts = `      <View style={styles.catalogueToolbar}><View style={[styles.search, styles.searchGrow, dark && darkStyles.card]}><Ionicons name="search-outline" size={20} color={theme.colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Search product, SKU or barcode" placeholderTextColor={theme.colors.subtle} style={[styles.searchInput, dark && darkStyles.title]} /><Pressable onPress={() => setScannerOpen(true)} style={styles.iconButton}><Ionicons name="barcode-outline" size={22} color={theme.colors.greenDark} /></Pressable></View><View style={[styles.viewToggle, dark && darkStyles.card]}><Pressable accessibilityLabel="Tile view" onPress={() => setCatalogueView('grid')} style={[styles.viewButton, catalogueView === 'grid' && styles.viewButtonActive]}><Ionicons name="grid-outline" size={18} color={catalogueView === 'grid' ? theme.colors.greenDark : theme.colors.muted} /></Pressable><Pressable accessibilityLabel="List view" onPress={() => setCatalogueView('list')} style={[styles.viewButton, catalogueView === 'list' && styles.viewButtonActive]}><Ionicons name="list-outline" size={20} color={catalogueView === 'list' ? theme.colors.greenDark : theme.colors.muted} /></Pressable></View></View>\n      <View style={catalogueView === 'grid' ? styles.productGrid : styles.productList}>{visibleProducts.map((product) => { const uom = selectedUom(product); const available = stockByProduct.get(product.id)?.quantityOnHand ?? 0; return <View key={product.id} style={[styles.card, catalogueView === 'grid' && styles.productTile, dark && darkStyles.card]}><View style={styles.row}><View style={styles.flex}><Text numberOfLines={2} style={[styles.productName, dark && darkStyles.title]}>{product.name}</Text><Text style={[styles.muted, dark && darkStyles.body]}>{formatQuantity(Math.max(0, available - stockInCart(product.id)))} {product.stockUom} available</Text></View>{catalogueView === 'list' ? <Text style={[styles.price, dark && darkStyles.title]}>{uom?.sellingPrice == null ? 'No price' : formatMoney(uom.sellingPrice, currency)}</Text> : null}</View>{catalogueView === 'grid' ? <Text style={[styles.tilePrice, dark && darkStyles.title]}>{uom?.sellingPrice == null ? 'No price' : formatMoney(uom.sellingPrice, currency)}</Text> : null}<View style={styles.chips}>{product.uoms.map((candidate) => <Pressable key={candidate.id} onPress={() => setSelectedUomByProduct((current) => ({ ...current, [product.id]: candidate.id }))} style={[styles.chip, candidate.id === uom?.id && styles.chipActive]}><Text numberOfLines={1} style={styles.chipText}>{candidate.name}</Text></Pressable>)}</View><Pressable disabled={!uom || uom.sellingPrice == null} onPress={() => addToCart(product)} style={[styles.primary, styles.addButton, (!uom || uom.sellingPrice == null) && styles.disabled]}><Ionicons name="add" size={18} color={theme.colors.white} /><Text style={styles.primaryText}>Add</Text></Pressable></View>; })}</View>`;
  source = replaceOnce(source, oldProducts, newProducts, 'tile/list catalogue');
  source = replaceOnce(source,
    "  stack: { gap: 14 }, eyebrow:",
    "  stack: { gap: 14 }, catalogueToolbar: { flexDirection: 'row', gap: 8, alignItems: 'center' }, searchGrow: { flex: 1 }, viewToggle: { flexDirection: 'row', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, padding: 3 }, viewButton: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, viewButtonActive: { backgroundColor: theme.colors.mintSoft }, productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, productList: { gap: 10 }, productTile: { width: '48%', minWidth: 0, justifyContent: 'space-between' }, tilePrice: { color: theme.colors.navy, fontSize: 16, fontWeight: '900' }, addButton: { minHeight: 42 }, eyebrow:",
    'catalogue styles');
  return source;
});

const offlinePath = 'apps/mobile/src/data/offlineSalesRepository.ts';
edit(offlinePath, (source) => {
  source = replaceOnce(source, "import type { BranchStockRow } from './inventoryRepository';", "import type { BranchStockRow } from './inventoryRepository';\nimport type { MerchantCustomer } from './customerRepository';", 'customer cache type');
  source = replaceOnce(source, "const POLICY_KEY_PREFIX = 'sellertray.offline.pos-policy.v1:';", "const POLICY_KEY_PREFIX = 'sellertray.offline.pos-policy.v1:';\nconst CUSTOMER_KEY_PREFIX = 'sellertray.offline.customers.v1:';", 'customer cache key');
  source = replaceOnce(source, "export async function savePosPolicyCache(tenantId: string, policy: PosPaymentPolicy): Promise<void> { await writeCache(`${POLICY_KEY_PREFIX}${tenantId}`, policy); }\nexport async function loadPosPolicyCache(tenantId: string): Promise<OfflineCache<PosPaymentPolicy> | null> { return readCache(`${POLICY_KEY_PREFIX}${tenantId}`); }", "export async function savePosPolicyCache(tenantId: string, policy: PosPaymentPolicy): Promise<void> { await writeCache(`${POLICY_KEY_PREFIX}${tenantId}`, policy); }\nexport async function loadPosPolicyCache(tenantId: string): Promise<OfflineCache<PosPaymentPolicy> | null> { return readCache(`${POLICY_KEY_PREFIX}${tenantId}`); }\nexport async function saveCustomerCache(tenantId: string, rows: MerchantCustomer[]): Promise<void> { await writeCache(`${CUSTOMER_KEY_PREFIX}${tenantId}`, rows); }\nexport async function loadCustomerCache(tenantId: string): Promise<OfflineCache<MerchantCustomer[]> | null> { return readCache(`${CUSTOMER_KEY_PREFIX}${tenantId}`); }", 'customer cache functions');
  return source;
});

const customerPath = 'apps/mobile/src/redesign/PosCustomerSelector.tsx';
edit(customerPath, (source) => {
  source = replaceOnce(source, "import { loadCustomers, type MerchantCustomer } from '../data/customerRepository';", "import { loadCustomers, type MerchantCustomer } from '../data/customerRepository';\nimport { isLikelyConnectivityError, loadCustomerCache, saveCustomerCache } from '../data/offlineSalesRepository';\nimport { sellerTrayUserMessage } from '../data/userFacingError';", 'customer offline imports');
  const oldLoad = `    void loadCustomers(tenantId)\n      .then((rows) => { if (active) setCustomers(rows.filter((row) => row.whatsappId !== 'pos:walk-in')); })\n      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load customers.'); })\n      .finally(() => { if (active) setLoading(false); });`;
  const newLoad = `    void loadCustomers(tenantId)\n      .then(async (rows) => { const filtered = rows.filter((row) => row.whatsappId !== 'pos:walk-in'); await saveCustomerCache(tenantId, filtered).catch(() => undefined); if (active) setCustomers(filtered); })\n      .catch(async (cause) => { if (!active) return; if (isLikelyConnectivityError(cause)) { const cached = await loadCustomerCache(tenantId); if (cached) { setCustomers(cached.data); setError(null); return; } } setError(sellerTrayUserMessage(cause, 'Customer list is unavailable right now.')); })\n      .finally(() => { if (active) setLoading(false); });`;
  return replaceOnce(source, oldLoad, newLoad, 'customer offline fallback');
});

const inventoryPath = 'apps/mobile/src/redesign/InventoryWorkspace.tsx';
edit(inventoryPath, (source) => {
  source = replaceOnce(source, "import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';", "import { isLikelyConnectivityError, loadBranchStockCache, loadCommerceProductCache, saveBranchStockCache, saveCommerceProductCache } from '../data/offlineSalesRepository';\nimport { sellerTrayUserMessage } from '../data/userFacingError';\nimport { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';", 'inventory offline imports');
  source = replaceOnce(source, "  const [notice, setNotice] = useState<string | null>(null);", "  const [notice, setNotice] = useState<string | null>(null);\n  const [usingSavedStock, setUsingSavedStock] = useState(false);", 'inventory cache state');
  const oldRefresh = `      const next = await loadBranchStock(tenantId, branch.id);\n      setRows(next);`;
  const newRefresh = `      const next = await loadBranchStock(tenantId, branch.id);\n      setRows(next);\n      setUsingSavedStock(false);\n      await saveBranchStockCache(tenantId, branch.id, next).catch(() => undefined);`;
  source = replaceOnce(source, oldRefresh, newRefresh, 'inventory save cache');
  source = replaceOnce(source, "    } catch (cause) {\n      setError(cause instanceof Error ? cause.message : 'Unable to load branch stock.');", "    } catch (cause) {\n      if (isLikelyConnectivityError(cause)) { const cached = await loadBranchStockCache(tenantId, branch.id); if (cached) { setRows(cached.data); setUsingSavedStock(true); setError(null); return; } }\n      setError(sellerTrayUserMessage(cause, 'Branch stock is unavailable right now.'));", 'inventory stock fallback');
  source = source.replace("setCapabilityError(cause instanceof Error ? cause.message : 'Stock action access is unavailable.');", "setCapabilityError(isLikelyConnectivityError(cause) ? 'Stock actions need a connection. Saved stock remains available to view.' : sellerTrayUserMessage(cause, 'Stock action access is unavailable.')); ");
  const oldProducts = `    void loadCommerceProducts(tenantId)\n      .then((next) => {\n        if (active) setProducts(next);\n      })\n      .catch(() => {\n        if (active) setProducts([]);\n      });`;
  const newProducts = `    void loadCommerceProducts(tenantId)\n      .then(async (next) => { await saveCommerceProductCache(tenantId, next).catch(() => undefined); if (active) setProducts(next); })\n      .catch(async (cause) => { if (!active) return; if (isLikelyConnectivityError(cause)) { const cached = await loadCommerceProductCache(tenantId); setProducts(cached?.data ?? []); } else setProducts([]); });`;
  source = replaceOnce(source, oldProducts, newProducts, 'inventory catalogue fallback');
  source = source.replace("setMovementError(cause instanceof Error ? cause.message : 'Unable to load stock history.');", "setMovementError(sellerTrayUserMessage(cause, 'Stock history is unavailable right now.')); ");
  source = replaceOnce(source, "      {error ? <ErrorCard text={error} dark={dark} /> : null}", "      {usingSavedStock ? <View style={[styles.savedDataCard, dark && darkStyles.subtleCard]}><Ionicons name=\"cloud-offline-outline\" size={18} color={theme.colors.warning} /><Text style={[styles.savedDataText, dark && darkStyles.bodyText]}>Offline · showing the last saved stock for this branch.</Text></View> : null}\n      {error ? <ErrorCard text={error} dark={dark} /> : null}", 'inventory saved notice');
  source = replaceOnce(source, "  stack:{gap:14},heading:", "  stack:{gap:14},savedDataCard:{borderRadius:theme.radius.md,backgroundColor:'#FFFAEB',padding:10,flexDirection:'row',alignItems:'center',gap:8},savedDataText:{flex:1,color:theme.colors.slate,fontSize:11,lineHeight:17},heading:", 'inventory saved styles');
  return source;
});

const tabPath = 'apps/mobile/src/redesign/InventoryTabWorkspace.tsx';
edit(tabPath, (source) => {
  source = replaceOnce(source, "import { loadLowStock } from '../data/lowStockRepository';", "import { loadLowStock } from '../data/lowStockRepository';\nimport { isLikelyConnectivityError, loadCommerceProductCache, saveCommerceProductCache } from '../data/offlineSalesRepository';\nimport { sellerTrayUserMessage } from '../data/userFacingError';", 'inventory tab safe imports');
  source = source.replace("setCountAccessError(err instanceof Error ? err.message : 'Unable to load the active stock count.');", "setCountAccessError(sellerTrayUserMessage(err, 'Stock count is unavailable right now.')); ");
  source = source.replace("setCountAccessError(err instanceof Error ? err.message : 'Inventory action access could not be verified.');", "const cached = isLikelyConnectivityError(err) ? await loadCommerceProductCache(tenantId) : null; setProducts(cached?.data ?? []); setCountAccessError(isLikelyConnectivityError(err) ? 'Inventory actions need a connection. Saved stock remains available to view.' : sellerTrayUserMessage(err, 'Inventory action access could not be verified.')); ");
  source = source.replace("      setProducts(nextProducts);", "      setProducts(nextProducts);\n      await saveCommerceProductCache(tenantId, nextProducts).catch(() => undefined);");
  return source;
});

const redesignPath = 'apps/mobile/src/redesign/RedesignWorkspace.tsx';
edit(redesignPath, (source) => {
  source = replaceOnce(source, "import { supabase } from '../lib/supabase';", "import { supabase } from '../lib/supabase';\nimport { sellerTrayUserMessage } from '../data/userFacingError';", 'workspace safe error import');
  source = source.replace("<Text style={[styles.errorText, appearance.dark && darkStyles.bodyText]}>{workspaceError}</Text>", "<Text style={[styles.errorText, appearance.dark && darkStyles.bodyText]}>{sellerTrayUserMessage(workspaceError, offline.connectionState === 'offline' ? 'SellerTray is offline. Saved data remains available where supported.' : 'Some information could not refresh. Pull down to try again.')}</Text>");
  return source;
});

const paymentRepo = 'apps/mobile/src/data/posPaymentRepository.ts';
edit(paymentRepo, (source) => {
  source = replaceOnce(source, "import { createPosClientReference, type PosPaymentMethodType } from './commerceRepository';", "import { createPosClientReference, type PosPaymentMethodType } from './commerceRepository';\nimport { sellerTrayUserMessage } from './userFacingError';", 'payment safe error import');
  source = source.replace("if (error) throw new Error(await functionErrorMessage(error, 'Unable to process this payment.'));", "if (error) throw new Error(sellerTrayUserMessage(await functionErrorMessage(error, 'Unable to process this payment.'), 'This payment could not be processed. Please try again.'));");
  return source;
});

const settingsPath = 'apps/mobile/src/components/SettingsHub.tsx';
edit(settingsPath, (source) => replaceOnce(source, "      <Text style={[styles.buildStamp, appearance.dark && darkStyles.bodyText]}>SellerTray 1.0.0 · Android build 18</Text>\n", '', 'remove stale settings build stamp'));

const appPath = 'apps/mobile/app.json';
edit(appPath, (source) => replaceOnce(source, '"versionCode": 25', '"versionCode": 26', 'build 26'));
const morePath = 'apps/mobile/src/redesign/MoreWorkspace.tsx';
edit(morePath, (source) => replaceOnce(source, 'SellerTray 1.0.0 · Android build 25', 'SellerTray 1.0.0 · Android build 26', 'build 26 marker'));

const oldMigration = 'supabase/migrations/20261016144200_pos_multi_allocation_confirmation.sql';
const liveMigration = 'supabase/migrations/20261016144418_pos_multi_allocation_confirmation.sql';
if (fs.existsSync(oldMigration)) fs.renameSync(oldMigration, liveMigration);
if (!fs.existsSync(liveMigration)) throw new Error('POS multi-allocation migration is missing');

const preflightPath = 'apps/mobile/scripts/offline-preflight.mjs';
edit(preflightPath, (source) => {
  source = replaceOnce(source, "const prepare = readFileSync(resolve(root, 'src/data/posDraftPreparationRepository.ts'), 'utf8');", "const prepare = readFileSync(resolve(root, 'src/data/posDraftPreparationRepository.ts'), 'utf8');\nconst inventory = readFileSync(resolve(root, 'src/redesign/InventoryWorkspace.tsx'), 'utf8');\nconst customer = readFileSync(resolve(root, 'src/redesign/PosCustomerSelector.tsx'), 'utf8');\nconst safeError = readFileSync(resolve(root, 'src/data/userFacingError.ts'), 'utf8');", 'offline QA sources');
  source = replaceOnce(source, "requireValue(offline.includes('unknownhost') && offline.includes('unable to resolve host'), 'DNS/backend reachability failures must be classified as offline conditions.');", "requireValue(offline.includes('unknownhost') && offline.includes('unable to resolve host'), 'DNS/backend reachability failures must be classified as offline conditions.');\nrequireValue(sell.includes(\"catalogueView\") && sell.includes(\"'grid'\") && sell.includes('grid-outline') && sell.includes('list-outline'), 'POS catalogue must default to governed tile view and retain an explicit compact list toggle.');\nrequireValue(inventory.includes('loadBranchStockCache') && inventory.includes('saveBranchStockCache') && inventory.includes('last saved stock'), 'Inventory must consume the same governed branch-stock cache as POS when offline.');\nrequireValue(customer.includes('loadCustomerCache') && customer.includes('saveCustomerCache'), 'POS customer selection must use the governed offline customer cache.');\nrequireValue(safeError.includes('supabase\\\\.co') && safeError.includes('SellerTray is offline'), 'Merchant-facing error translation must suppress infrastructure URLs and raw database errors.');", 'new device QA assertions');
  return source;
});

console.log('SellerTray Build 26 device QA corrections applied.');
