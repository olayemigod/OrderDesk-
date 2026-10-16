import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`${label}: anchor not found`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`${label}: anchor is ambiguous`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function replaceRange(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found`);
  const endStart = source.indexOf(endMarker, start);
  if (endStart < 0) throw new Error(`${label}: end marker not found`);
  const end = endStart + endMarker.length;
  return source.slice(0, start) + replacement + source.slice(end);
}

const resumePath = 'apps/mobile/src/redesign/ResumePosDraftWorkspace.tsx';
let resume = readFileSync(resumePath, 'utf8');

resume = replaceOnce(
  resume,
  "  type CommerceBranch,\n  type PosPaymentMethod,\n} from '../data/commerceRepository';",
  "  type CommerceBranch,\n  type CommerceProduct,\n  type CommerceUom,\n  type PosPaymentMethod,\n} from '../data/commerceRepository';",
  'resume commerce imports',
);
resume = replaceOnce(
  resume,
  "import { updatePosDraftItems } from '../data/posSaleRepository';",
  "import { loadOrders } from '../data/ordersRepository';\nimport { updatePosDraftItems } from '../data/posSaleRepository';",
  'resume orders import',
);
resume = replaceOnce(
  resume,
  "import type { MerchantOrder, OrderItem } from '../domain/order';",
  "import type { MerchantOrder } from '../domain/order';",
  'resume order type import',
);
resume = replaceOnce(
  resume,
  "import { PosPaymentAllocator } from './PosPaymentAllocator';",
  "import { BarcodeScannerSheet } from './BarcodeScannerSheet';\nimport { PosPaymentAllocator } from './PosPaymentAllocator';",
  'resume scanner import',
);
resume = replaceOnce(resume, "type ResumeStage = 'cart' | 'payment';", "type ResumeStage = 'products' | 'cart' | 'payment';", 'resume stage type');
resume = replaceOnce(resume, "const STOCK_EPSILON = 0.000001;", "const STOCK_EPSILON = 0.000001;\nconst PRODUCTS_PER_PAGE = 20;", 'resume page constant');
resume = replaceOnce(
  resume,
  "  const [workingOrder, setWorkingOrder] = useState(order);\n  const [lines, setLines] = useState<ResumedPosDraftLine[]>([]);",
  "  const [workingOrder, setWorkingOrder] = useState(order);\n  const [products, setProducts] = useState<CommerceProduct[]>([]);\n  const [query, setQuery] = useState('');\n  const [page, setPage] = useState(1);\n  const [selectedUomByProduct, setSelectedUomByProduct] = useState<Record<string, string>>({});\n  const [scannerOpen, setScannerOpen] = useState(false);\n  const [lines, setLines] = useState<ResumedPosDraftLine[]>([]);",
  'resume product state',
);
resume = replaceOnce(
  resume,
  "    setWorkingOrder(order);\n    setStage('cart');\n    setServerTotal(null);",
  "    setWorkingOrder(order);\n    setStage('products');\n    setQuery('');\n    setPage(1);\n    setSelectedUomByProduct({});\n    setScannerOpen(false);\n    setServerTotal(null);",
  'resume initial stage',
);
resume = replaceOnce(
  resume,
  "      setLines([]);\n      setPaymentMethods([]);",
  "      setProducts([]);\n      setLines([]);\n      setPaymentMethods([]);",
  'resume branch mismatch clear',
);
resume = replaceOnce(
  resume,
  "      const resumed = buildResumedPosDraft(order, products);\n      setLines(resumed.lines);\n      setQuantityDrafts(Object.fromEntries(resumed.lines.map((line) => [line.orderItemId, formatQuantity(line.quantity)])));\n      setPriceDrafts(Object.fromEntries(resumed.lines.map((line) => [line.orderItemId, formatEditablePrice(line.uom.sellingPrice ?? 0)])));",
  "      const resumed = buildResumedPosDraft(order, products);\n      setProducts(products);\n      setLines(resumed.lines);\n      setQuantityDrafts(Object.fromEntries(resumed.lines.map((line) => [lineKey(line), formatQuantity(line.quantity)])));\n      setPriceDrafts(Object.fromEntries(resumed.lines.map((line) => [lineKey(line), formatEditablePrice(order.items.find((item) => item.id === line.orderItemId)?.unitPrice ?? line.uom.sellingPrice ?? 0)])));",
  'resume initial line state',
);
resume = replaceOnce(
  resume,
  "      setNotice(`Resuming ${order.publicOrderId}. Changes stay on this saved sale.`);",
  "      setNotice(`Resuming ${order.publicOrderId}. Add or change products, then continue through Cart and Payment on this same saved sale.`);",
  'resume notice',
);

const computedAnchor = "  const shortage = useMemo(() => findStockShortage(lines, stockRows), [lines, stockRows]);\n\n";
const computedInsert = `  const shortage = useMemo(() => findStockShortage(lines, stockRows), [lines, stockRows]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = useMemo(
    () => !normalizedQuery
      ? products
      : products.filter((product) => [product.name, product.sku ?? '', product.category ?? '', ...product.uoms.map((uom) => uom.barcode ?? '')].join(' ').toLowerCase().includes(normalizedQuery)),
    [normalizedQuery, products],
  );
  const pageCount = Math.max(1, Math.ceil(visibleProducts.length / PRODUCTS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pageProducts = visibleProducts.slice((safePage - 1) * PRODUCTS_PER_PAGE, safePage * PRODUCTS_PER_PAGE);
  useEffect(() => { setPage(1); }, [normalizedQuery]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  function selectedUom(product: CommerceProduct): CommerceUom | null {
    const selectedId = selectedUomByProduct[product.id];
    return product.uoms.find((uom) => uom.id === selectedId)
      ?? product.uoms.find((uom) => uom.isDefaultSelling)
      ?? product.uoms[0]
      ?? null;
  }

  function stockQuantityInSale(productId: string, excludeKey?: string): number {
    return lines.reduce((sum, line) => line.product.id === productId && line.key !== excludeKey
      ? sum + line.quantity * line.uom.conversionFactor
      : sum, 0);
  }

  function addProduct(product: CommerceProduct) {
    if (saving || completing) return;
    const uom = selectedUom(product);
    if (!uom || uom.sellingPrice === null) {
      setError('Choose a priced selling unit before adding this product.');
      return;
    }
    const key = \`${'${product.id}:${uom.id}'}\`;
    const existing = lines.find((line) => line.key === key);
    if (existing) {
      setLineQuantity(existing, existing.quantity + 1);
      return;
    }
    const available = stockRows.find((row) => row.catalogItemId === product.id)?.quantityOnHand ?? 0;
    const requested = stockQuantityInSale(product.id) + uom.conversionFactor;
    if (requested > available + STOCK_EPSILON) {
      setError(\`Not enough ${'${product.name}'} at ${'${branch.name}'}. ${'${formatQuantity(available)}'} ${'${product.stockUom}'} is available.\`);
      return;
    }
    const line: ResumedPosDraftLine = { key, orderItemId: null, product, uom, quantity: 1 };
    setLines((current) => [...current, line]);
    setQuantityDrafts((current) => ({ ...current, [key]: '1' }));
    setPriceDrafts((current) => ({ ...current, [key]: formatEditablePrice(uom.sellingPrice ?? 0) }));
    setServerTotal(null);
    setError(null);
    setNotice(\`${'${product.name}'} added to ${'${workingOrder.publicOrderId}'}.\`);
  }

  function handleScannedBarcode(barcode: string) {
    const clean = barcode.trim();
    if (!clean) return;
    const match = products
      .flatMap((product) => product.uoms.map((uom) => ({ product, uom })))
      .find(({ uom }) => uom.barcode?.trim() === clean);
    if (match) setSelectedUomByProduct((current) => ({ ...current, [match.product.id]: match.uom.id }));
    setQuery(clean);
    setPage(1);
    setScannerOpen(false);
  }

`;
resume = replaceOnce(resume, computedAnchor, computedInsert, 'resume computed product state');

resume = replaceOnce(resume, "    setPriceDrafts((current) => ({ ...current, [line.orderItemId]: clean }));\n    setPriceEdited((current) => ({ ...current, [line.orderItemId]: true }));", "    const key = lineKey(line);\n    setPriceDrafts((current) => ({ ...current, [key]: clean }));\n    setPriceEdited((current) => ({ ...current, [key]: true }));", 'resume price key');
resume = replaceOnce(resume, "candidate.product.id === line.product.id && candidate.orderItemId !== line.orderItemId", "candidate.product.id === line.product.id && candidate.key !== line.key", 'resume stock exclusion');
resume = replaceOnce(resume, "        delete next[line.orderItemId];", "        delete next[lineKey(line)];", 'resume removed quantity key');
resume = replaceOnce(resume, "    setQuantityDrafts((current) => ({ ...current, [line.orderItemId]: formatQuantity(quantity) }));", "    setQuantityDrafts((current) => ({ ...current, [lineKey(line)]: formatQuantity(quantity) }));", 'resume quantity key');
resume = replaceOnce(resume, "    const value = Number(quantityDrafts[line.orderItemId] ?? formatQuantity(line.quantity));", "    const value = Number(quantityDrafts[lineKey(line)] ?? formatQuantity(line.quantity));", 'resume typed quantity read');
resume = replaceOnce(resume, "      setQuantityDrafts((current) => ({ ...current, [line.orderItemId]: formatQuantity(line.quantity) }));", "      setQuantityDrafts((current) => ({ ...current, [lineKey(line)]: formatQuantity(line.quantity) }));", 'resume typed quantity rollback');

const saveStart = "      const [products, latestStock] = await Promise.all([";
const saveEnd = "        : 'Saved sale updated. Current price, unit conversion and Branch stock were rechecked before payment.');";
const saveReplacement = `      const [latestProducts, latestStock] = await Promise.all([
        loadCommerceProducts(tenantId),
        loadBranchStock(tenantId, branch.id),
      ]);
      const productsById = new Map(latestProducts.map((product) => [product.id, product]));
      const nextLines = lines.map((line) => {
        const product = productsById.get(line.product.id);
        if (!product || !product.isActive) throw new Error(\`${'${line.product.name}'} is no longer available for sale.\`);
        const uom = product.uoms.find((candidate) => candidate.id === line.uom.id);
        if (!uom || uom.sellingPrice === null) throw new Error(\`The selling unit for ${'${product.name}'} is no longer available.\`);
        if (!uom.allowFractional && line.quantity !== Math.trunc(line.quantity)) throw new Error(\`${'${uom.name}'} does not allow fractional quantity.\`);
        return { ...line, product, uom };
      }).filter((line) => line.quantity > 0);
      if (!nextLines.length) throw new Error('Keep at least one product in the saved sale.');

      const latestShortage = findStockShortage(nextLines, latestStock);
      if (latestShortage) {
        throw new Error(\`Not enough ${'${latestShortage.productName}'} at ${'${branch.name}'}. ${'${formatQuantity(latestShortage.available)}'} ${'${latestShortage.stockUom}'} is available; ${'${formatQuantity(latestShortage.required)}'} is needed.\`);
      }

      const edits = buildResumedPosDraftEdits(workingOrder, nextLines).map((edit) => {
        const sourceLine = edit.orderItemId
          ? nextLines.find((line) => line.orderItemId === edit.orderItemId)
          : nextLines.find((line) => line.orderItemId === null && line.product.id === edit.catalogItemId && line.uom.id === edit.uomId);
        if (!sourceLine || !priceEdited[lineKey(sourceLine)]) return edit;
        const unitPrice = Number(priceDrafts[lineKey(sourceLine)] ?? '');
        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Enter a valid selling price.');
        return { ...edit, unitPrice };
      });
      const expectedTotal = nextLines.reduce((sum, line) => sum + line.quantity * effectiveLinePrice(line, priceDrafts, priceEdited), 0);
      const editResult = await updatePosDraftItems({ tenantId, orderId: workingOrder.id, items: edits });
      const refreshedOrder = (await loadOrders(tenantId)).find((candidate) => candidate.id === workingOrder.id);
      if (!refreshedOrder) throw new Error('SellerTray updated the saved sale but could not reload it. Return to Orders and reopen the sale.');
      const refreshed = buildResumedPosDraft(refreshedOrder, latestProducts);

      setWorkingOrder(refreshedOrder);
      setProducts(latestProducts);
      setLines(refreshed.lines);
      setQuantityDrafts(Object.fromEntries(refreshed.lines.map((line) => [lineKey(line), formatQuantity(line.quantity)])));
      setPriceDrafts(Object.fromEntries(refreshed.lines.map((line) => [
        lineKey(line),
        formatEditablePrice(refreshedOrder.items.find((item) => item.id === line.orderItemId)?.unitPrice ?? line.uom.sellingPrice ?? 0),
      ])));
      setPriceEdited({});
      setStockRows(latestStock);
      setServerTotal(editResult.totalAmount);
      setStage('payment');
      setNotice(Math.abs(editResult.totalAmount - expectedTotal) > 0.005
        ? 'Saved sale updated. A current selling price changed during recheck, so the payment amount has been refreshed from SellerTray.'
        : 'Saved sale updated. Products, current price, unit conversion and Branch stock were rechecked before payment.');`;
resume = replaceRange(resume, saveStart, saveEnd, saveReplacement, 'resume save and continue');

resume = replaceOnce(
  resume,
  "      <View style={styles.heading}>\n        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SELL · {stage === 'cart' ? 'CART' : 'PAYMENT'}</Text>\n        <Text style={[styles.title, dark && darkStyles.titleText]}>{stage === 'cart' ? 'Edit Saved Sale' : 'Take Payment'}</Text>",
  "      <BarcodeScannerSheet visible={scannerOpen} onClose={() => setScannerOpen(false)} onBarcode={handleScannedBarcode} />\n      <View style={styles.heading}>\n        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SELL · {stage === 'products' ? 'PRODUCTS' : stage === 'cart' ? 'CART' : 'PAYMENT'}</Text>\n        <Text style={[styles.title, dark && darkStyles.titleText]}>{stage === 'products' ? 'Edit Saved Sale' : stage === 'cart' ? 'Review Cart' : 'Take Payment'}</Text>",
  'resume heading',
);
resume = replaceOnce(
  resume,
  "        <Step number={1} label=\"Products\" complete />\n        <Step number={2} label=\"Cart\" active={stage === 'cart'} complete={stage === 'payment'} />",
  "        <Step number={1} label=\"Products\" active={stage === 'products'} complete={stage !== 'products'} />\n        <Step number={2} label=\"Cart\" active={stage === 'cart'} complete={stage === 'payment'} />",
  'resume steps',
);

const cartBranch = "      {stage === 'cart' ? (";
const productsBranch = `      {stage === 'products' ? (
        <View style={styles.stageStack}>
          <Pressable disabled={saving} onPress={onCancel} style={styles.backLink}><Ionicons name="arrow-back" size={19} color={theme.colors.greenDark} /><Text style={styles.backLinkText}>Back to Orders</Text></Pressable>
          <View style={[styles.searchBox, dark && darkStyles.input]}>
            <Ionicons name="search-outline" size={20} color={theme.colors.muted} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search product, SKU or barcode" placeholderTextColor={theme.colors.subtle} autoCorrect={false} style={[styles.searchInput, dark && darkStyles.input]} />
            <Pressable accessibilityRole="button" accessibilityLabel="Scan product barcode" onPress={() => setScannerOpen(true)} style={styles.scanButton}><Ionicons name="barcode-outline" size={23} color={theme.colors.greenDark} /></Pressable>
          </View>
          <View style={styles.row}><View style={styles.flex}><Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{visibleProducts.length} products</Text><Text style={[styles.small, dark && darkStyles.bodyText]}>Page {safePage} of {pageCount}</Text></View><Text style={[styles.total, dark && darkStyles.titleText]}>{formatMoney(total, currency)}</Text></View>
          {pageProducts.map((product) => {
            const uom = selectedUom(product);
            const onHand = stockRows.find((row) => row.catalogItemId === product.id)?.quantityOnHand ?? 0;
            const inSale = stockQuantityInSale(product.id);
            const remaining = Math.max(0, onHand - inSale);
            const canAdd = Boolean(uom && uom.sellingPrice !== null && remaining + STOCK_EPSILON >= uom.conversionFactor);
            return <View key={product.id} style={[styles.productCard, dark && darkStyles.card]}>
              <View style={styles.row}><View style={styles.flex}><Text style={[styles.productName, dark && darkStyles.titleText]}>{product.name}</Text><Text style={[styles.small, dark && darkStyles.bodyText]}>{product.sku ?? product.stockUom}</Text></View><Text style={[styles.productPrice, dark && darkStyles.titleText]}>{uom?.sellingPrice === null || !uom ? 'No price' : formatMoney(uom.sellingPrice, currency)}</Text></View>
              <Text style={[styles.small, remaining <= 0 && styles.dangerText, dark && darkStyles.bodyText]}>{formatQuantity(remaining)} {product.stockUom} available</Text>
              <View style={styles.chips}>{product.uoms.map((candidate) => <Pressable key={candidate.id} onPress={() => setSelectedUomByProduct((current) => ({ ...current, [product.id]: candidate.id }))} style={[styles.chip, candidate.id === uom?.id && styles.chipActive]}><Text style={[styles.chipText, candidate.id === uom?.id && styles.chipTextActive]}>{candidate.name}</Text></Pressable>)}</View>
              <Pressable disabled={!canAdd} onPress={() => addProduct(product)} style={[styles.addButton, !canAdd && styles.disabled]}><Ionicons name="add" size={18} color={theme.colors.white} /><Text style={styles.primaryText}>{lines.some((line) => line.product.id === product.id && line.uom.id === uom?.id) ? 'Add more' : 'Add'}</Text></Pressable>
            </View>;
          })}
          {visibleProducts.length > PRODUCTS_PER_PAGE ? <View style={styles.pagination}><Pressable disabled={safePage <= 1} onPress={() => setPage((value) => Math.max(1, value - 1))} style={[styles.pageButton, safePage <= 1 && styles.disabled]}><Text style={styles.pageButtonText}>Previous</Text></Pressable><Text style={[styles.small, dark && darkStyles.bodyText]}>{safePage} / {pageCount}</Text><Pressable disabled={safePage >= pageCount} onPress={() => setPage((value) => Math.min(pageCount, value + 1))} style={[styles.pageButton, safePage >= pageCount && styles.disabled]}><Text style={styles.pageButtonText}>Next</Text></Pressable></View> : null}
          <View style={[styles.card, dark && darkStyles.card]}><View style={styles.row}><View style={styles.flex}><Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{lines.length} product{lines.length === 1 ? '' : 's'} · {formatQuantity(unitCount)} units</Text><Text style={[styles.total, dark && darkStyles.titleText]}>{formatMoney(total, currency)}</Text></View><Pressable disabled={!lines.length} onPress={() => setStage('cart')} style={[styles.primaryButton, !lines.length && styles.disabled]}><Text style={styles.primaryText}>View cart</Text><Ionicons name="arrow-forward" size={18} color={theme.colors.white} /></Pressable></View></View>
        </View>
      ) : stage === 'cart' ? (`;
resume = replaceOnce(resume, cartBranch, productsBranch, 'resume products stage');

resume = replaceOnce(
  resume,
  "          <Pressable disabled={saving} onPress={onCancel} style={styles.backLink}><Ionicons name=\"arrow-back\" size={19} color={theme.colors.greenDark} /><Text style={styles.backLinkText}>Back to Orders</Text></Pressable>",
  "          <Pressable disabled={saving} onPress={() => setStage('products')} style={styles.backLink}><Ionicons name=\"arrow-back\" size={19} color={theme.colors.greenDark} /><Text style={styles.backLinkText}>Continue shopping</Text></Pressable>",
  'resume cart back link',
);
resume = resume.replaceAll('key={line.orderItemId}', 'key={line.key}');
resume = resume.replaceAll('priceDrafts[line.orderItemId]', 'priceDrafts[lineKey(line)]');
resume = resume.replaceAll('quantityDrafts[line.orderItemId]', 'quantityDrafts[lineKey(line)]');
resume = resume.replaceAll('[line.orderItemId]: value.replace', '[lineKey(line)]: value.replace');

resume = replaceRange(
  resume,
  "function updatedOrderItem(order: MerchantOrder, line: ResumedPosDraftLine): OrderItem {",
  "}\n\nfunction findStockShortage",
  "function findStockShortage",
  'remove obsolete updatedOrderItem',
);
resume = replaceOnce(
  resume,
  "function effectiveLinePrice(line: ResumedPosDraftLine, drafts: Record<string, string>, edited: Record<string, boolean>): number { if (!edited[line.orderItemId]) return line.uom.sellingPrice ?? 0; const value = Number(drafts[line.orderItemId] ?? ''); return Number.isFinite(value) && value >= 0 ? value : 0; }",
  "function lineKey(line: ResumedPosDraftLine): string { return line.orderItemId ?? line.key; }\nfunction effectiveLinePrice(line: ResumedPosDraftLine, drafts: Record<string, string>, edited: Record<string, boolean>): number { const key = lineKey(line); if (!edited[key]) return Number(drafts[key] ?? line.uom.sellingPrice ?? 0); const value = Number(drafts[key] ?? ''); return Number.isFinite(value) && value >= 0 ? value : 0; }",
  'resume effective price',
);
resume = replaceOnce(
  resume,
  "  stack:{gap:14},stageStack:{gap:12},loadingRow:{flexDirection:'row',alignItems:'center',gap:8},heading:{gap:3},priceEditor:",
  "  stack:{gap:14},stageStack:{gap:12},loadingRow:{flexDirection:'row',alignItems:'center',gap:8},searchBox:{minHeight:48,borderWidth:1,borderColor:theme.colors.border,borderRadius:theme.radius.md,backgroundColor:theme.colors.white,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12},searchInput:{flex:1,color:theme.colors.navy,fontSize:14},scanButton:{width:40,height:40,alignItems:'center',justifyContent:'center'},productCard:{borderRadius:theme.radius.md,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:12,gap:9},chips:{flexDirection:'row',flexWrap:'wrap',gap:6},chip:{borderWidth:1,borderColor:theme.colors.border,borderRadius:999,paddingVertical:6,paddingHorizontal:10,backgroundColor:theme.colors.white},chipActive:{borderColor:theme.colors.green,backgroundColor:theme.colors.mintSoft},chipText:{color:theme.colors.slate,fontSize:11,fontWeight:'800'},chipTextActive:{color:theme.colors.greenDark},addButton:{minHeight:42,borderRadius:theme.radius.sm,backgroundColor:theme.colors.green,flexDirection:'row',gap:6,alignItems:'center',justifyContent:'center'},pagination:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},pageButton:{minHeight:40,borderWidth:1,borderColor:theme.colors.border,borderRadius:theme.radius.sm,paddingHorizontal:14,alignItems:'center',justifyContent:'center'},pageButtonText:{color:theme.colors.greenDark,fontSize:12,fontWeight:'900'},dangerText:{color:theme.colors.danger},heading:{gap:3},priceEditor:",
  'resume product styles',
);

writeFileSync(resumePath, resume);

const redesignPath = 'apps/mobile/src/redesign/RedesignWorkspace.tsx';
let redesign = readFileSync(redesignPath, 'utf8');
redesign = replaceOnce(
  redesign,
  "import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';",
  "import { SellerTrayLoadingScreen } from '../components/SellerTrayLoadingScreen';\nimport { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';",
  'workspace loading import',
);
redesign = replaceOnce(
  redesign,
  "  if (!activeBusiness) {\n    return (\n      <View style={[styles.centered, appearance.dark && darkStyles.page]}>\n        <ActivityIndicator />\n        <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Opening your business…</Text>\n      </View>\n    );\n  }",
  "  if (!activeBusiness) return <SellerTrayLoadingScreen message=\"Opening your business…\" />;",
  'workspace branded loading',
);
writeFileSync(redesignPath, redesign);

console.log('Applied resumed POS Products -> Cart -> Payment flow and branded workspace loading.');
