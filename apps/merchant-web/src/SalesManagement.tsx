import { useEffect, useMemo, useState } from 'react';

import { errorMessage, supabase } from './supabase';

type Props = { tenantId: string; branchId: string };
type SaleItem = { id: string; item_name: string; quantity: number | string; selected_uom: string; unit_price: number | string | null; stock_quantity: number | string };
type Customer = { display_name: string | null; phone: string | null; wa_id: string | null };
type Sale = { id: string; public_order_id: string; source: string; payment_status: string; amount_paid: number | string; currency: string; return_status: string; returned_amount: number | string; created_at: string; customers: Customer | Customer[] | null; order_items: SaleItem[] | null };
type Profitability = {
  orderId: string;
  publicOrderId: string;
  branchId: string;
  currency: string;
  netRevenue: number | string;
  knownCogs: number | string;
  cogsComplete: boolean;
  grossProfit: number | string | null;
  grossMarginPercent: number | string | null;
};

function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function money(value: number | string, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(Number(value) || 0); } catch { return `${currency || 'NGN'} ${Number(value || 0).toLocaleString('en-NG')}`; } }
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function percent(value: number | string | null) { if (value == null) return '—'; return `${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(Number(value) || 0)}%`; }

export default function SalesManagement({ tenantId, branchId }: Props) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profitability, setProfitability] = useState<Profitability | null>(null);
  const [profitabilityLoading, setProfitabilityLoading] = useState(false);
  const [profitabilityError, setProfitabilityError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { data, error: loadError } = await supabase.from('orders')
        .select('id,public_order_id,source,payment_status,amount_paid,currency,return_status,returned_amount,created_at,customers(display_name,phone,wa_id),order_items(id,item_name,quantity,selected_uom,unit_price,stock_quantity)')
        .eq('tenant_id', tenantId)
        .eq('branch_id', branchId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(250);
      if (loadError) throw loadError;
      setSales((data ?? []) as unknown as Sale[]);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load completed sales.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadProfitability(orderId: string) {
    setProfitability(null);
    setProfitabilityError(null);
    setProfitabilityLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_order_profitability', {
        p_tenant_id: tenantId,
        p_order_id: orderId,
      });
      if (rpcError) throw rpcError;
      setProfitability(data as Profitability);
    } catch (cause) {
      const message = errorMessage(cause, 'Unable to load profitability for this sale.');
      setProfitabilityError(/permission|access/i.test(message)
        ? 'Profitability is available to team members with report access.'
        : message);
    } finally {
      setProfitabilityLoading(false);
    }
  }

  useEffect(() => { setSelectedId(null); setProfitability(null); setProfitabilityError(null); void load(); }, [tenantId, branchId]);

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
  const currency = visible[0]?.currency ?? sales[0]?.currency ?? 'NGN';

  function selectSale(saleId: string) {
    setSelectedId(saleId);
    void loadProfitability(saleId);
  }

  function closeSale() {
    setSelectedId(null);
    setProfitability(null);
    setProfitabilityError(null);
  }

  return <div className="page-stack">
    <div className="section-heading"><div><p className="eyebrow">Completed transactions</p><h2>Sales</h2></div><div><p className="muted">Review completed sales from POS, WhatsApp and manual orders.</p><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing' : 'Refresh sales'}</button></div></div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    <div className="metric-grid">
      <article className="metric-card"><span>Sales</span><strong>{visible.length}</strong><small>Completed transactions in this view</small></article>
      <article className="metric-card"><span>Collected</span><strong>{money(collected, currency)}</strong><small>Amount recorded as collected</small></article>
      <article className="metric-card"><span>Returned</span><strong>{money(returned, currency)}</strong><small>Approved returned value</small></article>
    </div>
    <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">Find a sale</p><h3>Transactions</h3></div><div className="topbar-actions"><label className="select-field"><span>Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sale, customer or product" /></label><label className="select-field"><span>Channel</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All channels</option><option value="pos">POS</option><option value="whatsapp">WhatsApp</option><option value="manual">Manual</option></select></label></div></div>
      {loading ? <div className="empty-state"><p>Loading sales…</p></div> : visible.length === 0 ? <div className="empty-state"><strong>No completed sales</strong><p>No completed sales match these filters.</p></div> : <div className="table-wrap"><table><thead><tr><th>Sale</th><th>Customer</th><th>Channel</th><th>Payment</th><th>Collected</th><th>Returns</th><th>Date</th><th /></tr></thead><tbody>{visible.map((sale) => { const customer = one(sale.customers); return <tr key={sale.id}><td><strong>{sale.public_order_id}</strong></td><td>{customer?.display_name || customer?.phone || customer?.wa_id || 'Walk-in customer'}</td><td>{label(sale.source)}</td><td>{label(sale.payment_status)}</td><td>{money(sale.amount_paid, sale.currency)}</td><td>{sale.return_status === 'none' ? 'None' : `${label(sale.return_status)} · ${money(sale.returned_amount, sale.currency)}`}</td><td>{dateTime(sale.created_at)}</td><td><button type="button" className="text-button" onClick={() => selectSale(sale.id)}>View</button></td></tr>; })}</tbody></table></div>}
    </article>
    {selected ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">Sale details</p><h3>{selected.public_order_id}</h3></div><button type="button" className="text-button" onClick={closeSale}>Close</button></div><div className="status-grid"><div className="status-stat"><span>Channel</span><strong>{label(selected.source)}</strong></div><div className="status-stat"><span>Payment</span><strong>{label(selected.payment_status)}</strong></div><div className="status-stat"><span>Collected</span><strong>{money(selected.amount_paid, selected.currency)}</strong></div><div className="status-stat"><span>Return status</span><strong>{label(selected.return_status)}</strong></div></div>
      <section className="page-stack"><div className="section-heading"><div><p className="eyebrow">Historical profitability</p><h4>Sale margin</h4></div><p className="muted">Uses the stock ledger cost state at the sale's business time.</p></div>
        {profitabilityLoading ? <div className="empty-state"><p>Loading profitability…</p></div> : profitabilityError ? <div className="empty-state"><strong>Profitability unavailable</strong><p>{profitabilityError}</p></div> : profitability ? profitability.cogsComplete ? <div className="metric-grid">
          <article className="metric-card"><span>Net revenue</span><strong>{money(profitability.netRevenue, profitability.currency || selected.currency)}</strong><small>After approved returns</small></article>
          <article className="metric-card"><span>Cost of goods sold</span><strong>{money(profitability.knownCogs, profitability.currency || selected.currency)}</strong><small>Historical governed cost</small></article>
          <article className="metric-card"><span>Gross profit</span><strong>{profitability.grossProfit == null ? '—' : money(profitability.grossProfit, profitability.currency || selected.currency)}</strong><small>Revenue less complete historical COGS</small></article>
          <article className="metric-card"><span>Gross margin</span><strong>{percent(profitability.grossMarginPercent)}</strong><small>Complete cost coverage</small></article>
        </div> : <div className="page-stack"><div className="metric-grid">
          <article className="metric-card"><span>Net revenue</span><strong>{money(profitability.netRevenue, profitability.currency || selected.currency)}</strong><small>After approved returns</small></article>
          <article className="metric-card"><span>Known COGS</span><strong>{money(profitability.knownCogs, profitability.currency || selected.currency)}</strong><small>Only stock with governed cost evidence</small></article>
          <article className="metric-card"><span>Cost coverage</span><strong>Incomplete</strong><small>Some sold stock is unvalued</small></article>
        </div><div className="empty-state"><strong>Gross profit is not shown</strong><p>SellerTray does not estimate missing inventory cost. Complete purchase-cost history is required before gross profit and margin become authoritative.</p></div></div> : null}
      </section>
      <div className="table-wrap"><table><thead><tr><th>Product</th><th>Unit</th><th>Qty</th><th>Stock qty</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>{(selected.order_items ?? []).map((item) => <tr key={item.id}><td>{item.item_name}</td><td>{item.selected_uom}</td><td>{Number(item.quantity)}</td><td>{Number(item.stock_quantity)}</td><td>{item.unit_price == null ? '—' : money(item.unit_price, selected.currency)}</td><td>{item.unit_price == null ? '—' : money(Number(item.quantity) * Number(item.unit_price), selected.currency)}</td></tr>)}</tbody></table></div><p className="muted">Returns and refunds are handled through SellerTray's authorised return workflow.</p></article> : null}
  </div>;
}
