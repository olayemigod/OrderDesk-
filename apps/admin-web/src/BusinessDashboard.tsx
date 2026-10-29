import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

type Metrics = Record<'new_merchants' | 'new_activations' | 'transacting_merchants' | 'transacting_branches' | 'completed_orders' | 'pos_orders' | 'whatsapp_orders', number>;
type Money = { period: string; currency: string; merchant_gmv: number; merchant_returns: number; installment_collections: number; commercial_order_value: number };
type OnboardingStageMetric = { stage: string; businessCount: number; averageTimeInStageSeconds: number; longestTimeInStageSeconds: number };
type OnboardingBranch = {
  branchId: string;
  branchCode: string;
  branchName: string;
  active: boolean;
  default: boolean;
  createdAt: string;
  setupRequired: boolean;
  setupState: string;
  setupAppointment: null | {
    id: string;
    status: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    createdAt: string;
    completedAt: string | null;
    workerId: string;
  };
  readiness: null | { id: string; readyAt: string; recordedAt: string; actorUserId: string; reason: string };
  latestProcessEdgeSetupEvent: null | { eventType: string; actorUserId: string; reason: string; occurredAt: string };
};
type PrivilegedIntervention = { action: string; actorUserId: string; createdAt: string; detail: Record<string, unknown> };
type OnboardingItem = {
  tenantId: string;
  businessName: string;
  merchantCode: string;
  businessCreatedAt: string;
  currentStage: string;
  stageEnteredAt: string;
  timeInStageSeconds: number;
  blockers: { code?: string; message?: string; branchId?: string; surface?: string }[];
  nextAction: null | { code?: string; label?: string; surface?: string };
  commercialOrder: null | {
    id: string;
    reference: string;
    currency: string;
    grossAmount: number;
    orderedAt: string;
    planCode: string;
    billingCycle: string;
    installmentObligationId?: string;
    installmentStructureCode?: string;
  };
  commercialOrderActorUserId: string | null;
  agreement: {
    required: boolean;
    published: boolean;
    accepted: boolean;
    acceptedAt: string | null;
    currentVersion: null | { id?: string; versionCode?: string; title?: string; contentSha256?: string; effectiveFrom?: string; publishedAt?: string };
    acceptedByUserId: string | null;
    acceptedRole: string | null;
  };
  settlement: {
    currency: string;
    grossAmount: number;
    confirmedPaymentAmount: number;
    outstandingAmount: number;
    qualifyingSettlementSatisfied: boolean;
    fullySettled: boolean;
  };
  branchSetup: { requiredCount: number; readyCount: number; ready: boolean; branches: unknown[] };
  activation: { entitlementState: string; effectiveFrom: string | null; effectiveUntil: string | null; operationallyActive: boolean };
  progression: Record<string, string | null>;
  branches: OnboardingBranch[];
  activationEvidence: null | { eventType: string; effectiveFrom: string; effectiveUntil: string; recordedAt: string; actorUserId: string | null; reason: string | null };
  privilegedInterventions: PrivilegedIntervention[];
};
type OnboardingCommercial = {
  generatedAt: string;
  funnel: {
    totalBusinesses: number;
    withCommercialOrder: number;
    agreementAccepted: number;
    qualifyingSettlement: number;
    setupReady: number;
    activated: number;
  };
  stageMetrics: OnboardingStageMetric[];
  items: OnboardingItem[];
  coverage: Record<string, string>;
};
type Summary = { generatedAt: string; startAt: string; previousStartAt: string; totalMerchants: number; activatedMerchants: number; whatsappConnected: number; current: Metrics; previous: Metrics; money: Money[]; outstanding: { currency: string; balance: number }[]; coverage: Record<string, string>; insights: { code: string; change: number; action: string; href: string }[]; onboardingCommercial: OnboardingCommercial };
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
    <header className="workspace-page-header"><p className="workspace-eyebrow">ProcessEdge business performance</p><h1>SellerTray business dashboard</h1><p className="workspace-muted">Growth, governed onboarding, confirmed collections and merchant adoption. Technical health is in Platform Operations.</p></header>
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
      <OnboardingPanel report={data.summary.onboardingCommercial} />
      <section className="workspace-panel"><h2>ProcessEdge commercial performance</h2><p className="workspace-muted">Confirmed installment collections and commercial purchase value are separate measures. Collections are gross cash receipts, not recognised revenue. Amounts remain separate by currency.</p>
        <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Currency</th><th>Installment collections</th><th>Previous period</th><th>Commercial order value</th></tr></thead><tbody>{data.summary.money.filter((row) => row.period === 'current').map((row) => <tr key={row.currency}><td>{row.currency}</td><td>{money(row.installment_collections,row.currency)}</td><td>{money(data.summary.money.find((p) => p.currency === row.currency && p.period === 'previous')?.installment_collections ?? 0,row.currency)}</td><td>{money(row.commercial_order_value,row.currency)}</td></tr>)}</tbody></table></div>
        {!data.summary.money.length ? <p>No governed commercial or completed sales activity.</p> : null}
        <h3>Current installment balance</h3>{data.summary.outstanding.length ? data.summary.outstanding.map((row) => <p key={row.currency}>{money(row.balance,row.currency)} outstanding</p>) : <p>No installment obligations.</p>}<a href={routeHref('reports/revenue')}>Open Revenue Dashboard</a>
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

function OnboardingPanel({ report }: { report: OnboardingCommercial }) {
  return <section className="workspace-panel">
    <h2>Onboarding funnel & bottlenecks</h2>
    <p className="workspace-muted">Server-derived operational progress from governed commercial, Master Agreement, settlement, Branch setup/readiness and activation facts. This is onboarding operations, not ProcessEdge revenue accounting.</p>
    <div className="workspace-stat-grid">
      <SnapshotKpi label="Businesses" value={report.funnel.totalBusinesses} />
      <SnapshotKpi label="Commercial orders" value={report.funnel.withCommercialOrder} />
      <SnapshotKpi label="Agreement accepted" value={report.funnel.agreementAccepted} />
      <SnapshotKpi label="Qualifying settlement" value={report.funnel.qualifyingSettlement} />
      <SnapshotKpi label="Branch setup ready" value={report.funnel.setupReady} />
      <SnapshotKpi label="Activated" value={report.funnel.activated} />
    </div>
    <h3>Current stage</h3>
    {report.stageMetrics.length ? <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Stage</th><th>Businesses</th><th>Average time</th><th>Longest time</th></tr></thead><tbody>{report.stageMetrics.map((row) => <tr key={row.stage}><td>{stageLabel(row.stage)}</td><td>{row.businessCount}</td><td>{duration(row.averageTimeInStageSeconds)}</td><td>{duration(row.longestTimeInStageSeconds)}</td></tr>)}</tbody></table></div> : <p>No onboarding stage data.</p>}
    <h3>Oldest current-stage items</h3>
    {report.items.length ? <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Business</th><th>Stage</th><th>Time in stage</th><th>Plan / order</th><th>Agreement</th><th>Settlement</th><th>Branch setup</th><th>Next action</th></tr></thead><tbody>{report.items.map((item) => <tr key={item.tenantId}>
      <td><a href={`#merchants?tenant=${encodeURIComponent(item.tenantId)}`}>{item.businessName}</a><br /><small>{item.merchantCode}</small><BranchDetails branches={item.branches} /></td>
      <td>{stageLabel(item.currentStage)}{item.blockers[0]?.message ? <><br /><small>{item.blockers[0].message}</small></> : null}</td>
      <td>{duration(item.timeInStageSeconds)}<br /><small>Since {new Date(item.stageEnteredAt).toLocaleString()}</small></td>
      <td>{item.commercialOrder ? <>{item.commercialOrder.planCode || 'Plan'} · {item.commercialOrder.reference}<br /><small>{item.commercialOrder.billingCycle} · {new Date(item.commercialOrder.orderedAt).toLocaleDateString()}</small></> : 'Not created'}</td>
      <td>{item.agreement.required ? item.agreement.accepted ? <>Accepted<br /><small>{item.agreement.currentVersion?.versionCode ?? 'Current version'}</small></> : item.agreement.published ? 'Awaiting acceptance' : 'Awaiting publication' : 'Not yet required'}</td>
      <td>{item.commercialOrder ? <>{money(item.settlement.confirmedPaymentAmount ?? 0,item.settlement.currency)} paid<br /><small>{money(item.settlement.outstandingAmount ?? 0,item.settlement.currency)} outstanding</small></> : 'Not started'}</td>
      <td>{item.branchSetup.requiredCount ? <>{item.branchSetup.readyCount} / {item.branchSetup.requiredCount} ready</> : 'Not scoped'}</td>
      <td>{item.nextAction?.label ?? 'No action'}<AuditDetails item={item} /></td>
    </tr>)}</tbody></table></div> : <p>No Businesses are available in the onboarding report.</p>}
    <p className="workspace-muted small">As of {new Date(report.generatedAt).toLocaleString()}. {report.coverage.stageClock} {report.coverage.sourceAttribution}</p>
  </section>;
}

function SnapshotKpi({ label, value }: { label: string; value: number }) {
  return <article className="workspace-stat-card"><span>{label}</span><strong>{value.toLocaleString()}</strong></article>;
}

function BranchDetails({ branches }: { branches: OnboardingBranch[] }) {
  if (!branches.length) return <><br /><small>No Branch yet</small></>;
  return <details><summary>{branches.length} {branches.length === 1 ? 'Branch' : 'Branches'}</summary><ul>{branches.map((branch) => <li key={branch.branchId}>
    <strong>{branch.branchName}</strong> — {branch.setupRequired ? setupStateLabel(branch.setupState) : 'Setup not required'}
    {branch.setupAppointment?.scheduledStartAt ? <> · {new Date(branch.setupAppointment.scheduledStartAt).toLocaleString()}</> : null}
    {branch.readiness ? <><br /><small>Ready {new Date(branch.readiness.readyAt).toLocaleString()} · ProcessEdge actor {branch.readiness.actorUserId}</small></> : null}
    {branch.latestProcessEdgeSetupEvent ? <><br /><small>{setupStateLabel(branch.latestProcessEdgeSetupEvent.eventType)} by {branch.latestProcessEdgeSetupEvent.actorUserId} · {new Date(branch.latestProcessEdgeSetupEvent.occurredAt).toLocaleString()}</small></> : null}
  </li>)}</ul></details>;
}

function AuditDetails({ item }: { item: OnboardingItem }) {
  const hasActorEvidence = Boolean(item.commercialOrderActorUserId || item.agreement.acceptedByUserId || item.activationEvidence?.actorUserId || item.privilegedInterventions.length);
  if (!hasActorEvidence) return null;
  return <details><summary>Lifecycle actors</summary><ul>
    {item.commercialOrderActorUserId ? <li>Commercial order actor: {item.commercialOrderActorUserId}</li> : null}
    {item.agreement.acceptedByUserId ? <li>Agreement accepted by: {item.agreement.acceptedByUserId}{item.agreement.acceptedRole ? ` (${item.agreement.acceptedRole})` : ''}</li> : null}
    {item.activationEvidence?.actorUserId ? <li>Activation actor: {item.activationEvidence.actorUserId}</li> : null}
    {item.privilegedInterventions.slice(0,5).map((event, index) => <li key={`${event.action}-${event.createdAt}-${index}`}>{adminActionLabel(event.action)} · {event.actorUserId} · {new Date(event.createdAt).toLocaleString()}</li>)}
  </ul></details>;
}

function Kpi({ label, value, previous }: { label: string; value: number; previous: number }) {
  return <article className="workspace-stat-card"><span>{label}</span><strong>{value.toLocaleString()}</strong><small>Previous: {previous.toLocaleString()} · Change: {value-previous}</small></article>;
}
function stageLabel(stage: string) {
  const labels: Record<string,string> = { business_setup: 'Business setup', commercial_order: 'Commercial order', agreement: 'Master Agreement', settlement: 'Settlement', setup: 'Branch setup', activation: 'Activation', active: 'Active' };
  return labels[stage] ?? stage.replace(/_/g,' ').replace(/^./,(value) => value.toUpperCase());
}
function setupStateLabel(value: string) { return value.replace(/_/g,' ').replace(/^./,(part) => part.toUpperCase()); }
function adminActionLabel(value: string) { return value.replace(/_/g,' ').replace(/^./,(part) => part.toUpperCase()); }
function duration(seconds: number) {
  const safe = Math.max(0,Math.round(Number(seconds) || 0));
  const days = Math.floor(safe/86400);
  if (days) return `${days}d ${Math.floor((safe%86400)/3600)}h`;
  const hours = Math.floor(safe/3600);
  if (hours) return `${hours}h ${Math.floor((safe%3600)/60)}m`;
  return `${Math.floor(safe/60)}m`;
}
function routeHref(route: string) { const tenantId = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tenant'); return tenantId ? `#${route}?tenant=${encodeURIComponent(tenantId)}` : `#${route}`; }
function money(value: number, currency: string) { return new Intl.NumberFormat('en',{ style: 'currency',currency }).format(value); }
