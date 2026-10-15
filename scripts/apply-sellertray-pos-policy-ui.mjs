import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`Expected one ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))];
  if (matches.length !== 1) throw new Error(`Expected one ${label}, found ${matches.length}`);
  return source.replace(pattern, replacement);
}

function patchResume() {
  const path = 'apps/mobile/src/redesign/ResumePosDraftWorkspace.tsx';
  let source = readFileSync(path, 'utf8');

  source = replaceOnce(source,
    "import { updatePosDraftItems } from '../data/posSaleRepository';\n",
    "import { updatePosDraftItems } from '../data/posSaleRepository';\nimport { loadPosPaymentPolicy, type PosAllocationCheckoutResult, type PosPaymentPolicy } from '../data/posPaymentRepository';\nimport { SellerTrayLoadingScreen } from '../components/SellerTrayLoadingScreen';\n",
    'Resume payment policy imports');
  source = replaceOnce(source,
    "import {\n  buildResumedPosDraft,\n  buildResumedPosDraftEdits,\n  type ResumedPosDraftLine,\n} from './posDraftResume';\n",
    "import {\n  buildResumedPosDraft,\n  buildResumedPosDraftEdits,\n  type ResumedPosDraftLine,\n} from './posDraftResume';\nimport { PosPaymentAllocator } from './PosPaymentAllocator';\n",
    'Resume payment allocator import');

  source = replaceOnce(source,
    "  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});\n",
    "  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});\n  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});\n  const [priceEdited, setPriceEdited] = useState<Record<string, boolean>>({});\n",
    'Resume price state');
  source = replaceOnce(source,
    "  const [notice, setNotice] = useState<string | null>(null);\n",
    "  const [notice, setNotice] = useState<string | null>(null);\n  const [posPolicy, setPosPolicy] = useState<PosPaymentPolicy | null>(null);\n",
    'Resume POS policy state');

  source = replaceOnce(source,
    "      loadBranchPosPaymentMethods(tenantId, branch.id),\n    ]).then(([products, stock, methods]) => {",
    "      loadBranchPosPaymentMethods(tenantId, branch.id),\n      loadPosPaymentPolicy(tenantId),\n    ]).then(([products, stock, methods, policy]) => {",
    'Resume policy load');
  source = replaceOnce(source,
    "      setQuantityDrafts(Object.fromEntries(resumed.lines.map((line) => [line.orderItemId, formatQuantity(line.quantity)])));\n      setStockRows(stock);\n      setPaymentMethods(methods);",
    "      setQuantityDrafts(Object.fromEntries(resumed.lines.map((line) => [line.orderItemId, formatQuantity(line.quantity)])));\n      setPriceDrafts(Object.fromEntries(resumed.lines.map((line) => [line.orderItemId, formatEditablePrice(line.uom.sellingPrice ?? 0)])));\n      setPriceEdited({});\n      setStockRows(stock);\n      setPaymentMethods(methods);\n      setPosPolicy(policy);",
    'Resume loaded price and policy state');

  source = replaceOnce(source,
    "  const calculatedTotal = lines.reduce((sum, line) => sum + line.quantity * (line.uom.sellingPrice ?? 0), 0);\n",
    "  const calculatedTotal = lines.reduce((sum, line) => sum + line.quantity * effectiveLinePrice(line, priceDrafts, priceEdited), 0);\n",
    'Resume calculated total');

  source = replaceOnce(source,
    "  function setLineQuantity(line: ResumedPosDraftLine, quantity: number): boolean {\n",
    "  function setLinePrice(line: ResumedPosDraftLine, value: string) {\n    const clean = value.replace(/[^0-9.]/g, '');\n    setPriceDrafts((current) => ({ ...current, [line.orderItemId]: clean }));\n    setPriceEdited((current) => ({ ...current, [line.orderItemId]: true }));\n    setServerTotal(null);\n    setError(null);\n  }\n\n  function setLineQuantity(line: ResumedPosDraftLine, quantity: number): boolean {\n",
    'Resume price edit handler');

  source = replaceOnce(source,
    "      const edits = buildResumedPosDraftEdits(workingOrder, nextLines);\n      const editResult = await updatePosDraftItems({ tenantId, orderId: workingOrder.id, items: edits });\n      const expectedTotal = nextLines.reduce((sum, line) => sum + line.quantity * (line.uom.sellingPrice ?? 0), 0);\n",
    "      const edits = buildResumedPosDraftEdits(workingOrder, nextLines).map((edit) => {\n        if (!priceEdited[edit.orderItemId]) return edit;\n        const unitPrice = Number(priceDrafts[edit.orderItemId] ?? '');\n        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Enter a valid selling price.');\n        return { ...edit, unitPrice };\n      });\n      const editResult = await updatePosDraftItems({ tenantId, orderId: workingOrder.id, items: edits });\n      const expectedTotal = nextLines.reduce((sum, line) => sum + line.quantity * effectiveLinePrice(line, priceDrafts, priceEdited), 0);\n",
    'Resume governed price edits');

  source = replaceOnce(source,
    "  if (loading) {\n    return <View style={[styles.centerCard, dark && darkStyles.card]}><ActivityIndicator /><Text style={[styles.small, dark && darkStyles.bodyText]}>Opening saved sale…</Text></View>;\n  }\n",
    "  if (loading) return <SellerTrayLoadingScreen message=\"Opening saved sale…\" />;\n",
    'Resume branded loader');

  source = replaceOnce(source,
    "                  <Text style={[styles.productPrice, dark && darkStyles.titleText]}>{formatMoney(line.quantity * (line.uom.sellingPrice ?? 0), currency)}</Text>\n",
    "                  <Text style={[styles.productPrice, dark && darkStyles.titleText]}>{formatMoney(line.quantity * effectiveLinePrice(line, priceDrafts, priceEdited), currency)}</Text>\n                  {posPolicy?.canOverridePrice ? <View style={styles.priceEditor}><Text style={[styles.smallStrong, dark && darkStyles.bodyText]}>Unit price</Text><View style={styles.priceInputRow}><Text style={[styles.smallStrong, dark && darkStyles.bodyText]}>{currency}</Text><TextInput value={priceDrafts[line.orderItemId] ?? formatEditablePrice(line.uom.sellingPrice ?? 0)} onChangeText={(value) => setLinePrice(line, value)} keyboardType=\"decimal-pad\" editable={!saving} selectTextOnFocus style={[styles.priceInput, dark && darkStyles.input]} /></View></View> : null}\n",
    'Resume price editor');

  source = replaceOnce(source,
    "            <Notice text=\"Current product quantities can be changed or removed. SellerTray will recheck price, unit conversion and Branch stock before payment.\" dark={dark} />",
    "            <Notice text={posPolicy?.canOverridePrice ? 'Quantities and authorised selling prices can be changed on this untouched draft. SellerTray rechecks unit conversion and Branch stock before payment.' : 'Current product quantities can be changed or removed. Selling price follows the current catalogue and your SellerTray permissions.'} dark={dark} />",
    'Resume draft edit notice');

  source = replaceRegexOnce(source,
    /            <Text style=\{\[styles\.sectionTitle, dark && darkStyles\.titleText\]\}>Payment method<\/Text>[\s\S]*?            <Pressable disabled=\{completing \|\| !selectedPayment\} onPress=\{confirmSelectedPayment\}[\s\S]*?<\/Pressable>/,
    `            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Payment</Text>\n            {!posPolicy ? <View style={styles.loadingRow}><ActivityIndicator /><Text style={[styles.small, dark && darkStyles.bodyText]}>Loading POS payment rules…</Text></View> : null}\n            {!paymentMethods.length ? <ErrorCard text=\"No in-person payment method is available for this Branch.\" dark={dark} /> : null}\n            {posPolicy && paymentMethods.length ? <PosPaymentAllocator tenantId={tenantId} orderId={workingOrder.id} amountDue={total} currency={currency} paymentMethods={paymentMethods} policy={posPolicy} disabled={completing} onError={(message) => setError(message || null)} onResult={handleAllocatedCheckout} /> : null}`,
    'Resume payment block');

  source = replaceOnce(source,
    "  if (loading) return <SellerTrayLoadingScreen message=\"Opening saved sale…\" />;\n",
    "  function handleAllocatedCheckout(result: PosAllocationCheckoutResult) {\n    if (result.status === 'awaiting_payment_confirmation') {\n      Alert.alert('Payment awaiting confirmation', 'SellerTray recorded the payment allocation. Stock and collection remain unchanged until the required payment confirmation is completed.');\n    } else if (result.outstandingAmount > 0.005) {\n      Alert.alert('Sale completed with balance', `${formatMoney(result.outstandingAmount, currency)} remains outstanding on this sale.`);\n    }\n    onCompleted(result.orderId);\n  }\n\n  if (loading) return <SellerTrayLoadingScreen message=\"Opening saved sale…\" />;\n",
    'Resume allocation result handler');

  source = replaceOnce(source,
    "function formatMoney(value: number, currency: string): string { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }\n",
    "function effectiveLinePrice(line: ResumedPosDraftLine, drafts: Record<string, string>, edited: Record<string, boolean>): number { if (!edited[line.orderItemId]) return line.uom.sellingPrice ?? 0; const value = Number(drafts[line.orderItemId] ?? ''); return Number.isFinite(value) && value >= 0 ? value : 0; }\nfunction formatEditablePrice(value: number): string { return Number(value.toFixed(2)).toString(); }\nfunction formatMoney(value: number, currency: string): string { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }\n",
    'Resume price helpers');

  source = replaceOnce(source,
    "  stack:{gap:14},stageStack:{gap:12},heading:{gap:3},",
    "  stack:{gap:14},stageStack:{gap:12},heading:{gap:3},priceEditor:{marginTop:8,gap:5},priceInputRow:{flexDirection:'row',alignItems:'center',gap:8},priceInput:{minWidth:105,minHeight:42,borderWidth:1,borderColor:theme.colors.border,borderRadius:theme.radius.sm,paddingHorizontal:10,color:theme.colors.navy,fontSize:15,fontWeight:'800',backgroundColor:theme.colors.cloud},",
    'Resume price styles');

  writeFileSync(path, source);
}

function patchSell() {
  const path = 'apps/mobile/src/redesign/SellWorkspace.tsx';
  let source = readFileSync(path, 'utf8');

  source = replaceOnce(source,
    "import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';\n",
    "import { loadPosPaymentPolicy, type PosAllocationCheckoutResult, type PosPaymentPolicy } from '../data/posPaymentRepository';\nimport { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';\n",
    'Sell POS policy import');
  source = replaceOnce(source,
    "import { BarcodeScannerSheet } from './BarcodeScannerSheet';\n",
    "import { BarcodeScannerSheet } from './BarcodeScannerSheet';\nimport { PosPaymentAllocator } from './PosPaymentAllocator';\n",
    'Sell allocator import');
  source = replaceOnce(source,
    "  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);\n",
    "  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);\n  const [posPolicy, setPosPolicy] = useState<PosPaymentPolicy | null>(null);\n  const [posPolicyError, setPosPolicyError] = useState<string | null>(null);\n",
    'Sell POS policy state');

  source = replaceOnce(source,
    "  const normalizedQuery = query.trim().toLowerCase();\n",
    "  useEffect(() => {\n    let active = true;\n    setPosPolicyError(null);\n    void loadPosPaymentPolicy(tenantId).then((policy) => { if (active) setPosPolicy(policy); }).catch((err) => { if (active) { setPosPolicy(null); setPosPolicyError(err instanceof Error ? err.message : 'Unable to load POS payment rules.'); } });\n    return () => { active = false; };\n  }, [tenantId]);\n\n  const normalizedQuery = query.trim().toLowerCase();\n",
    'Sell POS policy effect');

  source = replaceOnce(source,
    "  function clearSale() {\n",
    "  async function handleAllocatedCheckout(result: PosAllocationCheckoutResult) {\n    const orderId = result.orderId;\n    clearSale();\n    if (result.status === 'awaiting_payment_confirmation') {\n      setHeldNotice('Payment recorded and awaiting the configured confirmation. Stock and collection remain unchanged until SellerTray confirms the payment.');\n      Alert.alert('Payment awaiting confirmation', 'SellerTray recorded the payment allocation. Complete the required payment confirmation before handing over goods.');\n      onDraftCreated?.(orderId);\n      return;\n    }\n    if (result.outstandingAmount > 0.005) setHeldNotice(`${formatMoney(result.outstandingAmount, currency)} remains outstanding on the completed sale.`);\n    try { await refreshBranchStock({ allowCache: true }); }\n    catch { setStockError('Sale completed, but Branch stock could not be refreshed. Refresh stock before starting another sale.'); }\n    onDraftCreated?.(orderId);\n  }\n\n  function clearSale() {\n",
    'Sell allocation result handler');

  source = replaceRegexOnce(source,
    /          <Text style=\{\[styles\.sectionTitle, dark && darkStyles\.titleText\]\}>Payment method<\/Text>[\s\S]*?          <Pressable disabled=\{completing \|\| !selectedPayment \|\| paymentMethodsLoading\}[\s\S]*?<\/Pressable>/,
    `          <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Payment</Text>\n          {paymentMethodsLoading ? <View style={styles.loadingRow}><ActivityIndicator /><Text style={[styles.small, dark && darkStyles.bodyText]}>Loading Branch payment methods…</Text></View> : null}\n          {paymentMethodError ? <ErrorCard text={paymentMethodError} dark={dark} /> : null}\n          {posPolicyError ? <ErrorCard text={posPolicyError} dark={dark} /> : null}\n          {!paymentMethodsLoading && !posPolicy && !posPolicyError ? <View style={styles.loadingRow}><ActivityIndicator /><Text style={[styles.small, dark && darkStyles.bodyText]}>Loading POS payment rules…</Text></View> : null}\n          {draftOrderId && posPolicy && !paymentMethodsLoading && !paymentMethodError ? <PosPaymentAllocator tenantId={tenantId} orderId={draftOrderId} amountDue={total} currency={currency} paymentMethods={paymentMethods} policy={posPolicy} disabled={completing} onError={(message) => setCheckoutError(message || null)} onResult={(result) => { void handleAllocatedCheckout(result); }} /> : null}`,
    'Sell payment block');

  writeFileSync(path, source);
}

function patchSettings() {
  const path = 'apps/merchant-web/src/SettingsManagement.tsx';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(source,
    "import { errorMessage, supabase } from './supabase';\n",
    "import { errorMessage, supabase } from './supabase';\nimport { PosPolicySettings } from './PosPolicySettings';\n",
    'Merchant POS settings import');
  source = replaceOnce(source,
    "    </form>\n\n    <div className=\"settings-payment-layout\">",
    "    </form>\n\n    <PosPolicySettings tenantId={tenantId} />\n\n    <div className=\"settings-payment-layout\">",
    'Merchant POS settings panel');
  writeFileSync(path, source);
}

function patchSkill() {
  const path = '.agents/skills/sellertray-project-implementation/SKILL.md';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(source,
    "- split payment where enabled;\n- receipt actions.",
    "- split payment where enabled;\n- merchant-governed partial payment and pay-later where enabled;\n- merchant-governed manual non-cash payment confirmation authority;\n- receipt actions.",
    'Skill Sell payment bullets');
  source = replaceOnce(source,
    "8. Payment remains a distinct step after the cart is accepted. Completing payment must revalidate server-side transactional invariants before payment and stock effects are committed.\n9. A branch change invalidates stale Product/Cart/Payment context safely.\n10. Tablet or desktop layouts may use a denser split-screen treatment where appropriate, but do not force that pattern onto small Android phones.",
    "8. Payment remains a distinct step after the cart is accepted. Completing payment must revalidate server-side transactional invariants before payment and stock effects are committed.\n9. Split payment, partial settlement and pay-later are merchant policy, not client hard-coding. Mobile and web must consume the same governed payment settings.\n10. `amount_paid` is the sum of confirmed allocations. An order is `paid` only when confirmed allocations cover the governed invoice amount; any remainder stays an explicit outstanding balance.\n11. Cash is cashier-confirmed physical drawer tender. Manual bank-transfer and terminal confirmation authority is merchant-configurable and must still preserve Branch access plus the configured payment capability boundary.\n12. A branch change invalidates stale Product/Cart/Payment context safely.\n13. Tablet or desktop layouts may use a denser split-screen treatment where appropriate, but do not force that pattern onto small Android phones.",
    'Skill governed payment rules');
  writeFileSync(path, source);
}

patchResume();
patchSell();
patchSettings();
patchSkill();
console.log('SellerTray POS policy UI patch applied.');
