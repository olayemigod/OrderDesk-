import { useEffect, useMemo, useState } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type Customer = {
  id: string;
  displayName: string;
  phone: string | null;
  whatsappId: string | null;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void load(); }, [tenantId]);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => [customer.displayName, customer.phone ?? '', customer.whatsappId ?? '']
      .some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [customers, search]);

  const selected = customers.find((customer) => customer.id === selectedId) ?? null;
  const selectedOrders = selected ? orders.filter((order) => order.customerId === selected.id) : [];
  const collected = selectedOrders.reduce((total, order) => total + order.amountPaid, 0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [customerResult, orderResult] = await Promise.all([
        supabase.from('customers')
          .select('id,display_name,phone,wa_id,created_at')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('orders')
          .select('id,customer_id,public_order_id,status,payment_status,source,amount_paid,created_at')
          .eq('tenant_id', tenantId)
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
      setSelectedId((current) => nextCustomers.some((row) => row.id === current) ? current : nextCustomers[0]?.id ?? null);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load customers.'));
    } finally {
      setLoading(false);
    }
  }

  if (loading && customers.length === 0) return <article className="panel">Loading customers…</article>;

  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Customer management</p><h2>Customers</h2></div>
      <p className="muted">Review shared POS and WhatsApp customer history without creating a separate channel-specific customer record.</p>
    </div>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    <div className="product-toolbar panel">
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or phone" aria-label="Search customers" />
      <button className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing' : 'Refresh'}</button>
    </div>
    <div className="product-workspace">
      <aside className="panel product-list" aria-label="Customers">
        <div className="panel-head"><div><p className="eyebrow">Customers</p><h3>{visible.length} shown</h3></div></div>
        {visible.length ? visible.map((customer) => <button key={customer.id} className={selectedId === customer.id ? 'product-row active' : 'product-row'} onClick={() => setSelectedId(customer.id)}>
          <span><strong>{customer.displayName}</strong><small>{customer.phone || customer.whatsappId || 'No phone'}</small></span>
        </button>) : <div className="empty-state compact"><strong>No customers found</strong><p>Change the search to find another customer.</p></div>}
      </aside>
      <section className="product-editor-stack">
        {selected ? <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Customer</p><h3>{selected.displayName}</h3></div></div>
          <div className="status-grid">
            <Stat label="Orders" value={String(selectedOrders.length)} />
            <Stat label="Collected" value={money(collected, currency)} />
            <Stat label="Phone" value={selected.phone || '—'} />
            <Stat label="WhatsApp" value={selected.whatsappId ? 'Linked' : 'Not linked'} />
          </div>
        </article> : null}
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
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
