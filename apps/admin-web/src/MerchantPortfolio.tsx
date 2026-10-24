import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { loadMerchantDetail, loadMerchantPortfolio, type MerchantCursor, type MerchantDetail, type MerchantFilter, type MerchantPortfolioPage } from './merchant-read-model';

const FILTERS: Array<[MerchantFilter, string]> = [['all', 'All'], ['attention', 'Needs attention'], ['connected', 'WhatsApp connected'], ['restricted', 'Restricted access']];

export default function MerchantPortfolio({ session, refreshKey }: { session: Session; refreshKey: string }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MerchantFilter>('all');
  const [cursorStack, setCursorStack] = useState<MerchantCursor[]>([]);
  const [portfolio, setPortfolio] = useState<MerchantPortfolioPage | null>(null);
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
    void loadMerchantPortfolio(session, { search, filter, cursor, limit: 25 }).then((response) => {
      if (active) setPortfolio(response);
    }).catch((cause) => {
      if (active) setError(messageFrom(cause, 'Unable to load the merchant portfolio.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.access_token, search, filter, cursor?.afterName, cursor?.afterId, refreshKey]);

  function selectMerchant(id: string) {
    window.location.hash = `merchants?tenant=${encodeURIComponent(id)}`;
    setSelectedId(id);
  }

  function changeFilter(next: MerchantFilter) {
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
          <div><button className="workspace-button subtle compact" disabled={!cursorStack.length || loading} onClick={() => setCursorStack((current) => current.slice(0, -1))}>Previous</button><button className="workspace-button subtle compact" disabled={!portfolio?.hasMore || !portfolio.nextCursor || loading} onClick={() => portfolio?.nextCursor && setCursorStack((current) => [...current, portfolio.nextCursor as MerchantCursor])}>Next</button></div>
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
    void loadMerchantDetail(session, tenantId)
      .then((response) => { if (active) setDetail(response); })
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
function merchantFromHash() { const query = window.location.hash.split('?')[1] ?? ''; const value = new URLSearchParams(query).get('tenant'); return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null; }
function messageFrom(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }
