import './dashboard-overview.css';
import { useEffect, useRef, useState } from 'react';
import type { MerchantPortalPage } from './portalNavigation';
import { errorMessage, numberValue, supabase } from './supabase';

type DashboardPeriod = 1 | 7 | 30;
type Summary = {
  orders: { total: number; completed: number; orderValue: number; averageOrderValue: number; whatsapp: number };
  payments: { paidValue: number; awaitingPayment: number; verificationRequired: number; failed: number; exceptions: number };
  fulfillment: { awaitingFulfillment: number };
  topItems: Array<{ name: string; quantity: number; value: number }>;
};
type BranchRow = { branchId: string; branchName: string; orders: number; orderValue: number; paidValue: number; whatsappOrders: number; cashVariance: number };
type ChannelRow = { channel: string; orders: number; orderValue: number };
type Report = { days: number; summary: Summary; branchPerformance: BranchRow[]; channels: ChannelRow[] };

const PERIODS: Array<{ days: DashboardPeriod; label: string }> = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

export default function DashboardOverview({ tenantId, currency, go }: { tenantId: string; currency: string; go: (page: MerchantPortalPage) => void }) {
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
      const { data, error: rpcError } = await supabase.rpc('sellertray_report_center', {
        p_tenant_id: tenantId,
        p_days: days,
      });
      if (rpcError) throw rpcError;
      if (requestId === requestRef.current) setReport(parse(data));
    } catch (cause) {
      if (requestId === requestRef.current) setError(errorMessage(cause, 'Unable to load business overview.'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  const cashVarianceBranches = report?.branchPerformance.filter((row) => row.cashVariance !== 0).length ?? 0;
  const attention = report
    ? report.summary.payments.verificationRequired
      + report.summary.payments.failed
      + report.summary.payments.exceptions
      + report.summary.fulfillment.awaitingFulfillment
      + cashVarianceBranches
    : 0;

  return <div className="page-stack dashboard-overview">
    <div className="dashboard-heading">
      <div>
        <p className="eyebrow">{periodLabel(report?.days ?? days)}</p>
        <h2>Business overview</h2>
        <p className="muted dashboard-heading-copy">See performance and the management work that needs attention.</p>
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
        <Metric label="Sales" value={money(report.summary.orders.orderValue, currency)} note={`${formatNumber(report.summary.orders.completed)} completed`} />
        <Metric label="Orders" value={formatNumber(report.summary.orders.total)} note={`${formatNumber(report.summary.orders.whatsapp)} from WhatsApp`} />
        <Metric label="Collected" value={money(report.summary.payments.paidValue, currency)} note="Confirmed collections" />
        <Metric label="Awaiting payment" value={formatNumber(report.summary.payments.awaitingPayment)} note="Orders not yet paid" />
        <Metric label="Average sale" value={money(report.summary.orders.averageOrderValue, currency)} note={periodLabel(report.days)} />
      </div>

      <div className="two-column dashboard-primary-grid">
        <article className="panel dashboard-attention-panel">
          <div className="panel-head">
            <div><p className="eyebrow">Needs attention</p><h3>{attention ? `${formatNumber(attention)} items to review` : 'No current exceptions'}</h3></div>
          </div>
          <Action label="Payment verification" value={report.summary.payments.verificationRequired} onClick={() => go('payments')} />
          <Action label="Payment failures or exceptions" value={report.summary.payments.failed + report.summary.payments.exceptions} onClick={() => go('payments')} />
          <Action label="Awaiting fulfilment" value={report.summary.fulfillment.awaitingFulfillment} onClick={() => go('orders')} />
          <Action label="Branches with cash variance" value={cashVarianceBranches} onClick={() => go('cash')} />
        </article>

        <article className="panel">
          <div className="panel-head">
            <div><p className="eyebrow">Sales channels</p><h3>Where sales originate</h3></div>
            <button className="text-button" type="button" onClick={() => go('reports')}>Full report</button>
          </div>
          {report.channels.length ? <div className="dashboard-list">{report.channels.slice(0, 5).map((row) => <div className="dashboard-list-row" key={row.channel}>
            <div><strong>{label(row.channel)}</strong><span>{formatNumber(row.orders)} orders</span></div>
            <strong>{money(row.orderValue, currency)}</strong>
          </div>)}</div> : <Empty body="Channel performance will appear after completed sales." />}
        </article>
      </div>

      <article className="panel">
        <div className="panel-head">
          <div><p className="eyebrow">Branch performance</p><h3>Compare your Branches</h3></div>
          <button className="text-button" type="button" onClick={() => go('reports')}>Full report</button>
        </div>
        {report.branchPerformance.length ? <>
          <div className="table-wrap dashboard-branch-table"><table><thead><tr><th>Branch</th><th>Orders</th><th>Sales</th><th>Collected</th><th>WhatsApp</th><th>Cash variance</th></tr></thead><tbody>{report.branchPerformance.map((row) => <tr key={row.branchId}><td><strong>{row.branchName}</strong></td><td>{formatNumber(row.orders)}</td><td>{money(row.orderValue, currency)}</td><td>{money(row.paidValue, currency)}</td><td>{formatNumber(row.whatsappOrders)}</td><td className={row.cashVariance !== 0 ? 'danger-text' : ''}>{money(row.cashVariance, currency)}</td></tr>)}</tbody></table></div>
          <div className="dashboard-branch-cards">{report.branchPerformance.map((row) => <div className="dashboard-branch-card" key={row.branchId}><div className="dashboard-branch-card-head"><strong>{row.branchName}</strong><span>{formatNumber(row.orders)} orders</span></div><div><span>Sales</span><strong>{money(row.orderValue, currency)}</strong></div><div><span>Collected</span><strong>{money(row.paidValue, currency)}</strong></div><div><span>WhatsApp</span><strong>{formatNumber(row.whatsappOrders)}</strong></div><div><span>Cash variance</span><strong className={row.cashVariance !== 0 ? 'danger-text' : ''}>{money(row.cashVariance, currency)}</strong></div></div>)}</div>
        </> : <Empty body="Branch performance will appear as completed sales and cashier activity are recorded." />}
      </article>

      <article className="panel">
        <div className="panel-head">
          <div><p className="eyebrow">Top products</p><h3>Best-selling products</h3></div>
          <button className="text-button" type="button" onClick={() => go('products')}>Manage products</button>
        </div>
        {report.summary.topItems.length ? <div className="dashboard-list">{report.summary.topItems.slice(0, 8).map((row) => <div className="dashboard-list-row" key={row.name}><div><strong>{row.name}</strong><span>{formatNumber(row.quantity)} sold</span></div><strong>{money(row.value, currency)}</strong></div>)}</div> : <Empty body="Product performance will appear after completed sales." />}
      </article>
    </> : null}
  </div>;
}

function parse(value: unknown): Report {
  const root = object(value), summary = object(root.summary), orders = object(summary.orders), payments = object(summary.payments), fulfillment = object(summary.fulfillment);
  return {
    days: numberValue(root.days),
    summary: {
      orders: { total: numberValue(orders.total), completed: numberValue(orders.completed), orderValue: numberValue(orders.orderValue), averageOrderValue: numberValue(orders.averageOrderValue), whatsapp: numberValue(orders.whatsapp) },
      payments: { paidValue: numberValue(payments.paidValue), awaitingPayment: numberValue(payments.awaitingPayment), verificationRequired: numberValue(payments.verificationRequired), failed: numberValue(payments.failed), exceptions: numberValue(payments.exceptions) },
      fulfillment: { awaitingFulfillment: numberValue(fulfillment.awaitingFulfillment) },
      topItems: array(summary.topItems).map((item) => { const row = object(item); return { name: String(row.name ?? 'Product'), quantity: numberValue(row.quantity), value: numberValue(row.value) }; }),
    },
    branchPerformance: array(root.branchPerformance).map((item) => { const row = object(item); return { branchId: String(row.branchId ?? ''), branchName: String(row.branchName ?? 'Branch'), orders: numberValue(row.orders), orderValue: numberValue(row.orderValue), paidValue: numberValue(row.paidValue), whatsappOrders: numberValue(row.whatsappOrders), cashVariance: numberValue(row.cashVariance) }; }).filter((row) => row.branchId),
    channels: array(root.channels).map((item) => { const row = object(item); return { channel: String(row.channel ?? 'other'), orders: numberValue(row.orders), orderValue: numberValue(row.orderValue) }; }),
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
function periodLabel(days: number): string { return days === 1 ? 'Last 24 hours' : `Last ${days} days`; }
