import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

type Metrics = Record<'new_merchants' | 'new_activations' | 'transacting_merchants' | 'transacting_branches' | 'completed_orders' | 'pos_orders' | 'whatsapp_orders', number>;
type Money = { period: string; currency: string; merchant_gmv: number; merchant_returns: number; installment_collections: number; commercial_order_value: number };
type Summary = { generatedAt: string; startAt: string; previousStartAt: string; totalMerchants: number; activatedMerchants: number; whatsappConnected: number; current: Metrics; previous: Metrics; money: Money[]; outstanding: { currency: string; balance: number }[]; coverage: Record<string, string>; insights: { code: string; change: number; action: string; href: string }[] };
type Attention = { total: number; counts: { signal: string; count: number }[]; items: { tenant_id: string; name: string; signal: string; action: string }[] };
const signals: Record<string, string> = { inactive_14d: 'Activated merchants without a completed sale in 14 days', entitlement_ending: 'Entitlements ending within 7 days', setup_incomplete: 'Merchants with incomplete Branch setup' };

export default function BusinessDashboard({ session, refreshKey }: { session: Session; refreshKey: string }) {
  const [days, setDays] = useState(30);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<{ summary: Summary; attention: Attention } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setData(null); setError(null);
    void invokeJson<{ summary: Summary; attention: Attention }>('platform-admin', { action: 'business_dashboard', days }, session)
      .then((result) => { if (active) setData(result); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load business performance.'); });
    return () => { active = false; };
  }, [session.access_token, days, refreshKey, retry]);
  return <div className="workspace-page">
    <header className="workspace-page-header"><p className="workspace-eyebrow">ProcessEdge business performance</p><h1>SellerTray business dashboard</h1><p className="workspace-muted">Growth, confirmed collections and merchant adoption. Technical health is in Platform Operations.</p></header>
    <div className="workspace-toolbar"><label>Comparison period <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7,30,90].map((value) => <option key={value} value={value}>Last {value} days vs previous {value} days</option>)}</select></label><button className="workspace-button subtle" onClick={() => setRetry((value) => value + 1)}>Refresh performance</button></div>
    {error ? <div className="workspace-banner error" role="alert">{error} Retry using Refresh performance.</div> : !data ? <p role="status">Loading business performance…</p> : <>
      <p className="workspace-muted small">As of {new Date(data.summary.generatedAt).toLocaleString()} · Current: {new Date(data.summary.startAt).toLocaleString()} to as-of time · Previous starts {new Date(data.summary.previousStartAt).toLocaleString()}. Equal rolling periods; current-state totals are labelled separately.</p>
      <div className="workspace-stat-grid">
        <Kpi label="Merchants transacting" value={data.summary.current.transacting_merchants} previous={data.summary.previous.transacting_merchants} />
        <Kpi label="New merchants" value={data.summary.current.new_merchants} previous={data.summary.previous.new_merchants} />
        <Kpi label="New governed activations" value={data.summary.current.new_activations} previous={data.summary.previous.new_activations} />
        <Kpi label="Completed merchant orders" value={data.summary.current.completed_orders} previous={data.summary.previous.completed_orders} />
      </div>
      <section className="workspace-panel"><h2>Merchant estate & adoption</h2><p>Current estate: {data.summary.totalMerchants} merchants · {data.summary.activatedMerchants} governed activations · {data.summary.whatsappConnected} WhatsApp connected.</p><div className="workspace-stat-grid">
        <Kpi label="Branches transacting" value={data.summary.current.transacting_branches} previous={data.summary.previous.transacting_branches} />
        <Kpi label="POS orders" value={data.summary.current.pos_orders} previous={data.summary.previous.pos_orders} />
        <Kpi label="WhatsApp orders" value={data.summary.current.whatsapp_orders} previous={data.summary.previous.whatsapp_orders} />
      </div></section>
      <section className="workspace-panel"><h2>ProcessEdge commercial performance</h2><p className="workspace-muted">Confirmed installment collections and commercial purchase value are separate measures. Collections are gross cash receipts, not recognised revenue. Amounts remain separate by currency.</p>
        <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Currency</th><th>Installment collections</th><th>Previous period</th><th>Commercial order value</th></tr></thead><tbody>{data.summary.money.filter((row) => row.period === 'current').map((row) => <tr key={row.currency}><td>{row.currency}</td><td>{money(row.installment_collections,row.currency)}</td><td>{money(data.summary.money.find((p) => p.currency === row.currency && p.period === 'previous')?.installment_collections ?? 0,row.currency)}</td><td>{money(row.commercial_order_value,row.currency)}</td></tr>)}</tbody></table></div>
        {!data.summary.money.length ? <p>No governed commercial or completed sales activity.</p> : null}
        <h3>Current installment balance</h3>{data.summary.outstanding.length ? data.summary.outstanding.map((row) => <p key={row.currency}>{money(row.balance,row.currency)} outstanding</p>) : <p>No installment obligations.</p>}<a href="#reports/revenue">Open Revenue Dashboard</a>
      </section>
      <section className="workspace-panel"><h2>Merchant sales processed through SellerTray</h2><p className="workspace-muted">Merchant GMV is gross completed order value before returns, including applicable tax. It is separate from ProcessEdge income.</p><div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Currency</th><th>Merchant GMV</th><th>Previous period GMV</th><th>Completed returns</th></tr></thead><tbody>{data.summary.money.filter((row) => row.period === 'current').map((row) => <tr key={row.currency}><td>{row.currency}</td><td>{money(row.merchant_gmv,row.currency)}</td><td>{money(data.summary.money.find((p) => p.currency === row.currency && p.period === 'previous')?.merchant_gmv ?? 0,row.currency)}</td><td>{money(row.merchant_returns,row.currency)}</td></tr>)}</tbody></table></div></section>
      <section className="workspace-panel"><h2>Insights & actions</h2>{data.summary.insights.map((insight) => <p key={insight.code}>{insight.change} change in transacting merchants compared with the previous period. <a href="#merchants">{insight.action}</a></p>)}
        {data.attention.counts.map((item) => <p key={item.signal}><strong>{item.count}</strong> {signals[item.signal] ?? item.signal}. Review the merchants below.</p>)}
        <p className="workspace-muted">{data.attention.total} attention signals · showing up to 20, ordered by signal and merchant. Signals are factual prompts for review.</p>
        {data.attention.items.length ? <ul>{data.attention.items.map((item) => <li key={`${item.tenant_id}-${item.signal}`}><a href={`#merchants?tenant=${encodeURIComponent(item.tenant_id)}`}>{item.name}</a> — {item.action} · {signals[item.signal]}</li>)}</ul> : <p>No current commercial or adoption attention signals.</p>}
      </section>
      <section className="workspace-panel"><h2>Metric coverage</h2>{Object.entries(data.summary.coverage).map(([key,value]) => <p key={key}>{value}</p>)}</section>
    </>}
  </div>;
}
function Kpi({ label, value, previous }: { label: string; value: number; previous: number }) {
  return <article className="workspace-stat-card"><span>{label}</span><strong>{value.toLocaleString()}</strong><small>Previous: {previous.toLocaleString()} · Change: {value-previous}</small></article>;
}
function money(value: number, currency: string) { return new Intl.NumberFormat('en',{ style: 'currency',currency }).format(value); }
