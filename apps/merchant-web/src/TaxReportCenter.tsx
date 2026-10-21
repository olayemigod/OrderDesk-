import { SellerTrayInput, SellerTraySelect } from './SellerTrayElements';
import { useEffect, useMemo, useRef, useState } from 'react';

import { errorMessage, numberValue, supabase } from './supabase';

type BranchOption = { id: string; name: string };
type TaxReport = {
  currency: string;
  dateFrom: string;
  dateTo: string;
  salesSubtotal: number;
  salesTax: number;
  salesGross: number;
  returnedSubtotal: number;
  returnedTax: number;
  returnedGross: number;
  netRevenue: number;
  netTax: number;
  netGross: number;
};

export default function TaxReportCenter({ tenantId, currency, branches }: { tenantId: string; currency: string; branches: BranchOption[] }) {
  const initialRange = useMemo(() => dateRange(30), []);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [branchId, setBranchId] = useState('');
  const [source, setSource] = useState('all');
  const [report, setReport] = useState<TaxReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => { void loadReport(); }, [tenantId, dateFrom, dateTo, branchId, source]);

  async function loadReport() {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setError('Choose a valid report date range.');
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_tax_report_summary', {
        p_tenant_id: tenantId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_branch_id: branchId || null,
        p_source: source === 'all' ? null : source,
      });
      if (rpcError) throw rpcError;
      if (requestId === requestRef.current) setReport(parseReport(data));
    } catch (cause) {
      if (requestId === requestRef.current) setError(errorMessage(cause, 'Unable to load tax report.'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  function usePreset(days: number) {
    const range = dateRange(days);
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  const moneyCurrency = report?.currency || currency;

  return <div className="page-stack report-center">
    <div className="section-heading report-heading">
      <div><p className="eyebrow">Tax reconciliation</p><h2>Tax</h2><p className="muted">Posted sales and returns use immutable transaction tax snapshots. Net revenue excludes collected tax; changing current tax settings does not rewrite this history.</p></div>
      <div className="report-preset-actions" role="group" aria-label="Tax report period presets"><button type="button" className="secondary-button" onClick={() => usePreset(7)}>7 days</button><button type="button" className="secondary-button" onClick={() => usePreset(30)}>30 days</button><button type="button" className="secondary-button" onClick={() => usePreset(90)}>90 days</button></div>
    </div>

    <article className="panel report-filter-panel">
      <div className="report-filter-grid">
        <label><span>From</span><SellerTrayInput type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>To</span><SellerTrayInput type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label><span>Branch</span><SellerTraySelect value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All accessible Branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</SellerTraySelect></label>
        <label><span>Source</span><SellerTraySelect value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All channels</option><option value="pos">POS</option><option value="whatsapp">WhatsApp</option><option value="manual">Manual</option></SellerTraySelect></label>
      </div>
    </article>

    {error ? <div className="error-banner">{error}<button type="button" onClick={() => void loadReport()}>Retry</button></div> : null}
    {loading && !report ? <article className="panel"><p className="muted">Loading tax reconciliation…</p></article> : null}
    {report ? <>
      <div className="metric-grid">
        <Metric label="Net revenue" value={money(report.netRevenue, moneyCurrency)} note="Revenue basis after returns, excluding tax" />
        <Metric label="Net tax" value={money(report.netTax, moneyCurrency)} note="Tax collected less historical tax reversed" />
        <Metric label="Net gross" value={money(report.netGross, moneyCurrency)} note="Customer transaction value after returns" />
        <Metric label="Tax reversed" value={money(report.returnedTax, moneyCurrency)} note="Historical tax reversed by completed returns" />
      </div>

      <div className="report-two-column">
        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Posted sales</p><h3>Gross composition</h3></div></div>
          <div className="table-wrap"><table className="compact-table"><tbody>
            <tr><th>Revenue basis / subtotal</th><td>{money(report.salesSubtotal, moneyCurrency)}</td></tr>
            <tr><th>Tax</th><td>{money(report.salesTax, moneyCurrency)}</td></tr>
            <tr><th>Gross sales</th><td><strong>{money(report.salesGross, moneyCurrency)}</strong></td></tr>
          </tbody></table></div>
        </article>

        <article className="panel">
          <div className="panel-head"><div><p className="eyebrow">Completed returns</p><h3>Historical reversal</h3></div></div>
          <div className="table-wrap"><table className="compact-table"><tbody>
            <tr><th>Revenue reversed</th><td>{money(report.returnedSubtotal, moneyCurrency)}</td></tr>
            <tr><th>Tax reversed</th><td>{money(report.returnedTax, moneyCurrency)}</td></tr>
            <tr><th>Gross refunded</th><td><strong>{money(report.returnedGross, moneyCurrency)}</strong></td></tr>
          </tbody></table></div>
        </article>
      </div>

      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Period</p><h3>{report.dateFrom} to {report.dateTo}</h3></div></div>
        <p className="muted">Tax values come from finalised transaction snapshots, not the current Business tax rate. Use this report for reconciliation; current configuration is managed under Business → Settings.</p>
      </article>
    </> : null}
  </div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function parseReport(value: unknown): TaxReport {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    currency: String(row.currency ?? 'NGN'),
    dateFrom: String(row.dateFrom ?? ''),
    dateTo: String(row.dateTo ?? ''),
    salesSubtotal: numberValue(row.salesSubtotal),
    salesTax: numberValue(row.salesTax),
    salesGross: numberValue(row.salesGross),
    returnedSubtotal: numberValue(row.returnedSubtotal),
    returnedTax: numberValue(row.returnedTax),
    returnedGross: numberValue(row.returnedGross),
    netRevenue: numberValue(row.netRevenue),
    netTax: numberValue(row.netTax),
    netGross: numberValue(row.netGross),
  };
}

function dateRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - Math.max(1, days) + 1);
  return { from: isoDate(from), to: isoDate(to) };
}

function isoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function money(value: number, currency: string): string {
  try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}
