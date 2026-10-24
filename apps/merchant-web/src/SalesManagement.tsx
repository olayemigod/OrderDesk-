import { useEffect, useState } from 'react';

import { SellerTrayInput, SellerTraySelect } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';

type Props = { tenantId: string; branchId: string };
type SaleItem = { id: string; itemName: string; quantity: number | string; selectedUom: string; unitPrice: number | string | null; stockQuantity: number | string };
type SaleListItem = { id: string; publicOrderId: string; source: string; paymentStatus: string; amountPaid: number | string; currency: string; returnStatus: string; returnedAmount: number | string; customerName: string; createdAt: string };
type SaleDetail = SaleListItem & { status: string; totalAmount: number | string; customerNote: string | null; items: SaleItem[] };
type SalesListResponse = { items: SaleListItem[]; totalCount: number; collected: number | string; returned: number | string; currency: string; limit: number; offset: number };
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

const PAGE_SIZE = 50;

function money(value: number | string, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(Number(value) || 0); } catch { return `${currency || 'NGN'} ${Number(value || 0).toLocaleString('en-NG')}`; } }
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function percent(value: number | string | null) { if (value == null) return '—'; return `${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(Number(value) || 0)}%`; }

export default function SalesManagement({ tenantId, branchId }: Props) {
  const [sales, setSales] = useState<SaleListItem[]>([]);
  const [selected, setSelected] = useState<SaleDetail | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [collected, setCollected] = useState<number | string>(0);
  const [returned, setReturned] = useState<number | string>(0);
  const [currency, setCurrency] = useState('NGN');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profitability, setProfitability] = useState<Profitability | null>(null);
  const [profitabilityLoading, setProfitabilityLoading] = useState(false);
  const [profitabilityError, setProfitabilityError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { data, error: loadError } = await supabase.rpc('get_sellertray_sales_management_list', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_search: query.trim() || null,
        p_source: source === 'all' ? null : source,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (loadError) throw loadError;
      const result = data as unknown as SalesListResponse;
      setSales(result?.items ?? []);
      setTotalCount(Number(result?.totalCount ?? 0));
      setCollected(result?.collected ?? 0);
      setReturned(result?.returned ?? 0);
      setCurrency(result?.currency || 'NGN');
    } catch (cause) {
      setSales([]); setTotalCount(0); setCollected(0); setReturned(0);
      setError(errorMessage(cause, 'Unable to load completed sales.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadSale(orderId: string) {
    setDetailLoading(true); setError(null);
    try {
      const { data, error: detailError } = await supabase.rpc('get_sellertray_order_management_detail', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_order_id: orderId,
      });
      if (detailError) throw detailError;
      setSelected(data as unknown as SaleDetail);
    } catch (cause) {
      setSelected(null);
      setError(errorMessage(cause, 'Unable to load this sale.'));
    } finally {
      setDetailLoading(false);
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

  useEffect(() => {
    setPage(0); closeSale();
  }, [tenantId, branchId, query, source]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, query.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [tenantId, branchId, query, source, page]);

  const pageStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);

  function selectSale(saleId: string) {
    void loadSale(saleId);
    void loadProfitability(saleId);
  }

  function closeSale() {
    setSelected(null);
    setProfitability(null);
    setProfitabilityError(null);
  }

  return <div className="page-stack">
    <div className="section-heading"><div><p className="eyebrow">Completed transactions</p><h2>Sales</h2></div><div><p className="muted">Review completed sales from POS, WhatsApp and manual orders.</p><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing' : 'Refresh sales'}</button></div></div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    <div className="metric-grid">
      <article className="metric-card"><span>Sales</span><strong>{totalCount}</strong><small>Completed transactions matching these filters</small></article>
      <article className="metric-card"><span>Collected</span><strong>{money(collected, currency)}</strong><small>Across all matching completed sales</small></article>
      <article className="metric-card"><span>Returned</span><strong>{money(returned, currency)}</strong><small>Approved returned value across all matches</small></article>
    </div>
    <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">Find a sale</p><h3>Transactions</h3></div><div className="topbar-actions"><label className="select-field"><span>Search</span><SellerTrayInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sale, customer or product" /></label><label className="select-field"><span>Channel</span><SellerTraySelect value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All channels</option><option value="pos">POS</option><option value="whatsapp">WhatsApp</option><option value="manual">Manual</option></SellerTraySelect></label></div></div>
      {loading ? <div className="empty-state"><p>Loading sales…</p></div> : sales.length === 0 ? <div className="empty-state"><strong>No completed sales</strong><p>No completed sales match these filters.</p></div> : <div className="table-wrap"><table><thead><tr><th>Sale</th><th>Customer</th><th>Channel</th><th>Payment</th><th>Collected</th><th>Returns</th><th>Date</th><th /></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td><strong>{sale.publicOrderId}</strong></td><td>{sale.customerName}</td><td>{label(sale.source)}</td><td>{label(sale.paymentStatus)}</td><td>{money(sale.amountPaid, sale.currency)}</td><td>{sale.returnStatus === 'none' ? 'None' : `${label(sale.returnStatus)} · ${money(sale.returnedAmount, sale.currency)}`}</td><td>{dateTime(sale.createdAt)}</td><td><button type="button" className="text-button" onClick={() => selectSale(sale.id)} disabled={detailLoading}>View</button></td></tr>)}</tbody></table></div>}
      <div className="toolbar-row"><span className="muted-copy">{pageStart}–{pageEnd} of {totalCount}</span><div className="topbar-actions"><button type="button" className="text-button" disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button type="button" className="text-button" disabled={loading || pageEnd >= totalCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </article>
    {detailLoading ? <article className="panel"><div className="empty-state"><p>Loading sale details…</p></div></article> : null}
    {selected ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">Sale details</p><h3>{selected.publicOrderId}</h3></div><button type="button" className="text-button" onClick={closeSale}>Close</button></div><div className="status-grid"><div className="status-stat"><span>Channel</span><strong>{label(selected.source)}</strong></div><div className="status-stat"><span>Payment</span><strong>{label(selected.paymentStatus)}</strong></div><div className="status-stat"><span>Collected</span><strong>{money(selected.amountPaid, selected.currency)}</strong></div><div className="status-stat"><span>Return status</span><strong>{label(selected.returnStatus)}</strong></div></div>
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
      <div className="table-wrap"><table><thead><tr><th>Product</th><th>Unit</th><th>Qty</th><th>Stock qty</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.id}><td>{item.itemName}</td><td>{item.selectedUom}</td><td>{Number(item.quantity)}</td><td>{Number(item.stockQuantity)}</td><td>{item.unitPrice == null ? '—' : money(item.unitPrice, selected.currency)}</td><td>{item.unitPrice == null ? '—' : money(Number(item.quantity) * Number(item.unitPrice), selected.currency)}</td></tr>)}</tbody></table></div><p className="muted">Returns and refunds are handled through SellerTray's authorised return workflow.</p></article> : null}
  </div>;
}
