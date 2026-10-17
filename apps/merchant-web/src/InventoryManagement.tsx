import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type Branch = { id: string; name: string };
type StockRow = { catalog_item_id: string; item_name: string; sku: string | null; category: string | null; stock_uom: string; quantity_on_hand: number | string; last_movement_at: string | null };
type LowStockRow = { catalog_item_id: string; item_name: string; sku: string | null; stock_uom: string; quantity_on_hand: number | string; low_stock_threshold: number | string; reorder_target: number | string | null; suggested_reorder_quantity: number | string | null; is_out_of_stock: boolean };
type Movement = { id: string; catalog_item_id: string; item_name: string; movement_type: string; quantity_delta: number | string; stock_uom: string; source_uom: string; source_quantity: number | string; conversion_factor: number | string; reference_type: string; reference_id: string; business_at: string; reason: string | null };
type Transfer = { id: string; reference: string; status: string; source_branch_id: string; source_branch_name: string; destination_branch_id: string; destination_branch_name: string; item_count: number; created_at: string; dispatched_at: string | null; received_at: string | null };
type ProductUom = { id: string; uom_name: string; conversion_factor: number | string; allow_fractional: boolean };
type Product = { id: string; name: string; stock_uom: string; low_stock_threshold: number | string; reorder_target: number | string | null; catalog_item_uoms: ProductUom[] | null };
type CountItem = { productId: string; productName: string; stockUom: string; captured: boolean; selectedUom: string | null; countedQuantity: number | null; expectedStockQuantity: number | null; varianceQuantity: number | null };
type StockCount = { countId: string; reference: string; reason: string; status: 'counting' | 'review' | 'applied' | 'cancelled'; totalItems: number; capturedItems: number; items: CountItem[] };
type Capabilities = { can_receive_stock?: boolean; can_adjust_stock?: boolean; can_count_stock?: boolean; can_apply_stock_count?: boolean };
type Tab = 'stock' | 'movements' | 'counts' | 'transfers';
type TransferLine = { productId: string; uomId: string; quantity: string };

const ADJUST_REASONS = ['Data correction', 'Damage', 'Expiry', 'Missing / shrinkage', 'Inventory recovery', 'Other approved adjustment'];

export default function InventoryManagement({ tenantId, branch, branches, stockRows }: { tenantId: string; branch: Branch | null; branches: Branch[]; stockRows: StockRow[] }) {
  const [tab, setTab] = useState<Tab>('stock');
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [count, setCount] = useState<StockCount | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [policyProductId, setPolicyProductId] = useState<string | null>(null);
  const [policyThreshold, setPolicyThreshold] = useState('');
  const [policyTarget, setPolicyTarget] = useState('');
  const [adjustProductId, setAdjustProductId] = useState('');
  const [adjustUomId, setAdjustUomId] = useState('');
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustDirection, setAdjustDirection] = useState<'increase' | 'decrease'>('decrease');
  const [adjustReason, setAdjustReason] = useState(ADJUST_REASONS[0]);
  const [adjustReference, setAdjustReference] = useState(() => reference('ADJ'));
  const [countReference, setCountReference] = useState(() => reference('COUNT'));
  const [countReason, setCountReason] = useState('Routine stock count');
  const [transferDestination, setTransferDestination] = useState('');
  const [transferReference, setTransferReference] = useState(() => reference('TRF'));
  const [transferReason, setTransferReason] = useState('Branch replenishment');
  const [transferLines, setTransferLines] = useState<TransferLine[]>([]);
  const [lineProductId, setLineProductId] = useState('');
  const [lineUomId, setLineUomId] = useState('');
  const [lineQty, setLineQty] = useState('');

  const selectedProduct = products.find((row) => row.id === adjustProductId) ?? null;
  const lineProduct = products.find((row) => row.id === lineProductId) ?? null;
  const policyProduct = policyProductId ? stockRows.find((row) => row.catalog_item_id === policyProductId) ?? null : null;
  const visibleStock = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return stockRows.filter((row) => !needle || [row.item_name, row.sku ?? '', row.category ?? ''].some((value) => value.toLowerCase().includes(needle)));
  }, [stockRows, search]);

  useEffect(() => {
    setMessage(null); setError(null); setCount(null); setTransfers([]); setMovements([]); setLowStock([]); setProducts([]); setPolicyProductId(null);
    if (branch) void loadBranchInventory();
  }, [tenantId, branch?.id]);
  useEffect(() => {
    const uom = selectedProduct?.catalog_item_uoms?.find((row) => row.uom_name.toLowerCase() === selectedProduct.stock_uom.toLowerCase()) ?? selectedProduct?.catalog_item_uoms?.[0];
    setAdjustUomId(uom?.id ?? '');
  }, [adjustProductId, products]);
  useEffect(() => {
    const uom = lineProduct?.catalog_item_uoms?.find((row) => row.uom_name.toLowerCase() === lineProduct.stock_uom.toLowerCase()) ?? lineProduct?.catalog_item_uoms?.[0];
    setLineUomId(uom?.id ?? '');
  }, [lineProductId, products]);

  async function loadBranchInventory() {
    if (!branch) return;
    setLoading(true); setError(null);
    try {
      const [lowResult, movementResult, transferResult, countResult, capabilityResult, productResult] = await Promise.all([
        supabase.rpc('get_sellertray_low_stock', { p_tenant_id: tenantId, p_branch_id: branch.id }),
        supabase.rpc('get_sellertray_stock_movements', { p_tenant_id: tenantId, p_branch_id: branch.id, p_catalog_item_id: null, p_limit: 200 }),
        supabase.rpc('get_sellertray_stock_transfers', { p_tenant_id: tenantId, p_branch_id: branch.id, p_limit: 100 }),
        supabase.rpc('get_sellertray_active_stock_count', { p_tenant_id: tenantId, p_branch_id: branch.id }),
        supabase.rpc('get_sellertray_inventory_capabilities', { p_tenant_id: tenantId, p_branch_id: branch.id }),
        supabase.rpc('get_sellertray_inventory_product_options', { p_tenant_id: tenantId, p_branch_id: branch.id }),
      ]);
      for (const result of [lowResult, movementResult, transferResult, countResult, capabilityResult, productResult]) if (result.error) throw result.error;
      setLowStock((lowResult.data ?? []) as LowStockRow[]);
      setMovements((movementResult.data ?? []) as Movement[]);
      setTransfers((transferResult.data ?? []) as Transfer[]);
      setCount((countResult.data ?? null) as StockCount | null);
      const cap = Array.isArray(capabilityResult.data) ? capabilityResult.data[0] : capabilityResult.data;
      setCapabilities((cap ?? {}) as Capabilities);
      const nextProducts = (productResult.data ?? []) as Product[];
      setProducts(nextProducts);
      setAdjustProductId((current) => nextProducts.some((row) => row.id === current) ? current : nextProducts[0]?.id ?? '');
      setLineProductId((current) => nextProducts.some((row) => row.id === current) ? current : nextProducts[0]?.id ?? '');
      setTransferDestination((current) => branches.some((row) => row.id === current && row.id !== branch.id) ? current : branches.find((row) => row.id !== branch.id)?.id ?? '');
    } catch (cause) { setError(errorMessage(cause, 'Unable to load inventory management data.')); }
    finally { setLoading(false); }
  }

  async function invoke(name: string, body: Record<string, unknown>) {
    const { data, error: invokeError } = await supabase.functions.invoke(name, { body });
    if (invokeError) throw invokeError;
    if (data?.error) throw new Error(String(data.error));
    return data;
  }

  async function submitAdjustment(event: FormEvent) {
    event.preventDefault(); if (!branch) return;
    const quantity = Number(adjustQty);
    if (!adjustProductId || !adjustUomId || !Number.isFinite(quantity) || quantity <= 0 || !adjustReference.trim()) { setError('Choose a product and enter a valid quantity and reference.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await invoke('inventory-operation', { tenantId, branchId: branch.id, productId: adjustProductId, uomId: adjustUomId, operation: 'adjust', quantity, adjustmentDirection: adjustDirection, reference: adjustReference, reason: adjustReason, commandId: commandId('adjust') });
      setMessage('Stock adjustment posted.'); setAdjustQty(''); setAdjustReference(reference('ADJ')); await loadBranchInventory();
    } catch (cause) { setError(errorMessage(cause, 'Unable to post this stock adjustment.')); } finally { setBusy(false); }
  }

  function editPolicy(row: StockRow) {
    const current = products.find((item) => item.id === row.catalog_item_id);
    setPolicyProductId(row.catalog_item_id);
    setPolicyThreshold(String(current ? numberValue(current.low_stock_threshold) : 0));
    setPolicyTarget(current?.reorder_target == null ? '' : String(numberValue(current.reorder_target)));
    setError(null);
    setMessage(null);
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    if (!branch || !policyProduct) return;
    const threshold = Number(policyThreshold);
    const target = policyTarget.trim() ? Number(policyTarget) : null;
    if (!Number.isFinite(threshold) || threshold < 0 || (target != null && (!Number.isFinite(target) || target < threshold))) { setError('Enter a valid threshold and a reorder target that is not below it.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await invoke('inventory-operation', { tenantId, branchId: branch.id, productId: policyProduct.catalog_item_id, operation: 'policy', lowStockThreshold: threshold, reorderTarget: target });
      setPolicyProductId(null); setPolicyThreshold(''); setPolicyTarget('');
      setMessage('Low-stock policy updated.'); await loadBranchInventory();
    }
    catch (cause) { setError(errorMessage(cause, 'Unable to update this low-stock policy.')); } finally { setBusy(false); }
  }

  async function startCount(event: FormEvent) {
    event.preventDefault(); if (!branch) return;
    setBusy(true); setError(null);
    try { await invoke('stock-count', { action: 'start', tenantId, branchId: branch.id, reference: countReference, reason: countReason }); setMessage('Stock count started.'); setCountReference(reference('COUNT')); await loadBranchInventory(); }
    catch (cause) { setError(errorMessage(cause, 'Unable to start stock count.')); } finally { setBusy(false); }
  }

  async function captureCount(item: CountItem) {
    if (!count) return;
    const product = products.find((row) => row.id === item.productId);
    const uom = product?.catalog_item_uoms?.find((row) => row.uom_name.toLowerCase() === item.stockUom.toLowerCase()) ?? product?.catalog_item_uoms?.[0];
    if (!uom) { setError(`No usable unit is configured for ${item.productName}.`); return; }
    const entered = window.prompt(`Counted quantity for ${item.productName} (${uom.uom_name})`, item.countedQuantity == null ? '' : String(item.countedQuantity));
    if (entered == null) return;
    const quantity = Number(entered); if (!Number.isFinite(quantity) || quantity < 0) { setError('Counted quantity must be zero or greater.'); return; }
    setBusy(true); setError(null);
    try { await invoke('stock-count', { action: 'capture', tenantId, countId: count.countId, productId: item.productId, uomId: uom.id, quantity }); await loadBranchInventory(); }
    catch (cause) { setError(errorMessage(cause, 'Unable to save this counted quantity.')); } finally { setBusy(false); }
  }

  async function countAction(action: 'submit' | 'apply' | 'cancel') {
    if (!count) return;
    const body: Record<string, unknown> = { action, tenantId, countId: count.countId };
    if (action === 'cancel') { const reason = window.prompt('Why is this stock count being cancelled?'); if (!reason?.trim()) return; body.reason = reason; }
    setBusy(true); setError(null);
    try { await invoke('stock-count', body); setMessage(action === 'apply' ? 'Stock count applied.' : action === 'submit' ? 'Stock count ready for review.' : 'Stock count cancelled.'); await loadBranchInventory(); }
    catch (cause) { setError(errorMessage(cause, 'Unable to complete this stock count action.')); } finally { setBusy(false); }
  }

  function addTransferLine() {
    const quantity = Number(lineQty); if (!lineProductId || !lineUomId || !Number.isFinite(quantity) || quantity <= 0) { setError('Choose a product, unit and valid transfer quantity.'); return; }
    setTransferLines((rows) => [...rows, { productId: lineProductId, uomId: lineUomId, quantity: String(quantity) }]); setLineQty(''); setError(null);
  }

  async function createTransfer(event: FormEvent) {
    event.preventDefault(); if (!branch) return;
    if (!transferDestination || !transferLines.length || !transferReference.trim() || !transferReason.trim()) { setError('Choose a destination and add at least one product.'); return; }
    setBusy(true); setError(null);
    try {
      await invoke('stock-transfer', { action: 'create', tenantId, sourceBranchId: branch.id, destinationBranchId: transferDestination, reference: transferReference, reason: transferReason, items: transferLines.map((row) => ({ catalogItemId: row.productId, uomId: row.uomId, quantity: Number(row.quantity) })) });
      setMessage('Stock transfer saved as draft.'); setTransferLines([]); setTransferReference(reference('TRF')); await loadBranchInventory();
    } catch (cause) { setError(errorMessage(cause, 'Unable to create this stock transfer.')); } finally { setBusy(false); }
  }

  async function transferAction(transfer: Transfer, action: 'dispatch' | 'receive' | 'cancel') {
    const body: Record<string, unknown> = { action, tenantId, transferId: transfer.id };
    if (action === 'cancel') { const reason = window.prompt('Why is this transfer being cancelled?'); if (!reason?.trim()) return; body.reason = reason; }
    setBusy(true); setError(null);
    try { await invoke('stock-transfer', body); setMessage(action === 'dispatch' ? 'Transfer dispatched.' : action === 'receive' ? 'Transfer received into the destination Branch.' : 'Transfer cancelled.'); await loadBranchInventory(); }
    catch (cause) { setError(errorMessage(cause, 'Unable to complete this transfer action.')); } finally { setBusy(false); }
  }

  if (!branch) return <div className="page-stack"><Heading title="Inventory" note="Choose a Branch to manage stock." /><Empty title="No active Branch" body="Inventory actions require an explicit Branch context." /></div>;

  return <div className="page-stack">
    <Heading title="Inventory" note={`Manage ${branch.name} stock without bypassing purchasing, transfers or the stock ledger.`} />
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}
    <div className="metric-grid"><Metric label="Products" value={stockRows.length} /><Metric label="Low stock" value={lowStock.length} /><Metric label="Out of stock" value={lowStock.filter((row) => row.is_out_of_stock).length} /><Metric label="Open transfers" value={transfers.filter((row) => row.status === 'draft' || row.status === 'dispatched').length} /></div>
    <div className="tab-row">{(['stock','movements','counts','transfers'] as Tab[]).map((value) => <button key={value} className={tab === value ? 'tab active' : 'tab'} onClick={() => setTab(value)}>{value === 'stock' ? 'Stock' : value === 'movements' ? 'Movement history' : value === 'counts' ? 'Stock count' : 'Transfers'}</button>)}</div>

    {tab === 'stock' ? <>
      <article className="panel"><div className="panel-head"><div><p className="eyebrow">Branch stock</p><h3>On-hand quantities</h3></div><input className="search-input" placeholder="Search products" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <Table headers={['Product','SKU','Category','On hand','Stock unit','Last movement','Low-stock policy']}>{visibleStock.map((row) => <tr key={row.catalog_item_id}><td><strong>{row.item_name}</strong></td><td>{row.sku || '—'}</td><td>{row.category || '—'}</td><td className={numberValue(row.quantity_on_hand) <= 0 ? 'danger-text' : ''}>{formatNumber(numberValue(row.quantity_on_hand))}</td><td>{row.stock_uom}</td><td>{row.last_movement_at ? dateTime(row.last_movement_at) : 'No movement'}</td><td><button className="text-button" disabled={busy} onClick={() => editPolicy(row)}>Edit policy</button></td></tr>)}</Table>
        {!visibleStock.length ? <Empty title="No stock rows" body="Products appear here when the shared catalogue and stock ledger are available for this Branch." /> : null}
      </article>
      {policyProduct ? <form className="panel product-editor-stack" onSubmit={savePolicy}><div className="panel-head"><div><p className="eyebrow">Replenishment policy</p><h3>{policyProduct.item_name}</h3><p className="muted">Set thresholds in {policyProduct.stock_uom} for {branch.name}. This does not move or invent stock.</p></div><button type="button" className="text-button" disabled={busy} onClick={() => setPolicyProductId(null)}>Close</button></div><div className="form-grid">
        <label className="field">Low-stock threshold<input type="number" min="0" step="any" value={policyThreshold} onChange={(event) => setPolicyThreshold(event.target.value)} /></label>
        <label className="field">Reorder target<input type="number" min="0" step="any" value={policyTarget} onChange={(event) => setPolicyTarget(event.target.value)} placeholder="Optional" /></label>
      </div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save policy'}</button></div></form> : null}
      {capabilities.can_adjust_stock ? <form className="panel product-editor-stack" onSubmit={submitAdjustment}><div className="panel-head"><div><p className="eyebrow">Controlled correction</p><h3>Adjust stock</h3></div></div><p className="muted">Use this only for corrections, damage, expiry, shrinkage or recovery. Supplier receipts belong in Purchasing and Branch receipts belong in Transfers.</p><div className="form-grid">
        <label className="field">Product<select value={adjustProductId} onChange={(event) => setAdjustProductId(event.target.value)}>{products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="field">Unit<select value={adjustUomId} onChange={(event) => setAdjustUomId(event.target.value)}>{selectedProduct?.catalog_item_uoms?.map((row) => <option key={row.id} value={row.id}>{row.uom_name}</option>)}</select></label>
        <label className="field">Quantity<input type="number" min="0" step="any" value={adjustQty} onChange={(event) => setAdjustQty(event.target.value)} /></label>
        <label className="field">Direction<select value={adjustDirection} onChange={(event) => setAdjustDirection(event.target.value as 'increase' | 'decrease')}><option value="decrease">Reduce stock</option><option value="increase">Increase stock</option></select></label>
        <label className="field">Reason<select value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)}>{ADJUST_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
        <label className="field">Reference<input value={adjustReference} onChange={(event) => setAdjustReference(event.target.value)} /></label>
      </div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Posting…' : 'Post adjustment'}</button></div></form> : null}
    </> : null}

    {tab === 'movements' ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">Audit trail</p><h3>Stock movement history</h3></div><button className="secondary-button" disabled={loading} onClick={() => void loadBranchInventory()}>Refresh</button></div><Table headers={['When','Product','Movement','Quantity','Source','Reference','Reason']}>{movements.map((row) => <tr key={row.id}><td>{dateTime(row.business_at)}</td><td><strong>{row.item_name}</strong></td><td>{label(row.movement_type)}</td><td className={numberValue(row.quantity_delta) < 0 ? 'danger-text' : ''}>{signed(numberValue(row.quantity_delta))} {row.stock_uom}</td><td>{formatNumber(numberValue(row.source_quantity))} {row.source_uom}</td><td>{row.reference_id || '—'}</td><td>{row.reason || '—'}</td></tr>)}</Table>{!movements.length ? <Empty title="No movements yet" body="Posted sales, returns, purchase receipts, adjustments, counts and transfers will appear here." /> : null}</article> : null}

    {tab === 'counts' ? <>{count ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">{label(count.status)}</p><h3>{count.reference}</h3><p className="muted">{count.capturedItems} of {count.totalItems} products captured</p></div><div className="form-actions">{count.status === 'counting' ? <button className="primary-button" disabled={busy || count.capturedItems !== count.totalItems} onClick={() => void countAction('submit')}>Review variance</button> : null}{count.status === 'review' && capabilities.can_apply_stock_count ? <button className="primary-button" disabled={busy} onClick={() => void countAction('apply')}>Apply count</button> : null}{count.status !== 'applied' && count.status !== 'cancelled' ? <button className="secondary-button" disabled={busy} onClick={() => void countAction('cancel')}>Cancel</button> : null}</div></div><Table headers={['Product','Counted','Expected','Variance','Action']}>{count.items.map((item) => <tr key={item.productId}><td><strong>{item.productName}</strong></td><td>{item.captured ? `${formatNumber(item.countedQuantity ?? 0)} ${item.selectedUom ?? item.stockUom}` : 'Not counted'}</td><td>{item.expectedStockQuantity == null ? 'Hidden until review' : `${formatNumber(item.expectedStockQuantity)} ${item.stockUom}`}</td><td className={item.varianceQuantity != null && item.varianceQuantity !== 0 ? 'danger-text' : ''}>{item.varianceQuantity == null ? '—' : `${signed(item.varianceQuantity)} ${item.stockUom}`}</td><td>{count.status === 'counting' ? <button className="text-button" disabled={busy} onClick={() => void captureCount(item)}>{item.captured ? 'Update count' : 'Enter count'}</button> : '—'}</td></tr>)}</Table></article> : capabilities.can_count_stock ? <form className="panel product-editor-stack" onSubmit={startCount}><div className="panel-head"><div><p className="eyebrow">Physical verification</p><h3>Start stock count</h3></div></div><div className="form-grid"><label className="field">Reference<input value={countReference} onChange={(event) => setCountReference(event.target.value)} /></label><label className="field">Reason<input value={countReason} onChange={(event) => setCountReason(event.target.value)} /></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>Start count</button></div></form> : <Empty title="Stock count unavailable" body="Your SellerTray permissions do not allow starting a stock count for this Branch." />}</> : null}

    {tab === 'transfers' ? <><article className="panel"><div className="panel-head"><div><p className="eyebrow">Branch movement</p><h3>Stock transfers</h3></div></div><Table headers={['Reference','From','To','Products','Status','Created','Action']}>{transfers.map((row) => <tr key={row.id}><td><strong>{row.reference}</strong></td><td>{row.source_branch_name}</td><td>{row.destination_branch_name}</td><td>{row.item_count}</td><td>{label(row.status)}</td><td>{dateTime(row.created_at)}</td><td><div className="form-actions">{row.status === 'draft' && row.source_branch_id === branch.id ? <button className="text-button" disabled={busy} onClick={() => void transferAction(row,'dispatch')}>Dispatch</button> : null}{row.status === 'dispatched' && row.destination_branch_id === branch.id ? <button className="text-button" disabled={busy} onClick={() => void transferAction(row,'receive')}>Receive</button> : null}{row.status === 'draft' ? <button className="text-button" disabled={busy} onClick={() => void transferAction(row,'cancel')}>Cancel</button> : null}</div></td></tr>)}</Table>{!transfers.length ? <Empty title="No transfers" body="Transfers involving this Branch will appear here." /> : null}</article>
      {branches.some((row) => row.id !== branch.id) ? <form className="panel product-editor-stack" onSubmit={createTransfer}><div className="panel-head"><div><p className="eyebrow">Move between Branches</p><h3>New stock transfer</h3></div></div><div className="form-grid"><label className="field">Destination<select value={transferDestination} onChange={(event) => setTransferDestination(event.target.value)}>{branches.filter((row) => row.id !== branch.id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="field">Reference<input value={transferReference} onChange={(event) => setTransferReference(event.target.value)} /></label><label className="field">Reason<input value={transferReason} onChange={(event) => setTransferReason(event.target.value)} /></label></div><div className="form-grid"><label className="field">Product<select value={lineProductId} onChange={(event) => setLineProductId(event.target.value)}>{products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="field">Unit<select value={lineUomId} onChange={(event) => setLineUomId(event.target.value)}>{lineProduct?.catalog_item_uoms?.map((row) => <option key={row.id} value={row.id}>{row.uom_name}</option>)}</select></label><label className="field">Quantity<input type="number" min="0" step="any" value={lineQty} onChange={(event) => setLineQty(event.target.value)} /></label><div className="field"><span>Transfer line</span><button type="button" className="secondary-button" onClick={addTransferLine}>Add product</button></div></div>{transferLines.length ? <Table headers={['Product','Unit','Quantity','']}>{transferLines.map((line,index) => { const product = products.find((row) => row.id === line.productId); const uom = product?.catalog_item_uoms?.find((row) => row.id === line.uomId); return <tr key={`${line.productId}-${index}`}><td>{product?.name ?? 'Product'}</td><td>{uom?.uom_name ?? 'Unit'}</td><td>{line.quantity}</td><td><button type="button" className="text-button" onClick={() => setTransferLines((rows) => rows.filter((_,i) => i !== index))}>Remove</button></td></tr>; })}</Table> : null}<div className="form-actions"><button className="primary-button" disabled={busy || !transferLines.length}>Save transfer</button></div></form> : <Empty title="One Branch only" body="Add another Branch before creating stock transfers." />}</> : null}
  </div>;
}

function Heading({ title, note }: { title: string; note: string }) { return <div className="section-heading"><div><p className="eyebrow">Stock</p><h2>{title}</h2></div><p className="muted">{note}</p></div>; }
function Metric({ label: text, value }: { label: string; value: number }) { return <article className="metric-card"><span>{text}</span><strong>{value}</strong><small>Selected Branch</small></article>; }
function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) { return <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>; }
function label(value: string) { return value.replaceAll('_',' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatNumber(value: number) { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 3 }).format(value); }
function signed(value: number) { return `${value > 0 ? '+' : ''}${formatNumber(value)}`; }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function reference(prefix: string) { const now = new Date(); const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`; return `${prefix}-${stamp}`; }
function commandId(prefix: string) { return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2,10)}`; }
