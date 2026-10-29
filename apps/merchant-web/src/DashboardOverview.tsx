import './dashboard-overview.css';
import { useEffect, useRef, useState } from 'react';
import type { MerchantPortalPage } from './portalNavigation';
import { errorMessage, numberValue, supabase } from './supabase';

type DashboardPeriod = 1 | 7 | 30;
type Summary = {
  salesCount: number;
  salesValue: number;
  collectedValue: number;
  returnedValue: number;
  averageSale: number;
  whatsappSales: number;
};
type Attention = {
  verificationRequired: number;
  paymentIssues: number;
  awaitingPayment: number;
  awaitingFulfillment: number;
  openShifts: number;
  cashVarianceBranches: number;
  lowStockItems: number;
  outOfStockItems: number;
  openTransfers: number;
  total: number;
};
type BranchRow = { branchId: string; branchName: string; salesCount: number; salesValue: number; collectedValue: number; returnedValue: number; whatsappSales: number; cashVariance: number };
type ChannelRow = { channel: string; salesCount: number; salesValue: number };
type ProductRow = { catalogItemId: string; name: string; stockUom: string; stockQuantity: number; salesValue: number };
type Report = { dateFrom: string; dateTo: string; summary: Summary; attention: Attention; branchPerformance: BranchRow[]; channels: ChannelRow[]; topProducts: ProductRow[] };

const PERIODS: Array<{ days: DashboardPeriod; label: string }> = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

export default function DashboardOverview({ tenantId, currency, go, openBranch }: { tenantId: string; currency: string; go: (page: MerchantPortalPage) => void; openBranch: (page: MerchantPortalPage, branchId: string) => void }) {
  const [days, setDays] = useState<DashboardPeriod>(30);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(0);

  useEffect(() => {
    setReport(null);
    void load();
  }, [tenantId, days]);

  async function load() {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const range = dateRange(days);
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_report_management', {
        p_tenant_id: tenantId,
        p_date_from: range.from,
        p_date_to: range.to,
        p_branch_id: null,
        p_source: null,
        p_payment_method: null,
      });
      if (rpcError) throw rpcError;
      if (requestId === requestRef.current) setReport(parse(data));
    } catch (cause) {
      if (requestId === requestRef.current) setError(errorMessage(cause, 'Unable to load business overview.'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  return <div className="page-stack dashboard-overview">
    <div className="dashboard-heading">
      <div>
        <p className="eyebrow">{report ? rangeLabel(report.dateFrom, report.dateTo) : periodLabel(days)}</p>
        <h2>Business overview</h2>
        <p className="muted dashboard-heading-copy">See governed business performance and the management work that needs attention.</p>
      </div>
      <div className="dashboard-heading-actions">
        <div className="dashboard-periods" role="group" aria-label="Dashboard reporting period">
          {PERIODS.map((period) => <button
            key={period.days}
            type="button"
            className={days === period.days ? 'active' : ''}
            aria-pressed={days === period.days}
            disabled={loading && days === period.days}
            onClick={() => setDays(period.days)}
          >{period.label}</button>)}
        </div>
        <button className="secondary-button" type="button" onClick={() => go('reports')}>Open Report Center</button>
      </div>
    </div>

    <div className="dashboard-quick-actions" aria-label="Management shortcuts">
      <QuickAction title="Manage products" note="Catalogue, units and pricing" onClick={() => go('products')} />
      <QuickAction title="Open purchasing" note="Purchase orders and receiving" onClick={() => go('purchasing')} />
      <QuickAction title="Manage inventory" note="Stock, counts and transfers" onClick={() => go('inventory')} />
      <QuickAction title="Manage team" note="Staff access and permissions" onClick={() => go('team')} />
    </div>

    {error ? <div className="error-banner">{error}<button type="button" onClick={() => void load()}>Retry</button></div> : null}
    {loading && !report ? <article className="panel dashboard-loading"><p className="muted">Loading business overview…</p></article> : null}

    {report ? <>
      <div className="metric-grid dashboard-metric-grid">
        <Metric label="Sales" value={money(report.summary.salesValue, currency)} note={`${formatNumber(report.summary.salesCount)} completed`} />
        <Metric label="Completed sales" value={formatNumber(report.summary.salesCount)} note={`${formatNumber(report.summary.whatsappSales)} from WhatsApp`} />
        <Metric label="Collected" value={money(report.summary.collectedValue, currency)} note="Recorded collections on completed sales" />
        <Metric label="Awaiting payment" value={formatNumber(report.attention.awaitingPayment)} note="Current open orders" />
        <Metric label="Average sale" value={money(report.summary.averageSale, currency)} note={report.summary.returnedValue > 0 ? `${money(report.summary.returnedValue, currency)} returned` : rangeLabel(report.dateFrom, report.dateTo)} />
      </div>

      <div className="two-column dashboard-primary-grid">
        <article className="panel dashboard-attention-panel">
          <div className="panel-head">
            <div><p className="eyebrow">Needs attention</p><h3>{report.attention.total ? `${formatNumber(report.attention.total)} items to review` : 'No current exceptions'}</h3></div>
          </div>
          <Action label="Payment verification" value={report.attention.verificationRequired} onClick={() => go('payments')} />
          <Action label="Payment failures or exceptions" value={report.attention.paymentIssues} onClick={() => go('payments')} />
          <Action label="Awaiting fulfilment" value={report.attention.awaitingFulfillment} onClick={() => go('orders')} />
          <Action label="Open cashier shifts" value={report.attention.openShifts} onClick={() => go('cash')} />
          <Action label="Branches with cash variance" value={report.attention.cashVarianceBranches} onClick={() => go('cash')} />
          <Action label="Low-stock products" value={report.attention.lowStockItems} onClick={() => go('inventory')} />
          <Action label="Out-of-stock products" value={report.attention.outOfStockItems} onClick={() => go('inventory')} />
          <Action label="Open stock transfers" value={report.attention.openTransfers} onClick={() => go('inventory')} />
        </article>

        <article className="panel">
          <div className="panel-head">
            <div><p className="eyebrow">Sales channels</p><h3>Where completed sales originate</h3></div>
            <button className="text-button" type="button" onClick={() => go('reports')}>Full report</button>
          </div>
          {report.channels.length ? <div className="dashboard-list">{report.channels.slice(0, 5).map((row) => <div className="dashboard-list-row" key={row.channel}>
            <div><strong>{label(row.channel)}</strong><span>{formatNumber(row.salesCount)} sales</span></div>
            <strong>{money(row.salesValue, currency)}</strong>
          </div>)}</div> : <Empty body="Channel performance will appear after completed sales." />}
        </article>
      </div>

      <article className="panel">
        <div className="panel-head">
          <div><p className="eyebrow">Branch performance</p><h3>Compare your Branches</h3></div>
          <button className="text-button" type="button" onClick={() => go('reports')}>Full report</button>
        </div>
        {report.branchPerformance.length ? <>
          <div className="table-wrap dashboard-branch-table"><table><thead><tr><th>Branch</th><th>Sales</th><th>Value</th><th>Collected</th><th>WhatsApp</th><th>Returns</th><th>Cash variance</th></tr></thead><tbody>{report.branchPerformance.map((row) => <tr key={row.branchId}><td><button className="text-button" type="button" onClick={() => openBranch('sales', row.branchId)}>{row.branchName}</button></td><td>{formatNumber(row.salesCount)}</td><td>{money(row.salesValue, currency)}</td><td>{money(row.collectedValue, currency)}</td><td>{formatNumber(row.whatsappSales)}</td><td>{money(row.returnedValue, currency)}</td><td className={row.cashVariance !== 0 ? 'danger-text' : ''}>{money(row.cashVariance, currency)}</td></tr>)}</tbody></table></div>
          <div className="dashboard-branch-cards">{report.branchPerformance.map((row) => <button className="dashboard-branch-card" type="button" key={row.branchId} onClick={() => openBranch('sales', row.branchId)}><div className="dashboard-branch-card-head"><strong>{row.branchName}</strong><span>{formatNumber(row.salesCount)} sales</span></div><div><span>Sales</span><strong>{money(row.salesValue, currency)}</strong></div><div><span>Collected</span><strong>{money(row.collectedValue, currency)}</strong></div><div><span>Returns</span><strong>{money(row.returnedValue, currency)}</strong></div><div><span>Cash variance</span><strong className={row.cashVariance !== 0 ? 'danger-text' : ''}>{money(row.cashVariance, currency)}</strong></div></button>)}</div>
        </> : <Empty body="Branch performance will appear as completed sales and cashier activity are recorded." />}
      </article>

      <article className="panel">
        <div className="panel-head">
          <div><p className="eyebrow">Top products</p><h3>Best-selling products</h3></div>
          <button className="text-button" type="button" onClick={() => go('products')}>Manage products</button>
        </div>
        {report.topProducts.length ? <div className="dashboard-list">{report.topProducts.slice(0, 8).map((row) => <div className="dashboard-list-row" key={row.catalogItemId || row.name}><div><strong>{row.name}</strong><span>{formatNumber(row.stockQuantity)} {row.stockUom} sold</span></div><strong>{money(row.salesValue, currency)}</strong></div>)}</div> : <Empty body="Product performance will appear after completed sales." />}
      </article>
    </> : null}
  </div>;
}

function parse(value: unknown): Report {
  const root = object(value), summary = object(root.summary), attention = object(root.attention);
  return {
    dateFrom: String(root.dateFrom ?? ''),
    dateTo: String(root.dateTo ?? ''),
    summary: {
      salesCount: numberValue(summary.salesCount), salesValue: numberValue(summary.salesValue), collectedValue: numberValue(summary.collectedValue), returnedValue: numberValue(summary.returnedValue), averageSale: numberValue(summary.averageSale), whatsappSales: numberValue(summary.whatsappSales),
    },
    attention: {
      verificationRequired: numberValue(attention.verificationRequired), paymentIssues: numberValue(attention.paymentIssues), awaitingPayment: numberValue(attention.awaitingPayment), awaitingFulfillment: numberValue(attention.awaitingFulfillment), openShifts: numberValue(attention.openShifts), cashVarianceBranches: numberValue(attention.cashVarianceBranches), lowStockItems: numberValue(attention.lowStockItems), outOfStockItems: numberValue(attention.outOfStockItems), openTransfers: numberValue(attention.openTransfers), total: numberValue(attention.total),
    },
    branchPerformance: array(root.branchPerformance).map((item) => { const row = object(item); return { branchId: String(row.branchId ?? ''), branchName: String(row.branchName ?? 'Branch'), salesCount: numberValue(row.salesCount), salesValue: numberValue(row.salesValue), collectedValue: numberValue(row.collectedValue), returnedValue: numberValue(row.returnedValue), whatsappSales: numberValue(row.whatsappSales), cashVariance: numberValue(row.cashVariance) }; }).filter((row) => row.branchId),
    channels: array(root.channels).map((item) => { const row = object(item); return { channel: String(row.channel ?? 'other'), salesCount: numberValue(row.salesCount), salesValue: numberValue(row.salesValue) }; }),
    topProducts: array(root.topProducts).map((item) => { const row = object(item); return { catalogItemId: String(row.catalogItemId ?? ''), name: String(row.name ?? 'Product'), stockUom: String(row.stockUom ?? 'unit'), stockQuantity: numberValue(row.stockQuantity), salesValue: numberValue(row.salesValue) }; }),
  };
}

function Metric({ label: name, value, note }: { label: string; value: string; note: string }) { return <article className="metric-card"><span>{name}</span><strong>{value}</strong><small>{note}</small></article>; }
function QuickAction({ title, note, onClick }: { title: string; note: string; onClick: () => void }) { return <button className="dashboard-quick-action" type="button" onClick={onClick}><strong>{title}</strong><span>{note}</span><b aria-hidden="true">→</b></button>; }
function Action({ label: name, value, onClick }: { label: string; value: number; onClick: () => void }) { return <button className="detail-row overview-action" type="button" onClick={onClick}><span>{name}</span><strong>{formatNumber(value)}</strong></button>; }
function Empty({ body }: { body: string }) { return <div className="dashboard-empty"><p className="muted">{body}</p></div>; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function label(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatNumber(value: number): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(value); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${formatNumber(value)}`; } }
function periodLabel(days: number): string { return days === 1 ? 'Today' : `Last ${days} days`; }
function dateRange(days: number): { from: string; to: string } { const to = new Date(); const from = new Date(to); from.setDate(from.getDate()-(days-1)); return { from: isoDate(from), to: isoDate(to) }; }
function isoDate(value: Date): string { return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`; }
function rangeLabel(from: string, to: string): string { if (!from || !to) return 'Selected period'; if (from===to) return dateOnly(from); return `${dateOnly(from)} – ${dateOnly(to)}`; }
function dateOnly(value: string): string { const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date); }
