import { useEffect, useState } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';
import './procurement-reports.css';

type ProcurementSummary = {
  purchaseOrders: number;
  purchaseValue: number;
  receivedPurchaseOrders: number;
  receivedValue: number;
  supplierPaidValue: number;
  supplierOutstanding: number;
};

type PurchaseStatusRow = {
  status: string;
  purchaseOrders: number;
  purchaseValue: number;
};

type BranchProcurement = {
  branchId: string;
  branchCode: string;
  branchName: string;
  isActive: boolean;
  purchaseOrders: number;
  purchaseValue: number;
  receivedPurchaseOrders: number;
  receivedValue: number;
  supplierPaidValue: number;
};

type SupplierOutstanding = {
  supplierId: string;
  supplierName: string;
  currency: string;
  purchaseTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  purchaseCount: number;
};

type ProcurementReport = {
  days: number;
  procurementSummary: ProcurementSummary;
  purchaseStatus: PurchaseStatusRow[];
  branchProcurement: BranchProcurement[];
  supplierOutstanding: SupplierOutstanding[];
};

const PERIODS = [7, 30, 90, 365] as const;

export default function ProcurementReportCenter({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<ProcurementReport | null>(null);
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
      setError(errorMessage(cause, 'Unable to load purchasing reports.'));
    } finally {
      setLoading(false);
    }
  }

  return <div className="page-stack procurement-report-center">
    <div className="section-heading report-heading">
      <div><p className="eyebrow">Purchasing performance</p><h2>Purchasing Reports</h2></div>
      <label className="select-field"><span>Period</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}>{PERIODS.map((value) => <option key={value} value={value}>{periodLabel(value)}</option>)}</select></label>
    </div>

    <div className="info-banner procurement-report-note">
      Purchase, receiving and supplier-payment activity follow the selected period. Supplier outstanding is the current unpaid balance across placed Purchase Orders.
    </div>

    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {loading && !report ? <article className="panel"><p className="muted">Loading purchasing reports…</p></article> : null}

    {report ? <>
      <div className="metric-grid">
        <Metric label="Purchase value" value={money(report.procurementSummary.purchaseValue, currency)} note={`${formatNumber(report.procurementSummary.purchaseOrders)} placed Purchase Orders`} />
        <Metric label="Received value" value={money(report.procurementSummary.receivedValue, currency)} note={`${formatNumber(report.procurementSummary.receivedPurchaseOrders)} fully received`} />
        <Metric label="Supplier paid" value={money(report.procurementSummary.supplierPaidValue, currency)} note={periodLabel(report.days)} />
        <Metric label="Supplier outstanding" value={money(report.procurementSummary.supplierOutstanding, currency)} note="Current balance" />
      </div>

      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Procurement by Branch</p><h3>Purchasing and receiving comparison</h3></div><span className="muted">{periodLabel(report.days)}</span></div>
        {report.branchProcurement.length ? <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Purchase Orders</th><th>Purchase value</th><th>Received POs</th><th>Received value</th><th>Supplier paid</th></tr></thead><tbody>
          {report.branchProcurement.map((row) => <tr key={row.branchId}><td><strong>{row.branchName}</strong><small className="report-subline">{row.branchCode}{row.isActive ? '' : ' · Inactive'}</small></td><td>{formatNumber(row.purchaseOrders)}</td><td>{money(row.purchaseValue, currency)}</td><td>{formatNumber(row.receivedPurchaseOrders)}</td><td>{money(row.receivedValue, currency)}</td><td>{money(row.supplierPaidValue, currency)}</td></tr>)}
        </tbody></table></div> : <Empty title="No procurement activity" body="Placed Purchase Orders will appear here by Branch." />}
      </article>

      <div className="report-two-column procurement-report-columns">
        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Purchase Order status</p><h3>Purchasing workflow</h3></div></div>
          {report.purchaseStatus.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Status</th><th>Purchase Orders</th><th>Value</th></tr></thead><tbody>{report.purchaseStatus.map((row) => <tr key={row.status}><td><strong>{label(row.status)}</strong></td><td>{formatNumber(row.purchaseOrders)}</td><td>{money(row.purchaseValue, currency)}</td></tr>)}</tbody></table></div> : <Empty title="No Purchase Orders" body="Purchase Order lifecycle activity will appear here." />}
        </article>

        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Supplier Outstanding</p><h3>Current supplier balances</h3></div></div>
          {report.supplierOutstanding.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Supplier</th><th>Purchases</th><th>Purchase total</th><th>Paid</th><th>Outstanding</th></tr></thead><tbody>{report.supplierOutstanding.map((row) => <tr key={row.supplierId}><td><strong>{row.supplierName}</strong><small className="report-subline">{formatNumber(row.purchaseCount)} placed {row.purchaseCount === 1 ? 'purchase' : 'purchases'}</small></td><td>{formatNumber(row.purchaseCount)}</td><td>{money(row.purchaseTotal, row.currency || currency)}</td><td>{money(row.paidAmount, row.currency || currency)}</td><td className={row.outstandingAmount > 0 ? 'procurement-outstanding' : ''}>{money(row.outstandingAmount, row.currency || currency)}</td></tr>)}</tbody></table></div> : <Empty title="No supplier balances" body="Supplier outstanding will appear after Purchase Orders are placed." />}
        </article>
      </div>
    </> : null}
  </div>;
}

function parseReport(value: unknown): ProcurementReport {
  const root = object(value);
  const summary = object(root.procurementSummary);
  return {
    days: numberValue(root.days),
    procurementSummary: {
      purchaseOrders: numberValue(summary.purchaseOrders),
      purchaseValue: numberValue(summary.purchaseValue),
      receivedPurchaseOrders: numberValue(summary.receivedPurchaseOrders),
      receivedValue: numberValue(summary.receivedValue),
      supplierPaidValue: numberValue(summary.supplierPaidValue),
      supplierOutstanding: numberValue(summary.supplierOutstanding),
    },
    purchaseStatus: array(root.purchaseStatus).map((item) => {
      const row = object(item);
      return {
        status: String(row.status ?? 'unknown'),
        purchaseOrders: numberValue(row.purchaseOrders),
        purchaseValue: numberValue(row.purchaseValue),
      };
    }),
    branchProcurement: array(root.branchProcurement).map((item) => {
      const row = object(item);
      return {
        branchId: String(row.branchId ?? ''),
        branchCode: String(row.branchCode ?? ''),
        branchName: String(row.branchName ?? 'Branch'),
        isActive: row.isActive === true,
        purchaseOrders: numberValue(row.purchaseOrders),
        purchaseValue: numberValue(row.purchaseValue),
        receivedPurchaseOrders: numberValue(row.receivedPurchaseOrders),
        receivedValue: numberValue(row.receivedValue),
        supplierPaidValue: numberValue(row.supplierPaidValue),
      };
    }).filter((row) => row.branchId),
    supplierOutstanding: array(root.supplierOutstanding).map((item) => {
      const row = object(item);
      return {
        supplierId: String(row.supplierId ?? ''),
        supplierName: String(row.supplierName ?? 'Supplier'),
        currency: String(row.currency ?? ''),
        purchaseTotal: numberValue(row.purchaseTotal),
        paidAmount: numberValue(row.paidAmount),
        outstandingAmount: numberValue(row.outstandingAmount),
        purchaseCount: numberValue(row.purchaseCount),
      };
    }).filter((row) => row.supplierId),
  };
}

function Metric({ label: name, value, note }: { label: string; value: string; note: string }) { return <article className="metric-card"><span>{name}</span><strong>{value}</strong><small>{note}</small></article>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function label(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatNumber(value: number): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(value); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${formatNumber(value)}`; } }
function periodLabel(days: number): string { return days === 365 ? 'Last 12 months' : `Last ${days} days`; }
