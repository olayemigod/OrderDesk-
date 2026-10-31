import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

type Money = { period: string; currency: string; merchant_gmv: number; merchant_returns: number; installment_collections: number; commercial_order_value: number };
type RevenueSummary = { generatedAt: string; startAt: string; previousStartAt: string; money: Money[]; outstanding: { currency: string; balance: number }[]; coverage: Record<string, string> };
type RevenueResponse = { summary: RevenueSummary };

export default function RevenueDashboard({ session, refreshKey }: { session: Session; refreshKey: string }) {
  const [days, setDays] = useState(30);
  const [retry, setRetry] = useState(0);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSummary(null); setError(null);
    void invokeJson<RevenueResponse>('platform-admin', { action: 'business_dashboard', days }, session)
      .then((result) => { if (active) setSummary(result.summary); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load ProcessEdge commercial performance.'); });
    return () => { active = false; };
  }, [session.access_token, days, refreshKey, retry]);

  const current = useMemo(() => summary?.money.filter((row) => row.period === 'current') ?? [], [summary]);
  const previousByCurrency = useMemo(() => new Map((summary?.money ?? []).filter((row) => row.period === 'previous').map((row) => [row.currency, row])), [summary]);
  const outstandingByCurrency = useMemo(() => new Map((summary?.outstanding ?? []).map((row) => [row.currency, row.balance])), [summary]);

  return <div className="workspace-page admin-revenue-workspace">
    <header className="workspace-page-header admin-page-hero">
      <div><p className="workspace-eyebrow">Insights & Reports</p><h1>Commercial performance</h1><p>ProcessEdge collections, commercial order value and installment exposure from one governed reporting model.</p></div>
      <div className="admin-page-actions"><label className="admin-period-control"><span>Compare</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}>{[7,30,90].map((value) => <option key={value} value={value}>{value} days</option>)}</select></label><button className="workspace-button subtle" onClick={() => setRetry((value) => value + 1)}>Refresh</button></div>
    </header>

    <div className="admin-accounting-boundary"><span className="workspace-status-pill neutral">Reporting boundary</span><p><strong>ProcessEdge recognised revenue is not calculated or displayed here.</strong> Collections, commercial order value and outstanding installments remain separate facts. Amounts are never combined across currencies.</p></div>

    {error ? <div className="workspace-banner error" role="alert">{error} Retry using Refresh.</div> : !summary ? <div className="admin-workspace-loading" role="status">Loading governed commercial performance…</div> : <>
      <div className="admin-report-meta"><span>Updated {formatDate(summary.generatedAt)}</span><span>Current period from {formatDate(summary.startAt)}</span><span>Previous period from {formatDate(summary.previousStartAt)}</span></div>

      {current.length ? <div className="admin-currency-stack">{current.map((row) => {
        const previous = previousByCurrency.get(row.currency);
        const previousCollections = previous?.installment_collections ?? 0;
        const previousOrderValue = previous?.commercial_order_value ?? 0;
        const outstanding = outstandingByCurrency.get(row.currency) ?? 0;
        return <section className="workspace-panel admin-currency-report" key={row.currency}>
          <div className="admin-currency-heading"><div><span className="admin-currency-code">{row.currency}</span><div><h2>{currencyName(row.currency)}</h2><p>Current {days}-day commercial position</p></div></div><span className="workspace-status-pill good">Governed facts</span></div>
          <div className="admin-financial-kpis">
            <FinancialCard label="Confirmed collections" value={money(row.installment_collections,row.currency)} delta={row.installment_collections-previousCollections} previous={previousCollections} currency={row.currency} />
            <FinancialCard label="Commercial order value" value={money(row.commercial_order_value,row.currency)} delta={row.commercial_order_value-previousOrderValue} previous={previousOrderValue} currency={row.currency} />
            <article className="admin-financial-card exposure"><span>Outstanding installments</span><strong>{money(outstanding,row.currency)}</strong><small>Current confirmed exposure</small></article>
          </div>
          <div className="admin-report-links"><span>Investigate the underlying commercial records</span><div><a href={routeHref('commercial/orders')}>Commercial Orders</a><a href={routeHref('commercial/settlement')}>Payments & Settlement</a><a href={routeHref('commercial/installments')}>Installments</a></div></div>
        </section>;
      })}</div> : <section className="workspace-panel"><div className="workspace-empty"><strong>No commercial activity</strong><p>No governed commercial collections or commercial order value are recorded for this period.</p></div></section>}

      {summary.outstanding.some((row) => !current.some((item) => item.currency === row.currency)) ? <section className="workspace-panel"><div className="workspace-panel-heading"><div><p className="workspace-eyebrow">Exposure</p><h2>Other outstanding currencies</h2><p>Balances without current-period collection/order activity.</p></div></div><div className="admin-exposure-grid">{summary.outstanding.filter((row) => !current.some((item) => item.currency === row.currency)).map((row) => <article className="admin-financial-card exposure" key={row.currency}><span>{row.currency}</span><strong>{money(row.balance,row.currency)}</strong><small>Outstanding installment balance</small></article>)}</div></section> : null}

      <section className="workspace-panel admin-report-scope"><div><p className="workspace-eyebrow">Reporting scope</p><h2>What this workspace measures</h2><p>Merchant GMV and returns remain merchant-business performance. They are deliberately excluded from ProcessEdge commercial performance.</p></div><div className="admin-scope-actions"><a href={routeHref('overview/dashboard')}>Open Business Dashboard</a>{Object.entries(summary.coverage).slice(0,3).map(([key,value]) => <small key={key}>{value}</small>)}</div></section>
    </>}
  </div>;
}

function FinancialCard({ label, value, delta, previous, currency }: { label: string; value: string; delta: number; previous: number; currency: string }) {
  const tone = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return <article className="admin-financial-card"><span>{label}</span><strong>{value}</strong><div className={`admin-financial-delta ${tone}`}><b>{delta > 0 ? '↑' : delta < 0 ? '↓' : '—'} {money(Math.abs(delta),currency)}</b><small>vs {money(previous,currency)} previous</small></div></article>;
}
function routeHref(route: string) { const tenantId = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tenant'); return tenantId ? `#${route}?tenant=${encodeURIComponent(tenantId)}` : `#${route}`; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG',{style:'currency',currency,maximumFractionDigits:2}).format(value); } catch { return `${currency} ${value.toLocaleString()}`; } }
function currencyName(currency: string) { try { return new Intl.DisplayNames(['en'],{type:'currency'}).of(currency) ?? currency; } catch { return currency; } }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG',{dateStyle:'medium',timeStyle:'short'}).format(date); }
