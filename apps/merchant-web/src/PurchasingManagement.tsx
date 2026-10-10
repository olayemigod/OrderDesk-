import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type View = 'orders' | 'suppliers';
type Branch = { id: string; name: string; isDefault: boolean };
type Supplier = {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
};
type Uom = { id: string; name: string; conversionFactor: number; isDefaultPurchase: boolean };
type Product = { id: string; name: string; sku: string | null; stockUom: string; uoms: Uom[] };
type PurchaseOrderRow = {
  id: string;
  reference: string;
  status: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  totalAmount: number;
  itemCount: number;
  expectedDate: string | null;
  createdAt: string;
};
type PurchaseItem = {
  itemId: string;
  catalogItemId: string;
  uomId: string;
  productName: string;
  sku: string | null;
  selectedUom: string;
  conversionFactor: number;
  orderedQuantity: number;
  unitCost: number;
  lineTotal: number;
  receivedQuantity: number;
  remainingQuantity: number;
};
type Receipt = { receiptId: string; reference: string; receivedAt: string; notes: string | null; itemCount: number };
type PurchaseDetail = {
  purchaseOrderId: string;
  reference: string;
  status: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  totalAmount: number;
  expectedDate: string | null;
  notes: string | null;
  createdAt: string;
  orderedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: PurchaseItem[];
  receipts: Receipt[];
};
type SupplierDraft = Omit<Supplier, 'id'>;
type LineDraft = { key: string; catalogItemId: string; uomId: string; quantity: string; unitCost: string };
type PurchaseDraft = { reference: string; branchId: string; supplierId: string; expectedDate: string; notes: string; items: LineDraft[] };

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  stock_uom: string;
  catalog_item_uoms: Array<{
    id: string;
    uom_name: string;
    conversion_factor: number | string;
    is_default_purchase: boolean;
  }> | null;
};

const EMPTY_SUPPLIER: SupplierDraft = { name: '', contactName: '', phone: '', email: '', address: '', notes: '', isActive: true };

export default function PurchasingManagement({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [view, setView] = useState<View>('orders');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierDraft, setSupplierDraft] = useState<SupplierDraft>(EMPTY_SUPPLIER);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [draft, setDraft] = useState<PurchaseDraft>(() => emptyPurchase());
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedSupplier = useMemo(() => suppliers.find((row) => row.id === selectedSupplierId) ?? null, [suppliers, selectedSupplierId]);
  const activeSuppliers = useMemo(() => suppliers.filter((row) => row.isActive), [suppliers]);
  const draftTotal = useMemo(() => draft.items.reduce((sum, row) => sum + positive(row.quantity) * nonNegative(row.unitCost), 0), [draft.items]);
  const editable = !detail || detail.status === 'draft';

  useEffect(() => { void loadFoundation(); }, [tenantId]);

  useEffect(() => {
    if (!selectedSupplier) return;
    setSupplierDraft({
      name: selectedSupplier.name,
      contactName: selectedSupplier.contactName,
      phone: selectedSupplier.phone,
      email: selectedSupplier.email,
      address: selectedSupplier.address,
      notes: selectedSupplier.notes,
      isActive: selectedSupplier.isActive,
    });
  }, [selectedSupplierId]);

  useEffect(() => {
    if (selectedOrderId) void loadDetail(selectedOrderId);
  }, [selectedOrderId]);

  async function loadFoundation(preferredOrderId?: string | null, preferredSupplierId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const [branchResult, supplierResult, productResult, orderResult] = await Promise.all([
        supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId }),
        supabase.rpc('get_sellertray_suppliers', { p_tenant_id: tenantId }),
        supabase.from('catalog_items').select(`id,name,sku,stock_uom,catalog_item_uoms(id,uom_name,conversion_factor,is_default_purchase)`).eq('tenant_id', tenantId).eq('is_active', true).order('name', { ascending: true }),
        supabase.rpc('get_sellertray_purchase_orders', { p_tenant_id: tenantId, p_branch_id: null, p_limit: 200 }),
      ]);
      if (branchResult.error) throw branchResult.error;
      if (supplierResult.error) throw supplierResult.error;
      if (productResult.error) throw productResult.error;
      if (orderResult.error) throw orderResult.error;

      const nextBranches = ((branchResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''), name: String(row.name ?? 'Branch'), isDefault: row.is_default === true,
      })).filter((row) => row.id);
      const nextSuppliers = ((supplierResult.data ?? []) as Array<Record<string, unknown>>).map(mapSupplier);
      const nextProducts = ((productResult.data ?? []) as unknown as ProductRow[]).map(mapProduct).filter((row) => row.uoms.length > 0);
      const nextOrders = ((orderResult.data ?? []) as Array<Record<string, unknown>>).map(mapOrder);

      setBranches(nextBranches);
      setSuppliers(nextSuppliers);
      setProducts(nextProducts);
      setOrders(nextOrders);

      const wantedSupplier = preferredSupplierId ?? selectedSupplierId;
      setSelectedSupplierId(wantedSupplier && nextSuppliers.some((row) => row.id === wantedSupplier) ? wantedSupplier : nextSuppliers[0]?.id ?? null);

      const wantedOrder = preferredOrderId ?? selectedOrderId;
      const nextOrderId = wantedOrder && nextOrders.some((row) => row.id === wantedOrder) ? wantedOrder : nextOrders[0]?.id ?? null;
      setSelectedOrderId(nextOrderId);
      if (!nextOrderId) startNewOrder(nextBranches, nextSuppliers);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load purchasing.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(orderId: string) {
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_purchase_order_detail', {
        p_tenant_id: tenantId,
        p_purchase_order_id: orderId,
      });
      if (rpcError) throw rpcError;
      const next = parseDetail(data);
      setDetail(next);
      setDraft({
        reference: next.reference,
        branchId: next.branchId,
        supplierId: next.supplierId,
        expectedDate: next.expectedDate ?? '',
        notes: next.notes ?? '',
        items: next.items.map((item) => ({
          key: item.itemId,
          catalogItemId: item.catalogItemId,
          uomId: item.uomId,
          quantity: String(item.orderedQuantity),
          unitCost: String(item.unitCost),
        })),
      });
      setCancelReason('');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load this purchase order.'));
    }
  }

  function startNewOrder(branchRows = branches, supplierRows = suppliers) {
    setSelectedOrderId(null);
    setDetail(null);
    setDraft({
      reference: '',
      branchId: branchRows.find((row) => row.isDefault)?.id ?? branchRows[0]?.id ?? '',
      supplierId: supplierRows.find((row) => row.isActive)?.id ?? '',
      expectedDate: '',
      notes: '',
      items: [emptyLine()],
    });
    setCancelReason('');
    clearNotice();
  }

  function startNewSupplier() {
    setSelectedSupplierId(null);
    setSupplierDraft(EMPTY_SUPPLIER);
    clearNotice();
  }

  async function saveSupplier(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    clearNotice();
    try {
      const { data, error: rpcError } = await supabase.rpc('save_sellertray_supplier', {
        p_tenant_id: tenantId,
        p_supplier_id: selectedSupplierId,
        p_name: supplierDraft.name,
        p_contact_name: clean(supplierDraft.contactName),
        p_phone: clean(supplierDraft.phone),
        p_email: clean(supplierDraft.email),
        p_address: clean(supplierDraft.address),
        p_notes: clean(supplierDraft.notes),
        p_is_active: supplierDraft.isActive,
      });
      if (rpcError) throw rpcError;
      const row = object(data);
      const supplierId = typeof row.supplierId === 'string' ? row.supplierId : selectedSupplierId;
      setMessage(selectedSupplierId ? 'Supplier updated.' : 'Supplier created.');
      await loadFoundation(selectedOrderId, supplierId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this supplier.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (!draft.branchId || !draft.supplierId) return setError('Choose a Branch and Supplier.');
    const lines = draft.items.map(toCommandLine).filter(Boolean);
    if (!lines.length || lines.length !== draft.items.length) return setError('Every purchase line needs a product, unit, positive quantity and valid cost.');
    const duplicate = new Set(lines.map((line) => `${line.catalogItemId}:${line.uomId}`)).size !== lines.length;
    if (duplicate) return setError('The same product and unit can appear only once on a purchase order.');

    setBusy(true);
    clearNotice();
    try {
      const { data, error: rpcError } = await supabase.rpc('save_sellertray_purchase_order', {
        p_tenant_id: tenantId,
        p_purchase_order_id: selectedOrderId,
        p_branch_id: draft.branchId,
        p_supplier_id: draft.supplierId,
        p_reference: clean(draft.reference),
        p_expected_date: clean(draft.expectedDate),
        p_notes: clean(draft.notes),
        p_items: lines,
      });
      if (rpcError) throw rpcError;
      const row = object(data);
      const orderId = typeof row.purchaseOrderId === 'string' ? row.purchaseOrderId : selectedOrderId;
      if (!orderId) throw new Error('SellerTray did not return the purchase order reference.');
      setMessage(selectedOrderId ? 'Purchase Order updated.' : 'Purchase Order created.');
      await loadFoundation(orderId, selectedSupplierId);
      await loadDetail(orderId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this Purchase Order.'));
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder() {
    if (!selectedOrderId || detail?.status !== 'draft') return;
    setBusy(true);
    clearNotice();
    try {
      const { error: rpcError } = await supabase.rpc('place_sellertray_purchase_order', {
        p_tenant_id: tenantId,
        p_purchase_order_id: selectedOrderId,
      });
      if (rpcError) throw rpcError;
      setMessage('Purchase Order placed. Stock can now be received in SellerTray mobile.');
      await loadFoundation(selectedOrderId, selectedSupplierId);
      await loadDetail(selectedOrderId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to place this Purchase Order.'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder() {
    if (!selectedOrderId || !detail || !['draft', 'ordered'].includes(detail.status)) return;
    if (!cancelReason.trim()) return setError('Enter a cancellation reason.');
    setBusy(true);
    clearNotice();
    try {
      const { error: rpcError } = await supabase.rpc('cancel_sellertray_purchase_order', {
        p_tenant_id: tenantId,
        p_purchase_order_id: selectedOrderId,
        p_reason: cancelReason,
      });
      if (rpcError) throw rpcError;
      setMessage('Purchase Order cancelled.');
      await loadFoundation(selectedOrderId, selectedSupplierId);
      await loadDetail(selectedOrderId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to cancel this Purchase Order.'));
    } finally {
      setBusy(false);
    }
  }

  function addLine() {
    setDraft((current) => ({ ...current, items: [...current.items, emptyLine()] }));
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((line) => line.key === key ? { ...line, ...patch } : line),
    }));
  }

  function removeLine(key: string) {
    setDraft((current) => ({ ...current, items: current.items.length > 1 ? current.items.filter((line) => line.key !== key) : current.items }));
  }

  function chooseProduct(line: LineDraft, catalogItemId: string) {
    const product = products.find((row) => row.id === catalogItemId);
    const uom = product?.uoms.find((row) => row.isDefaultPurchase) ?? product?.uoms[0];
    updateLine(line.key, { catalogItemId, uomId: uom?.id ?? '' });
  }

  function clearNotice() {
    setError(null);
    setMessage(null);
  }

  if (loading) return <article className="panel"><p className="muted">Loading purchasing…</p></article>;

  return <div className="page-stack purchasing-page">
    <div className="section-heading purchasing-heading">
      <div><p className="eyebrow">Stock procurement</p><h2>Purchasing</h2></div>
      <div className="purchasing-tabs"><button className={view === 'orders' ? 'active' : ''} onClick={() => setView('orders')}>Purchase Orders</button><button className={view === 'suppliers' ? 'active' : ''} onClick={() => setView('suppliers')}>Suppliers</button></div>
    </div>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {view === 'suppliers' ? <div className="purchase-two-column">
      <article className="panel purchase-list-panel">
        <div className="panel-head"><div><p className="eyebrow">Suppliers</p><h3>Supplier directory</h3></div><button className="secondary-button" onClick={startNewSupplier}>New supplier</button></div>
        {suppliers.length ? <div className="device-list">{suppliers.map((row) => <button key={row.id} className={selectedSupplierId === row.id ? 'device-row selected' : 'device-row'} onClick={() => setSelectedSupplierId(row.id)}><span><strong>{row.name}</strong><small>{row.contactName || row.phone || row.email || 'No contact details'}</small></span><span className="device-row-badges"><em className={row.isActive ? 'good' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</em></span></button>)}</div> : <Empty title="No suppliers" body="Add a supplier before creating a Purchase Order." />}
      </article>
      <form className="panel purchase-form" onSubmit={saveSupplier}>
        <div className="panel-head"><div><p className="eyebrow">Supplier details</p><h3>{selectedSupplier?.name ?? 'New supplier'}</h3></div></div>
        <div className="purchase-field-grid"><Field label="Supplier name"><input required value={supplierDraft.name} onChange={(event) => setSupplierDraft((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="Contact person"><input value={supplierDraft.contactName} onChange={(event) => setSupplierDraft((current) => ({ ...current, contactName: event.target.value }))} /></Field><Field label="Phone"><input value={supplierDraft.phone} onChange={(event) => setSupplierDraft((current) => ({ ...current, phone: event.target.value }))} /></Field><Field label="Email"><input type="email" value={supplierDraft.email} onChange={(event) => setSupplierDraft((current) => ({ ...current, email: event.target.value }))} /></Field></div>
        <Field label="Address"><textarea rows={2} value={supplierDraft.address} onChange={(event) => setSupplierDraft((current) => ({ ...current, address: event.target.value }))} /></Field>
        <Field label="Notes"><textarea rows={3} value={supplierDraft.notes} onChange={(event) => setSupplierDraft((current) => ({ ...current, notes: event.target.value }))} /></Field>
        <label className="settings-toggle"><input type="checkbox" checked={supplierDraft.isActive} onChange={(event) => setSupplierDraft((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active supplier</span></label>
        <div className="purchase-actions"><button className="primary-button" disabled={busy}>{busy ? 'Saving' : 'Save supplier'}</button></div>
      </form>
    </div> : <div className="purchase-two-column orders-layout">
      <article className="panel purchase-list-panel">
        <div className="panel-head"><div><p className="eyebrow">Purchase Orders</p><h3>Purchase history</h3></div><button className="secondary-button" disabled={!activeSuppliers.length || !branches.length} onClick={() => startNewOrder()}>New Purchase Order</button></div>
        {orders.length ? <div className="purchase-order-list">{orders.map((row) => <button key={row.id} className={selectedOrderId === row.id ? 'purchase-order-row selected' : 'purchase-order-row'} onClick={() => setSelectedOrderId(row.id)}><span><strong>{row.reference}</strong><small>{row.supplierName} · {row.branchName}</small></span><span><strong>{money(row.totalAmount, row.currency)}</strong><small>{statusLabel(row.status)} · {row.itemCount} items</small></span></button>)}</div> : <Empty title="No Purchase Orders" body="Create a Purchase Order after adding a Supplier." />}
      </article>

      <form className="panel purchase-form purchase-order-form" onSubmit={saveDraft}>
        <div className="panel-head"><div><p className="eyebrow">Purchase Order</p><h3>{detail?.reference ?? 'New Purchase Order'}</h3></div>{detail ? <span className={`status-pill ${detail.status === 'received' ? 'good' : detail.status === 'cancelled' ? 'bad' : 'neutral'}`}>{statusLabel(detail.status)}</span> : null}</div>
        {!activeSuppliers.length ? <div className="warning-box">Add an active Supplier before creating a Purchase Order.</div> : null}
        <div className="purchase-field-grid">
          <Field label="Branch"><select required disabled={!editable} value={draft.branchId} onChange={(event) => setDraft((current) => ({ ...current, branchId: event.target.value }))}><option value="">Select Branch</option>{branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
          <Field label="Supplier"><select required disabled={!editable} value={draft.supplierId} onChange={(event) => setDraft((current) => ({ ...current, supplierId: event.target.value }))}><option value="">Select Supplier</option>{activeSuppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}{detail && !activeSuppliers.some((row) => row.id === detail.supplierId) ? <option value={detail.supplierId}>{detail.supplierName}</option> : null}</select></Field>
          <Field label="Reference"><input disabled={!editable} value={draft.reference} onChange={(event) => setDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="Auto-generated if blank" /></Field>
          <Field label="Expected date"><input type="date" disabled={!editable} value={draft.expectedDate} onChange={(event) => setDraft((current) => ({ ...current, expectedDate: event.target.value }))} /></Field>
        </div>
        <Field label="Notes"><textarea rows={2} disabled={!editable} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></Field>

        <div className="purchase-lines-head"><div><p className="eyebrow">Items</p><h4>{detail ? `${detail.items.length} items` : `${draft.items.length} items`}</h4></div>{editable ? <button type="button" className="secondary-button" onClick={addLine}>Add item</button> : null}</div>
        {editable ? <div className="purchase-lines">{draft.items.map((line) => {
          const product = products.find((row) => row.id === line.catalogItemId);
          const uoms = product?.uoms ?? [];
          return <div className="purchase-line" key={line.key}>
            <Field label="Product"><select required value={line.catalogItemId} onChange={(event) => chooseProduct(line, event.target.value)}><option value="">Select product</option>{products.map((row) => <option key={row.id} value={row.id}>{row.name}{row.sku ? ` · ${row.sku}` : ''}</option>)}</select></Field>
            <Field label="Purchase UOM"><select required value={line.uomId} onChange={(event) => updateLine(line.key, { uomId: event.target.value })}><option value="">Select unit</option>{uoms.map((row) => <option key={row.id} value={row.id}>{row.name} × {formatNumber(row.conversionFactor)} {product?.stockUom}</option>)}</select></Field>
            <Field label="Quantity"><input type="number" min="0.000001" step="any" required value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></Field>
            <Field label={`Unit cost (${currency})`}><input type="number" min="0" step="0.01" required value={line.unitCost} onChange={(event) => updateLine(line.key, { unitCost: event.target.value })} /></Field>
            <div className="purchase-line-total"><span>Line total</span><strong>{money(positive(line.quantity) * nonNegative(line.unitCost), currency)}</strong></div>
            <button type="button" className="text-button danger-text" onClick={() => removeLine(line.key)} disabled={draft.items.length === 1}>Remove</button>
          </div>;
        })}</div> : <div className="table-wrap"><table><thead><tr><th>Product</th><th>UOM</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Unit cost</th><th>Total</th></tr></thead><tbody>{detail?.items.map((item) => <tr key={item.itemId}><td><strong>{item.productName}</strong><small className="report-subline">{item.sku || 'No SKU'}</small></td><td>{item.selectedUom}<small className="report-subline">× {formatNumber(item.conversionFactor)}</small></td><td>{formatNumber(item.orderedQuantity)}</td><td>{formatNumber(item.receivedQuantity)}</td><td>{formatNumber(item.remainingQuantity)}</td><td>{money(item.unitCost, detail.currency)}</td><td>{money(item.lineTotal, detail.currency)}</td></tr>)}</tbody></table></div>}

        <div className="purchase-total"><span>Total</span><strong>{money(detail && !editable ? detail.totalAmount : draftTotal, detail?.currency ?? currency)}</strong></div>
        {editable ? <div className="purchase-actions"><button className="primary-button" disabled={busy || !activeSuppliers.length}>{busy ? 'Saving' : 'Save draft'}</button>{detail?.status === 'draft' ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void placeOrder()}>Place Purchase Order</button> : null}</div> : null}

        {detail && ['ordered', 'partially_received'].includes(detail.status) ? <div className="mobile-operation-note"><strong>Receive stock in SellerTray mobile</strong><p>This Purchase Order is ready for operational receiving. Merchant Web tracks ordered, received and remaining quantities but does not post stock.</p></div> : null}

        {detail?.receipts.length ? <div className="purchase-receipts"><div className="purchase-lines-head"><div><p className="eyebrow">Receipts</p><h4>Stock received</h4></div></div><div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Items</th><th>Received</th><th>Notes</th></tr></thead><tbody>{detail.receipts.map((row) => <tr key={row.receiptId}><td><strong>{row.reference}</strong></td><td>{row.itemCount}</td><td>{dateTime(row.receivedAt)}</td><td>{row.notes || '—'}</td></tr>)}</tbody></table></div></div> : null}

        {detail && ['draft', 'ordered'].includes(detail.status) ? <div className="purchase-cancel"><Field label="Cancellation reason"><input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Required to cancel" /></Field><button type="button" className="secondary-button danger-text" disabled={busy || !cancelReason.trim()} onClick={() => void cancelOrder()}>Cancel Purchase Order</button></div> : null}
        {detail?.status === 'cancelled' ? <div className="warning-box"><strong>Cancelled:</strong> {detail.cancelReason || 'No reason recorded.'}</div> : null}
      </form>
    </div>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="purchase-field"><span>{label}</span>{children}</label>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>; }
function emptyPurchase(): PurchaseDraft { return { reference: '', branchId: '', supplierId: '', expectedDate: '', notes: '', items: [emptyLine()] }; }
function emptyLine(): LineDraft { return { key: crypto.randomUUID(), catalogItemId: '', uomId: '', quantity: '1', unitCost: '0' }; }
function clean(value: string): string | null { const next = value.trim(); return next || null; }
function positive(value: string): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function nonNegative(value: string): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
function toCommandLine(row: LineDraft): { catalogItemId: string; uomId: string; quantity: number; unitCost: number } | null { const quantity = positive(row.quantity); const unitCost = nonNegative(row.unitCost); return row.catalogItemId && row.uomId && quantity > 0 ? { catalogItemId: row.catalogItemId, uomId: row.uomId, quantity, unitCost } : null; }
function mapSupplier(row: Record<string, unknown>): Supplier { return { id: String(row.id ?? ''), name: String(row.name ?? 'Supplier'), contactName: text(row.contact_name), phone: text(row.phone), email: text(row.email), address: text(row.address), notes: text(row.notes), isActive: row.is_active === true }; }
function mapProduct(row: ProductRow): Product { return { id: row.id, name: row.name, sku: row.sku, stockUom: row.stock_uom, uoms: (row.catalog_item_uoms ?? []).map((unit) => ({ id: unit.id, name: unit.uom_name, conversionFactor: numberValue(unit.conversion_factor), isDefaultPurchase: unit.is_default_purchase })).sort((a, b) => Number(b.isDefaultPurchase) - Number(a.isDefaultPurchase) || a.name.localeCompare(b.name)) }; }
function mapOrder(row: Record<string, unknown>): PurchaseOrderRow { return { id: String(row.id ?? ''), reference: String(row.reference ?? 'Purchase Order'), status: String(row.status ?? 'draft'), branchId: String(row.branch_id ?? ''), branchName: String(row.branch_name ?? 'Branch'), supplierId: String(row.supplier_id ?? ''), supplierName: String(row.supplier_name ?? 'Supplier'), currency: String(row.currency ?? 'NGN'), totalAmount: numberValue(row.total_amount), itemCount: numberValue(row.item_count), expectedDate: nullableText(row.expected_date), createdAt: String(row.created_at ?? '') }; }
function parseDetail(value: unknown): PurchaseDetail { const row = object(value); return { purchaseOrderId: String(row.purchaseOrderId ?? ''), reference: String(row.reference ?? 'Purchase Order'), status: String(row.status ?? 'draft'), branchId: String(row.branchId ?? ''), branchName: String(row.branchName ?? 'Branch'), supplierId: String(row.supplierId ?? ''), supplierName: String(row.supplierName ?? 'Supplier'), currency: String(row.currency ?? 'NGN'), totalAmount: numberValue(row.totalAmount), expectedDate: nullableText(row.expectedDate), notes: nullableText(row.notes), createdAt: String(row.createdAt ?? ''), orderedAt: nullableText(row.orderedAt), receivedAt: nullableText(row.receivedAt), cancelledAt: nullableText(row.cancelledAt), cancelReason: nullableText(row.cancelReason), items: array(row.items).map((item) => { const value = object(item); return { itemId: String(value.itemId ?? ''), catalogItemId: String(value.catalogItemId ?? ''), uomId: String(value.uomId ?? ''), productName: String(value.productName ?? 'Product'), sku: nullableText(value.sku), selectedUom: String(value.selectedUom ?? 'Unit'), conversionFactor: numberValue(value.conversionFactor), orderedQuantity: numberValue(value.orderedQuantity), unitCost: numberValue(value.unitCost), lineTotal: numberValue(value.lineTotal), receivedQuantity: numberValue(value.receivedQuantity), remainingQuantity: numberValue(value.remainingQuantity) }; }).filter((item) => item.itemId), receipts: array(row.receipts).map((item) => { const value = object(item); return { receiptId: String(value.receiptId ?? ''), reference: String(value.reference ?? 'Receipt'), receivedAt: String(value.receivedAt ?? ''), notes: nullableText(value.notes), itemCount: numberValue(value.itemCount) }; }).filter((item) => item.receiptId) }; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function nullableText(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function statusLabel(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatNumber(value: number): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 6 }).format(value); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${formatNumber(value)}`; } }
function dateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
