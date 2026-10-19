import { useEffect, useMemo, useRef, useState } from 'react';
import type { MerchantPortalPage } from './portalNavigation';
import { errorMessage, numberValue, supabase } from './supabase';

type BranchOption = { id: string; name: string };
type BranchPerformance = { branchId: string; branchCode: string; branchName: string; isActive: boolean; salesCount: number; salesValue: number; collectedValue: number; returnedValue: number; whatsappSales: number; closedShifts: number; cashVariance: number };
type TrendRow = { date: string; salesCount: number; salesValue: number; collectedValue: number; returnedValue: number };
type ChannelRow = { channel: string; salesCount: number; salesValue: number; collectedValue: number };
type PaymentRow = { method: string; attempts: number; confirmed: number; confirmedValue: number; pendingVerification: number; failed: number };
type CustomerRow = { customerId: string; customerName: string; salesCount: number; salesValue: number; collectedValue: number; lastSaleAt: string };
type ProductRow = { catalogItemId: string; name: string; stockUom: string; stockQuantity: number; salesValue: number };
type CategoryRow = { category: string; salesCount: number; salesValue: number };
type StaffRow = { staffUserId: string; staffName: string; salesCount: number; salesValue: number; collectedValue: number };
type Attention = { verificationRequired: number; paymentIssues: number; awaitingPayment: number; awaitingFulfillment: number; openShifts: number; cashVarianceBranches: number; lowStockItems: number; outOfStockItems: number; openTransfers: number; total: number };

type ReportCenterData = {
  dateFrom: string;
  dateTo: string;
  timezone: string;
  summary: { salesCount: number; salesValue: number; collectedValue: number; returnedValue: number; averageSale: number; whatsappSales: number };
  attention: Attention;
  branchPerformance: BranchPerformance[];
  salesTrend: TrendRow[];
  channels: ChannelRow[];
  paymentMethods: PaymentRow[];
  topCustomers: CustomerRow[];
  topProducts: ProductRow[];
  categoryPerformance: CategoryRow[];
  staffPerformance: StaffRow[];
};

export default function SalesReportCenter({ tenantId, currency, branches, go, openBranch }: { tenantId: string; currency: string; branches: BranchOption[]; go: (page: MerchantPortalPage) => void; openBranch: (page: MerchantPortalPage, branchId: string) => void }) {
  const initialRange = useMemo(() => dateRange(30), []);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [branchId, setBranchId] = useState('');
  const [source, setSource] = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('all');
  const [methodOptions, setMethodOptions] = useState<string[]>([]);
  const [report, setReport] = useState<ReportCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    void loadReport();
  }, [tenantId, dateFrom, dateTo, branchId, source, paymentMethod]);

  async function loadReport() {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setError('Choose a valid report date range.');
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_report_management', {
        p_tenant_id: tenantId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_branch_id: branchId || null,
        p_source: source === 'all' ? null : source,
        p_payment_method: paymentMethod === 'all' ? null : paymentMethod,
      });
      if (rpcError) throw rpcError;
      const next = parseReport(data);
      if (requestId === requestRef.current) {
        setReport(next);
        setMethodOptions((current) => Array.from(new Set([...current, ...next.paymentMethods.map((row) => row.method).filter(Boolean)])).sort());
      }
    } catch (cause) {
      if (requestId === requestRef.current) setError(errorMessage(cause, 'Unable to load Report Center.'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  function usePreset(days: number) {
    const range = dateRange(days);
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  return <div className="page-stack report-center">
    <div className="section-heading report-heading">
      <div><p className="eyebrow">Business performance</p><h2>Sales & Operations</h2><p className="muted">Completed sales use one governed reporting model. Current attention queues remain separate from the selected performance period so older unresolved work is not hidden.</p></div>
      <div className="report-preset-actions" role="group" aria-label="Report period presets"><button type="button" className="secondary-button" onClick={() => usePreset(7)}>7 days</button><button type="button" className="secondary-button" onClick={() => usePreset(30)}>30 days</button><button type="button" className="secondary-button" onClick={() => usePreset(90)}>90 days</button></div>
    </div>

    <article className="panel report-filter-panel">
      <div className="report-filter-grid">
        <label><span>From</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>To</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label><span>Branch</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All accessible Branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label><span>Source</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All channels</option><option value="pos">POS</option><option value="whatsapp">WhatsApp</option><option value="manual">Manual</option></select></label>
        <label><span>Payment method</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="all">All payment methods</option>{methodOptions.map((method) => <option key={method} value={method}>{label(method)}</option>)}</select></label>
      </div>
      <div className="report-filter-foot"><span className="muted">{report ? `${rangeLabel(report.dateFrom, report.dateTo)} · ${report.timezone}` : 'Exact business-local date range'}</span><button type="button" className="text-button" onClick={() => { setBranchId(''); setSource('all'); setPaymentMethod('all'); const range=dateRange(30); setDateFrom(range.from); setDateTo(range.to); }}>Reset filters</button></div>
    </article>

    {error ? <div className="error-banner">{error}<button onClick={() => void loadReport()}>Retry</button></div> : null}
    {loading && !report ? <article className="panel"><p className="muted">Loading business reports…</p></article> : null}
    {report ? <>
      <div className="metric-grid">
        <Metric label="Sales" value={money(report.summary.salesValue, currency)} note={`${formatNumber(report.summary.salesCount)} completed sales`} />
        <Metric label="Collected" value={money(report.summary.collectedValue, currency)} note="Recorded on completed sales" />
        <Metric label="Returns" value={money(report.summary.returnedValue, currency)} note="Returned value recorded on sales" />
        <Metric label="Average sale" value={money(report.summary.averageSale, currency)} note={`${formatNumber(report.summary.whatsappSales)} WhatsApp sales`} />
      </div>

      <article className="panel report-attention">
        <div><p className="eyebrow">Current attention</p><h3>{report.attention.total ? `${formatNumber(report.attention.total)} management items` : 'No current exceptions'}</h3><p className="muted">Current operational queues are not limited by the sales date filter.</p></div>
        <div className="report-attention-grid report-attention-grid-wide">
          <ActionStat label="Payment verification" value={report.attention.verificationRequired} onClick={() => go('payments')} />
          <ActionStat label="Payment issues" value={report.attention.paymentIssues} onClick={() => go('payments')} />
          <ActionStat label="Awaiting fulfilment" value={report.attention.awaitingFulfillment} onClick={() => go('orders')} />
          <ActionStat label="Open shifts" value={report.attention.openShifts} onClick={() => go('cash')} />
          <ActionStat label="Cash variance Branches" value={report.attention.cashVarianceBranches} onClick={() => go('cash')} />
          <ActionStat label="Low stock" value={report.attention.lowStockItems} onClick={() => go('inventory')} />
          <ActionStat label="Out of stock" value={report.attention.outOfStockItems} onClick={() => go('inventory')} />
          <ActionStat label="Open transfers" value={report.attention.openTransfers} onClick={() => go('inventory')} />
        </div>
      </article>

      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Branch comparison</p><h3>Performance by Branch</h3></div><span className="muted">{rangeLabel(report.dateFrom, report.dateTo)}</span></div>
        {report.branchPerformance.length ? <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Sales</th><th>Value</th><th>Collected</th><th>Returns</th><th>WhatsApp</th><th>Closed shifts</th><th>Cash variance</th></tr></thead><tbody>
          {report.branchPerformance.map((row) => <tr key={row.branchId}><td><button className="text-button" type="button" onClick={() => openBranch('sales', row.branchId)}>{row.branchName}</button><small className="report-subline">{row.branchCode}{row.isActive ? '' : ' · Inactive'}</small></td><td>{formatNumber(row.salesCount)}</td><td>{money(row.salesValue, currency)}</td><td>{money(row.collectedValue, currency)}</td><td>{money(row.returnedValue, currency)}</td><td>{formatNumber(row.whatsappSales)}</td><td>{formatNumber(row.closedShifts)}</td><td className={row.cashVariance !== 0 ? 'danger-text' : ''}>{money(row.cashVariance, currency)}</td></tr>)}
        </tbody></table></div> : <Empty title="No Branch activity" body="Branch performance will appear as completed sales and cashier activity are recorded." />}
      </article>

      <div className="report-two-column">
        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Sales channels</p><h3>Where completed sales came from</h3></div></div>
          {report.channels.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Channel</th><th>Sales</th><th>Value</th><th>Collected</th></tr></thead><tbody>{report.channels.map((row) => <tr key={row.channel}><td><strong>{label(row.channel)}</strong></td><td>{formatNumber(row.salesCount)}</td><td>{money(row.salesValue, currency)}</td><td>{money(row.collectedValue, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No channel activity" body="Completed sale-source performance will appear here." />}
        </article>

        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Payments</p><h3>Payment methods on selected sales</h3></div><button className="text-button" type="button" onClick={() => go('payments')}>Open Payments</button></div>
          {report.paymentMethods.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Method</th><th>Confirmed</th><th>Value</th><th>Pending</th><th>Failed</th></tr></thead><tbody>{report.paymentMethods.map((row) => <tr key={row.method}><td><strong>{label(row.method)}</strong><small className="report-subline">{formatNumber(row.attempts)} attempts</small></td><td>{formatNumber(row.confirmed)}</td><td>{money(row.confirmedValue, currency)}</td><td>{formatNumber(row.pendingVerification)}</td><td>{formatNumber(row.failed)}</td></tr>)}</tbody></table></div> : <Empty title="No payment activity" body="Payment-method performance will appear here." />}
        </article>
      </div>

      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Sales trend</p><h3>Business-local daily performance</h3></div></div>
        {report.salesTrend.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Sales</th><th>Value</th><th>Collected</th><th>Returns</th></tr></thead><tbody>{report.salesTrend.map((row) => <tr key={row.date}><td>{dateOnly(row.date)}</td><td>{formatNumber(row.salesCount)}</td><td>{money(row.salesValue, currency)}</td><td>{money(row.collectedValue, currency)}</td><td>{money(row.returnedValue, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No sales activity" body="Daily completed-sales performance will appear here." />}
      </article>

      <div className="report-two-column">
        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Customers</p><h3>Top customers</h3></div><button className="text-button" type="button" onClick={() => go('customers')}>Open Customers</button></div>
          {report.topCustomers.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Customer</th><th>Sales</th><th>Value</th><th>Collected</th></tr></thead><tbody>{report.topCustomers.map((row) => <tr key={row.customerId}><td><strong>{row.customerName}</strong><small className="report-subline">Last sale {dateTime(row.lastSaleAt)}</small></td><td>{formatNumber(row.salesCount)}</td><td>{money(row.salesValue, currency)}</td><td>{money(row.collectedValue, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No customer activity" body="Customer contribution will appear here." />}
        </article>

        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Products</p><h3>Top products</h3></div><button className="text-button" type="button" onClick={() => go('products')}>Open Products</button></div>
          {report.topProducts.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Product</th><th>Stock quantity sold</th><th>Value</th></tr></thead><tbody>{report.topProducts.map((row) => <tr key={row.catalogItemId || row.name}><td><strong>{row.name}</strong></td><td>{formatNumber(row.stockQuantity)} {row.stockUom}</td><td>{money(row.salesValue, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No product activity" body="Top-selling products will appear here." />}
        </article>
      </div>

      <div className="report-two-column">
        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Categories</p><h3>Category contribution</h3></div></div>
          {report.categoryPerformance.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Category</th><th>Sales</th><th>Value</th></tr></thead><tbody>{report.categoryPerformance.map((row) => <tr key={row.category}><td><strong>{row.category}</strong></td><td>{formatNumber(row.salesCount)}</td><td>{money(row.salesValue, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No category activity" body="Category contribution will appear here when catalogued products are sold." />}
        </article>

        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Staff</p><h3>POS cashier performance</h3></div><button className="text-button" type="button" onClick={() => go('team')}>Open Team</button></div>
          {report.staffPerformance.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Cashier</th><th>Sales</th><th>Value</th><th>Collected</th></tr></thead><tbody>{report.staffPerformance.map((row) => <tr key={row.staffUserId}><td><strong>{row.staffName}</strong></td><td>{formatNumber(row.salesCount)}</td><td>{money(row.salesValue, currency)}</td><td>{money(row.collectedValue, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No cashier attribution" body="POS cashier performance appears for completed sales carrying the governed cashier snapshot." />}
        </article>
      </div>
    </> : null}
  </div>;
}

function parseReport(value: unknown): ReportCenterData {
  const root = object(value), summary = object(root.summary), attention = object(root.attention);
  return {
    dateFrom: String(root.dateFrom ?? ''), dateTo: String(root.dateTo ?? ''), timezone: String(root.timezone ?? ''),
    summary: { salesCount: numberValue(summary.salesCount), salesValue: numberValue(summary.salesValue), collectedValue: numberValue(summary.collectedValue), returnedValue: numberValue(summary.returnedValue), averageSale: numberValue(summary.averageSale), whatsappSales: numberValue(summary.whatsappSales) },
    attention: { verificationRequired: numberValue(attention.verificationRequired), paymentIssues: numberValue(attention.paymentIssues), awaitingPayment: numberValue(attention.awaitingPayment), awaitingFulfillment: numberValue(attention.awaitingFulfillment), openShifts: numberValue(attention.openShifts), cashVarianceBranches: numberValue(attention.cashVarianceBranches), lowStockItems: numberValue(attention.lowStockItems), outOfStockItems: numberValue(attention.outOfStockItems), openTransfers: numberValue(attention.openTransfers), total: numberValue(attention.total) },
    branchPerformance: array(root.branchPerformance).map((item) => { const row=object(item); return { branchId:String(row.branchId??''), branchCode:String(row.branchCode??''), branchName:String(row.branchName??'Branch'), isActive:row.isActive===true, salesCount:numberValue(row.salesCount), salesValue:numberValue(row.salesValue), collectedValue:numberValue(row.collectedValue), returnedValue:numberValue(row.returnedValue), whatsappSales:numberValue(row.whatsappSales), closedShifts:numberValue(row.closedShifts), cashVariance:numberValue(row.cashVariance) }; }).filter((row)=>row.branchId),
    salesTrend: array(root.salesTrend).map((item)=>{ const row=object(item); return { date:String(row.date??''), salesCount:numberValue(row.salesCount), salesValue:numberValue(row.salesValue), collectedValue:numberValue(row.collectedValue), returnedValue:numberValue(row.returnedValue) }; }).filter((row)=>row.date),
    channels: array(root.channels).map((item)=>{ const row=object(item); return { channel:String(row.channel??'other'), salesCount:numberValue(row.salesCount), salesValue:numberValue(row.salesValue), collectedValue:numberValue(row.collectedValue) }; }),
    paymentMethods: array(root.paymentMethods).map((item)=>{ const row=object(item); return { method:String(row.method??'other'), attempts:numberValue(row.attempts), confirmed:numberValue(row.confirmed), confirmedValue:numberValue(row.confirmedValue), pendingVerification:numberValue(row.pendingVerification), failed:numberValue(row.failed) }; }),
    topCustomers: array(root.topCustomers).map((item)=>{ const row=object(item); return { customerId:String(row.customerId??''), customerName:String(row.customerName??'Customer'), salesCount:numberValue(row.salesCount), salesValue:numberValue(row.salesValue), collectedValue:numberValue(row.collectedValue), lastSaleAt:String(row.lastSaleAt??'') }; }).filter((row)=>row.customerId),
    topProducts: array(root.topProducts).map((item)=>{ const row=object(item); return { catalogItemId:String(row.catalogItemId??''), name:String(row.name??'Product'), stockUom:String(row.stockUom??'unit'), stockQuantity:numberValue(row.stockQuantity), salesValue:numberValue(row.salesValue) }; }),
    categoryPerformance: array(root.categoryPerformance).map((item)=>{ const row=object(item); return { category:String(row.category??'Uncategorised'), salesCount:numberValue(row.salesCount), salesValue:numberValue(row.salesValue) }; }),
    staffPerformance: array(root.staffPerformance).map((item)=>{ const row=object(item); return { staffUserId:String(row.staffUserId??''), staffName:String(row.staffName??'Cashier'), salesCount:numberValue(row.salesCount), salesValue:numberValue(row.salesValue), collectedValue:numberValue(row.collectedValue) }; }).filter((row)=>row.staffUserId),
  };
}

function Metric({ label: name, value, note }: { label: string; value: string; note: string }) { return <article className="metric-card"><span>{name}</span><strong>{value}</strong><small>{note}</small></article>; }
function ActionStat({ label: name, value, onClick }: { label: string; value: number; onClick: () => void }) { return <button className="status-stat report-action-stat" type="button" onClick={onClick}><span>{name}</span><strong>{formatNumber(value)}</strong></button>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function label(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatNumber(value: number): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(value); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${formatNumber(value)}`; } }
function dateRange(days: number): { from: string; to: string } { const to=new Date(); const from=new Date(to); from.setDate(from.getDate()-(days-1)); return { from:isoDate(from), to:isoDate(to) }; }
function isoDate(value: Date): string { return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`; }
function rangeLabel(from: string, to: string): string { if (!from||!to) return 'Selected period'; return from===to ? dateOnly(from) : `${dateOnly(from)} – ${dateOnly(to)}`; }
function dateOnly(value: string): string { const date=new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG',{dateStyle:'medium'}).format(date); }
function dateTime(value: string): string { const date=new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG',{dateStyle:'medium',timeStyle:'short'}).format(date); }
