import { useEffect, useMemo, useState } from 'react';

import { errorMessage, supabase } from './supabase';

type Props = { tenantId: string; branchId: string; currency: string };
type Customer = { display_name: string | null; phone: string | null; wa_id: string | null };
type OrderItem = { id: string; item_name: string; quantity: number | string; selected_uom: string; unit_price: number | string | null };
type Order = { id: string; public_order_id: string; status: string; payment_status: string; source: string; amount_paid: number | string; total_amount: number | string; currency: string; customer_note: string | null; created_at: string; customers: Customer | Customer[] | null; order_items: OrderItem[] | null };

function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
function money(value: number | string, currency: string) { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(Number(value) || 0); }
function commandId(orderId: string) { return `web-draft-delete:${orderId}:${Date.now()}`; }

export default function OrdersManagement({ tenantId, branchId, currency }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    const { data, error: loadError } = await supabase.from('orders')
      .select('id,public_order_id,status,payment_status,source,amount_paid,total_amount,currency,customer_note,created_at,customers(display_name,phone,wa_id),order_items(id,item_name,quantity,selected_uom,unit_price)')
      .eq('tenant_id', tenantId).eq('branch_id', branchId).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(250);
    if (loadError) setError(errorMessage(loadError, 'Unable to load orders.'));
    else setOrders((data ?? []) as Order[]);
    setLoading(false);
  }

  useEffect(() => { setSelectedId(null); setReason(''); void load(); }, [tenantId, branchId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (status === 'active' && order.status === 'completed') return false;
      if (status !== 'all' && status !== 'active' && order.status !== status) return false;
      if (!needle) return true;
      const customer = one(order.customers);
      return [order.public_order_id, order.status, order.payment_status, order.source, customer?.display_name ?? '', customer?.phone ?? '', customer?.wa_id ?? '', ...(order.order_items ?? []).map((item) => item.item_name)].join(' ').toLowerCase().includes(needle);
    });
  }, [orders, query, status]);

  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const canDeleteDraft = selected?.source === 'pos' && selected.status === 'draft' && selected.payment_status === 'unpaid' && Number(selected.amount_paid || 0) === 0;

  async function deleteDraft() {
    if (!selected || !canDeleteDraft || !reason.trim()) return;
    setDeleting(true); setError(null);
    try {
      const { error: actionError } = await supabase.functions.invoke('order-draft-action', { body: { action: 'delete', tenantId, orderId: selected.id, reason: reason.trim(), commandId: commandId(selected.id) } });
      if (actionError) throw actionError;
      setSelectedId(null); setReason(''); await load();
    } catch (cause) { setError(errorMessage(cause, 'Unable to delete this draft.')); }
    finally { setDeleting(false); }
  }

  return <div className="page-stack">
    <section className="page-heading"><div><p className="eyebrow">Business</p><h2>Orders</h2><p>Review open orders and POS drafts. Completed transactions remain in Sales.</p></div><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></section>
    {error ? <div className="error-banner">{error}</div> : null}
    <section className="panel-card"><div className="toolbar-row"><input className="text-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, customer or product" /><select className="text-input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Open orders</option><option value="draft">Drafts</option><option value="awaiting_payment_confirmation">Awaiting payment</option><option value="cancelled">Cancelled</option><option value="all">All orders</option></select></div>
      {loading ? <p>Loading orders…</p> : visible.length === 0 ? <p className="muted-copy">No orders match these filters.</p> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Channel</th><th>Status</th><th>Payment</th><th>Total</th><th>Collected</th><th>Date</th><th /></tr></thead><tbody>{visible.map((order) => { const customer = one(order.customers); return <tr key={order.id}><td><strong>{order.public_order_id}</strong></td><td>{customer?.display_name || customer?.phone || customer?.wa_id || 'Walk-in customer'}</td><td>{label(order.source)}</td><td>{label(order.status)}</td><td>{label(order.payment_status)}</td><td>{money(order.total_amount, order.currency || currency)}</td><td>{money(order.amount_paid, order.currency || currency)}</td><td>{new Date(order.created_at).toLocaleString()}</td><td><button type="button" className="text-button" onClick={() => { setSelectedId(order.id); setReason(''); }}>View</button></td></tr>; })}</tbody></table></div>}
    </section>
    {selected ? <section className="panel-card"><div className="section-heading"><div><p className="eyebrow">Order details</p><h3>{selected.public_order_id}</h3></div><button type="button" className="text-button" onClick={() => { setSelectedId(null); setReason(''); }}>Close</button></div><div className="detail-grid"><div><span>Status</span><strong>{label(selected.status)}</strong></div><div><span>Payment</span><strong>{label(selected.payment_status)}</strong></div><div><span>Total</span><strong>{money(selected.total_amount, selected.currency || currency)}</strong></div><div><span>Collected</span><strong>{money(selected.amount_paid, selected.currency || currency)}</strong></div></div>{selected.customer_note ? <p>{selected.customer_note}</p> : null}<div className="table-wrap"><table><thead><tr><th>Product</th><th>Unit</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>{(selected.order_items ?? []).map((item) => <tr key={item.id}><td>{item.item_name}</td><td>{item.selected_uom}</td><td>{Number(item.quantity)}</td><td>{item.unit_price == null ? '—' : money(item.unit_price, selected.currency || currency)}</td><td>{item.unit_price == null ? '—' : money(Number(item.quantity) * Number(item.unit_price), selected.currency || currency)}</td></tr>)}</tbody></table></div>{canDeleteDraft ? <div className="page-stack"><label>Reason for deleting this draft<textarea className="text-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Enter the reason this draft is no longer needed" /></label><div><button type="button" className="secondary-button" disabled={deleting || !reason.trim()} onClick={() => void deleteDraft()}>{deleting ? 'Deleting…' : 'Delete draft'}</button></div><p className="muted-copy">Deleting removes this unpaid draft from active work while keeping its history for audit.</p></div> : null}</section> : null}
  </div>;
}
