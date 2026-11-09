import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SellerTrayInput } from './SellerTrayElements';
import { errorMessage, numberValue, supabase } from './supabase';

const PAGE_SIZE = 50;

type Customer = {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  lastOrderAt: string | null;
  createdAt: string;
};

type CustomerOrder = {
  id: string;
  publicOrderId: string;
  status: string;
  paymentStatus: string;
  source: string;
  totalAmount: number;
  amountPaid: number;
  outstandingBalance: number;
  createdAt: string;
};

type LinkedOrderDetail = {
  id: string;
  publicOrderId: string;
  status: string;
  source: string;
  paymentStatus: string;
  totalAmount: number | string;
  amountPaid: number | string;
  currency: string;
  customerNote: string | null;
  items: Array<{ id: string; itemName: string; selectedUom: string; quantity: number | string; unitPrice: number | string | null }>;
};

type CustomerDetail = {
  customer: Customer & { whatsappLinked: boolean };
  summary: {
    completedOrderCount: number;
    totalSales: number;
    collected: number;
    outstanding: number;
  };
  orders: CustomerOrder[];
};

export default function CustomersManagement({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [openedOrder, setOpenedOrder] = useState<LinkedOrderDetail | null>(null);
  const [openedOrderLoadingId, setOpenedOrderLoadingId] = useState<string | null>(null);
  const [openedOrderError, setOpenedOrderError] = useState<string | null>(null);
  const orderRequestRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const selected = customers.find((customer) => customer.id === selectedId) ?? detail?.customer ?? null;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCustomers(0, undefined, search); }, 250);
    return () => window.clearTimeout(timer);
  }, [tenantId, search]);

  useEffect(() => {
    orderRequestRef.current += 1;
    setOpenedOrder(null);
    setOpenedOrderError(null);
    setOpenedOrderLoadingId(null);
  }, [tenantId, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadCustomerDetail(selectedId);
  }, [tenantId, selectedId]);

  useEffect(() => {
    setEditName(selected?.displayName ?? '');
    setEditEmail(selected?.email ?? '');
  }, [selectedId, selected?.displayName, selected?.email]);

  async function loadCustomers(pageIndex = page, preferredCustomerId?: string, searchValue = search) {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_customer_management_list', {
        p_tenant_id: tenantId,
        p_search: searchValue.trim() || null,
        p_limit: PAGE_SIZE,
        p_offset: pageIndex * PAGE_SIZE,
      });
      if (rpcError) throw rpcError;
      const payload = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
      const nextCustomers = Array.isArray(payload.items) ? payload.items.map(parseCustomer).filter((row) => row.id) : [];
      const nextTotal = numberValue(payload.totalCount);
      setCustomers(nextCustomers);
      setTotalCount(nextTotal);
      setPage(pageIndex);
      setSelectedId((current) => {
        if (preferredCustomerId && nextCustomers.some((row) => row.id === preferredCustomerId)) return preferredCustomerId;
        if (current && nextCustomers.some((row) => row.id === current)) return current;
        return nextCustomers[0]?.id ?? null;
      });
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load customers.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadCustomerDetail(customerId: string) {
    setDetailLoading(true);
    setError(null);
    setDetail(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_customer_management_detail', {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
        p_order_limit: 100,
      });
      if (rpcError) throw rpcError;
      setDetail(parseCustomerDetail(data));
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load this customer.'));
    } finally {
      setDetailLoading(false);
    }
  }

  async function openCustomerOrder(orderId: string) {
    const requestId = ++orderRequestRef.current;
    setOpenedOrder(null);
    setOpenedOrderLoadingId(orderId);
    setOpenedOrderError(null);
    try {
      // History covers all business branches. Resolve only the order's Branch under existing RLS,
      // then use the same permission-checked details RPC as the Orders and Sales pages.
      const { data: orderScope, error: scopeError } = await supabase.from('orders')
        .select('branch_id').eq('tenant_id', tenantId).eq('id', orderId).is('deleted_at', null).maybeSingle();
      if (scopeError) throw scopeError;
      const branchId = orderScope?.branch_id;
      if (typeof branchId !== 'string' || !branchId) throw new Error('This order is unavailable in your permitted branches.');
      const { data, error: detailError } = await supabase.rpc('get_sellertray_order_management_detail', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_order_id: orderId,
      });
      if (detailError) throw detailError;
      if (!data || typeof data !== 'object') throw new Error('Order details are unavailable.');
      if (requestId === orderRequestRef.current) setOpenedOrder(data as LinkedOrderDetail);
    } catch (cause) {
      if (requestId === orderRequestRef.current) setOpenedOrderError(errorMessage(cause, 'Unable to open this order.'));
    } finally {
      if (requestId === orderRequestRef.current) setOpenedOrderLoadingId(null);
    }
  }

  async function createCustomer(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('create_sellertray_customer', {
        p_tenant_id: tenantId,
        p_display_name: newName.trim(),
        p_phone: newPhone.trim() || null,
        p_email: newEmail.trim() || null,
      });
      if (rpcError) throw rpcError;
      const customerId = typeof data === 'string' ? data : null;
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      setCreating(false);
      setSearch('');
      setNotice(newPhone.trim() ? 'Customer saved. An existing matching phone was reused where applicable.' : 'Customer saved without a phone number.');
      await loadCustomers(0, customerId ?? undefined, '');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save customer.'));
    } finally {
      setSaving(false);
    }
  }

  async function updateCustomer(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { error: rpcError } = await supabase.rpc('update_sellertray_customer_profile', {
        p_tenant_id: tenantId,
        p_customer_id: selected.id,
        p_display_name: editName.trim(),
        p_email: editEmail.trim() || null,
      });
      if (rpcError) throw rpcError;
      setNotice('Customer details updated.');
      await loadCustomers(page, selected.id, search);
      await loadCustomerDetail(selected.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to update customer.'));
    } finally {
      setSaving(false);
    }
  }

  async function changePage(nextPage: number) {
    if (nextPage < 0 || nextPage >= totalPages || nextPage === page) return;
    await loadCustomers(nextPage, undefined, search);
  }

  if (loading && customers.length === 0) return <article className="panel">Loading customers…</article>;

  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Customer management</p><h2>Customers</h2></div>
      <p className="muted">Manage the shared customer record used by POS, WhatsApp and reporting.</p>
    </div>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {notice ? <div className="success-banner">{notice}<button onClick={() => setNotice(null)}>Dismiss</button></div> : null}
    <div className="product-toolbar panel">
      <SellerTrayInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone or email" aria-label="Search customers" />
      <button className="secondary-button" disabled={loading} onClick={() => void loadCustomers(page, selectedId ?? undefined, search)}>{loading ? 'Refreshing' : 'Refresh'}</button>
      <button className="primary-button" onClick={() => setCreating((value) => !value)}>{creating ? 'Close' : 'Add Customer'}</button>
    </div>
    {creating ? <form className="panel page-stack" onSubmit={createCustomer}>
      <div className="panel-head"><div><p className="eyebrow">New customer</p><h3>Add Customer</h3></div></div>
      <div className="form-grid">
        <label>Name<SellerTrayInput required maxLength={120} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Customer name" /></label>
        <label>Phone <span className="muted">Optional</span><SellerTrayInput inputMode="tel" value={newPhone} onChange={(event) => setNewPhone(event.target.value)} placeholder="e.g. 08012345678" /></label>
        <label>Email <span className="muted">Optional</span><SellerTrayInput type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="customer@example.com" /></label>
      </div>
      <div className="topbar-actions"><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save Customer'}</button></div>
    </form> : null}
    <div className="product-workspace">
      <aside className="panel product-list" aria-label="Customers">
        <div className="panel-head"><div><p className="eyebrow">Customers</p><h3>{totalCount} total</h3></div></div>
        {customers.length ? customers.map((customer) => <button key={customer.id} className={selectedId === customer.id ? 'product-row active' : 'product-row'} onClick={() => setSelectedId(customer.id)}>
          <span><strong>{customer.displayName}</strong><small>{customer.phone || customer.email || 'No contact details'}</small></span>
          <small>{customer.lastOrderAt ? `Last order ${dateTime(customer.lastOrderAt)}` : 'No orders yet'}</small>
        </button>) : <div className="empty-state compact"><strong>No customers found</strong><p>Change the search to find another customer.</p></div>}
        <div className="topbar-actions">
          <button type="button" className="secondary-button" disabled={loading || page === 0} onClick={() => void changePage(page - 1)}>Previous</button>
          <span className="muted">Page {page + 1} of {totalPages}</span>
          <button type="button" className="secondary-button" disabled={loading || page + 1 >= totalPages} onClick={() => void changePage(page + 1)}>Next</button>
        </div>
      </aside>
      <section className="product-editor-stack">
        {selected ? <form className="panel page-stack" onSubmit={updateCustomer}>
          <div className="panel-head"><div><p className="eyebrow">Customer</p><h3>{selected.displayName}</h3></div><button className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save Changes'}</button></div>
          <div className="form-grid">
            <label>Name<SellerTrayInput required maxLength={120} value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
            <label>Email <span className="muted">Optional</span><SellerTrayInput type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} /></label>
            <label>Phone<SellerTrayInput value={selected.phone ?? ''} readOnly aria-readonly="true" /><small className="muted">Phone identity is protected because it links customer history across selling channels.</small></label>
          </div>
          {detailLoading ? <p className="muted">Loading customer history…</p> : detail ? <div className="status-grid">
            <Stat label="Completed sales" value={String(detail.summary.completedOrderCount)} />
            <Stat label="Total sales" value={money(detail.summary.totalSales, currency)} />
            <Stat label="Collected" value={money(detail.summary.collected, currency)} />
            <Stat label="Outstanding" value={money(detail.summary.outstanding, currency)} />
            <Stat label="WhatsApp" value={detail.customer.whatsappLinked ? 'Linked' : 'Not linked'} />
            <Stat label="Created" value={dateTime(detail.customer.createdAt)} />
          </div> : null}
        </form> : null}
        {selected ? <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">History</p><h3>Recent orders</h3></div></div>
          {detailLoading ? <p className="muted">Loading orders…</p> : detail?.orders.length ? <div className="table-wrap"><table><thead><tr><th>Order</th><th>Source</th><th>Status</th><th>Payment</th><th>Total</th><th>Collected</th><th>Outstanding</th><th>Created</th></tr></thead><tbody>
            {detail.orders.map((order) => <tr key={order.id}><td><button type="button" className="text-button" disabled={openedOrderLoadingId !== null} onClick={() => void openCustomerOrder(order.id)} aria-label={`Open order ${order.publicOrderId}`}>{order.publicOrderId}</button></td><td>{label(order.source)}</td><td>{label(order.status)}</td><td>{label(order.paymentStatus)}</td><td>{money(order.totalAmount, currency)}</td><td>{money(order.amountPaid, currency)}</td><td>{money(order.outstandingBalance, currency)}</td><td>{dateTime(order.createdAt)}</td></tr>)}
          </tbody></table></div> : <div className="empty-state"><strong>No linked orders</strong><p>Orders attributed to this customer will appear here.</p></div>}
          {openedOrderLoadingId ? <p className="muted" role="status">Opening order…</p> : null}
          {openedOrderError ? <div className="error-banner" role="alert">{openedOrderError}<button type="button" onClick={() => setOpenedOrderError(null)}>Dismiss</button></div> : null}
          {openedOrder ? <section className="panel page-stack" aria-label={`Order details ${openedOrder.publicOrderId}`}>
            <div className="panel-head"><div><p className="eyebrow">Order details</p><h3>{openedOrder.publicOrderId}</h3></div><button type="button" className="secondary-button" onClick={() => setOpenedOrder(null)}>Close details</button></div>
            <div className="status-grid">
              <Stat label="Status" value={label(openedOrder.status)} />
              <Stat label="Channel" value={label(openedOrder.source)} />
              <Stat label="Payment" value={label(openedOrder.paymentStatus)} />
              <Stat label="Total" value={money(openedOrder.totalAmount, openedOrder.currency || currency)} />
              <Stat label="Collected" value={money(openedOrder.amountPaid, openedOrder.currency || currency)} />
            </div>
            {openedOrder.customerNote ? <p className="muted">{openedOrder.customerNote}</p> : null}
            <div className="table-wrap"><table><thead><tr><th>Product</th><th>Unit</th><th>Quantity</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>
              {(openedOrder.items ?? []).map((item) => <tr key={item.id}><td>{item.itemName}</td><td>{item.selectedUom}</td><td>{Number(item.quantity)}</td><td>{item.unitPrice == null ? '—' : money(item.unitPrice, openedOrder.currency || currency)}</td><td>{item.unitPrice == null ? '—' : money(Number(item.quantity) * Number(item.unitPrice), openedOrder.currency || currency)}</td></tr>)}
            </tbody></table></div>
          </section> : null}
        </article> : <article className="panel"><div className="empty-state"><strong>No customer selected</strong><p>Select a customer to review their history.</p></div></article>}
      </section>
    </div>
  </div>;
}

function parseCustomer(value: unknown): Customer {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    id: String(row.id ?? ''),
    displayName: String(row.displayName ?? 'Customer'),
    phone: typeof row.phone === 'string' ? row.phone : null,
    email: typeof row.email === 'string' ? row.email : null,
    lastOrderAt: typeof row.lastOrderAt === 'string' ? row.lastOrderAt : null,
    createdAt: String(row.createdAt ?? ''),
  };
}

function parseCustomerDetail(value: unknown): CustomerDetail {
  const payload = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const customerRow = payload.customer && typeof payload.customer === 'object' && !Array.isArray(payload.customer) ? payload.customer as Record<string, unknown> : {};
  const summary = payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary) ? payload.summary as Record<string, unknown> : {};
  const customer = parseCustomer(customerRow);
  return {
    customer: { ...customer, whatsappLinked: customerRow.whatsappLinked === true },
    summary: {
      completedOrderCount: numberValue(summary.completedOrderCount),
      totalSales: numberValue(summary.totalSales),
      collected: numberValue(summary.collected),
      outstanding: numberValue(summary.outstanding),
    },
    orders: Array.isArray(payload.orders) ? payload.orders.map((raw) => {
      const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      return {
        id: String(row.id ?? ''),
        publicOrderId: String(row.publicOrderId ?? 'Order'),
        status: String(row.status ?? ''),
        paymentStatus: String(row.paymentStatus ?? ''),
        source: String(row.source ?? ''),
        totalAmount: numberValue(row.totalAmount),
        amountPaid: numberValue(row.amountPaid),
        outstandingBalance: numberValue(row.outstandingBalance),
        createdAt: String(row.createdAt ?? ''),
      };
    }).filter((row) => row.id) : [],
  };
}

function Stat({ label: name, value }: { label: string; value: string }) {
  return <div className="status-stat"><span>{name}</span><strong>{value}</strong></div>;
}

function label(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
  }
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
