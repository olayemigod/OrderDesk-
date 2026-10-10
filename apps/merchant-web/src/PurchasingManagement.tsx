import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';
import './PurchasingManagement.css';

type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
};

type PurchaseOrderSummary = {
  id: string;
  number: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  status: string;
  currency: string;
  expectedDate: string | null;
  totalAmount: number;
  orderedAt: string | null;
  createdAt: string;
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

type OrderLine = {
  id: string;
  catalogItemId: string;
  itemName: string;
  sku: string | null;
  purchaseUomId: string | null;
  purchaseUom: string;
  quantityOrdered: number;
  conversionFactor: number;
  stockUom: string;
  stockQuantityOrdered: number;
  stockQuantityReceived: number;
  allowFractional: boolean;
  unitCost: number;
  lineTotal: number;
};

type ReceiptSummary = {
  id: string;
  number: string;
  supplierReference: string | null;
  totalCost: number;
  receivedAt: string;
};

type PurchaseOrderDetail = {
  id: string;
  number: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  status: string;
  currency: string;
  expectedDate: string | null;
  notes: string | null;
  totalAmount: number;
  orderedAt: string | null;
  createdAt: string;
  items: OrderLine[];
  receipts: ReceiptSummary[];
};

type DraftLine = {
  key: string;
  catalogItemId: string;
  uomId: string;
  quantity: string;
  unitCost: string;
};

type SupplierDraft = {
  id: string | null;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

type OrderDraft = {
  id: string | null;
  supplierId: string;
  expectedDate: string;
  notes: string;
  lines: DraftLine[];
};

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  stock_uom: string;
  catalog_item_uoms: Array<{
    id: string;
    uom_name: string;
    conversion_factor: number | string;
    allow_fractional: boolean;
    is_default_purchase: boolean;
  }> | null;
};

const EMPTY_SUPPLIER: SupplierDraft = {
  id: null,
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
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
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderDetail | null>(null);
  const [orderDraft, setOrderDraft] = useState<OrderDraft | null>(null);
  const [supplierDraft, setSupplierDraft] = useState<SupplierDraft>(EMPTY_SUPPLIER);
  const [receiving, setReceiving] = useState(false);
  const [receiveQuantities, setReceiveQuantities] = useState<Record<string, string>>({});
  const [supplierReference, setSupplierReference] = useState('');
  const [receiptRequestKey, setReceiptRequestKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);
  const draftTotal = useMemo(() => (orderDraft?.lines ?? []).reduce((total, line) => {
    const quantity = Number(line.quantity);
    const unitCost = Number(line.unitCost);
    return total + (Number.isFinite(quantity) && Number.isFinite(unitCost) ? quantity * unitCost : 0);
  }, 0), [orderDraft]);

  useEffect(() => {
    void loadAll();
  }, [tenantId, branchId]);

  async function loadAll(preferredOrderId?: string | null) {
    if (!tenantId || !branchId) {
      setOrders([]);
      setSelectedOrder(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [supplierResult, orderResult, productResult] = await Promise.all([
        supabase.rpc('get_sellertray_suppliers', { p_tenant_id: tenantId, p_include_inactive: true }),
        supabase.rpc('get_sellertray_purchase_orders', { p_tenant_id: tenantId, p_branch_id: branchId, p_limit: 100 }),
        supabase
          .from('catalog_items')
          .select('id,name,sku,stock_uom,catalog_item_uoms(id,uom_name,conversion_factor,allow_fractional,is_default_purchase)')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .order('name', { ascending: true }),
      ]);
      if (supplierResult.error) throw supplierResult.error;
      if (orderResult.error) throw orderResult.error;
      if (productResult.error) throw productResult.error;

      const nextSuppliers = ((supplierResult.data ?? []) as Array<Record<string, unknown>>).map(mapSupplier);
      const nextOrders = ((orderResult.data ?? []) as Array<Record<string, unknown>>).map(mapOrderSummary);
      const nextProducts = ((productResult.data ?? []) as unknown as ProductRow[]).map(mapProduct);
      setSuppliers(nextSuppliers);
      setOrders(nextOrders);
      setProducts(nextProducts);

      const target = preferredOrderId ?? selectedOrder?.id ?? null;
      if (target && nextOrders.some((order) => order.id === target)) {
        await loadOrder(target);
      } else if (selectedOrder && !nextOrders.some((order) => order.id === selectedOrder.id)) {
        setSelectedOrder(null);
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load Purchasing.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadOrder(orderId: string) {
    const { data, error: loadError } = await supabase.rpc('get_sellertray_purchase_order', {
      p_tenant_id: tenantId,
      p_purchase_order_id: orderId,
    });
    if (loadError) throw loadError;
    setSelectedOrder(parseOrderDetail(data));
    setReceiving(false);
    setReceiveQuantities({});
    setSupplierReference('');
  }

  function startSupplier(supplier?: Supplier) {
    setSupplierDraft(supplier ? {
      id: supplier.id,
      name: supplier.name,
      contactName: supplier.contactName ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
    } : EMPTY_SUPPLIER);
    setMessage(null);
    setError(null);
  }

  async function saveSupplier(event: FormEvent) {
    event.preventDefault();
    if (!supplierDraft.name.trim()) {
      setError('Enter the Supplier name.');
      return;
    }
    setSaving(true);
    clearFeedback();
    try {
      const { data, error: saveError } = await supabase.rpc('save_sellertray_supplier', {
        p_tenant_id: tenantId,
        p_supplier_id: supplierDraft.id,
        p_name: supplierDraft.name,
        p_contact_name: clean(supplierDraft.contactName),
        p_phone: clean(supplierDraft.phone),
        p_email: clean(supplierDraft.email),
        p_address: clean(supplierDraft.address),
        p_notes: clean(supplierDraft.notes),
      });
      if (saveError) throw saveError;
      const savedId = typeof data === 'string' ? data : supplierDraft.id;
      setMessage(supplierDraft.id ? 'Supplier updated.' : 'Supplier added.');
      setSupplierDraft(EMPTY_SUPPLIER);
      await loadAll();
      if (savedId) setSupplierDraft(EMPTY_SUPPLIER);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this Supplier.'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleSupplier(supplier: Supplier) {
    setSaving(true);
    clearFeedback();
    try {
      const { error: updateError } = await supabase.rpc('set_sellertray_supplier_active', {
        p_tenant_id: tenantId,
        p_supplier_id: supplier.id,
        p_active: !supplier.isActive,
      });
      if (updateError) throw updateError;
      setMessage(supplier.isActive ? 'Supplier deactivated. Purchase history is preserved.' : 'Supplier reactivated.');
      await loadAll();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to update this Supplier.'));
    } finally {
      setSaving(false);
    }
  }

  function startOrder(detail?: PurchaseOrderDetail) {
    if (!branchId) {
      setError('Choose an active Branch before creating a Purchase Order.');
      return;
    }
    if (!activeSuppliers.length) {
      setView('suppliers');
      setError('Add an active Supplier before creating a Purchase Order.');
      return;
    }
    const firstProduct = products[0] ?? null;
    setOrderDraft(detail ? {
      id: detail.id,
      supplierId: detail.supplierId,
      expectedDate: detail.expectedDate ?? '',
      notes: detail.notes ?? '',
      lines: detail.items.map((line) => ({
        key: line.id,
        catalogItemId: line.catalogItemId,
        uomId: line.purchaseUomId ?? '',
        quantity: String(line.quantityOrdered),
        unitCost: String(line.unitCost),
      })),
    } : {
      id: null,
      supplierId: activeSuppliers[0]?.id ?? '',
      expectedDate: '',
      notes: '',
      lines: firstProduct ? [newLine(firstProduct)] : [],
    });
    clearFeedback();
  }

  function addLine() {
    if (!orderDraft || !products.length) return;
    setOrderDraft({ ...orderDraft, lines: [...orderDraft.lines, newLine(products[0])] });
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    if (!orderDraft) return;
    setOrderDraft({ ...orderDraft, lines: orderDraft.lines.map((line) => line.key === key ? { ...line, ...patch } : line) });
  }

  function chooseProduct(key: string, productId: string) {
    const product = products.find((row) => row.id === productId);
    if (!product) return;
    updateLine(key, { catalogItemId: product.id, uomId: defaultPurchaseUom(product)?.id ?? product.uoms[0]?.id ?? '' });
  }

  async function saveOrder(event: FormEvent) {
    event.preventDefault();
    if (!orderDraft) return;
    const lines = orderDraft.lines.map((line) => ({
      catalogItemId: line.catalogItemId,
      uomId: line.uomId,
      quantity: Number(line.quantity),
      unitCost: Number(line.unitCost),
    }));
    if (!orderDraft.supplierId || !lines.length || lines.some((line) => !line.catalogItemId || !line.uomId || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitCost) || line.unitCost < 0)) {
      setError('Choose a Supplier and enter a valid Product, Unit, Quantity and Unit cost for every line.');
      return;
    }
    setSaving(true);
    clearFeedback();
    try {
      const { data, error: saveError } = await supabase.rpc('save_sellertray_purchase_order', {
        p_tenant_id: tenantId,
        p_purchase_order_id: orderDraft.id,
        p_branch_id: branchId,
        p_supplier_id: orderDraft.supplierId,
        p_expected_date: orderDraft.expectedDate || null,
        p_notes: clean(orderDraft.notes),
        p_items: lines,
      });
      if (saveError) throw saveError;
      const orderId = typeof data === 'string' ? data : orderDraft.id;
      if (!orderId) throw new Error('SellerTray did not return the Purchase Order reference.');
      setOrderDraft(null);
      setMessage(orderDraft.id ? 'Draft Purchase Order updated.' : 'Draft Purchase Order created.');
      await loadAll(orderId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this Purchase Order.'));
    } finally {
      setSaving(false);
    }
  }

  async function changeOrder(action: 'submit' | 'cancel') {
    if (!selectedOrder) return;
    setSaving(true);
    clearFeedback();
    try {
      const rpc = action === 'submit' ? 'submit_sellertray_purchase_order' : 'cancel_sellertray_purchase_order';
      const { error: actionError } = await supabase.rpc(rpc, {
        p_tenant_id: tenantId,
        p_purchase_order_id: selectedOrder.id,
      });
      if (actionError) throw actionError;
      setMessage(action === 'submit' ? 'Purchase Order placed.' : 'Purchase Order cancelled.');
      await loadAll(selectedOrder.id);
    } catch (cause) {
      setError(errorMessage(cause, action === 'submit' ? 'Unable to place this Purchase Order.' : 'Unable to cancel this Purchase Order.'));
    } finally {
      setSaving(false);
    }
  }

  function startReceiving() {
    if (!selectedOrder) return;
    const quantities: Record<string, string> = {};
    for (const line of selectedOrder.items) quantities[line.id] = '';
    setReceiveQuantities(quantities);
    setSupplierReference('');
    setReceiptRequestKey(crypto.randomUUID());
    setReceiving(true);
    clearFeedback();
  }

  async function postReceipt(event: FormEvent) {
    event.preventDefault();
    if (!selectedOrder) return;
    const items = selectedOrder.items
      .map((line) => ({ purchaseOrderItemId: line.id, quantity: Number(receiveQuantities[line.id] || 0) }))
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);
    if (!items.length) {
      setError('Enter the quantity received for at least one product.');
      return;
    }
    setSaving(true);
    clearFeedback();
    try {
      const { data, error: receiptError } = await supabase.rpc('post_sellertray_purchase_receipt', {
        p_tenant_id: tenantId,
        p_purchase_order_id: selectedOrder.id,
        p_supplier_reference: clean(supplierReference),
        p_received_at: new Date().toISOString(),
        p_request_key: receiptRequestKey,
        p_items: items,
      });
      if (receiptError) throw receiptError;
      const payload = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
      setMessage(`Stock received${typeof payload.purchaseReceiptNumber === 'string' ? ` as ${payload.purchaseReceiptNumber}` : ''}.`);
      setReceiving(false);
      await loadAll(selectedOrder.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to post this Purchase Receipt.'));
    } finally {
      setSaving(false);
    }
  }

  function clearFeedback() {
    setError(null);
    setMessage(null);
  }

  if (!branchId) return <article className="panel"><div className="empty-state"><strong>No active Branch</strong><p>Choose or activate a Branch before using Purchasing.</p></div></article>;

  return <div className="page-stack purchasing-workspace">
    <div className="section-heading">
      <div><h2>Purchasing</h2><p className="muted">Order stock from Suppliers and receive it into the same Branch inventory ledger used by SellerTray sales.</p></div>
      <div className="purchase-actions">
        <button className={view === 'orders' ? 'secondary-button selected' : 'secondary-button'} onClick={() => setView('orders')}>Purchase Orders</button>
        <button className={view === 'suppliers' ? 'secondary-button selected' : 'secondary-button'} onClick={() => setView('suppliers')}>Suppliers</button>
        {view === 'orders' ? <button className="primary-button" onClick={() => startOrder()}>New Purchase Order</button> : <button className="primary-button" onClick={() => startSupplier()}>Add Supplier</button>}
      </div>
    </div>

    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="purchase-message">{message}</div> : null}

    {view === 'suppliers' ? <div className="purchase-split">
      <article className="panel">
        <div className="panel-head"><div><h3>Suppliers</h3><p className="muted">Deactivation stops new orders but preserves purchase history.</p></div></div>
        {loading ? <p className="muted">Loading Suppliers…</p> : suppliers.length ? <div className="table-wrap"><table><thead><tr><th>Supplier</th><th>Contact</th><th>Status</th><th></th></tr></thead><tbody>
          {suppliers.map((supplier) => <tr key={supplier.id}><td><strong>{supplier.name}</strong><small>{supplier.email || supplier.phone || 'No contact detail'}</small></td><td>{supplier.contactName || '—'}</td><td><span className={supplier.isActive ? 'status-pill good' : 'status-pill'}>{supplier.isActive ? 'Active' : 'Inactive'}</span></td><td className="purchase-row-actions"><button className="text-button" onClick={() => startSupplier(supplier)}>Edit</button><button className="text-button" disabled={saving} onClick={() => void toggleSupplier(supplier)}>{supplier.isActive ? 'Deactivate' : 'Reactivate'}</button></td></tr>)}
        </tbody></table></div> : <div className="empty-state"><strong>No Suppliers yet</strong><p>Add the businesses you buy stock from.</p></div>}
      </article>
      <SupplierForm draft={supplierDraft} setDraft={setSupplierDraft} saving={saving} onSubmit={saveSupplier} />
    </div> : <>
      {orderDraft ? <PurchaseOrderForm
        draft={orderDraft}
        setDraft={setOrderDraft}
        suppliers={activeSuppliers}
        products={products}
        branchName={branchName}
        currency={currency}
        total={draftTotal}
        saving={saving}
        chooseProduct={chooseProduct}
        updateLine={updateLine}
        addLine={addLine}
        removeLine={(key) => setOrderDraft({ ...orderDraft, lines: orderDraft.lines.filter((line) => line.key !== key) })}
        onSubmit={saveOrder}
        onClose={() => setOrderDraft(null)}
      /> : null}

      <article className="panel">
        <div className="panel-head"><div><h3>Purchase Orders</h3><p className="muted">{branchName} · Drafts do not affect stock. Stock changes only when a Purchase Receipt is posted.</p></div></div>
        {loading ? <p className="muted">Loading Purchase Orders…</p> : orders.length ? <div className="table-wrap"><table><thead><tr><th>Purchase Order</th><th>Supplier</th><th>Status</th><th>Expected</th><th>Total</th><th></th></tr></thead><tbody>
          {orders.map((order) => <tr key={order.id}><td><strong>{order.number}</strong><small>{formatDate(order.createdAt)}</small></td><td>{order.supplierName}</td><td><span className={order.status === 'received' ? 'status-pill good' : 'status-pill'}>{labelStatus(order.status)}</span></td><td>{order.expectedDate ? formatDate(order.expectedDate) : '—'}</td><td>{money(order.totalAmount, order.currency)}</td><td><button className="text-button" onClick={() => void loadOrder(order.id).catch((cause) => setError(errorMessage(cause, 'Unable to open this Purchase Order.')))}>View</button></td></tr>)}
        </tbody></table></div> : <div className="empty-state"><strong>No Purchase Orders for this Branch</strong><p>Create a Draft Purchase Order to start replenishment.</p></div>}
      </article>

      {selectedOrder ? <OrderDetail
        order={selectedOrder}
        saving={saving}
        receiving={receiving}
        receiveQuantities={receiveQuantities}
        setReceiveQuantities={setReceiveQuantities}
        supplierReference={supplierReference}
        setSupplierReference={setSupplierReference}
        onEdit={() => startOrder(selectedOrder)}
        onSubmitOrder={() => void changeOrder('submit')}
        onCancelOrder={() => void changeOrder('cancel')}
        onStartReceiving={startReceiving}
        onCancelReceiving={() => setReceiving(false)}
        onPostReceipt={postReceipt}
        onClose={() => setSelectedOrder(null)}
      /> : null}
    </>}
  </div>;
}

function SupplierForm({ draft, setDraft, saving, onSubmit }: { draft: SupplierDraft; setDraft: (value: SupplierDraft) => void; saving: boolean; onSubmit: (event: FormEvent) => void }) {
  return <form className="panel purchase-form" onSubmit={onSubmit}>
    <div className="panel-head"><div><h3>{draft.id ? 'Edit Supplier' : 'Add Supplier'}</h3><p className="muted">Contact details are optional.</p></div></div>
    <label>Supplier name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <div className="purchase-form-grid"><label>Contact name<input value={draft.contactName} onChange={(event) => setDraft({ ...draft, contactName: event.target.value })} /></label><label>Phone<input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label></div>
    <label>Email<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
    <label>Address<textarea value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} /></label>
    <label>Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
    <button className="primary-button" disabled={saving}>{saving ? 'Saving' : draft.id ? 'Save Supplier' : 'Add Supplier'}</button>
  </form>;
}

function PurchaseOrderForm({ draft, setDraft, suppliers, products, branchName, currency, total, saving, chooseProduct, updateLine, addLine, removeLine, onSubmit, onClose }: {
  draft: OrderDraft; setDraft: (value: OrderDraft) => void; suppliers: Supplier[]; products: Product[]; branchName: string; currency: string; total: number; saving: boolean;
  chooseProduct: (key: string, productId: string) => void; updateLine: (key: string, patch: Partial<DraftLine>) => void; addLine: () => void; removeLine: (key: string) => void;
  onSubmit: (event: FormEvent) => void; onClose: () => void;
}) {
  return <form className="panel purchase-form" onSubmit={onSubmit}>
    <div className="panel-head"><div><h3>{draft.id ? 'Edit Draft Purchase Order' : 'New Purchase Order'}</h3><p className="muted">Receiving Branch: {branchName}</p></div><button type="button" className="text-button" onClick={onClose}>Close</button></div>
    <div className="purchase-form-grid"><label>Supplier<select required value={draft.supplierId} onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })}>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label>Expected date<input type="date" value={draft.expectedDate} onChange={(event) => setDraft({ ...draft, expectedDate: event.target.value })} /></label></div>
    <label>Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
    <div className="purchase-lines"><div className="purchase-lines-head"><strong>Products</strong><button type="button" className="secondary-button" onClick={addLine}>Add product</button></div>
      {draft.lines.map((line, index) => {
        const product = products.find((row) => row.id === line.catalogItemId) ?? products[0];
        return <div className="purchase-line" key={line.key}>
          <label>Product<select value={line.catalogItemId} onChange={(event) => chooseProduct(line.key, event.target.value)}>{products.map((row) => <option key={row.id} value={row.id}>{row.name}{row.sku ? ` · ${row.sku}` : ''}</option>)}</select></label>
          <label>Purchase Unit<select value={line.uomId} onChange={(event) => updateLine(line.key, { uomId: event.target.value })}>{(product?.uoms ?? []).map((uom) => <option key={uom.id} value={uom.id}>{uom.name} · {uom.conversionFactor} {product.stockUom}</option>)}</select></label>
          <label>Quantity<input inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
          <label>Unit cost ({currency})<input inputMode="decimal" value={line.unitCost} onChange={(event) => updateLine(line.key, { unitCost: event.target.value })} /></label>
          <button type="button" className="text-button danger-text" disabled={draft.lines.length === 1} onClick={() => removeLine(line.key)}>Remove {index + 1}</button>
        </div>;
      })}
    </div>
    <div className="purchase-submit"><div><span className="muted">Order total</span><strong>{money(total, currency)}</strong></div><button className="primary-button" disabled={saving || !draft.lines.length}>{saving ? 'Saving' : 'Save Draft'}</button></div>
  </form>;
}

function OrderDetail({ order, saving, receiving, receiveQuantities, setReceiveQuantities, supplierReference, setSupplierReference, onEdit, onSubmitOrder, onCancelOrder, onStartReceiving, onCancelReceiving, onPostReceipt, onClose }: {
  order: PurchaseOrderDetail; saving: boolean; receiving: boolean; receiveQuantities: Record<string, string>; setReceiveQuantities: (value: Record<string, string>) => void; supplierReference: string; setSupplierReference: (value: string) => void;
  onEdit: () => void; onSubmitOrder: () => void; onCancelOrder: () => void; onStartReceiving: () => void; onCancelReceiving: () => void; onPostReceipt: (event: FormEvent) => void; onClose: () => void;
}) {
  return <article className="panel purchase-detail">
    <div className="panel-head"><div><p className="eyebrow">{order.number}</p><h3>{order.supplierName}</h3><p className="muted">{order.branchName} · {labelStatus(order.status)} · {money(order.totalAmount, order.currency)}</p></div><button className="text-button" onClick={onClose}>Close</button></div>
    <div className="table-wrap"><table><thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Unit cost</th></tr></thead><tbody>
      {order.items.map((line) => <tr key={line.id}><td><strong>{line.itemName}</strong><small>{line.sku || line.stockUom}</small></td><td>{formatQty(line.quantityOrdered)} {line.purchaseUom}</td><td>{formatQty(line.stockQuantityReceived / line.conversionFactor)} {line.purchaseUom}</td><td>{formatQty(Math.max(0, line.stockQuantityOrdered - line.stockQuantityReceived) / line.conversionFactor)} {line.purchaseUom}</td><td>{money(line.unitCost, order.currency)}</td></tr>)}
    </tbody></table></div>

    {receiving ? <form className="purchase-receive" onSubmit={onPostReceipt}>
      <div className="purchase-form-grid"><label>Supplier reference<input value={supplierReference} onChange={(event) => setSupplierReference(event.target.value)} placeholder="Delivery note or invoice number" /></label><div><span className="muted">Receipt rule</span><p>Enter only the quantity physically received now. SellerTray posts the Stock-UOM movement when you confirm.</p></div></div>
      {order.items.map((line) => {
        const remaining = Math.max(0, line.stockQuantityOrdered - line.stockQuantityReceived) / line.conversionFactor;
        return remaining > 0 ? <label className="purchase-receive-line" key={line.id}><span>{line.itemName}<small>Remaining {formatQty(remaining)} {line.purchaseUom}</small></span><input inputMode="decimal" placeholder="0" value={receiveQuantities[line.id] ?? ''} onChange={(event) => setReceiveQuantities({ ...receiveQuantities, [line.id]: event.target.value })} /></label> : null;
      })}
      <div className="purchase-row-actions"><button type="button" className="secondary-button" onClick={onCancelReceiving}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Posting receipt' : 'Post Purchase Receipt'}</button></div>
    </form> : <div className="purchase-row-actions purchase-detail-actions">
      {order.status === 'draft' ? <><button className="secondary-button" onClick={onEdit}>Edit Draft</button><button className="primary-button" disabled={saving} onClick={onSubmitOrder}>Place Purchase Order</button><button className="text-button danger-text" disabled={saving} onClick={onCancelOrder}>Cancel</button></> : null}
      {(order.status === 'ordered' || order.status === 'partially_received') ? <><button className="primary-button" onClick={onStartReceiving}>Receive stock</button><button className="text-button danger-text" disabled={saving} onClick={onCancelOrder}>Cancel remaining</button></> : null}
    </div>}

    <div className="purchase-receipt-history"><h3>Purchase Receipts</h3>{order.receipts.length ? order.receipts.map((receipt) => <div key={receipt.id} className="purchase-receipt-row"><div><strong>{receipt.number}</strong><small>{formatDateTime(receipt.receivedAt)}</small></div><div><span>{receipt.supplierReference || 'No Supplier reference'}</span><strong>{money(receipt.totalCost, order.currency)}</strong></div></div>) : <p className="muted">No stock has been received against this Purchase Order yet.</p>}</div>
  </article>;
}

function mapSupplier(row: Record<string, unknown>): Supplier {
  return {
    id: String(row.id ?? ''), name: String(row.name ?? 'Supplier'), contactName: optional(row.contact_name), phone: optional(row.phone),
    email: optional(row.email), address: optional(row.address), notes: optional(row.notes), isActive: row.is_active === true,
  };
}

function mapOrderSummary(row: Record<string, unknown>): PurchaseOrderSummary {
  return {
    id: String(row.id ?? ''), number: String(row.purchase_order_number ?? ''), branchId: String(row.branch_id ?? ''), branchName: String(row.branch_name ?? 'Branch'),
    supplierId: String(row.supplier_id ?? ''), supplierName: String(row.supplier_name ?? 'Supplier'), status: String(row.status ?? 'draft'), currency: String(row.currency ?? 'NGN'),
    expectedDate: optional(row.expected_date), totalAmount: numberValue(row.total_amount), orderedAt: optional(row.ordered_at), createdAt: String(row.created_at ?? ''),
  };
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id, name: row.name, sku: row.sku, stockUom: row.stock_uom,
    uoms: (row.catalog_item_uoms ?? []).map((uom) => ({ id: uom.id, name: uom.uom_name, conversionFactor: numberValue(uom.conversion_factor), allowFractional: uom.allow_fractional, isDefaultPurchase: uom.is_default_purchase })),
  };
}

function parseOrderDetail(value: unknown): PurchaseOrderDetail {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const items = Array.isArray(row.items) ? row.items as Array<Record<string, unknown>> : [];
  const receipts = Array.isArray(row.receipts) ? row.receipts as Array<Record<string, unknown>> : [];
  return {
    id: String(row.id ?? ''), number: String(row.purchaseOrderNumber ?? ''), branchId: String(row.branchId ?? ''), branchName: String(row.branchName ?? 'Branch'),
    supplierId: String(row.supplierId ?? ''), supplierName: String(row.supplierName ?? 'Supplier'), status: String(row.status ?? 'draft'), currency: String(row.currency ?? 'NGN'),
    expectedDate: optional(row.expectedDate), notes: optional(row.notes), totalAmount: numberValue(row.totalAmount), orderedAt: optional(row.orderedAt), createdAt: String(row.createdAt ?? ''),
    items: items.map((item) => ({
      id: String(item.id ?? ''), catalogItemId: String(item.catalogItemId ?? ''), itemName: String(item.itemName ?? 'Product'), sku: optional(item.sku), purchaseUomId: optional(item.purchaseUomId),
      purchaseUom: String(item.purchaseUom ?? ''), quantityOrdered: numberValue(item.quantityOrdered), conversionFactor: numberValue(item.conversionFactor), stockUom: String(item.stockUom ?? ''),
      stockQuantityOrdered: numberValue(item.stockQuantityOrdered), stockQuantityReceived: numberValue(item.stockQuantityReceived), allowFractional: item.allowFractional === true,
      unitCost: numberValue(item.unitCost), lineTotal: numberValue(item.lineTotal),
    })),
    receipts: receipts.map((receipt) => ({ id: String(receipt.id ?? ''), number: String(receipt.purchaseReceiptNumber ?? ''), supplierReference: optional(receipt.supplierReference), totalCost: numberValue(receipt.totalCost), receivedAt: String(receipt.receivedAt ?? '') })),
  };
}

function newLine(product: Product): DraftLine {
  return { key: crypto.randomUUID(), catalogItemId: product.id, uomId: defaultPurchaseUom(product)?.id ?? product.uoms[0]?.id ?? '', quantity: '1', unitCost: '0' };
}
function defaultPurchaseUom(product: Product): ProductUom | null { return product.uoms.find((uom) => uom.isDefaultPurchase) ?? product.uoms[0] ?? null; }
function clean(value: string): string | null { const cleanValue = value.trim(); return cleanValue || null; }
function optional(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function money(value: number, currency: string): string { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value || 0); }
function formatQty(value: number): string { return Number.isInteger(value) ? String(value) : value.toLocaleString('en-NG', { maximumFractionDigits: 6 }); }
function formatDate(value: string): string { const date = new Date(value.length === 10 ? `${value}T00:00:00` : value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }); }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); }
function labelStatus(value: string): string { return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
