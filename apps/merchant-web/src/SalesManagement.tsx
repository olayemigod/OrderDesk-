import { useEffect, useMemo, useState } from 'react';

import { errorMessage, supabase } from './supabase';

type Props = { tenantId: string; branchId: string };
type SaleItem = { id: string; item_name: string; quantity: number | string; selected_uom: string; unit_price: number | string | null; stock_quantity: number | string };
type Customer = { display_name: string | null; phone: string | null; wa_id: string | null };
type Sale = { id: string; public_order_id: string; source: string; payment_status: string; amount_paid: number | string; currency: string; return_status: string; returned_amount: number | string; created_at: string; customers: Customer | Customer[] | null; order_items: SaleItem[] | null };

function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function money(value: number | string, currency: string) { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value) || 0); }
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }

export function SalesManagement({ tenantId, branchId }: Props) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    const { data, error: loadError } = await supabase.from('orders')
      .select('id, public_order_id, source, payment_status, amount_paid, currency, return_status, returned_amount, created_at, customers(display_name, phone, wa_id), order_items(id, item_name, quantity, selected_uom, unit_price, stock_quantity)')
      .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('status', 'completed')
      .order('created_at', { ascending: false }).limit(250);
    if (loadError) setError(errorMessage(loadError)); else setSales((data ?? []) as Sale[]);
    setLoading(false);
  }

  useEffect(() => { setSelectedId(null); void load(); }, [tenantId, branchId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sales.filter((sale) => {
      if (source !== 'all' && sale.source !== source) return false;
      if (!needle) return true;
      const customer = one(sale.customers);
      return [sale.public_order_id, customer?.display_name ?? '', customer?.phone ?? '', customer?.wa_id ?? '', ...(sale.order_items ?? []).map((item) => item.item_name)].join(' ').toLowerCase().includes(needle);
    });
  }, [sales, query, source]);

  const selected = sales.find((sale) => sale.id === selectedId) ?? null;
  const collected = visible.reduce((sum, sale) => sum + Number(sale.amount_paid || 0), 0);
  const returned = visible.reduce((sum, sale) => sum + Number(sale.returned_amount || 0), 0);
  const currency = visible[0]?.currency ?? 'NGN';

  return <div className="page-stack">
    <section className="page-heading"><div><p className="eyebrow">Business</p><h2>Sales</h2><p>Review completed sales from POS, WhatsApp and manual orders.</p></div><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></section>
    {error ? <div className="error-banner">{error}</div> : null}
    <section className="summary-grid"><article className="summary-card"><span>Sales</span><strong>{visible.length}</strong></article><article className="summary-card"><span>Collected</span><strong>{money(collected, currency)}</strong></article><article className="summary-card"><span>Returned</span><strong>{money(returned, currency)}</strong></article></section>
    <section className="panel-card">
      <div className="toolbar-row"><input className="text-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sale, customer or product" /><select className="text-input" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All channels</option><option value="pos">POS</option><option value="whatsapp">WhatsApp</option><option value="manual">Manual</option></select></div>
      {loading ? <p>Loading sales…</p> : visible.length === 0 ? <p className="muted-copy">No completed sales match these filters.</p> : <div className="table-wrap"><table><thead><tr><th>Sale</th><th>Customer</th><th>Channel</th><th>Payment</th><th>Collected</th><th>Returns</th><th>Date</th><th /></tr></thead><tbody>{visible.map((sale) => { const customer = one(sale.customers); return <tr key={sale.id}><td><strong>{sale.public_order_id}</strong></td><td>{customer?.display_name || customer?.phone || customer?.wa_id || 'Walk-in customer'}</td><td>{label(sale.source)}</td><td>{label(sale.payment_status)}</td><td>{money(sale.amount_paid, sale.currency)}</td><td>{sale.return_status === 'none' ? 'None' : `${label(sale.return_status)} · ${money(sale.returned_amount, sale.currency)}`}</td><td>{new Date(sale.created_at).toLocaleString()}</td><td><button type="button" className="text-button" onClick={() => setSelectedId(sale.id)}>View</button></td></tr>; })}</tbody></table></div>}
    </section>
    {selected ? <section className="panel-card"><div className="section-heading"><div><p className="eyebrow">Sale details</p><h3>{selected.public_order_id}</h3></div><button type="button" className="text-button" onClick={() => setSelectedId(null)}>Close</button></div><div className="detail-grid"><div><span>Channel</span><strong>{label(selected.source)}</strong></div><div><span>Payment</span><strong>{label(selected.payment_status)}</strong></div><div><span>Collected</span><strong>{money(selected.amount_paid, selected.currency)}</strong></div><div><span>Return status</span><strong>{label(selected.return_status)}</strong></div></div><div className="table-wrap"><table><thead><tr><th>Product</th><th>Unit</th><th>Qty</th><th>Stock qty</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>{(selected.order_items ?? []).map((item) => <tr key={item.id}><td>{item.item_name}</td><td>{item.selected_uom}</td><td>{Number(item.quantity)}</td><td>{Number(item.stock_quantity)}</td><td>{item.unit_price == null ? '—' : money(item.unit_price, selected.currency)}</td><td>{item.unit_price == null ? '—' : money(Number(item.quantity) * Number(item.unit_price), selected.currency)}</td></tr>)}</tbody></table></div><p className="muted-copy">Returns and refunds use SellerTray's governed return workflow and are not changed from this review screen.</p></section> : null}
  </div>;
}
