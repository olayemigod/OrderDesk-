import { useEffect, useState } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type BranchPerformance = {
  branchId: string;
  branchCode: string;
  branchName: string;
  isActive: boolean;
  orders: number;
  completed: number;
  orderValue: number;
  paidValue: number;
  whatsappOrders: number;
  closedShifts: number;
  cashVariance: number;
};

type TrendRow = { date: string; orders: number; orderValue: number; paidValue: number };
type ChannelRow = { channel: string; orders: number; orderValue: number; paidValue: number };
type PaymentRow = { method: string; attempts: number; confirmed: number; confirmedValue: number; pendingVerification: number; failed: number };
type CustomerRow = { customerId: string; customerName: string; orders: number; orderValue: number; paidValue: number; lastOrderAt: string };
type TopItem = { name: string; quantity: number; value: number };

type ReportCenterData = {
  days: number;
  summary: {
    orders: { total: number; completed: number; orderValue: number; averageOrderValue: number; whatsapp: number };
    payments: { paidValue: number; awaitingPayment: number; verificationRequired: number; failed: number; exceptions: number };
    fulfillment: { awaitingFulfillment: number; delivered: number; collected: number };
    topItems: TopItem[];
  };
  branchPerformance: BranchPerformance[];
  salesTrend: TrendRow[];
  channels: ChannelRow[];
  paymentMethods: PaymentRow[];
  topCustomers: CustomerRow[];
};

const PERIODS = [7, 30, 90, 365] as const;

export default function ReportCenter({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<ReportCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadReport();
  }, [tenantId, days]);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('sellertray_report_center', {
        p_tenant_id: tenantId,
        p_days: days,
      });
      if (rpcError) throw rpcError;
      setReport(parseReport(data));
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load Report Center.'));
    } finally {
      setLoading(false);
    }
  }

  return <div className="page-stack report-center">
    <div className="section-heading report-heading">
      <div><p className="eyebrow">Business performance</p><h2>Report Center</h2></div>
      <label className="select-field"><span>Period</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}>{PERIODS.map((value) => <option key={value} value={value}>{periodLabel(value)}</option>)}</select></label>
    </div>

    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {loading && !report ? <article className="panel"><p className="muted">Loading business reports…</p></article> : null}
    {report ? <>
      <div className="metric-grid">
        <Metric label="Order value" value={money(report.summary.orders.orderValue, currency)} note={`${report.summary.orders.total} orders`} />
        <Metric label="Paid value" value={money(report.summary.payments.paidValue, currency)} note={`${report.summary.payments.awaitingPayment} awaiting payment`} />
        <Metric label="Completed" value={formatNumber(report.summary.orders.completed)} note={`${report.summary.fulfillment.awaitingFulfillment} awaiting fulfilment`} />
        <Metric label="Average order" value={money(report.summary.orders.averageOrderValue, currency)} note={`${report.summary.orders.whatsapp} WhatsApp orders`} />
      </div>

      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Branch comparison</p><h3>Performance by Branch</h3></div><span className="muted">{periodLabel(report.days)}</span></div>
        {report.branchPerformance.length ? <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Orders</th><th>Completed</th><th>Order value</th><th>Paid</th><th>WhatsApp</th><th>Closed shifts</th><th>Cash variance</th></tr></thead><tbody>
          {report.branchPerformance.map((row) => <tr key={row.branchId}><td><strong>{row.branchName}</strong><small className="report-subline">{row.branchCode}{row.isActive ? '' : ' · Inactive'}</small></td><td>{formatNumber(row.orders)}</td><td>{formatNumber(row.completed)}</td><td>{money(row.orderValue, currency)}</td><td>{money(row.paidValue, currency)}</td><td>{formatNumber(row.whatsappOrders)}</td><td>{formatNumber(row.closedShifts)}</td><td className={row.cashVariance !== 0 ? 'danger-text' : ''}>{money(row.cashVariance, currency)}</td></tr>)}
        </tbody></table></div> : <Empty title="No Branch activity" body="Branch performance will appear as sales and cashier activity are recorded." />}
      </article>

      <div className="report-two-column">
        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Sales channels</p><h3>Where orders came from</h3></div></div>
          {report.channels.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Channel</th><th>Orders</th><th>Order value</th><th>Paid</th></tr></thead><tbody>{report.channels.map((row) => <tr key={row.channel}><td><strong>{label(row.channel)}</strong></td><td>{formatNumber(row.orders)}</td><td>{money(row.orderValue, currency)}</td><td>{money(row.paidValue, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No channel activity" body="Order-source performance will appear here." />}
        </article>

        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Payments</p><h3>Payment methods</h3></div></div>
          {report.paymentMethods.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Method</th><th>Confirmed</th><th>Value</th><th>Pending</th><th>Failed</th></tr></thead><tbody>{report.paymentMethods.map((row) => <tr key={row.method}><td><strong>{label(row.method)}</strong><small className="report-subline">{row.attempts} attempts</small></td><td>{row.confirmed}</td><td>{money(row.confirmedValue, currency)}</td><td>{row.pendingVerification}</td><td>{row.failed}</td></tr>)}</tbody></table></div> : <Empty title="No payment activity" body="Payment-method performance will appear here." />}
        </article>
      </div>

      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Sales trend</p><h3>Daily performance</h3></div></div>
        {report.salesTrend.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Orders</th><th>Order value</th><th>Paid value</th></tr></thead><tbody>{report.salesTrend.map((row) => <tr key={row.date}><td>{dateOnly(row.date)}</td><td>{row.orders}</td><td>{money(row.orderValue, currency)}</td><td>{money(row.paidValue, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No sales activity" body="Daily sales performance will appear here." />}
      </article>

      <div className="report-two-column">
        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Customers</p><h3>Top customers</h3></div></div>
          {report.topCustomers.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Customer</th><th>Orders</th><th>Order value</th><th>Paid</th></tr></thead><tbody>{report.topCustomers.map((row) => <tr key={row.customerId}><td><strong>{row.customerName}</strong><small className="report-subline">Last order {dateOnly(row.lastOrderAt)}</small></td><td>{row.orders}</td><td>{money(row.orderValue, currency)}</td><td>{money(row.paidValue, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No customer activity" body="Customer contribution will appear here." />}
        </article>

        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Products</p><h3>Top products</h3></div></div>
          {report.summary.topItems.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Product</th><th>Quantity</th><th>Value</th></tr></thead><tbody>{report.summary.topItems.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{formatNumber(row.quantity)}</td><td>{money(row.value, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No product activity" body="Top-selling products will appear here." />}
        </article>
      </div>

      {(report.summary.payments.verificationRequired > 0 || report.summary.payments.failed > 0 || report.summary.payments.exceptions > 0) ? <article className="panel report-attention"><div><p className="eyebrow">Payment attention</p><h3>Items needing review</h3></div><div className="report-attention-grid"><Stat label="Verification" value={report.summary.payments.verificationRequired} /><Stat label="Failed" value={report.summary.payments.failed} /><Stat label="Exceptions" value={report.summary.payments.exceptions} /></div></article> : null}
    </> : null}
  </div>;
}

function parseReport(value: unknown): ReportCenterData {
  const root = object(value);
  const summary = object(root.summary);
  const orders = object(summary.orders);
  const payments = object(summary.payments);
  const fulfillment = object(summary.fulfillment);
  return {
    days: numberValue(root.days),
    summary: {
      orders: {
        total: numberValue(orders.total),
        completed: numberValue(orders.completed),
        orderValue: numberValue(orders.orderValue),
        averageOrderValue: numberValue(orders.averageOrderValue),
        whatsapp: numberValue(orders.whatsapp),
      },
      payments: {
        paidValue: numberValue(payments.paidValue),
        awaitingPayment: numberValue(payments.awaitingPayment),
        verificationRequired: numberValue(payments.verificationRequired),
        failed: numberValue(payments.failed),
        exceptions: numberValue(payments.exceptions),
      },
      fulfillment: {
        awaitingFulfillment: numberValue(fulfillment.awaitingFulfillment),
        delivered: numberValue(fulfillment.delivered),
        collected: numberValue(fulfillment.collected),
      },
      topItems: array(summary.topItems).map((item) => {
        const row = object(item);
        return { name: String(row.name ?? 'Product'), quantity: numberValue(row.quantity), value: numberValue(row.value) };
      }),
    },
    branchPerformance: array(root.branchPerformance).map((item) => {
      const row = object(item);
      return { branchId: String(row.branchId ?? ''), branchCode: String(row.branchCode ?? ''), branchName: String(row.branchName ?? 'Branch'), isActive: row.isActive === true, orders: numberValue(row.orders), completed: numberValue(row.completed), orderValue: numberValue(row.orderValue), paidValue: numberValue(row.paidValue), whatsappOrders: numberValue(row.whatsappOrders), closedShifts: numberValue(row.closedShifts), cashVariance: numberValue(row.cashVariance) };
    }).filter((row) => row.branchId),
    salesTrend: array(root.salesTrend).map((item) => { const row = object(item); return { date: String(row.date ?? ''), orders: numberValue(row.orders), orderValue: numberValue(row.orderValue), paidValue: numberValue(row.paidValue) }; }).filter((row) => row.date),
    channels: array(root.channels).map((item) => { const row = object(item); return { channel: String(row.channel ?? 'other'), orders: numberValue(row.orders), orderValue: numberValue(row.orderValue), paidValue: numberValue(row.paidValue) }; }),
    paymentMethods: array(root.paymentMethods).map((item) => { const row = object(item); return { method: String(row.method ?? 'other'), attempts: numberValue(row.attempts), confirmed: numberValue(row.confirmed), confirmedValue: numberValue(row.confirmedValue), pendingVerification: numberValue(row.pendingVerification), failed: numberValue(row.failed) }; }),
    topCustomers: array(root.topCustomers).map((item) => { const row = object(item); return { customerId: String(row.customerId ?? ''), customerName: String(row.customerName ?? 'Customer'), orders: numberValue(row.orders), orderValue: numberValue(row.orderValue), paidValue: numberValue(row.paidValue), lastOrderAt: String(row.lastOrderAt ?? '') }; }).filter((row) => row.customerId),
  };
}

function Metric({ label: name, value, note }: { label: string; value: string; note: string }) { return <article className="metric-card"><span>{name}</span><strong>{value}</strong><small>{note}</small></article>; }
function Stat({ label: name, value }: { label: string; value: number }) { return <div className="status-stat"><span>{name}</span><strong>{formatNumber(value)}</strong></div>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function label(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatNumber(value: number): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(value); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${formatNumber(value)}`; } }
function periodLabel(days: number): string { return days === 365 ? 'Last 12 months' : `Last ${days} days`; }
function dateOnly(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date); }
