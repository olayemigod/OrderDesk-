import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type Customer = {
  id: string;
  displayName: string;
  phone: string | null;
  whatsappId: string | null;
  email: string | null;
  createdAt: string;
};

type Order = {
  id: string;
  customerId: string | null;
  publicOrderId: string;
  status: string;
  paymentStatus: string;
  source: string;
  amountPaid: number;
  createdAt: string;
};

type CustomerRow = {
  id: string;
  display_name: string | null;
  phone: string | null;
  wa_id: string | null;
  email: string | null;
  created_at: string;
};

type OrderRow = {
  id: string;
  customer_id: string | null;
  public_order_id: string;
  status: string;
  payment_status: string;
  source: string;
  amount_paid: number | string | null;
  created_at: string;
};

export default function CustomersManagement({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => { void load(); }, [tenantId]);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => [customer.displayName, customer.phone ?? '', customer.whatsappId ?? '', customer.email ?? '']
      .some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [customers, search]);

  const selected = customers.find((customer) => customer.id === selectedId) ?? null;
  const selectedOrders = selected ? orders.filter((order) => order.customerId === selected.id) : [];
  const completedOrders = selectedOrders.filter((order) => order.status === 'completed');
  const collected = completedOrders.reduce((total, order) => total + order.amountPaid, 0);

  useEffect(() => {
    setEditName(selected?.displayName ?? '');
    setEditEmail(selected?.email ?? '');
  }, [selectedId, selected?.displayName, selected?.email]);

  async function load(preferredCustomerId?: string) {
    setLoading(true);
    setError(null);
    try {
      const [customerResult, orderResult] = await Promise.all([
        supabase.from('customers')
          .select('id,display_name,phone,wa_id,email,created_at')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('orders')
          .select('id,customer_id,public_order_id,status,payment_status,source,amount_paid,created_at')
          .eq('tenant_id', tenantId)
          .is('deleted_at', null)
          .not('customer_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1000),
      ]);
      if (customerResult.error) throw customerResult.error;
      if (orderResult.error) throw orderResult.error;
      const nextCustomers = ((customerResult.data ?? []) as CustomerRow[]).map((row) => ({
        id: row.id,
        displayName: row.display_name?.trim() || row.phone || row.wa_id || 'Customer',
        phone: row.phone,
        whatsappId: row.wa_id,
        email: row.email,
        createdAt: row.created_at,
      }));
      const nextOrders = ((orderResult.data ?? []) as OrderRow[]).map((row) => ({
        id: row.id,
        customerId: row.customer_id,
        publicOrderId: row.public_order_id,
        status: row.status,
        paymentStatus: row.payment_status,
        source: row.source,
        amountPaid: numberValue(row.amount_paid),
        createdAt: row.created_at,
      }));
      setCustomers(nextCustomers);
      setOrders(nextOrders);
      setSelectedId((current) => {
        if (preferredCustomerId && nextCustomers.some((row) => row.id === preferredCustomerId)) return preferredCustomerId;
        return nextCustomers.some((row) => row.id === current) ? current : nextCustomers[0]?.id ?? null;
      });
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load customers.'));
    } finally {
      setLoading(false);
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
        p_phone: newPhone.trim(),
        p_email: newEmail.trim() || null,
      });
      if (rpcError) throw rpcError;
      const customerId = typeof data === 'string' ? data : null;
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      setCreating(false);
      setNotice('Customer saved. Existing matching phone records are reused when the match is unambiguous.');
      await load(customerId ?? undefined);
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
      await load(selected.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to update customer.'));
    } finally {
      setSaving(false);
    }
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
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone or email" aria-label="Search customers" />
      <button className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing' : 'Refresh'}</button>
      <button className="primary-button" onClick={() => setCreating((value) => !value)}>{creating ? 'Close' : 'Add Customer'}</button>
    </div>
    {creating ? <form className="panel page-stack" onSubmit={createCustomer}>
      <div className="panel-head"><div><p className="eyebrow">New customer</p><h3>Add Customer</h3></div></div>
      <div className="form-grid">
        <label>Name<input required maxLength={120} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Customer name" /></label>
        <label>Phone<input required inputMode="tel" value={newPhone} onChange={(event) => setNewPhone(event.target.value)} placeholder="e.g. 08012345678" /></label>
        <label>Email <span className="muted">Optional</span><input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="customer@example.com" /></label>
      </div>
      <div className="topbar-actions"><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save Customer'}</button></div>
    </form> : null}
    <div className="product-workspace">
      <aside className="panel product-list" aria-label="Customers">
        <div className="panel-head"><div><p className="eyebrow">Customers</p><h3>{visible.length} shown</h3></div></div>
        {visible.length ? visible.map((customer) => <button key={customer.id} className={selectedId === customer.id ? 'product-row active' : 'product-row'} onClick={() => setSelectedId(customer.id)}>
          <span><strong>{customer.displayName}</strong><small>{customer.phone || customer.whatsappId || 'No phone'}</small></span>
        </button>) : <div className="empty-state compact"><strong>No customers found</strong><p>Change the search to find another customer.</p></div>}
      </aside>
      <section className="product-editor-stack">
        {selected ? <form className="panel page-stack" onSubmit={updateCustomer}>
          <div className="panel-head"><div><p className="eyebrow">Customer</p><h3>{selected.displayName}</h3></div><button className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save Changes'}</button></div>
          <div className="form-grid">
            <label>Name<input required maxLength={120} value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
            <label>Email <span className="muted">Optional</span><input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} /></label>
            <label>Phone<input value={selected.phone ?? ''} readOnly aria-readonly="true" /><small className="muted">Phone identity is protected because it links customer history across selling channels.</small></label>
          </div>
          <div className="status-grid">
            <Stat label="Completed sales" value={String(completedOrders.length)} />
            <Stat label="Collected" value={money(collected, currency)} />
            <Stat label="WhatsApp" value={selected.whatsappId && !selected.whatsappId.startsWith('manual:') && !selected.whatsappId.startsWith('pos:') ? 'Linked' : 'Not linked'} />
            <Stat label="Created" value={dateTime(selected.createdAt)} />
          </div>
        </form> : null}
        {selected ? <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">History</p><h3>Recent orders</h3></div></div>
          {selectedOrders.length ? <div className="table-wrap"><table><thead><tr><th>Order</th><th>Source</th><th>Status</th><th>Payment</th><th>Collected</th><th>Created</th></tr></thead><tbody>
            {selectedOrders.slice(0, 100).map((order) => <tr key={order.id}><td><strong>{order.publicOrderId}</strong></td><td>{label(order.source)}</td><td>{label(order.status)}</td><td>{label(order.paymentStatus)}</td><td>{money(order.amountPaid, currency)}</td><td>{dateTime(order.createdAt)}</td></tr>)}
          </tbody></table></div> : <div className="empty-state"><strong>No linked orders</strong><p>Orders attributed to this customer will appear here.</p></div>}
        </article> : <article className="panel"><div className="empty-state"><strong>No customer selected</strong><p>Select a customer to review their history.</p></div></article>}
      </section>
    </div>
  </div>;
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
