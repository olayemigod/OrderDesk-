import { SellerTrayInput } from './SellerTrayElements';
import { useEffect, useState } from 'react';

import { errorMessage, supabase } from './supabase';

type Props = { tenantId: string; branchId: string };
type RefundMethod = 'cash' | 'bank' | null;
type ReturnLine = { id: string; orderItemId: string; itemName: string; selectedUom: string; returnedQuantity: number | string; returnedStockQuantity: number | string; conversionFactor: number | string; unitPrice: number | string; lineAmount: number | string };
type ReturnListItem = { id: string; orderId: string; publicOrderId: string; customerName: string; reason: string | null; returnedAmount: number | string; receivableReduction: number | string; refundAmount: number | string; refundMethod: RefundMethod; currency: string; lineCount: number | string; createdAt: string };
type ReturnDetail = Omit<ReturnListItem, 'lineCount'> & { items: ReturnLine[] };
type ReturnsResponse = { items: ReturnListItem[]; totalCount: number; returnedAmount: number | string; receivableReduction: number | string; refundAmount: number | string; returnedLines: number | string; currency: string; limit: number; offset: number };

const PAGE_SIZE = 50;

function money(value: number | string, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(Number(value) || 0); } catch { return `${currency || 'NGN'} ${Number(value || 0).toLocaleString('en-NG')}`; } }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function refundMethodLabel(value: RefundMethod) { return value === 'cash' ? 'Cash' : value === 'bank' ? 'Bank' : 'No payout'; }

export default function ReturnsManagement({ tenantId, branchId }: Props) {
  const [returns, setReturns] = useState<ReturnListItem[]>([]);
  const [selected, setSelected] = useState<ReturnDetail | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [returnedAmount, setReturnedAmount] = useState<number | string>(0);
  const [receivableReduction, setReceivableReduction] = useState<number | string>(0);
  const [refundAmount, setRefundAmount] = useState<number | string>(0);
  const [returnedLines, setReturnedLines] = useState<number | string>(0);
  const [currency, setCurrency] = useState('NGN');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { data, error: loadError } = await supabase.rpc('get_sellertray_returns_management_list', { p_tenant_id: tenantId, p_branch_id: branchId, p_search: query.trim() || null, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE });
      if (loadError) throw loadError;
      const result = data as unknown as ReturnsResponse;
      setReturns(result?.items ?? []);
      setTotalCount(Number(result?.totalCount ?? 0));
      setReturnedAmount(result?.returnedAmount ?? 0);
      setReceivableReduction(result?.receivableReduction ?? 0);
      setRefundAmount(result?.refundAmount ?? 0);
      setReturnedLines(result?.returnedLines ?? 0);
      setCurrency(result?.currency || 'NGN');
    } catch (cause) {
      setReturns([]); setTotalCount(0); setReturnedAmount(0); setReceivableReduction(0); setRefundAmount(0); setReturnedLines(0); setError(errorMessage(cause, 'Unable to load returns.'));
    } finally { setLoading(false); }
  }

  async function loadReturn(returnId: string) {
    setDetailLoading(true); setError(null);
    try {
      const { data, error: detailError } = await supabase.rpc('get_sellertray_return_management_detail', { p_tenant_id: tenantId, p_branch_id: branchId, p_return_id: returnId });
      if (detailError) throw detailError;
      setSelected(data as unknown as ReturnDetail);
    } catch (cause) { setSelected(null); setError(errorMessage(cause, 'Unable to load this return.')); }
    finally { setDetailLoading(false); }
  }

  useEffect(() => { setPage(0); setSelected(null); }, [tenantId, branchId, query]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, query.trim() ? 250 : 0); return () => window.clearTimeout(timer); }, [tenantId, branchId, query, page]);

  const pageStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);

  return <div className="page-stack">
    <div className="section-heading"><div><p className="eyebrow">Completed sale returns</p><h2>Returns</h2></div><div><p className="muted">Review governed merchandise returns, receivable reductions and actual Cash/Bank payouts for the selected Branch.</p><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing' : 'Refresh returns'}</button></div></div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    <div className="metric-grid"><article className="metric-card"><span>Returns</span><strong>{totalCount}</strong><small>Matching completed return events</small></article><article className="metric-card"><span>Returned value</span><strong>{money(returnedAmount, currency)}</strong><small>Commercial value of returned merchandise</small></article><article className="metric-card"><span>Receivable reduced</span><strong>{money(receivableReduction, currency)}</strong><small>Outstanding balance removed by returns</small></article><article className="metric-card"><span>Refunded</span><strong>{money(refundAmount, currency)}</strong><small>Actual Cash or Bank payouts</small></article><article className="metric-card"><span>Returned lines</span><strong>{Number(returnedLines).toLocaleString('en-NG')}</strong><small>Product lines across matching returns</small></article></div>
    <article className="panel"><div className="panel-head"><div><p className="eyebrow">Return history</p><h3>Completed returns</h3></div><label className="select-field"><span>Search</span><SellerTrayInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sale, customer, product or reason" /></label></div>
      {loading ? <div className="empty-state"><p>Loading returns…</p></div> : returns.length === 0 ? <div className="empty-state"><strong>No returns found</strong><p>No completed returns match this Branch and search.</p></div> : <div className="table-wrap"><table><thead><tr><th>Sale</th><th>Customer</th><th>Reason</th><th>Lines</th><th>Returned value</th><th>Receivable reduced</th><th>Refunded</th><th>Date</th><th /></tr></thead><tbody>{returns.map((entry) => <tr key={entry.id}><td><strong>{entry.publicOrderId}</strong></td><td>{entry.customerName}</td><td>{entry.reason || '—'}</td><td>{Number(entry.lineCount)}</td><td>{money(entry.returnedAmount, entry.currency)}</td><td>{money(entry.receivableReduction, entry.currency)}</td><td>{money(entry.refundAmount, entry.currency)} · {refundMethodLabel(entry.refundMethod)}</td><td>{dateTime(entry.createdAt)}</td><td><button type="button" className="text-button" onClick={() => void loadReturn(entry.id)} disabled={detailLoading}>View</button></td></tr>)}</tbody></table></div>}
      <div className="toolbar-row"><span className="muted-copy">{pageStart}–{pageEnd} of {totalCount}</span><div className="topbar-actions"><button type="button" className="text-button" disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button type="button" className="text-button" disabled={loading || pageEnd >= totalCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </article>
    {detailLoading ? <article className="panel"><div className="empty-state"><p>Loading return details…</p></div></article> : null}
    {selected ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">Return details</p><h3>{selected.publicOrderId}</h3></div><button type="button" className="text-button" onClick={() => setSelected(null)}>Close</button></div><div className="status-grid"><div className="status-stat"><span>Customer</span><strong>{selected.customerName}</strong></div><div className="status-stat"><span>Returned value</span><strong>{money(selected.returnedAmount, selected.currency)}</strong></div><div className="status-stat"><span>Receivable reduced</span><strong>{money(selected.receivableReduction, selected.currency)}</strong></div><div className="status-stat"><span>Refunded</span><strong>{money(selected.refundAmount, selected.currency)} · {refundMethodLabel(selected.refundMethod)}</strong></div><div className="status-stat"><span>Date</span><strong>{dateTime(selected.createdAt)}</strong></div></div><p className="muted"><strong>Reason:</strong> {selected.reason || 'No reason recorded'}</p><div className="table-wrap"><table><thead><tr><th>Product</th><th>Unit</th><th>Returned qty</th><th>Stock qty</th><th>Conversion</th><th>Unit price</th><th>Returned value</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.id}><td>{item.itemName}</td><td>{item.selectedUom}</td><td>{Number(item.returnedQuantity)}</td><td>{Number(item.returnedStockQuantity)}</td><td>{Number(item.conversionFactor)}</td><td>{money(item.unitPrice, selected.currency)}</td><td>{money(item.lineAmount, selected.currency)}</td></tr>)}</tbody></table></div><p className="muted">These are immutable snapshots from the posted return. Returned merchandise value, receivable reduction and actual payout remain separate governed facts; SellerTray does not recalculate historical quantities, UOM conversion, tax, prices or settlement on this management screen.</p></article> : null}
  </div>;
}