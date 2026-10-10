import { useEffect, useMemo, useState } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
};

type PurchaseOrderSummary = {
  id: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  totalAmount: number;
  receivedLineCount: number;
  lineCount: number;
};

type ProductUom = {
  id: string;
  name: string;
  conversionFactor: number;
  allowFractional: boolean;
  isDefaultPurchase: boolean;
};

type Product = {
  id: string;
  name: string;
  sku: string | null;
  stockUom: string;
  uoms: ProductUom[];
};

type PurchaseLine = {
  id: string;
  productId: string;
  productName: string;
  uomId: string;
  uom: string;
  stockUom: string;
  conversionFactor: number;
  allowFractional: boolean;
  quantityOrdered: number;
  quantityReceived: number;
  stockQuantityOrdered: number;
  unitCost: number;
  lineTotal: number;
};

type Receipt = {
  id: string;
  reference: string;
  notes: string | null;
  receivedAt: string;
};

type PurchaseDetail = {
  id: string;
  purchaseNumber: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  currency: string;
  totalAmount: number;
  notes: string | null;
  lines: PurchaseLine[];
  receipts: Receipt[];
};

type DraftLine = {
  key: string;
  productId: string;
  uomId: string;
  quantity: string;
  unitCost: string;
};

type SupplierDraft = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
};

const EMPTY_SUPPLIER: SupplierDraft = {
  id: '', name: '', phone: '', email: '', address: '', notes: '', isActive: true,
};

export default function PurchasingManagement({
  tenantId,
  branchId,
  branchName,
  currency,
}: {
  tenantId: string;
  branchId: string;
  branchName: string;
  currency: string;
}) {
  const [view, setView] = useState<'orders' | 'suppliers'>('orders');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [supplierDraft, setSupplierDraft] = useState<SupplierDraft>(EMPTY_SUPPLIER);
  const [editingOrderId, setEditingOrderId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(today());
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([newDraftLine()]);
  const [receiptReference, setReceiptReference] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [received, setReceived] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    resetOrderEditor();
  }, [tenantId, branchId]);

  useEffect(() => {
    if (selectedOrderId) void loadDetail(selectedOrderId);
    else setDetail(null);
  }, [selectedOrderId]);

  const activeSuppliers = useMemo(() => suppliers.filter((row) => row.isActive), [suppliers]);

  async function load() {
    if (!tenantId || !branchId) return;
    setLoading(true);
    setError(null);
    try {
      const [supplierResult, orderResult, productResult] = await Promise.all([
        supabase.rpc('get_sellertray_suppliers', { p_tenant_id: tenantId }),
        supabase.rpc('get_sellertray_purchase_orders', {
          p_tenant_id: tenantId,
          p_branch_id: branchId,
          p_status: null,
        }),
        supabase
          .from('catalog_items')
          .select('id,name,sku,stock_uom,is_active,catalog_item_uoms(id,uom_name,conversion_factor,allow_fractional,is_default_purchase)')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .order('name'),
      ]);
      if (supplierResult.error) throw supplierResult.error;
      if (orderResult.error) throw orderResult.error;
      if (productResult.error) throw productResult.error;
      setSuppliers(parseSuppliers(supplierResult.data));
      setOrders(parseOrders(orderResult.data));
      setProducts(parseProducts(productResult.data));
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load Purchasing.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(orderId: string) {
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_purchase_order_detail', {
        p_tenant_id: tenantId,
        p_purchase_order_id: orderId,
      });
      if (rpcError) throw rpcError;
      const next = parseDetail(data);
      setDetail(next);
      setReceived({});
      setReceiptReference('');
      setReceiptNotes('');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load this Purchase Order.'));
    }
  }

  async function saveSupplier() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { error: rpcError } = await supabase.rpc('save_sellertray_supplier', {
        p_tenant_id: tenantId,
        p_supplier_id: supplierDraft.id || null,
        p_name: supplierDraft.name,
        p_phone: supplierDraft.phone || null,
        p_email: supplierDraft.email || null,
        p_address: supplierDraft.address || null,
        p_notes: supplierDraft.notes || null,
        p_is_active: supplierDraft.isActive,
      });
      if (rpcError) throw rpcError;
      setSupplierDraft(EMPTY_SUPPLIER);
      setMessage('Supplier saved.');
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save Supplier.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveOrder(submitAfterSave = false) {
    if (!supplierId) {
      setError('Choose a Supplier.');
      return;
    }
    const payload = lines.map((line) => ({
      productId: line.productId,
      uomId: line.uomId,
      quantity: Number(line.quantity),
      unitCost: Number(line.unitCost),
    }));
    if (payload.some((line) => !line.productId || !line.uomId || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitCost) || line.unitCost < 0)) {
      setError('Complete every Purchase Order line with a Product, unit, quantity and valid unit cost.');
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('save_sellertray_purchase_order', {
        p_tenant_id: tenantId,
        p_purchase_order_id: editingOrderId || null,
        p_branch_id: branchId,
        p_supplier_id: supplierId,
        p_order_date: orderDate,
        p_expected_date: expectedDate || null,
        p_notes: notes || null,
        p_lines: payload,
      });
      if (rpcError) throw rpcError;
      const orderId = String(data ?? '');
      if (submitAfterSave) {
        const { error: submitError } = await supabase.rpc('submit_sellertray_purchase_order', {
          p_tenant_id: tenantId,
          p_purchase_order_id: orderId,
        });
        if (submitError) throw submitError;
      }
      setMessage(submitAfterSave ? 'Purchase Order submitted.' : 'Purchase Order draft saved.');
      resetOrderEditor();
      await load();
      if (orderId) setSelectedOrderId(orderId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save Purchase Order.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitSelected() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('submit_sellertray_purchase_order', {
        p_tenant_id: tenantId,
        p_purchase_order_id: detail.id,
      });
      if (rpcError) throw rpcError;
      setMessage('Purchase Order submitted.');
      await load();
      await loadDetail(detail.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to submit Purchase Order.'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelSelected() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('cancel_sellertray_purchase_order', {
        p_tenant_id: tenantId,
        p_purchase_order_id: detail.id,
      });
      if (rpcError) throw rpcError;
      setMessage('Purchase Order cancelled.');
      await load();
      await loadDetail(detail.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to cancel Purchase Order.'));
    } finally {
      setBusy(false);
    }
  }

  async function receiveSelected() {
    if (!detail) return;
    const items = detail.lines.flatMap((line) => {
      const quantity = Number(received[line.id] || 0);
      return Number.isFinite(quantity) && quantity > 0 ? [{ lineId: line.id, quantity }] : [];
    });
    if (!receiptReference.trim()) {
      setError('Enter the Supplier receipt or delivery reference.');
      return;
    }
    if (!items.length) {
      setError('Enter at least one quantity physically received.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('receive_sellertray_purchase_order', {
        p_tenant_id: tenantId,
        p_purchase_order_id: detail.id,
        p_reference: receiptReference,
        p_notes: receiptNotes || null,
        p_items: items,
      });
      if (rpcError) throw rpcError;
      setMessage('Stock receipt posted to the inventory ledger.');
      setReceived({});
      setReceiptReference('');
      setReceiptNotes('');
      await load();
      await loadDetail(detail.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to receive this delivery.'));
    } finally {
      setBusy(false);
    }
  }

  function editDraft(order: PurchaseDetail) {
    if (order.status !== 'draft') return;
    setEditingOrderId(order.id);
    setSupplierId(order.supplierId);
    setOrderDate(order.orderDate);
    setExpectedDate(order.expectedDate ?? '');
    setNotes(order.notes ?? '');
    setLines(order.lines.map((line) => ({
      key: key(),
      productId: line.productId,
      uomId: line.uomId,
      quantity: String(line.quantityOrdered),
      unitCost: String(line.unitCost),
    })));
    setSelectedOrderId('');
  }

  function resetOrderEditor() {
    setEditingOrderId('');
    setSupplierId('');
    setOrderDate(today());
    setExpectedDate('');
    setNotes('');
    setLines([newDraftLine()]);
  }

  function chooseProduct(index: number, productId: string) {
    const product = products.find((row) => row.id === productId);
    const defaultUom = product?.uoms.find((row) => row.isDefaultPurchase) ?? product?.uoms[0];
    setLines((current) => current.map((line, lineIndex) => lineIndex === index
      ? { ...line, productId, uomId: defaultUom?.id ?? '' }
      : line));
  }

  if (!branchId) return <article className="panel"><div className="empty-state"><strong>No active Branch</strong><p>Select or create a Branch before creating Purchase Orders.</p></div></article>;

  return <div className="page-stack purchasing-page">
    <div className="section-heading purchasing-heading">
      <div><p className="eyebrow">{branchName}</p><h2>Purchasing</h2><p className="muted">Manage Suppliers, order stock in the right Purchase UOM, and receive deliveries into the same inventory ledger used by sales.</p></div>
      <div className="segmented-control">
        <button className={view === 'orders' ? 'active' : ''} onClick={() => setView('orders')}>Purchase Orders</button>
        <button className={view === 'suppliers' ? 'active' : ''} onClick={() => setView('suppliers')}>Suppliers</button>
      </div>
    </div>

    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {view === 'suppliers' ? <div className="two-column purchasing-columns">
      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Supplier master</p><h3>{supplierDraft.id ? 'Edit Supplier' : 'New Supplier'}</h3></div>{supplierDraft.id ? <button className="text-button" onClick={() => setSupplierDraft(EMPTY_SUPPLIER)}>New Supplier</button> : null}</div>
        <div className="form-grid">
          <label>Supplier name<input value={supplierDraft.name} onChange={(event) => setSupplierDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Phone<input value={supplierDraft.phone} onChange={(event) => setSupplierDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
          <label>Email<input type="email" value={supplierDraft.email} onChange={(event) => setSupplierDraft((current) => ({ ...current, email: event.target.value }))} /></label>
          <label>Address<textarea rows={3} value={supplierDraft.address} onChange={(event) => setSupplierDraft((current) => ({ ...current, address: event.target.value }))} /></label>
          <label className="full-field">Notes<textarea rows={3} value={supplierDraft.notes} onChange={(event) => setSupplierDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
          <label className="check-row full-field"><input type="checkbox" checked={supplierDraft.isActive} onChange={(event) => setSupplierDraft((current) => ({ ...current, isActive: event.target.checked }))} />Active Supplier</label>
        </div>
        <div className="form-actions"><button className="primary-button" disabled={busy || !supplierDraft.name.trim()} onClick={() => void saveSupplier()}>{busy ? 'Saving' : 'Save Supplier'}</button></div>
      </article>
      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Business-wide</p><h3>Suppliers</h3></div><span className="count-badge">{suppliers.length}</span></div>
        {suppliers.length ? <div className="supplier-list">{suppliers.map((supplier) => <button key={supplier.id} className="supplier-row" onClick={() => setSupplierDraft({ id: supplier.id, name: supplier.name, phone: supplier.phone ?? '', email: supplier.email ?? '', address: supplier.address ?? '', notes: supplier.notes ?? '', isActive: supplier.isActive })}><div><strong>{supplier.name}</strong><span>{supplier.phone || supplier.email || 'No contact details'}</span></div><span className={`status-pill ${supplier.isActive ? 'good' : 'neutral'}`}>{supplier.isActive ? 'Active' : 'Inactive'}</span></button>)}</div> : <Empty title="No Suppliers yet" body="Add the Supplier you purchase stock from." />}
      </article>
    </div> : <>
      <div className="two-column purchasing-columns">
        <article className="panel purchase-editor">
          <div className="panel-head"><div><p className="eyebrow">{branchName}</p><h3>{editingOrderId ? 'Edit draft Purchase Order' : 'New Purchase Order'}</h3></div>{editingOrderId ? <button className="text-button" onClick={resetOrderEditor}>New order</button> : null}</div>
          <div className="form-grid">
            <label>Supplier<select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Choose Supplier</option>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label>Order date<input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} /></label>
            <label>Expected date<input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /></label>
            <label className="full-field">Notes<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          </div>
          <div className="purchase-lines">
            <div className="panel-head"><div><p className="eyebrow">Products</p><h4>Order lines</h4></div><button className="secondary-button compact-button" onClick={() => setLines((current) => [...current, newDraftLine()])}>Add product</button></div>
            {lines.map((line, index) => {
              const product = products.find((row) => row.id === line.productId);
              const unit = product?.uoms.find((row) => row.id === line.uomId);
              const stockQty = numberValue(line.quantity) * (unit?.conversionFactor ?? 0);
              return <div className="purchase-line" key={line.key}>
                <label>Product<select value={line.productId} onChange={(event) => chooseProduct(index, event.target.value)}><option value="">Choose product</option>{products.map((row) => <option key={row.id} value={row.id}>{row.name}{row.sku ? ` · ${row.sku}` : ''}</option>)}</select></label>
                <label>Purchase unit<select value={line.uomId} disabled={!product} onChange={(event) => setLines((current) => current.map((row, lineIndex) => lineIndex === index ? { ...row, uomId: event.target.value } : row))}><option value="">Choose unit</option>{product?.uoms.map((row) => <option key={row.id} value={row.id}>{row.name}{row.isDefaultPurchase ? ' · default' : ''}</option>)}</select></label>
                <label>Quantity<input inputMode="decimal" value={line.quantity} onChange={(event) => setLines((current) => current.map((row, lineIndex) => lineIndex === index ? { ...row, quantity: event.target.value } : row))} /></label>
                <label>Unit cost ({currency})<input inputMode="decimal" value={line.unitCost} onChange={(event) => setLines((current) => current.map((row, lineIndex) => lineIndex === index ? { ...row, unitCost: event.target.value } : row))} /></label>
                <div className="line-stock-preview"><span>Stock impact when fully received</span><strong>{Number.isFinite(stockQty) ? formatNumber(stockQty) : '0'} {product?.stockUom ?? ''}</strong></div>
                {lines.length > 1 ? <button className="text-button danger-text" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button> : <span />}
              </div>;
            })}
          </div>
          <div className="form-actions purchase-actions"><button className="secondary-button" disabled={busy || loading} onClick={() => void saveOrder(false)}>{busy ? 'Saving' : 'Save draft'}</button><button className="primary-button" disabled={busy || loading} onClick={() => void saveOrder(true)}>Save & submit</button></div>
        </article>

        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">{branchName}</p><h3>Purchase Orders</h3></div><span className="count-badge">{orders.length}</span></div>
          {loading ? <p className="muted">Loading Purchase Orders…</p> : orders.length ? <div className="purchase-order-list">{orders.map((order) => <button key={order.id} className={selectedOrderId === order.id ? 'purchase-order-row active' : 'purchase-order-row'} onClick={() => setSelectedOrderId(order.id)}><div><strong>{order.purchaseNumber}</strong><span>{order.supplierName} · {dateLabel(order.orderDate)}</span></div><div className="purchase-order-meta"><strong>{money(order.totalAmount, currency)}</strong><span className={`status-pill ${statusTone(order.status)}`}>{statusText(order.status)}</span></div></button>)}</div> : <Empty title="No Purchase Orders in this Branch" body="Create a Purchase Order to record expected stock before delivery." />}
        </article>
      </div>

      {detail ? <article className="panel purchase-detail">
        <div className="panel-head"><div><p className="eyebrow">{detail.supplierName}</p><h3>{detail.purchaseNumber}</h3><p className="muted">{detail.branchName} · Ordered {dateLabel(detail.orderDate)}{detail.expectedDate ? ` · Expected ${dateLabel(detail.expectedDate)}` : ''}</p></div><div className="detail-actions"><span className={`status-pill ${statusTone(detail.status)}`}>{statusText(detail.status)}</span>{detail.status === 'draft' ? <button className="secondary-button" onClick={() => editDraft(detail)}>Edit draft</button> : null}{detail.status === 'draft' ? <button className="primary-button" disabled={busy} onClick={() => void submitSelected()}>Submit</button> : null}{detail.status === 'draft' || detail.status === 'ordered' ? <button className="text-button danger-text" disabled={busy} onClick={() => void cancelSelected()}>Cancel</button> : null}</div></div>
        <div className="table-wrap"><table><thead><tr><th>Product</th><th>Purchase UOM</th><th>Ordered</th><th>Received</th><th>Stock quantity</th><th>Unit cost</th><th>Total</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.id}><td><strong>{line.productName}</strong></td><td>{line.uom}</td><td>{formatNumber(line.quantityOrdered)}</td><td>{formatNumber(line.quantityReceived)}</td><td>{formatNumber(line.stockQuantityOrdered)} {line.stockUom}</td><td>{money(line.unitCost, currency)}</td><td>{money(line.lineTotal, currency)}</td></tr>)}</tbody></table></div>

        {detail.status === 'ordered' || detail.status === 'partially_received' ? <div className="receive-panel">
          <div><p className="eyebrow">Physical receiving</p><h4>Receive delivery</h4><p className="muted">Enter only what is physically present. Stock posts to the selected Branch after the receipt command succeeds.</p></div>
          <div className="receive-grid"><label>Supplier receipt / delivery reference<input value={receiptReference} onChange={(event) => setReceiptReference(event.target.value)} placeholder="e.g. DN-1024" /></label><label>Notes<input value={receiptNotes} onChange={(event) => setReceiptNotes(event.target.value)} placeholder="Optional receiving note" /></label></div>
          <div className="receive-lines">{detail.lines.map((line) => {
            const remaining = Math.max(0, line.quantityOrdered - line.quantityReceived);
            return <label key={line.id}><span><strong>{line.productName}</strong><small>{formatNumber(remaining)} {line.uom} remaining</small></span><input inputMode="decimal" disabled={remaining <= 0} value={received[line.id] ?? ''} onChange={(event) => setReceived((current) => ({ ...current, [line.id]: event.target.value }))} placeholder="0" /></label>;
          })}</div>
          <div className="form-actions"><button className="primary-button" disabled={busy} onClick={() => void receiveSelected()}>{busy ? 'Posting receipt' : 'Receive stock'}</button></div>
        </div> : null}

        {detail.receipts.length ? <div className="receipt-history"><p className="eyebrow">Receipt history</p>{detail.receipts.map((receipt) => <div key={receipt.id}><strong>{receipt.reference}</strong><span>{dateTime(receipt.receivedAt)}{receipt.notes ? ` · ${receipt.notes}` : ''}</span></div>)}</div> : null}
      </article> : null}
    </>}
  </div>;
}

function parseSuppliers(value: unknown): Supplier[] {
  return rows(value).map((row) => ({
    id: text(row.id), name: text(row.name), phone: optionalText(row.phone), email: optionalText(row.email),
    address: optionalText(row.address), notes: optionalText(row.notes), isActive: row.is_active === true,
  })).filter((row) => row.id && row.name);
}

function parseOrders(value: unknown): PurchaseOrderSummary[] {
  return rows(value).map((row) => ({
    id: text(row.id), purchaseNumber: text(row.purchase_number), supplierId: text(row.supplier_id), supplierName: text(row.supplier_name),
    status: text(row.status), orderDate: text(row.order_date), expectedDate: optionalText(row.expected_date), totalAmount: numberValue(row.total_amount),
    receivedLineCount: numberValue(row.received_line_count), lineCount: numberValue(row.line_count),
  })).filter((row) => row.id);
}

function parseProducts(value: unknown): Product[] {
  return rows(value).map((row) => ({
    id: text(row.id), name: text(row.name), sku: optionalText(row.sku), stockUom: text(row.stock_uom),
    uoms: rows(row.catalog_item_uoms).map((uom) => ({
      id: text(uom.id), name: text(uom.uom_name), conversionFactor: numberValue(uom.conversion_factor),
      allowFractional: uom.allow_fractional === true, isDefaultPurchase: uom.is_default_purchase === true,
    })).filter((uom) => uom.id),
  })).filter((row) => row.id && row.uoms.length);
}

function parseDetail(value: unknown): PurchaseDetail {
  const row = object(value);
  return {
    id: text(row.id), purchaseNumber: text(row.purchaseNumber), branchId: text(row.branchId), branchName: text(row.branchName),
    supplierId: text(row.supplierId), supplierName: text(row.supplierName), status: text(row.status), orderDate: text(row.orderDate),
    expectedDate: optionalText(row.expectedDate), currency: text(row.currency) || 'NGN', totalAmount: numberValue(row.totalAmount), notes: optionalText(row.notes),
    lines: rows(row.lines).map((line) => ({
      id: text(line.id), productId: text(line.productId), productName: text(line.productName), uomId: text(line.uomId), uom: text(line.uom),
      stockUom: text(line.stockUom), conversionFactor: numberValue(line.conversionFactor), allowFractional: line.allowFractional === true,
      quantityOrdered: numberValue(line.quantityOrdered), quantityReceived: numberValue(line.quantityReceived), stockQuantityOrdered: numberValue(line.stockQuantityOrdered),
      unitCost: numberValue(line.unitCost), lineTotal: numberValue(line.lineTotal),
    })),
    receipts: rows(row.receipts).map((receipt) => ({ id: text(receipt.id), reference: text(receipt.reference), notes: optionalText(receipt.notes), receivedAt: text(receipt.receivedAt) })),
  };
}

function rows(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : []; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return typeof value === 'string' ? value : value == null ? '' : String(value); }
function optionalText(value: unknown): string | null { const valueText = text(value).trim(); return valueText || null; }
function key(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function newDraftLine(): DraftLine { return { key: key(), productId: '', uomId: '', quantity: '1', unitCost: '' }; }
function today(): string { return new Date().toISOString().slice(0, 10); }
function formatNumber(value: number): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 6 }).format(value); }
function money(value: number, currency: string): string { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); }
function dateLabel(value: string): string { const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date); }
function dateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function statusText(value: string): string { return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function statusTone(value: string): string { const status = value.toLowerCase(); return status === 'received' ? 'good' : status === 'cancelled' ? 'bad' : 'neutral'; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>; }
