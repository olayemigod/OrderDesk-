import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson, isRecord } from './supabase';

type Filter = 'all' | 'attention' | 'connected' | 'restricted';
type Cursor = { afterName: string; afterId: string };
type MerchantRow = {
  id: string; name: string; slug: string; businessEmail: string | null; businessPhone: string | null;
  onboardingStatus: string; whatsappStatus: string; subscriptionStatus: string; accessMode: string;
  planCode: string | null; currentPeriodEnd: string | null; currency: string; createdAt: string | null;
  activatedAt: string | null; completedOrders30d: number; needsReview: number; totalBranches: number;
  activeBranches: number; teamCount: number; lastOrderAt: string | null; notificationExceptions: number;
  attentionReasons: string[];
};
type Portfolio = { generatedAt: string; pageSize: number; items: MerchantRow[]; hasMore: boolean; nextCursor: Cursor | null };
type Money = { currency: string; merchantGmv: number; recordedPaidValue: number; outstandingOrderValue: number };
type Branch = { id: string; code: string; name: string; active: boolean; default: boolean };
type Activity = { id: string; action: string; createdAt: string };
type MerchantDetail = {
  merchant: MerchantRow & {
    businessType: string | null; timezone: string; updatedAt: string | null; planName: string | null;
    graceEndsAt: string | null; activeUntil: string | null; lastInboundAt: string | null;
    supportNote: string | null; supportNoteUpdatedAt: string | null;
  };
  branches: Branch[];
  team: { total: number; owners: number; managers: number; cashiers: number };
  performance: { periodDays: number; completedOrders: number; whatsappOrders: number; posOrders: number; manualOrders: number; lastOrderAt: string | null; lastCompletedAt: string | null; money: Money[] };
  commercial: { commercialOrders: number; latestCommercialOrderAt: string | null; agreementsIssued: number; agreementsAccepted: number; setupRequired: number; setupReady: number };
  recentAdminActivity: Activity[];
};

const FILTERS: Array<[Filter, string]> = [['all', 'All'], ['attention', 'Needs attention'], ['connected', 'WhatsApp connected'], ['restricted', 'Restricted access']];

export default function MerchantPortfolio({ session, refreshKey }: { session: Session; refreshKey: string }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [cursorStack, setCursorStack] = useState<Cursor[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => merchantFromHash());

  const cursor = cursorStack[cursorStack.length - 1] ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setCursorStack([]);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const update = () => setSelectedId(merchantFromHash());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void invokeJson<{ portfolio?: unknown }>('platform-admin', {
      action: 'merchant_portfolio', search, filter,
      afterName: cursor?.afterName ?? null, afterId: cursor?.afterId ?? null, limit: 25,
    }, session).then((response) => {
      if (active) setPortfolio(parsePortfolio(response.portfolio));
    }).catch((cause) => {
      if (active) setError(messageFrom(cause, 'Unable to load the merchant portfolio.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.access_token, search, filter, cursor?.afterName, cursor?.afterId, refreshKey]);

  function selectMerchant(id: string) {
    window.location.hash = `merchants?tenant=${encodeURIComponent(id)}`;
    setSelectedId(id);
  }

  function changeFilter(next: Filter) {
    setFilter(next);
    setCursorStack([]);
  }

  return (
    <div className="workspace-page">
      <header className="workspace-page-header"><div><p className="workspace-eyebrow">Merchants</p><h1>SellerTray businesses</h1><p>Governed, paginated cross-tenant discovery and platform-level status. Business operations remain in Merchant Web.</p></div></header>
      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <label className="workspace-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search business, email, phone, plan or status" aria-label="Search merchants" /></label>
          <div className="workspace-filter-row">{FILTERS.map(([value, label]) => <button key={value} className={filter === value ? 'workspace-filter active' : 'workspace-filter'} onClick={() => changeFilter(value)}>{label}</button>)}</div>
        </div>
        {error ? <div className="workspace-banner error">{error}</div> : null}
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead><tr><th>Business</th><th>Plan & access</th><th>WhatsApp</th><th>Orders 30d</th><th>Branches</th><th>Attention</th></tr></thead>
            <tbody>
              {portfolio?.items.map((merchant) => (
                <tr key={merchant.id} className="workspace-clickable-row" tabIndex={0} onClick={() => selectMerchant(merchant.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectMerchant(merchant.id); }}>
                  <td><strong>{merchant.name}</strong><small>{merchant.businessEmail ?? merchant.businessPhone ?? merchant.slug}</small></td>
                  <td><Status value={merchant.subscriptionStatus} /><small>{merchant.planCode ?? 'No plan'} · {friendlyAccess(merchant.accessMode)}</small></td>
                  <td><Status value={merchant.whatsappStatus} /></td>
                  <td>{merchant.completedOrders30d.toLocaleString()}<small>{formatDate(merchant.lastOrderAt, 'No recent activity')}</small></td>
                  <td>{merchant.activeBranches.toLocaleString()} / {merchant.totalBranches.toLocaleString()}<small>{merchant.teamCount.toLocaleString()} team member{merchant.teamCount === 1 ? '' : 's'}</small></td>
                  <td>{merchant.attentionReasons[0] ?? 'Clear'}{merchant.attentionReasons.length > 1 ? <small>+{merchant.attentionReasons.length - 1} more</small> : null}</td>
                </tr>
              ))}
              {!loading && !portfolio?.items.length ? <tr><td colSpan={6}><Empty title="No merchants found" body="Adjust the search or status filter." /></td></tr> : null}
              {loading ? <tr><td colSpan={6}><Empty title="Loading merchants" body="Retrieving the governed merchant page…" /></td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="workspace-pagination">
          <span>Page {cursorStack.length + 1}{portfolio ? ` · up to ${portfolio.pageSize} businesses` : ''}</span>
          <div><button className="workspace-button subtle compact" disabled={!cursorStack.length || loading} onClick={() => setCursorStack((current) => current.slice(0, -1))}>Previous</button><button className="workspace-button subtle compact" disabled={!portfolio?.hasMore || !portfolio.nextCursor || loading} onClick={() => portfolio?.nextCursor && setCursorStack((current) => [...current, portfolio.nextCursor as Cursor])}>Next</button></div>
        </div>
      </section>
      {selectedId ? <Merchant360 session={session} tenantId={selectedId} onClose={() => { window.location.hash = 'merchants'; setSelectedId(null); }} /> : null}
    </div>
  );
}

function Merchant360({ session, tenantId, onClose }: { session: Session; tenantId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<MerchantDetail | null>(null);
  const [tab, setTab] = useState<'summary' | 'commercial' | 'activity'>('summary');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDetail(null); setError(null); setTab('summary');
    void invokeJson<{ detail?: unknown }>('platform-admin', { action: 'merchant_detail', tenantId }, session)
      .then((response) => { if (active) setDetail(parseDetail(response.detail)); })
      .catch((cause) => { if (active) setError(messageFrom(cause, 'Unable to load Merchant 360.')); });
    return () => { active = false; };
  }, [session.access_token, tenantId]);

  const merchant = detail?.merchant;
  return (
    <div className="workspace-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="workspace-drawer workspace-drawer-wide" role="dialog" aria-modal="true" aria-labelledby="merchant-360-title" onClick={(event) => event.stopPropagation()}>
        <div className="workspace-drawer-header"><div><p className="workspace-eyebrow">Merchant 360</p><h2 id="merchant-360-title">{merchant?.name ?? 'Loading merchant'}</h2><p>{merchant?.businessEmail ?? merchant?.businessPhone ?? merchant?.slug ?? 'Governed platform and commercial context'}</p></div><button className="workspace-icon-button" aria-label="Close Merchant 360" onClick={onClose}>×</button></div>
        {error ? <div className="workspace-banner error">{error}</div> : null}
        {!detail && !error ? <Empty title="Loading Merchant 360" body="Retrieving governed business, adoption and commercial context…" /> : null}
        {detail ? <>
          <div className="workspace-tabs" role="tablist" aria-label="Merchant details">{([['summary', 'Summary'], ['commercial', 'Commercial'], ['activity', 'Support & activity']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}</div>
          {detail.merchant.attentionReasons.length ? <div className="workspace-banner warning"><strong>Needs attention:</strong> {detail.merchant.attentionReasons.join(' · ')}</div> : <div className="workspace-banner success">No current portfolio attention signal.</div>}
          {tab === 'summary' ? <Summary detail={detail} /> : null}
          {tab === 'commercial' ? <Commercial detail={detail} /> : null}
          {tab === 'activity' ? <ActivityPanel detail={detail} /> : null}
        </> : null}
      </aside>
    </div>
  );
}

function Summary({ detail }: { detail: MerchantDetail }) {
  const { merchant, performance, branches, team } = detail;
  return <>
    <div className="workspace-detail-grid">
      <Detail label="Plan" value={merchant.planName ?? merchant.planCode ?? 'Not assigned'} />
      <Detail label="Access" value={`${friendlyStatus(merchant.subscriptionStatus)} · ${friendlyAccess(merchant.accessMode)}`} />
      <Detail label="Activation" value={formatDate(merchant.activatedAt, 'Not activated')} />
      <Detail label="Active until" value={formatDate(merchant.activeUntil ?? merchant.currentPeriodEnd, 'Not recorded')} />
      <Detail label="WhatsApp" value={friendlyStatus(merchant.whatsappStatus)} />
      <Detail label="Onboarding" value={friendlyStatus(merchant.onboardingStatus)} />
      <Detail label="Timezone" value={merchant.timezone || 'Not recorded'} />
      <Detail label="Created" value={formatDate(merchant.createdAt, 'Not recorded')} />
    </div>
    <section className="workspace-drawer-section"><h3>Merchant performance · 30 days</h3><div className="workspace-detail-grid"><Detail label="Completed orders" value={performance.completedOrders.toLocaleString()} /><Detail label="Last completed order" value={formatDate(performance.lastCompletedAt, 'None in period')} /><Detail label="POS orders" value={performance.posOrders.toLocaleString()} /><Detail label="WhatsApp orders" value={performance.whatsappOrders.toLocaleString()} /></div>{performance.money.map((money) => <div className="workspace-money-row" key={money.currency}><strong>{money.currency}</strong><span>GMV {formatMoney(money.merchantGmv, money.currency)}</span><span>Paid against orders {formatMoney(money.recordedPaidValue, money.currency)}</span><span>Outstanding order value {formatMoney(money.outstandingOrderValue, money.currency)}</span></div>)}{!performance.money.length ? <Empty title="No completed sales" body="No merchant sales value is recorded for this period." /> : null}<p className="workspace-disclosure">GMV is gross completed order value by currency. Paid and outstanding values are merchant order facts, not ProcessEdge revenue or installment collections. Returns and tax are not netted in this foundation.</p></section>
    <section className="workspace-drawer-section"><h3>Branches and team</h3><div className="workspace-detail-grid"><Detail label="Team" value={`${team.total} total · ${team.owners} Owner · ${team.managers} Manager · ${team.cashiers} Cashier`} /><Detail label="Branches" value={`${branches.filter((branch) => branch.active).length} active · ${branches.length} total`} /></div><div className="workspace-branch-list">{branches.map((branch) => <div key={branch.id}><span><strong>{branch.name}</strong><small>{branch.code}{branch.default ? ' · Default' : ''}</small></span><Status value={branch.active ? 'active' : 'inactive'} /></div>)}</div></section>
  </>;
}

function Commercial({ detail }: { detail: MerchantDetail }) {
  const { commercial, merchant } = detail;
  return <section className="workspace-drawer-section"><h3>Governed commercial readiness</h3><div className="workspace-detail-grid"><Detail label="Commercial orders" value={commercial.commercialOrders.toLocaleString()} /><Detail label="Latest order" value={formatDate(commercial.latestCommercialOrderAt, 'None recorded')} /><Detail label="Agreements" value={`${commercial.agreementsAccepted} accepted · ${commercial.agreementsIssued} issued`} /><Detail label="Branch setup" value={`${commercial.setupReady} ready · ${commercial.setupRequired} required`} /></div><div className="workspace-banner info">Payment confirmation, agreement acceptance, Branch setup readiness and entitlement remain separate authorities.</div><button className="workspace-button primary" onClick={() => { window.location.hash = `billing?tenant=${encodeURIComponent(merchant.id)}`; }}>Open Billing & Commercial</button></section>;
}

function ActivityPanel({ detail }: { detail: MerchantDetail }) {
  const { merchant, recentAdminActivity } = detail;
  return <><section className="workspace-drawer-section"><h3>Support context</h3>{merchant.supportNote ? <div className="workspace-support-note"><p>{merchant.supportNote}</p><small>Updated {formatDate(merchant.supportNoteUpdatedAt, 'date unavailable')}</small></div> : <Empty title="No support note" body="Support context can be maintained through governed Admin actions." />}</section><section className="workspace-drawer-section"><h3>Recent administrator activity</h3><div className="workspace-activity-list">{recentAdminActivity.map((item) => <div key={item.id}><strong>{friendlyStatus(item.action)}</strong><small>{formatDate(item.createdAt, 'Unknown time')}</small></div>)}</div>{!recentAdminActivity.length ? <Empty title="No recent activity" body="No tenant-specific administrator activity is recorded." /> : null}</section></>;
}

function Status({ value }: { value: string }) { const normalized = value.toLowerCase(); const tone = ['active', 'connected', 'full', 'paid', 'ready'].includes(normalized) ? 'good' : ['error', 'suspended', 'cancelled', 'past_due', 'read_only'].includes(normalized) ? 'bad' : ['pending', 'grace', 'trial'].includes(normalized) ? 'warn' : 'neutral'; return <span className={`workspace-status-pill ${tone}`}>{friendlyStatus(value)}</span>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="workspace-detail"><span>{label}</span><strong>{value}</strong></div>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="workspace-empty"><strong>{title}</strong><p>{body}</p></div>; }
function friendlyAccess(value: string) { return value === 'full' ? 'Full access' : value === 'read_only' ? 'Read only' : friendlyStatus(value); }
function friendlyStatus(value: string) { if (value === 'trial') return 'Legacy compatibility'; return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value: string | null | undefined, fallback: string) { if (!value) return fallback; const date = new Date(value); return Number.isNaN(date.getTime()) ? fallback : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function formatMoney(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toLocaleString()}`; } }
function numberValue(value: unknown) { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function stringValue(value: unknown) { return typeof value === 'string' ? value : ''; }
function optionalString(value: unknown) { return typeof value === 'string' && value ? value : null; }
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function merchantFromHash() { const query = window.location.hash.split('?')[1] ?? ''; const value = new URLSearchParams(query).get('tenant'); return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null; }
function messageFrom(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }

function parsePortfolio(value: unknown): Portfolio {
  if (!isRecord(value)) throw new Error('Merchant portfolio returned an invalid response.');
  const items = Array.isArray(value.items) ? value.items.filter(isRecord).map(parseMerchant) : [];
  const cursor = isRecord(value.nextCursor) ? { afterName: stringValue(value.nextCursor.afterName), afterId: stringValue(value.nextCursor.afterId) } : null;
  return { generatedAt: stringValue(value.generatedAt), pageSize: numberValue(value.pageSize) || 25, items: items.filter((item) => item.id), hasMore: value.hasMore === true, nextCursor: cursor?.afterName && cursor.afterId ? cursor : null };
}

function parseMerchant(value: Record<string, unknown>): MerchantRow {
  return { id: stringValue(value.id), name: stringValue(value.name) || 'Unnamed business', slug: stringValue(value.slug), businessEmail: optionalString(value.businessEmail), businessPhone: optionalString(value.businessPhone), onboardingStatus: stringValue(value.onboardingStatus) || 'unknown', whatsappStatus: stringValue(value.whatsappStatus) || 'not_connected', subscriptionStatus: stringValue(value.subscriptionStatus) || 'unknown', accessMode: stringValue(value.accessMode) || 'unknown', planCode: optionalString(value.planCode), currentPeriodEnd: optionalString(value.currentPeriodEnd), currency: stringValue(value.currency) || 'NGN', createdAt: optionalString(value.createdAt), activatedAt: optionalString(value.activatedAt), completedOrders30d: numberValue(value.completedOrders30d), needsReview: numberValue(value.needsReview), totalBranches: numberValue(value.totalBranches), activeBranches: numberValue(value.activeBranches), teamCount: numberValue(value.teamCount), lastOrderAt: optionalString(value.lastOrderAt), notificationExceptions: numberValue(value.notificationExceptions), attentionReasons: strings(value.attentionReasons) };
}

function parseDetail(value: unknown): MerchantDetail {
  if (!isRecord(value) || !isRecord(value.merchant) || !isRecord(value.team) || !isRecord(value.performance) || !isRecord(value.commercial)) throw new Error('Merchant 360 returned an invalid response.');
  const merchantBase = parseMerchant(value.merchant);
  const performance = value.performance; const team = value.team; const commercial = value.commercial;
  return {
    merchant: { ...merchantBase, businessType: optionalString(value.merchant.businessType), timezone: stringValue(value.merchant.timezone), updatedAt: optionalString(value.merchant.updatedAt), planName: optionalString(value.merchant.planName), graceEndsAt: optionalString(value.merchant.graceEndsAt), activeUntil: optionalString(value.merchant.activeUntil), lastInboundAt: optionalString(value.merchant.lastInboundAt), supportNote: optionalString(value.merchant.supportNote), supportNoteUpdatedAt: optionalString(value.merchant.supportNoteUpdatedAt) },
    branches: Array.isArray(value.branches) ? value.branches.filter(isRecord).map((branch) => ({ id: stringValue(branch.id), code: stringValue(branch.code), name: stringValue(branch.name), active: branch.active === true, default: branch.default === true })) : [],
    team: { total: numberValue(team.total), owners: numberValue(team.owners), managers: numberValue(team.managers), cashiers: numberValue(team.cashiers) },
    performance: { periodDays: numberValue(performance.periodDays), completedOrders: numberValue(performance.completedOrders), whatsappOrders: numberValue(performance.whatsappOrders), posOrders: numberValue(performance.posOrders), manualOrders: numberValue(performance.manualOrders), lastOrderAt: optionalString(performance.lastOrderAt), lastCompletedAt: optionalString(performance.lastCompletedAt), money: Array.isArray(performance.money) ? performance.money.filter(isRecord).map((money) => ({ currency: stringValue(money.currency), merchantGmv: numberValue(money.merchantGmv), recordedPaidValue: numberValue(money.recordedPaidValue), outstandingOrderValue: numberValue(money.outstandingOrderValue) })) : [] },
    commercial: { commercialOrders: numberValue(commercial.commercialOrders), latestCommercialOrderAt: optionalString(commercial.latestCommercialOrderAt), agreementsIssued: numberValue(commercial.agreementsIssued), agreementsAccepted: numberValue(commercial.agreementsAccepted), setupRequired: numberValue(commercial.setupRequired), setupReady: numberValue(commercial.setupReady) },
    recentAdminActivity: Array.isArray(value.recentAdminActivity) ? value.recentAdminActivity.filter(isRecord).map((item) => ({ id: stringValue(item.id), action: stringValue(item.action), createdAt: stringValue(item.createdAt) })) : [],
  };
}
