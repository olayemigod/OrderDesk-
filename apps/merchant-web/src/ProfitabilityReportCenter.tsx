import { useEffect, useRef, useState } from 'react';
import { SellerTrayInput, SellerTraySelect } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';

type BranchOption = { id: string; name: string };
type ProfitTotals = {
  salesCount: number;
  fullyCostedSales?: number;
  incompleteCostSales: number;
  costComplete: boolean;
  netRevenue: number;
  knownCogs: number;
  grossProfit: number | null;
  grossMarginPercent: number | null;
};
type BranchProfit = Omit<ProfitTotals, 'fullyCostedSales'> & {
  branchId: string;
  branchName: string;
};
type ProfitReport = {
  dateFrom: string;
  dateTo: string;
  timezone: string;
  currency: string;
  summary: ProfitTotals;
  branches: BranchProfit[];
};

export default function ProfitabilityReportCenter({
  tenantId,
  currency,
  branches,
  onReviewValuation,
}: {
  tenantId: string;
  currency: string;
  branches: BranchOption[];
  onReviewValuation: () => void;
}) {
  const [initialRange] = useState(() => dateRange(30));
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [branchId, setBranchId] = useState('');
  const [source, setSource] = useState('all');
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const sequence = ++request.current;
    setReport(null);
    setError(null);

    if (!dateFrom || !dateTo || dateFrom > dateTo || daysBetween(dateFrom, dateTo) > 365) {
      setLoading(false);
      setError('Choose a valid report range of up to 366 days.');
      return () => { request.current += 1; };
    }

    setLoading(true);
    void (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('get_sellertray_profitability_report', {
          p_tenant_id: tenantId,
          p_date_from: dateFrom,
          p_date_to: dateTo,
          p_branch_id: branchId || null,
          p_source: source === 'all' ? null : source,
        });
        if (rpcError) throw rpcError;
        const next = parseProfitReport(data);
        if (next.currency !== currency) throw new Error('Business currency does not match this report. Refresh your Business settings.');
        if (sequence === request.current) setReport(next);
      } catch (cause) {
        if (sequence === request.current) setError(errorMessage(cause, 'Unable to load profitability.'));
      } finally {
        if (sequence === request.current) setLoading(false);
      }
    })();
    return () => { request.current += 1; };
  }, [tenantId, currency, dateFrom, dateTo, branchId, source, revision]);

  function resetFilters() {
    const next = dateRange(30);
    setDateFrom(next.from);
    setDateTo(next.to);
    setBranchId('');
    setSource('all');
  }

  const s = report?.summary;
  const incomplete = (s?.incompleteCostSales ?? 0) > 0;

  return <div className="page-stack report-center">
    <div className="section-heading">
      <div><p className="eyebrow">Profitability</p><h2>Sales gross profit</h2></div>
      <p className="muted">Uses posted sales, completed returns and recorded historical stock costs. Unknown cost is never treated as zero.</p>
    </div>

    <article className="panel report-filter-panel">
      <div className="report-filter-grid">
        <label><span>From</span><SellerTrayInput type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>To</span><SellerTrayInput type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label><span>Branch</span><SellerTraySelect value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All accessible Branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</SellerTraySelect></label>
        <label><span>Channel</span><SellerTraySelect value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All channels</option><option value="pos">POS</option><option value="whatsapp">WhatsApp</option><option value="manual">Manual</option></SellerTraySelect></label>
      </div>
      <div className="report-filter-foot">
        <span className="muted">{report ? report.dateFrom + ' to ' + report.dateTo + ' · ' + report.timezone : 'Selected Business-local sales dates'}</span>
        <div className="topbar-actions"><button type="button" className="text-button" onClick={resetFilters}>Reset filters</button><button type="button" className="secondary-button" disabled={loading} onClick={() => setRevision((current) => current + 1)}>{loading ? 'Loading…' : 'Refresh'}</button></div>
      </div>
    </article>

    {error ? <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setRevision((current) => current + 1)}>Retry</button></div> : null}
    {loading ? <article className="panel"><p className="muted" role="status">Loading profitability…</p></article> : null}

    {!loading && s && report ? <>
      <div className="metric-grid">
        <Metric name="Net sales revenue" value={money(s.netRevenue, report.currency)} note={String(s.salesCount) + ' completed sales'} />
        <Metric name={incomplete ? 'Known cost (incomplete)' : 'Cost of goods sold'} value={money(s.knownCogs, report.currency)} note={String(s.incompleteCostSales) + ' sales missing full cost'} />
        <Metric name="Gross profit" value={s.costComplete && s.grossProfit !== null ? money(s.grossProfit, report.currency) : '—'} note={incomplete ? 'Withheld until cost is complete' : 'Revenue less historical cost'} />
        <Metric name="Gross margin" value={s.costComplete && s.grossMarginPercent !== null ? percent(s.grossMarginPercent) : '—'} note={incomplete ? 'Not a reliable margin yet' : 'Across selected completed sales'} />
      </div>

      {incomplete ? <article className="panel" role="status">
        <div className="panel-head">
          <div><h3>Cost records need attention</h3><p className="muted">{s.incompleteCostSales} of {s.salesCount} sales do not yet have complete historical cost evidence. The total profit and margin are intentionally hidden.</p></div>
          <button type="button" className="secondary-button" onClick={onReviewValuation}>Review inventory value</button>
        </div>
      </article> : null}

      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Branch performance</p><h3>Profitability by Branch</h3></div><span className="muted">{String(s.fullyCostedSales ?? (s.salesCount-s.incompleteCostSales))} fully costed sales</span></div>
        {report.branches.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Branch</th><th>Sales</th><th>Net revenue</th><th>Known cost</th><th>Gross profit</th><th>Margin</th><th>Cost status</th></tr></thead><tbody>
          {report.branches.map((row) => <tr key={row.branchId}>
            <td><strong>{row.branchName}</strong></td><td>{row.salesCount}</td>
            <td>{money(row.netRevenue, report.currency)}</td><td>{money(row.knownCogs, report.currency)}</td>
            <td>{row.costComplete && row.grossProfit !== null ? money(row.grossProfit, report.currency) : '—'}</td>
            <td>{row.costComplete && row.grossMarginPercent !== null ? percent(row.grossMarginPercent) : '—'}</td>
            <td>{row.costComplete ? 'Complete' : String(row.incompleteCostSales) + ' sales need cost'}</td>
          </tr>)}
        </tbody></table></div>
          : <div className="empty-state"><strong>No completed sales in this range</strong><p>Adjust the dates, Branch or channel to find sales.</p></div>}
      </article>
      <article className="panel">
        <p className="muted">This is gross profit on completed sales created in the selected period, net of completed returns recorded to date. Tax collected is excluded from posted-tax revenue. It is not net profit after operating expenses. A cost entry corrected later may update historical profitability without changing the original sale.</p>
      </article>
    </> : null}
  </div>;
}

function Metric({ name, value, note }: { name: string; value: string; note: string }) {
  return <article className="metric-card"><span>{name}</span><strong>{value}</strong><small>{note}</small></article>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SellerTray returned an invalid profitability report.');
  return value as Record<string, unknown>;
}
function amount(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('SellerTray returned an incomplete profitability amount.');
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('SellerTray returned an invalid profitability amount.');
  return parsed;
}
function optionalAmount(value: unknown): number | null { return value === null ? null : amount(value); }
function totals(value: unknown): ProfitTotals {
  const row = record(value);
  return {
    salesCount: amount(row.salesCount),
    fullyCostedSales: row.fullyCostedSales === undefined ? undefined : amount(row.fullyCostedSales),
    incompleteCostSales: amount(row.incompleteCostSales),
    costComplete: row.costComplete === true,
    netRevenue: amount(row.netRevenue),
    knownCogs: amount(row.knownCogs),
    grossProfit: optionalAmount(row.grossProfit),
    grossMarginPercent: optionalAmount(row.grossMarginPercent),
  };
}
function parseProfitReport(value: unknown): ProfitReport {
  const data = record(value);
  if (!Array.isArray(data.branches) || typeof data.currency !== 'string' || typeof data.timezone !== 'string') {
    throw new Error('SellerTray returned an incomplete profitability report.');
  }
  return {
    dateFrom: String(data.dateFrom ?? ''),
    dateTo: String(data.dateTo ?? ''),
    timezone: data.timezone,
    currency: data.currency,
    summary: totals(data.summary),
    branches: data.branches.map((value) => {
      const row = record(value);
      if (typeof row.branchId !== 'string' || typeof row.branchName !== 'string') throw new Error('SellerTray returned an invalid Branch report.');
      return { ...totals(value), branchId: row.branchId, branchName: row.branchName };
    }),
  };
}
function money(value: number, currency: string): string {
  try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return currency + ' ' + value.toLocaleString('en-NG', { maximumFractionDigits: 2 }); }
}
function percent(value: number): string { return value.toLocaleString('en-NG', { maximumFractionDigits: 2 }) + '%'; }
function dateRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  return { from: localDate(from), to: localDate(to) };
}
function localDate(value: Date): string {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
}
function daysBetween(from: string, to: string): number {
  return (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
}
