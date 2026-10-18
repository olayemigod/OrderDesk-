import { useEffect, useState } from 'react';

import { errorMessage, supabase } from './supabase';

type Props = { tenantId: string; branchId: string; currency: string };
type OrderItem = { id: string; itemName: string; quantity: number | string; selectedUom: string; unitPrice: number | string | null; stockQuantity: number | string };
type OrderListItem = { id: string; publicOrderId: string; status: string; paymentStatus: string; source: string; amountPaid: number | string; totalAmount: number | string; currency: string; customerName: string; createdAt: string };
type OrderDetail = OrderListItem & { customerNote: string | null; returnStatus: string; returnedAmount: number | string; items: OrderItem[] };
type OrderListResponse = { items: OrderListItem[]; totalCount: number; limit: number; offset: number };

const PAGE_SIZE = 50;

function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
function money(value: number | string, currency: string) { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(Number(value) || 0); }
function commandId(orderId: string) { return `web-draft-delete:${orderId}:${Date.now()}`; }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }

export default function OrdersManagement({ tenantId, branchId, currency }: Props) {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { data, error: loadError } = await supabase.rpc('get_sellertray_order_management_list', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_view: status,
        p_search: query.trim() || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (loadError) throw loadError;
      const result = data as unknown as OrderListResponse;
      setOrders(result?.items ?? []);
      setTotalCount(Number(result?.totalCount ?? 0));
    } catch (cause) {
      setOrders([]); setTotalCount(0);
      setError(errorMessage(cause, 'Unable to load orders.'));
    } finally {
      setLoading(false);
    }
  }

  async function openOrder(orderId: string) {
    setDetailLoading(true); setError(null); setReason('');
    try {
      const { data, error: detailError } = await supabase.rpc('get_sellertray_order_management_detail', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_order_id: orderId,
      });
      if (detailError) throw detailError;
      setSelected(data as unknown as OrderDetail);
    } catch (cause) {
      setSelected(null);
      setError(errorMessage(cause, 'Unable to load this order.'));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    setPage(0); setSelected(null); setReason('');
  }, [tenantId, branchId, status, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, query.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [tenantId, branchId, status, query, page]);

  const canDeleteDraft = selected?.source === 'pos' && selected.status === 'draft' && selected.paymentStatus === 'unpaid' && Number(selected.amountPaid || 0) === 0;
  const pageStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);

  async function deleteDraft() {
    if (!selected || !canDeleteDraft || !reason.trim()) return;
    setDeleting(true); setError(null);
    try {
      const { error: actionError } = await supabase.functions.invoke('order-draft-action', { body: { action: 'delete', tenantId, orderId: selected.id, reason: reason.trim(), commandId: commandId(selected.id) } });
      if (actionError) throw actionError;
      setSelected(null); setReason(''); await load();
    } catch (cause) { setError(errorMessage(cause, 'Unable to delete this draft.')); }
    finally { setDeleting(false); }
  }

  return <div className="page-stack">
    <section className="page-heading"><div><p className="eyebrow">Business</p><h2>Orders</h2><p>Review open orders and POS drafts. Completed transactions remain in Sales.</p></div><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></section>
    {error ? <div className="error-banner">{error}</div> : null}
    <section className="panel-card"><div className="toolbar-row"><input className="text-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, customer or product" /><select className="text-input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Open orders</option><option value="draft">Drafts</option><option value="awaiting_payment">Awaiting payment</option><option value="cancelled">Cancelled</option><option value="all">All orders</option></select></div>
      {loading ? <p>Loading orders…</p> : orders.length === 0 ? <p className="muted-copy">No orders match these filters.</p> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Channel</th><th>Status</th><th>Payment</th><th>Total</th><th>Collected</th><th>Date</th><th /></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.publicOrderId}</strong></td><td>{order.customerName}</td><td>{label(order.source)}</td><td>{label(order.status)}</td><td>{label(order.paymentStatus)}</td><td>{money(order.totalAmount, order.currency || currency)}</td><td>{money(order.amountPaid, order.currency || currency)}</td><td>{dateTime(order.createdAt)}</td><td><button type="button" className="text-button" onClick={() => void openOrder(order.id)} disabled={detailLoading}>View</button></td></tr>)}</tbody></table></div>}
      <div className="toolbar-row"><span className="muted-copy">{pageStart}–{pageEnd} of {totalCount}</span><div className="topbar-actions"><button type="button" className="text-button" disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button type="button" className="text-button" disabled={loading || pageEnd >= totalCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </section>
    {detailLoading ? <section className="panel-card"><p>Loading order details…</p></section> : null}
    {selected ? <section className="panel-card"><div className="section-heading"><div><p className="eyebrow">Order details</p><h3>{selected.publicOrderId}</h3></div><button type="button" className="text-button" onClick={() => { setSelected(null); setReason(''); }}>Close</button></div><div className="detail-grid"><div><span>Status</span><strong>{label(selected.status)}</strong></div><div><span>Payment</span><strong>{label(selected.paymentStatus)}</strong></div><div><span>Total</span><strong>{money(selected.totalAmount, selected.currency || currency)}</strong></div><div><span>Collected</span><strong>{money(selected.amountPaid, selected.currency || currency)}</strong></div></div>{selected.customerNote ? <p>{selected.customerNote}</p> : null}<div className="table-wrap"><table><thead><tr><th>Product</th><th>Unit</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.id}><td>{item.itemName}</td><td>{item.selectedUom}</td><td>{Number(item.quantity)}</td><td>{item.unitPrice == null ? '—' : money(item.unitPrice, selected.currency || currency)}</td><td>{item.unitPrice == null ? '—' : money(Number(item.quantity) * Number(item.unitPrice), selected.currency || currency)}</td></tr>)}</tbody></table></div>{canDeleteDraft ? <div className="page-stack"><label>Reason for deleting this draft<textarea className="text-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Enter the reason this draft is no longer needed" /></label><div><button type="button" className="secondary-button" disabled={deleting || !reason.trim()} onClick={() => void deleteDraft()}>{deleting ? 'Deleting…' : 'Delete draft'}</button></div><p className="muted-copy">Deleting removes this unpaid draft from active work while keeping its history for audit.</p></div> : null}</section> : null}
  </div>;
}
