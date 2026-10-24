import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

type Money = {
  period: string;
  currency: string;
  merchant_gmv: number;
  merchant_returns: number;
  installment_collections: number;
  commercial_order_value: number;
};

type RevenueSummary = {
  generatedAt: string;
  startAt: string;
  previousStartAt: string;
  money: Money[];
  outstanding: { currency: string; balance: number }[];
  coverage: Record<string, string>;
};

type RevenueResponse = { summary: RevenueSummary };

export default function RevenueDashboard({ session, refreshKey }: { session: Session; refreshKey: string }) {
  const [days, setDays] = useState(30);
  const [retry, setRetry] = useState(0);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSummary(null);
    setError(null);
    void invokeJson<RevenueResponse>('platform-admin', { action: 'business_dashboard', days }, session)
      .then((result) => { if (active) setSummary(result.summary); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load ProcessEdge commercial performance.');
      });
    return () => { active = false; };
  }, [session.access_token, days, refreshKey, retry]);

  const current = useMemo(() => summary?.money.filter((row) => row.period === 'current') ?? [], [summary]);
  const previousByCurrency = useMemo(() => new Map((summary?.money ?? []).filter((row) => row.period === 'previous').map((row) => [row.currency, row])), [summary]);

  return <div className="workspace-page">
    <header className="workspace-page-header">
      <div>
        <p className="workspace-eyebrow">Insights & Reports</p>
        <h1>Revenue dashboard</h1>
        <p>ProcessEdge commercial collections, commercial order value and outstanding installment exposure from the governed platform read model.</p>
      </div>
    </header>

    <div className="workspace-banner info">
      <strong>Accounting boundary:</strong> recognised revenue is not calculated or displayed here. Confirmed collections, commercial order value and outstanding installments remain separate facts until SellerTray has an approved revenue-recognition authority.
    </div>

    <div className="workspace-toolbar">
      <label>Comparison period <select value={days} onChange={(event) => setDays(Number(event.target.value))}>{[7, 30, 90].map((value) => <option key={value} value={value}>Last {value} days vs previous {value} days</option>)}</select></label>
      <button className="workspace-button subtle" onClick={() => setRetry((value) => value + 1)}>Refresh revenue facts</button>
    </div>

    {error ? <div className="workspace-banner error" role="alert">{error} Retry using Refresh revenue facts.</div> : !summary ? <p role="status">Loading governed revenue facts…</p> : <>
      <p className="workspace-muted small">As of {formatDate(summary.generatedAt)} · Current rolling period starts {formatDate(summary.startAt)} · Previous rolling period starts {formatDate(summary.previousStartAt)}. Amounts are never combined across currencies.</p>

      <section className="workspace-panel">
        <div className="workspace-panel-heading"><div><h2>ProcessEdge commercial performance</h2><p>Confirmed installment collections and commercial purchase value are shown independently for the selected rolling period.</p></div></div>
        <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Currency</th><th>Confirmed collections</th><th>Previous collections</th><th>Collection change</th><th>Commercial order value</th><th>Previous order value</th><th>Order-value change</th></tr></thead><tbody>
          {current.map((row) => {
            const previous = previousByCurrency.get(row.currency);
            const previousCollections = previous?.installment_collections ?? 0;
            const previousOrderValue = previous?.commercial_order_value ?? 0;
            return <tr key={row.currency}>
              <td><strong>{row.currency}</strong></td>
              <td>{money(row.installment_collections, row.currency)}</td>
              <td>{money(previousCollections, row.currency)}</td>
              <td>{money(row.installment_collections - previousCollections, row.currency)}</td>
              <td>{money(row.commercial_order_value, row.currency)}</td>
              <td>{money(previousOrderValue, row.currency)}</td>
              <td>{money(row.commercial_order_value - previousOrderValue, row.currency)}</td>
            </tr>;
          })}
          {!current.length ? <tr><td colSpan={7}>No governed commercial collections or commercial order value in this period.</td></tr> : null}
        </tbody></table></div>
      </section>

      <section className="workspace-panel">
        <div className="workspace-panel-heading"><div><h2>Outstanding installment balance</h2><p>Current confirmed outstanding obligations. This is exposure due under governed commercial obligations, not earned or recognised revenue.</p></div></div>
        {summary.outstanding.length ? <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Currency</th><th>Outstanding balance</th></tr></thead><tbody>{summary.outstanding.map((row) => <tr key={row.currency}><td><strong>{row.currency}</strong></td><td>{money(row.balance, row.currency)}</td></tr>)}</tbody></table></div> : <p>No outstanding installment obligations.</p>}
      </section>

      <section className="workspace-panel">
        <div className="workspace-panel-heading"><div><h2>Reporting scope</h2><p>This destination is intentionally narrower than the executive Business Dashboard.</p></div></div>
        <p>Merchant GMV and merchant returns remain merchant-business performance and are not presented as ProcessEdge revenue.</p>
        <p>For commercial-order or payment investigation, use <a href="#commercial/orders">Commercial Orders</a> and <a href="#commercial/settlement">Payments & Settlement</a>.</p>
        <p>For merchant adoption, sales activity and attention signals, use the <a href="#overview/dashboard">Business Dashboard</a>.</p>
        {Object.entries(summary.coverage).map(([key, value]) => <p className="workspace-muted small" key={key}>{value}</p>)}
      </section>
    </>}
  </div>;
}

function money(value: number, currency: string) {
  try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(value); }
  catch { return `${currency} ${value.toLocaleString()}`; }
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
