import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import AgreementLifecycleManagement from './AgreementLifecycleManagement';
import BusinessDashboard from './BusinessDashboard';
import RevenueDashboard from './RevenueDashboard';
import {
  BranchReadinessAdministration,
  CommercialOrdersAdministration,
  CommercialPricingAdministration,
  InstallmentEntitlementAdministration,
} from './CommercialAdminWorkspaces';
import CommercialSettlementAdministration from './CommercialSettlementAdministration';
import { CampaignHistory, MerchantMessageComposer, type AdminAuditEvent } from './AdminCommunicationsWorkspaces';
import { AiOperations, PaymentInfrastructure, WhatsAppOperations } from './AdminOperationsWorkspaces';
import MerchantPortfolio from './MerchantPortfolio';
import MerchantSelector from './MerchantSelector';
import SetupSchedulingAdministration from './SetupSchedulingAdministration';
import { loadMerchantDetail, type MerchantRow } from './merchant-read-model';
import { invokeJson, isRecord, supabase } from './supabase';

type SecurityState = 'checking' | 'needs_mfa' | 'needs_enroll' | 'ready';
type AdminRole = 'admin' | 'support';
type AdminRoute =
  | 'overview/dashboard'
  | 'merchants/all'
  | 'commercial/orders'
  | 'commercial/pricing'
  | 'commercial/settlement'
  | 'commercial/installments'
  | 'commercial/agreements'
  | 'setup/appointments'
  | 'setup/resources'
  | 'setup/completion'
  | 'setup/readiness'
  | 'setup/activation'
  | 'communications/compose'
  | 'communications/history'
  | 'operations/whatsapp'
  | 'operations/ai'
  | 'operations/payments'
  | 'reports/revenue'
  | 'governance/audit';
type IconName = 'overview' | 'merchants' | 'commercial' | 'setup' | 'communications' | 'operations' | 'reports' | 'governance' | 'menu' | 'close' | 'refresh' | 'search' | 'chevron';
type PlatformBootstrap = { actorRole: AdminRole; generatedAt: string; merchantCount: number; legacyTrialRecords: number };
type Enrollment = { factorId: string; qrCode: string; secret: string };
type NavItem = { id: AdminRoute; label: string; description: string; merchantScoped?: boolean };
type NavGroup = { id: string; label: string; icon: IconName; items: NavItem[] };
type MerchantContext = { id: string; name: string } | null;

const LOCAL_LOGO = '/brand/sellertray-admin-logo.webp';

const NAV_GROUPS: NavGroup[] = [
  { id: 'overview', label: 'Overview', icon: 'overview', items: [
    { id: 'overview/dashboard', label: 'Dashboard', description: 'Business performance' },
  ] },
  { id: 'merchants', label: 'Merchants', icon: 'merchants', items: [
    { id: 'merchants/all', label: 'All Merchants', description: 'Merchant estate and 360 view' },
  ] },
  { id: 'commercial', label: 'Commercial', icon: 'commercial', items: [
    { id: 'commercial/orders', label: 'Commercial Orders', description: 'Initial purchases and order history', merchantScoped: true },
    { id: 'commercial/pricing', label: 'Plans & Pricing', description: 'Subscription and Branch setup pricing', merchantScoped: true },
    { id: 'commercial/settlement', label: 'Payments & Settlement', description: 'Discounts, direct payments and balances', merchantScoped: true },
    { id: 'commercial/installments', label: 'Installments', description: 'Installment and entitlement review', merchantScoped: true },
    { id: 'commercial/agreements', label: 'Master Agreement', description: 'Platform publication and Business acceptance review' },
  ] },
  { id: 'setup', label: 'Onboarding & Setup', icon: 'setup', items: [
    { id: 'setup/appointments', label: 'Setup Appointments', description: 'Scheduling and rescheduling', merchantScoped: true },
    { id: 'setup/resources', label: 'Setup Resources', description: 'Service areas, workforce and capacity', merchantScoped: true },
    { id: 'setup/completion', label: 'Setup Completion', description: 'Equipment, test and handover evidence', merchantScoped: true },
    { id: 'setup/readiness', label: 'Branch Readiness', description: 'Purchased setup obligations and readiness facts', merchantScoped: true },
    { id: 'setup/activation', label: 'Activation Queue', description: 'Blockers and reconciliation recovery', merchantScoped: true },
  ] },
  { id: 'communications', label: 'Communications', icon: 'communications', items: [
    { id: 'communications/compose', label: 'Compose Message', description: 'Create and publish merchant messages' },
    { id: 'communications/history', label: 'Campaign History', description: 'Review audited publications' },
  ] },
  { id: 'operations', label: 'Platform Operations', icon: 'operations', items: [
    { id: 'operations/whatsapp', label: 'WhatsApp Operations', description: 'Cross-merchant connection health' },
    { id: 'operations/ai', label: 'AI Operations', description: 'Parser readiness and diagnostics' },
    { id: 'operations/payments', label: 'Payment Infrastructure', description: 'ProcessEdge collection readiness' },
  ] },
  { id: 'reports', label: 'Insights & Reports', icon: 'reports', items: [
    { id: 'reports/revenue', label: 'Revenue Dashboard', description: 'Collections, commercial value and installment exposure' },
  ] },
  { id: 'governance', label: 'Governance', icon: 'governance', items: [
    { id: 'governance/audit', label: 'Audit Log', description: 'Privileged administrator activity' },
  ] },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export default function AdminWorkspace() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [securityState, setSecurityState] = useState<SecurityState>('checking');
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [bootstrap, setBootstrap] = useState<PlatformBootstrap | null>(null);
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setBooting(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setBootstrap(null);
      setAudit([]);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session) {
      setSecurityState('checking');
      setVerifiedFactorId(null);
      setEnrollment(null);
      return;
    }
    void assessSecurity();
  }, [session?.access_token]);

  useEffect(() => {
    if (securityState !== 'ready' || !session) return;
    void loadPortal();
  }, [securityState, session?.access_token]);

  async function assessSecurity() {
    setPortalError(null);
    setSecurityState('checking');
    try {
      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      if (aal.currentLevel === 'aal2') { setSecurityState('ready'); return; }
      const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) throw factorError;
      const verified = factors.totp.find((factor) => factor.status === 'verified');
      if (verified) { setVerifiedFactorId(verified.id); setSecurityState('needs_mfa'); }
      else { setVerifiedFactorId(null); setSecurityState('needs_enroll'); }
    } catch (cause) {
      setPortalError(messageFrom(cause, 'Unable to verify the administrator security level.'));
    }
  }

  async function loadPortal() {
    if (!session) return;
    setPortalError(null);
    try {
      const [bootstrapResult, auditResult] = await Promise.all([
        invokeJson<{ bootstrap?: unknown }>('platform-admin', { action: 'bootstrap' }, session),
        invokeJson<{ audit?: unknown }>('platform-admin', { action: 'audit', tenantId: null, limit: 100 }, session),
      ]);
      setBootstrap(normalizeBootstrap(bootstrapResult.bootstrap));
      setAudit(normalizeAudit(auditResult.audit));
    } catch (cause) {
      setPortalError(messageFrom(cause, 'Unable to load SellerTray platform administration.'));
    }
  }

  async function refreshAudit() {
    if (!session) return;
    const result = await invokeJson<{ audit?: unknown }>('platform-admin', { action: 'audit', tenantId: null, limit: 100 }, session);
    setAudit(normalizeAudit(result.audit));
  }

  async function signOut() { await supabase.auth.signOut(); }

  if (booting) return <StatusScreen title="Opening SellerTray Admin" body="Checking your ProcessEdge administrator session…" />;
  if (!session) return <LoginScreen />;
  if (securityState === 'checking') return <StatusScreen title="Verifying administrator security" body="SellerTray Admin requires MFA for privileged platform access." error={portalError} />;
  if (securityState === 'needs_mfa' && verifiedFactorId) return <MfaChallenge factorId={verifiedFactorId} onVerified={assessSecurity} onSignOut={signOut} />;
  if (securityState === 'needs_enroll') return <MfaEnrollment enrollment={enrollment} setEnrollment={setEnrollment} onVerified={assessSecurity} onSignOut={signOut} />;
  if (!bootstrap) return <StatusScreen title="Loading SellerTray Admin" body="Retrieving platform context and recent administrator activity…" error={portalError} onRetry={loadPortal} />;

  return <WorkspaceShell session={session} bootstrap={bootstrap} audit={audit} onReload={loadPortal} onAuditRefresh={refreshAudit} onSignOut={signOut} />;
}

function WorkspaceShell({ session, bootstrap, audit, onReload, onAuditRefresh, onSignOut }: { session: Session; bootstrap: PlatformBootstrap; audit: AdminAuditEvent[]; onReload: () => Promise<void>; onAuditRefresh: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [locationHash, setLocationHash] = useState(() => window.location.hash);
  const route = routeFromHash(locationHash);
  const [merchant, setMerchant] = useState<MerchantContext>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [merchantPickerOpen, setMerchantPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(NAV_GROUPS.map((group) => group.id)));
  const tenantId = tenantFromHash(locationHash);

  useEffect(() => {
    const handleHashChange = () => setLocationHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const nextTenantId = tenantId;
    if (!nextTenantId) { setMerchant(null); return; }
    let active = true;
    void loadMerchantDetail(session, nextTenantId)
      .then((detail) => { if (active) setMerchant({ id: detail.merchant.id, name: detail.merchant.name }); })
      .catch(() => { if (active) setMerchant({ id: nextTenantId, name: 'Selected merchant' }); });
    return () => { active = false; };
  }, [session.access_token, tenantId]);

  useEffect(() => {
    const group = NAV_GROUPS.find((candidate) => candidate.items.some((item) => item.id === route));
    if (group && !expandedGroups.has(group.id)) setExpandedGroups((current) => new Set([...current, group.id]));
  }, [route]);

  const activeItem = ALL_ITEMS.find((item) => item.id === route) ?? ALL_ITEMS[0];
  const activeGroup = NAV_GROUPS.find((group) => group.items.some((item) => item.id === route)) ?? NAV_GROUPS[0];

  async function refreshAll() {
    setRefreshing(true);
    try { await onReload(); } finally { setRefreshing(false); }
  }

  function navigate(next: AdminRoute) {
    const query = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
    window.location.hash = `${next}${query}`;
    setMobileNavOpen(false);
  }

  function setMerchantContext(next: Set<string>, changedMerchant?: MerchantRow) {
    const id = [...next][0] ?? '';
    const query = id ? `?tenant=${encodeURIComponent(id)}` : '';
    window.location.hash = `${route}${query}`;
    setMerchant(id ? { id, name: changedMerchant?.name ?? 'Selected merchant' } : null);
    setMerchantPickerOpen(false);
  }

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }

  const chooseMerchant = () => setMerchantPickerOpen(true);
  const page = (() => {
    switch (route) {
      case 'overview/dashboard': return <BusinessDashboard session={session} refreshKey={bootstrap.generatedAt} />;
      case 'merchants/all': return <MerchantPortfolio session={session} refreshKey={bootstrap.generatedAt} />;
      case 'commercial/orders': return <MerchantScopedPage eyebrow="Commercial" title="Commercial orders" description="Create and review governed initial commercial purchases without mixing pricing, settlement, agreements or Branch readiness into the same page." tenantId={tenantId} choose={chooseMerchant}>{tenantId ? <CommercialOrdersAdministration session={session} actorRole={bootstrap.actorRole} tenantId={tenantId} /> : null}</MerchantScopedPage>;
      case 'commercial/pricing': return <MerchantScopedPage eyebrow="Commercial" title="Plans & pricing" description="Manage effective SellerTray subscription and Branch setup pricing as a focused commercial job." tenantId={tenantId} choose={chooseMerchant}>{tenantId ? <CommercialPricingAdministration session={session} actorRole={bootstrap.actorRole} tenantId={tenantId} /> : null}</MerchantScopedPage>;
      case 'commercial/settlement': return <MerchantScopedPage eyebrow="Commercial" title="Payments & settlement" description="Review authoritative order balances, ProcessEdge direct payments, discounts and installment-policy overrides without mixing them with setup scheduling." tenantId={tenantId} choose={chooseMerchant}>{tenantId ? <div className="admin-context-bound admin-hide-first-scope-card"><CommercialSettlementAdministration key={tenantId} session={session} initialTenantId={tenantId} /></div> : null}</MerchantScopedPage>;
      case 'commercial/installments': return <MerchantScopedPage eyebrow="Commercial" title="Installments" description="Review installment progress and entitlement state without placing payment corrections or setup actions on the same page." tenantId={tenantId} choose={chooseMerchant}>{tenantId ? <InstallmentEntitlementAdministration session={session} tenantId={tenantId} /> : null}</MerchantScopedPage>;
      case 'commercial/agreements': return <PageFrame eyebrow="Commercial" title="SellerTray Master Agreement" description="Publish the platform-wide Master Agreement and review immutable Business acceptance history. Merchant-specific issuance and replacement are retired."><AgreementLifecycleManagement session={session} tenantId={tenantId ?? ''} /></PageFrame>;
      case 'setup/appointments': return <MerchantScopedPage eyebrow="Onboarding & Setup" title="Setup appointments" description="Schedule and reschedule ProcessEdge Branch setup work against exact purchased setup obligations." tenantId={tenantId} choose={chooseMerchant}>{tenantId ? <SetupSchedulingAdministration session={session} initialTenantId={tenantId} view="appointments" showMerchantSelector={false} /> : null}</MerchantScopedPage>;
      case 'setup/resources': return <MerchantScopedPage eyebrow="Onboarding & Setup" title="Setup resources" description="Manage ProcessEdge setup service areas, workforce coverage and capacity separately from merchant appointment work." tenantId={tenantId} choose={chooseMerchant}>{tenantId ? <SetupSchedulingAdministration session={session} initialTenantId={tenantId} view="resources" showMerchantSelector={false} /> : null}</MerchantScopedPage>;
      case 'setup/completion': return <MerchantScopedPage eyebrow="Onboarding & Setup" title="Setup completion" description="Record the structured equipment, pairing/test, handover and merchant acknowledgement evidence required before Branch readiness can converge." tenantId={tenantId} choose={chooseMerchant}>{tenantId ? <SetupSchedulingAdministration session={session} initialTenantId={tenantId} view="completion" showMerchantSelector={false} /> : null}</MerchantScopedPage>;
      case 'setup/readiness': return <MerchantScopedPage eyebrow="Onboarding & Setup" title="Branch readiness" description="Review immutable readiness against exact purchased Branch setup obligations. Readiness is written only by the governed setup-completion authority." tenantId={tenantId} choose={chooseMerchant}>{tenantId ? <BranchReadinessAdministration session={session} tenantId={tenantId} /> : null}</MerchantScopedPage>;
      case 'setup/activation': return <MerchantScopedPage eyebrow="Onboarding & Setup" title="Activation queue" description="Review named activation blockers and retry the existing entitlement reconciliation when prerequisites are satisfied; there is no direct Activate shortcut." tenantId={tenantId} choose={chooseMerchant}>{tenantId ? <SetupSchedulingAdministration session={session} initialTenantId={tenantId} view="activation" showMerchantSelector={false} /> : null}</MerchantScopedPage>;
      case 'communications/compose': return <PageFrame eyebrow="Communications" title="Compose message" description="Create and publish governed merchant communications without mixing campaign review into the same task page."><MerchantMessageComposer session={session} actorRole={bootstrap.actorRole} merchantCount={bootstrap.merchantCount} onPublished={onAuditRefresh} /></PageFrame>;
      case 'communications/history': return <PageFrame eyebrow="Communications" title="Campaign history" description="Review audited merchant-message publications independently from message composition."><CampaignHistory audit={audit} /></PageFrame>;
      case 'operations/whatsapp': return <PageFrame eyebrow="Platform Operations" title="WhatsApp operations" description="Monitor cross-merchant WhatsApp connection health without mixing AI diagnostics into the same page."><WhatsAppOperations session={session} /></PageFrame>;
      case 'operations/ai': return <PageFrame eyebrow="Platform Operations" title="AI operations" description="Review server-side parser readiness and run controlled diagnostics within ProcessEdge authority."><AiOperations session={session} actorRole={bootstrap.actorRole} /></PageFrame>;
      case 'operations/payments': return <PageFrame eyebrow="Platform Operations" title="Payment infrastructure" description="Review server-side ProcessEdge/SellerTray collection readiness without exposing or storing raw gateway credentials in Admin Web."><PaymentInfrastructure session={session} /></PageFrame>;
      case 'reports/revenue': return <RevenueDashboard session={session} refreshKey={bootstrap.generatedAt} />;
      case 'governance/audit': return <AuditPage audit={audit} onRefresh={onAuditRefresh} />;
    }
  })();

  return <div className="workspace-app-shell">
    <aside className={mobileNavOpen ? 'workspace-sidebar open' : 'workspace-sidebar'} aria-label="SellerTray Admin navigation">
      <div className="workspace-sidebar-brand"><img src={LOCAL_LOGO} alt="SellerTray" /><div><strong>SellerTray Admin</strong><span>ProcessEdge</span></div><button className="workspace-icon-button mobile-only" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><Icon name="close" /></button></div>
      <nav className="workspace-nav admin-grouped-nav">
        {NAV_GROUPS.map((group) => {
          const expanded = expandedGroups.has(group.id);
          const groupActive = group.items.some((item) => item.id === route);
          return <section className={groupActive ? 'admin-nav-group active' : 'admin-nav-group'} key={group.id}>
            <button type="button" className="admin-nav-group-button" aria-expanded={expanded} onClick={() => toggleGroup(group.id)}><span className="workspace-nav-icon"><Icon name={group.icon} /></span><span>{group.label}</span><Icon name="chevron" /></button>
            {expanded ? <div className="admin-nav-submenu">{group.items.map((item) => <a key={item.id} href={`#${item.id}`} className={route === item.id ? 'admin-nav-submenu-link active' : 'admin-nav-submenu-link'} onClick={(event) => { event.preventDefault(); navigate(item.id); }}><strong>{item.label}</strong><small>{item.description}</small></a>)}</div> : null}
          </section>;
        })}
      </nav>
      <div className="workspace-sidebar-footer"><span className="workspace-role-badge">{bootstrap.actorRole === 'admin' ? 'Platform Admin' : 'Platform Support'}</span><strong>{session.user.email ?? 'Administrator'}</strong><button className="workspace-button subtle" onClick={() => void onSignOut()}>Sign out</button></div>
    </aside>
    {mobileNavOpen ? <button className="workspace-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}
    <div className="workspace-main-shell">
      <header className="workspace-topbar admin-topbar">
        <button className="workspace-icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Icon name="menu" /></button>
        <div className="workspace-topbar-title"><strong>{activeItem.label}</strong><span>{activeGroup.label} · ProcessEdge platform operations</span></div>
        <div className="admin-merchant-context">
          <button type="button" className={merchant ? 'admin-merchant-context-button selected' : 'admin-merchant-context-button'} onClick={() => setMerchantPickerOpen((value) => !value)} aria-expanded={merchantPickerOpen}><span>Merchant context</span><strong>{merchant?.name ?? 'All merchants'}</strong></button>
          {merchantPickerOpen ? <div className="admin-merchant-context-popover"><div className="admin-context-heading"><div><strong>Merchant context</strong><small>Select once and keep the Business context across merchant-scoped Admin work.</small></div><button className="workspace-icon-button" aria-label="Close merchant context" onClick={() => setMerchantPickerOpen(false)}><Icon name="close" /></button></div><MerchantSelector session={session} mode="single" showCommercialPortfolio={false} selectedIds={tenantId ? new Set([tenantId]) : new Set()} onChange={setMerchantContext} />{tenantId ? <button type="button" className="workspace-button subtle compact" onClick={() => setMerchantContext(new Set())}>Clear merchant context</button> : null}</div> : null}
        </div>
        <div className="workspace-topbar-actions"><span className="workspace-generated">Updated {formatDate(bootstrap.generatedAt)}</span><button className="workspace-button subtle compact" onClick={() => void refreshAll()} disabled={refreshing}><Icon name="refresh" />{refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
      </header>
      <main className="workspace-content">{activeItem.merchantScoped ? <div className="admin-context-strip"><span>Business scope</span><strong>{merchant?.name ?? 'Select a merchant to continue'}</strong>{tenantId ? <button type="button" className="workspace-button text compact" onClick={() => setMerchantPickerOpen(true)}>Change</button> : <button type="button" className="workspace-button primary compact" onClick={() => setMerchantPickerOpen(true)}>Choose merchant</button>}</div> : null}{page}</main>
    </div>
  </div>;
}

function MerchantScopedPage({ eyebrow, title, description, tenantId, choose, children }: { eyebrow: string; title: string; description: string; tenantId: string | null; choose: () => void; children: ReactNode }) {
  return <PageFrame eyebrow={eyebrow} title={title} description={description}>{tenantId ? children : <ScopeRequired action={choose} />}</PageFrame>;
}
function ScopeRequired({ action }: { action: () => void }) { return <section className="workspace-panel admin-scope-required"><div><p className="workspace-eyebrow">Merchant-scoped work</p><h2>Choose a merchant</h2><p className="workspace-muted">Select the Business once in the top bar. The same context follows you through related Admin work.</p></div><button type="button" className="workspace-button primary" onClick={action}>Choose merchant</button></section>; }
function AuditPage({ audit, onRefresh }: { audit: AdminAuditEvent[]; onRefresh: () => Promise<void> }) {
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const filtered = useMemo(() => { const needle = search.trim().toLowerCase(); if (!needle) return audit; return audit.filter((event) => [event.action, event.actorEmail, JSON.stringify(event.detail)].some((value) => value.toLowerCase().includes(needle))); }, [audit, search]);
  async function refresh() { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } }
  return <PageFrame eyebrow="Governance" title="Audit log" description="Recent ProcessEdge administrator actions from the governed platform audit log."><section className="workspace-panel"><div className="workspace-toolbar"><div className="workspace-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search action, actor or detail" /></div><button className="workspace-button subtle compact" onClick={() => void refresh()} disabled={refreshing}><Icon name="refresh" />{refreshing ? 'Refreshing…' : 'Refresh'}</button></div><div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Merchant / reference</th></tr></thead><tbody>{filtered.map((event) => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td><strong>{friendlyLabel(event.action)}</strong></td><td>{event.actorEmail || 'Platform administrator'}</td><td><code>{auditReference(event.detail)}</code></td></tr>)}{!filtered.length ? <tr><td colSpan={4}><EmptyState title="No audit events found" body="Adjust the search or refresh the audit log." /></td></tr> : null}</tbody></table></div></section></PageFrame>;
}

function LoginScreen() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (authError) throw authError; } catch (cause) { setError(messageFrom(cause, 'Unable to sign in.')); } finally { setBusy(false); } }
  return <div className="workspace-auth-shell"><section className="workspace-auth-brand"><img src={LOCAL_LOGO} alt="SellerTray" /><p className="workspace-eyebrow">ProcessEdge Operations</p><h1>SellerTray Admin</h1><p>Cross-tenant platform operations, commercial administration and governed merchant communications.</p><div className="workspace-security-note">Restricted ProcessEdge access · MFA required</div></section><form className="workspace-auth-card" onSubmit={submit}><div><p className="workspace-eyebrow">Restricted access</p><h2>Sign in</h2><p className="workspace-muted">Use your ProcessEdge platform administrator account.</p></div><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error ? <div className="workspace-banner error">{error}</div> : null}<button className="workspace-button primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Continue securely'}</button></form></div>;
}
function MfaChallenge({ factorId, onVerified, onSignOut }: { factorId: string; onVerified: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function verify(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() }); if (verifyError) throw verifyError; await supabase.auth.refreshSession(); await onVerified(); } catch (cause) { setError(messageFrom(cause, 'The MFA code could not be verified.')); } finally { setBusy(false); } }
  return <div className="workspace-center-shell"><form className="workspace-security-card" onSubmit={verify}><img src={LOCAL_LOGO} alt="SellerTray" /><p className="workspace-eyebrow">Second factor</p><h1>Verify MFA</h1><p className="workspace-muted">Enter the six-digit code from your authenticator app.</p><input className="workspace-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required />{error ? <div className="workspace-banner error">{error}</div> : null}<button className="workspace-button primary" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and continue'}</button><button className="workspace-button text" type="button" onClick={() => void onSignOut()}>Use another account</button></form></div>;
}
function MfaEnrollment({ enrollment, setEnrollment, onVerified, onSignOut }: { enrollment: Enrollment | null; setEnrollment: (value: Enrollment | null) => void; onVerified: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function beginEnrollment() { setBusy(true); setError(null); try { const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ProcessEdge SellerTray Admin' }); if (enrollError) throw enrollError; setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }); } catch (cause) { setError(messageFrom(cause, 'Unable to start MFA setup.')); } finally { setBusy(false); } }
  async function verify(event: FormEvent) { event.preventDefault(); if (!enrollment) return; setBusy(true); setError(null); try { const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code: code.trim() }); if (verifyError) throw verifyError; await supabase.auth.refreshSession(); setEnrollment(null); await onVerified(); } catch (cause) { setError(messageFrom(cause, 'The MFA code could not be verified.')); } finally { setBusy(false); } }
  return <div className="workspace-center-shell"><form className="workspace-security-card wide" onSubmit={verify}><img src={LOCAL_LOGO} alt="SellerTray" /><p className="workspace-eyebrow">Administrator protection</p><h1>Set up MFA</h1><p className="workspace-muted">SellerTray Admin requires a verified second factor before privileged platform operations are available.</p>{!enrollment ? <button className="workspace-button primary" type="button" onClick={() => void beginEnrollment()} disabled={busy}>{busy ? 'Preparing…' : 'Set up authenticator'}</button> : <><div className="workspace-enrollment-grid"><div className="workspace-qr"><img src={enrollment.qrCode} alt="Authenticator QR code" /></div><div><strong>Scan with your authenticator app</strong><p className="workspace-muted small">Manual setup key:</p><code>{enrollment.secret}</code></div></div><input className="workspace-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required /><button className="workspace-button primary" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify MFA'}</button></>}{error ? <div className="workspace-banner error">{error}</div> : null}<button className="workspace-button text" type="button" onClick={() => void onSignOut()}>Sign out</button></form></div>;
}
function StatusScreen({ title, body, error, onRetry }: { title: string; body: string; error?: string | null; onRetry?: () => Promise<void> }) { return <div className="workspace-center-shell"><section className="workspace-security-card"><img src={LOCAL_LOGO} alt="SellerTray" /><h1>{title}</h1><p className="workspace-muted">{body}</p>{error ? <div className="workspace-banner error">{error}</div> : null}{onRetry ? <button className="workspace-button primary" onClick={() => void onRetry()}>Retry</button> : null}</section></div>; }
function PageFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) { return <div className="workspace-page"><header className="workspace-page-header"><div><p className="workspace-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div></header>{children}</div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="workspace-empty"><strong>{title}</strong><p>{body}</p></div>; }

function Icon({ name }: { name: IconName }) {
  const path = (() => {
    switch (name) {
      case 'overview': return <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></>;
      case 'merchants': return <><path d="M4 20v-2a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v2" /><circle cx="9.5" cy="7" r="3" /><path d="M16 4.5a3 3 0 0 1 0 5.8M17 14a4 4 0 0 1 3 3.9V20" /></>;
      case 'commercial': return <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>;
      case 'setup': return <><path d="M4 7h16M6 7v12h12V7" /><path d="M9 4h6v6H9zM9 14h6" /></>;
      case 'communications': return <><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h6" /></>;
      case 'operations': return <><circle cx="12" cy="12" r="3" /><path d="M19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.5-1.5M5.5 18.5 7 17M17 17l1.5 1.5M5.5 5.5 7 7" /></>;
      case 'reports': return <><path d="M4 19V9M10 19V5M16 19v-7M3 19h18" /></>;
      case 'governance': return <><path d="M6 3h12v18H6z" /><path d="M9 7h6M9 11h6M9 15h4" /></>;
      case 'menu': return <path d="M4 7h16M4 12h16M4 17h16" />;
      case 'close': return <path d="M6 6l12 12M18 6 6 18" />;
      case 'refresh': return <><path d="M20 6v5h-5" /><path d="M18.5 9A7 7 0 1 0 19 15" /></>;
      case 'search': return <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>;
      case 'chevron': return <path d="m9 7 5 5-5 5" />;
    }
  })();
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{path}</svg>;
}

function routeFromHash(hash = window.location.hash): AdminRoute {
  const raw = hash.replace(/^#/, '').split('?')[0];
  const aliases: Record<string, AdminRoute> = {
    overview: 'overview/dashboard',
    merchants: 'merchants/all',
    billing: 'commercial/orders',
    'commercial/core': 'commercial/orders',
    communications: 'communications/compose',
    'communications/messages': 'communications/compose',
    operations: 'operations/whatsapp',
    'operations/health': 'operations/whatsapp',
    'payment-infrastructure': 'operations/payments',
    revenue: 'reports/revenue',
    reports: 'reports/revenue',
    audit: 'governance/audit',
    settings: 'overview/dashboard',
  };
  const candidate = aliases[raw] ?? raw;
  return ALL_ITEMS.some((item) => item.id === candidate) ? candidate as AdminRoute : 'overview/dashboard';
}
function tenantFromHash(hash = window.location.hash): string | null { const value = new URLSearchParams(hash.split('?')[1] ?? '').get('tenant'); return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null; }
function normalizeBootstrap(value: unknown): PlatformBootstrap { if (!isRecord(value)) throw new Error('Platform admin returned an invalid bootstrap response.'); const actorRole = value.actorRole === 'support' ? 'support' : value.actorRole === 'admin' ? 'admin' : null; if (!actorRole) throw new Error('This account is not configured for ProcessEdge platform administration.'); return { actorRole, generatedAt: stringValue(value.generatedAt), merchantCount: numberValue(value.merchantCount), legacyTrialRecords: numberValue(value.legacyTrialRecords) }; }
function normalizeAudit(value: unknown): AdminAuditEvent[] { const source = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.events) ? value.events : []; return source.filter(isRecord).map((event) => ({ id: stringValue(event.id) || crypto.randomUUID(), action: stringValue(event.action), detail: isRecord(event.detail) ? event.detail : {}, createdAt: stringValue(event.createdAt), actorEmail: stringValue(event.actorEmail) })); }
function auditReference(detail: Record<string, unknown>): string { return shortId(stringValue(detail.tenant_id) || stringValue(detail.tenantId) || stringValue(detail.campaign_id) || stringValue(detail.campaignId) || stringValue(detail.request_id) || stringValue(detail.requestId)); }
function friendlyLabel(value: string): string { if (!value) return 'Unknown'; return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()); }
function messageFrom(value: unknown, fallback: string): string { return value instanceof Error && value.message ? value.message : fallback; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function numberValue(value: unknown): number { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function shortId(value: string): string { return value ? `${value.slice(0, 8)}…` : '—'; }
function formatDate(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
