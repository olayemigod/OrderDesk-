import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import BusinessDashboard from './BusinessDashboard';
import {
  BranchReadinessAdministration,
  CommercialAgreementAdministration,
  CommercialOrdersAdministration,
  CommercialPricingAdministration,
  InstallmentEntitlementAdministration,
} from './CommercialAdminWorkspaces';
import CommercialSettlementAdministration from './CommercialSettlementAdministration';
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
  | 'setup/readiness'
  | 'communications/messages'
  | 'operations/health'
  | 'governance/audit';
type MessageType = 'update' | 'service' | 'information' | 'promotion';
type Severity = 'info' | 'attention' | 'urgent';
type MerchantRole = 'owner' | 'manager' | 'staff';
type IconName = 'overview' | 'merchants' | 'commercial' | 'setup' | 'communications' | 'operations' | 'governance' | 'menu' | 'close' | 'refresh' | 'search' | 'chevron';

type PlatformBootstrap = {
  actorRole: AdminRole;
  generatedAt: string;
  merchantCount: number;
  legacyTrialRecords: number;
};

type OperationsSummary = {
  merchantCount: number;
  whatsappConnected: number;
  whatsappErrors: number;
  whatsappPending: number;
  whatsappNotConnected: number;
};

type AuditEvent = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
  actorEmail: string;
};

type Enrollment = { factorId: string; qrCode: string; secret: string };
type PublishResult = { ok?: boolean; campaignId?: string; notificationCount?: number };
type AiReadiness = {
  configured: boolean;
  configuredModel: string;
  attempts: number;
  successes: number;
  nonSuccess: number;
  totalTokens: number;
  meteredExternalOrderUnits: number;
  productionAcceptanceReady: boolean;
  generatedAt: string;
};
type AiProbe = {
  ok: boolean;
  status: string;
  durationMs: number | null;
  httpStatus: number | null;
  configuredModel: string | null;
  structuredOutputValid: boolean | null;
};

type NavItem = { id: AdminRoute; label: string; description: string; merchantScoped?: boolean };
type NavGroup = { id: string; label: string; icon: IconName; items: NavItem[] };
type MerchantContext = { id: string; name: string } | null;

const MESSAGE_LABELS: Record<MessageType, string> = {
  update: 'Product update',
  service: 'Service notice',
  information: 'Information',
  promotion: 'Promotion',
};
const ROLE_LABELS: Record<MerchantRole, string> = { owner: 'Owner', manager: 'Manager', staff: 'Cashier' };
const DEFAULT_ROLES: MerchantRole[] = ['owner', 'manager', 'staff'];
const ACTION_URL_PATTERN = /^(https:\/\/[^\s]+|sellertray:\/\/[A-Za-z0-9/_?=&.%-]+)$/;
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
    { id: 'commercial/agreements', label: 'Agreements', description: 'Templates, issuance, acceptance and replacement', merchantScoped: true },
  ] },
  { id: 'setup', label: 'Onboarding & Setup', icon: 'setup', items: [
    { id: 'setup/appointments', label: 'Setup Appointments', description: 'Scheduling, rescheduling and capacity', merchantScoped: true },
    { id: 'setup/readiness', label: 'Branch Readiness', description: 'Purchased setup obligations and readiness facts', merchantScoped: true },
  ] },
  { id: 'communications', label: 'Communications', icon: 'communications', items: [
    { id: 'communications/messages', label: 'Merchant Messages', description: 'Compose and review campaigns' },
  ] },
  { id: 'operations', label: 'Platform Operations', icon: 'operations', items: [
    { id: 'operations/health', label: 'Service Health', description: 'WhatsApp and AI operations' },
  ] },
  { id: 'governance', label: 'Governance', icon: 'governance', items: [
    { id: 'governance/audit', label: 'Audit Log', description: 'Privileged administrator activity' },
  ] },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export default function AdminWorkspaceV3() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [securityState, setSecurityState] = useState<SecurityState>('checking');
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [bootstrap, setBootstrap] = useState<PlatformBootstrap | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
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
    } catch (error) {
      setPortalError(messageFrom(error, 'Unable to verify the administrator security level.'));
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
    } catch (error) {
      setPortalError(messageFrom(error, 'Unable to load SellerTray platform administration.'));
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

function WorkspaceShell({ session, bootstrap, audit, onReload, onAuditRefresh, onSignOut }: { session: Session; bootstrap: PlatformBootstrap; audit: AuditEvent[]; onReload: () => Promise<void>; onAuditRefresh: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [route, setRoute] = useState<AdminRoute>(() => routeFromHash());
  const [merchant, setMerchant] = useState<MerchantContext>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [merchantPickerOpen, setMerchantPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(NAV_GROUPS.map((group) => group.id)));
  const tenantId = tenantFromHash();

  useEffect(() => {
    const handleHashChange = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const nextTenantId = tenantFromHash();
    if (!nextTenantId) { setMerchant(null); return; }
    let active = true;
    void loadMerchantDetail(session, nextTenantId)
      .then((detail) => { if (active) setMerchant({ id: detail.merchant.id, name: detail.merchant.name }); })
      .catch(() => { if (active) setMerchant({ id: nextTenantId, name: 'Selected merchant' }); });
    return () => { active = false; };
  }, [session.access_token, route]);

  useEffect(() => {
    const group = NAV_GROUPS.find((candidate) => candidate.items.some((item) => item.id === route));
    if (group && !expandedGroups.has(group.id)) {
      setExpandedGroups((current) => new Set([...current, group.id]));
    }
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
    setRoute(next);
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
      case 'commercial/orders': return <CommercialOrdersPage session={session} actorRole={bootstrap.actorRole} tenantId={tenantId} onChooseMerchant={chooseMerchant} />;
      case 'commercial/pricing': return <CommercialPricingPage session={session} actorRole={bootstrap.actorRole} tenantId={tenantId} onChooseMerchant={chooseMerchant} />;
      case 'commercial/settlement': return <SettlementPage session={session} tenantId={tenantId} onChooseMerchant={chooseMerchant} />;
      case 'commercial/installments': return <InstallmentsPage session={session} tenantId={tenantId} onChooseMerchant={chooseMerchant} />;
      case 'commercial/agreements': return <AgreementsPage session={session} actorRole={bootstrap.actorRole} tenantId={tenantId} onChooseMerchant={chooseMerchant} />;
      case 'setup/appointments': return <SetupAppointmentsPage session={session} tenantId={tenantId} onChooseMerchant={chooseMerchant} />;
      case 'setup/readiness': return <BranchReadinessPage session={session} tenantId={tenantId} onChooseMerchant={chooseMerchant} />;
      case 'communications/messages': return <CommunicationsPage session={session} bootstrap={bootstrap} audit={audit} onAuditRefresh={onAuditRefresh} />;
      case 'operations/health': return <OperationsPage session={session} actorRole={bootstrap.actorRole} />;
      case 'governance/audit': return <AuditPage audit={audit} onRefresh={onAuditRefresh} />;
    }
  })();

  return (
    <div className="workspace-app-shell">
      <aside className={mobileNavOpen ? 'workspace-sidebar open' : 'workspace-sidebar'} aria-label="SellerTray Admin navigation">
        <div className="workspace-sidebar-brand">
          <img src={LOCAL_LOGO} alt="SellerTray" />
          <div><strong>SellerTray Admin</strong><span>ProcessEdge</span></div>
          <button className="workspace-icon-button mobile-only" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><Icon name="close" /></button>
        </div>
        <nav className="workspace-nav admin-grouped-nav">
          {NAV_GROUPS.map((group) => {
            const expanded = expandedGroups.has(group.id);
            const groupActive = group.items.some((item) => item.id === route);
            return <section className={groupActive ? 'admin-nav-group active' : 'admin-nav-group'} key={group.id}>
              <button type="button" className="admin-nav-group-button" aria-expanded={expanded} onClick={() => toggleGroup(group.id)}>
                <span className="workspace-nav-icon"><Icon name={group.icon} /></span>
                <span>{group.label}</span>
                <Icon name="chevron" />
              </button>
              {expanded ? <div className="admin-nav-submenu">
                {group.items.map((item) => <a key={item.id} href={`#${item.id}`} className={route === item.id ? 'admin-nav-submenu-link active' : 'admin-nav-submenu-link'} onClick={(event) => { event.preventDefault(); navigate(item.id); }}><strong>{item.label}</strong><small>{item.description}</small></a>)}
              </div> : null}
            </section>;
          })}
        </nav>
        <div className="workspace-sidebar-footer">
          <span className="workspace-role-badge">{bootstrap.actorRole === 'admin' ? 'Platform Admin' : 'Platform Support'}</span>
          <strong>{session.user.email ?? 'Administrator'}</strong>
          <button className="workspace-button subtle" onClick={() => void onSignOut()}>Sign out</button>
        </div>
      </aside>
      {mobileNavOpen ? <button className="workspace-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}

      <div className="workspace-main-shell">
        <header className="workspace-topbar admin-topbar">
          <button className="workspace-icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Icon name="menu" /></button>
          <div className="workspace-topbar-title"><strong>{activeItem.label}</strong><span>{activeGroup.label} · ProcessEdge platform operations</span></div>
          <div className="admin-merchant-context">
            <button type="button" className={merchant ? 'admin-merchant-context-button selected' : 'admin-merchant-context-button'} onClick={() => setMerchantPickerOpen((value) => !value)} aria-expanded={merchantPickerOpen}>
              <span>Merchant context</span><strong>{merchant?.name ?? 'All merchants'}</strong>
            </button>
            {merchantPickerOpen ? <div className="admin-merchant-context-popover">
              <div className="admin-context-heading"><div><strong>Merchant context</strong><small>Select once and keep the Business context across merchant-scoped Admin work.</small></div><button className="workspace-icon-button" aria-label="Close merchant context" onClick={() => setMerchantPickerOpen(false)}><Icon name="close" /></button></div>
              <MerchantSelector session={session} mode="single" showCommercialPortfolio={false} selectedIds={tenantId ? new Set([tenantId]) : new Set()} onChange={setMerchantContext} />
              {tenantId ? <button type="button" className="workspace-button subtle compact" onClick={() => setMerchantContext(new Set())}>Clear merchant context</button> : null}
            </div> : null}
          </div>
          <div className="workspace-topbar-actions">
            <span className="workspace-generated">Updated {formatDate(bootstrap.generatedAt)}</span>
            <button className="workspace-button subtle compact" onClick={() => void refreshAll()} disabled={refreshing}><Icon name="refresh" />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </header>
        <main className="workspace-content">
          {activeItem.merchantScoped ? <div className="admin-context-strip"><span>Business scope</span><strong>{merchant?.name ?? 'Select a merchant to continue'}</strong>{tenantId ? <button type="button" className="workspace-button text compact" onClick={() => setMerchantPickerOpen(true)}>Change</button> : <button type="button" className="workspace-button primary compact" onClick={() => setMerchantPickerOpen(true)}>Choose merchant</button>}</div> : null}
          {page}
        </main>
      </div>
    </div>
  );
}

function CommercialOrdersPage({ session, actorRole, tenantId, onChooseMerchant }: { session: Session; actorRole: AdminRole; tenantId: string | null; onChooseMerchant: () => void }) {
  return <PageFrame eyebrow="Commercial" title="Commercial orders" description="Create and review governed initial commercial purchases without mixing pricing, settlement, agreements or Branch readiness into the same page.">
    {!tenantId ? <ScopeRequired title="Choose a merchant" body="Commercial orders are merchant-scoped. Select the Business once in the top bar." action={onChooseMerchant} /> : <CommercialOrdersAdministration session={session} actorRole={actorRole} tenantId={tenantId} />}
  </PageFrame>;
}

function CommercialPricingPage({ session, actorRole, tenantId, onChooseMerchant }: { session: Session; actorRole: AdminRole; tenantId: string | null; onChooseMerchant: () => void }) {
  return <PageFrame eyebrow="Commercial" title="Plans & pricing" description="Manage effective SellerTray subscription and Branch setup pricing as a focused commercial job.">
    {!tenantId ? <ScopeRequired title="Choose a merchant" body="Current pricing review is merchant-scoped while using the existing commercial authority. Select the Business once in the top bar." action={onChooseMerchant} /> : <CommercialPricingAdministration session={session} actorRole={actorRole} tenantId={tenantId} />}
  </PageFrame>;
}

function SettlementPage({ session, tenantId, onChooseMerchant }: { session: Session; tenantId: string | null; onChooseMerchant: () => void }) {
  return <PageFrame eyebrow="Commercial" title="Payments & settlement" description="Review authoritative order balances, ProcessEdge direct payments, discounts and installment-policy overrides without mixing them with setup scheduling.">
    {!tenantId ? <ScopeRequired title="Choose a merchant" body="Settlement is merchant-scoped. Select the Business once in the top bar." action={onChooseMerchant} /> : <div className="admin-context-bound admin-hide-first-scope-card"><CommercialSettlementAdministration key={tenantId} session={session} initialTenantId={tenantId} /></div>}
  </PageFrame>;
}

function InstallmentsPage({ session, tenantId, onChooseMerchant }: { session: Session; tenantId: string | null; onChooseMerchant: () => void }) {
  return <PageFrame eyebrow="Commercial" title="Installments" description="Review installment progress and entitlement state without placing payment corrections or setup actions on the same page.">
    {!tenantId ? <ScopeRequired title="Choose a merchant" body="Installment review is merchant-scoped. Select the Business once in the top bar." action={onChooseMerchant} /> : <InstallmentEntitlementAdministration session={session} tenantId={tenantId} />}
  </PageFrame>;
}

function AgreementsPage({ session, actorRole, tenantId, onChooseMerchant }: { session: Session; actorRole: AdminRole; tenantId: string | null; onChooseMerchant: () => void }) {
  return <PageFrame eyebrow="Commercial" title="Agreements" description="Publish governed templates, issue merchant agreements and review immutable acceptance/replacement history in one agreement workspace.">
    {!tenantId ? <ScopeRequired title="Choose a merchant" body="Agreement administration is merchant-scoped. Select the Business once in the top bar." action={onChooseMerchant} /> : <CommercialAgreementAdministration session={session} actorRole={actorRole} tenantId={tenantId} />}
  </PageFrame>;
}

function SetupAppointmentsPage({ session, tenantId, onChooseMerchant }: { session: Session; tenantId: string | null; onChooseMerchant: () => void }) {
  return <PageFrame eyebrow="Onboarding & Setup" title="Setup appointments" description="Schedule and manage ProcessEdge Branch setup work independently from commercial settlement and readiness review.">
    {!tenantId ? <ScopeRequired title="Choose a merchant" body="Setup appointments are tied to exact merchant Branch setup obligations. Select the Business once in the top bar." action={onChooseMerchant} /> : <div className="admin-context-bound"><SetupSchedulingAdministration session={session} initialTenantId={tenantId} /></div>}
  </PageFrame>;
}

function BranchReadinessPage({ session, tenantId, onChooseMerchant }: { session: Session; tenantId: string | null; onChooseMerchant: () => void }) {
  return <PageFrame eyebrow="Onboarding & Setup" title="Branch readiness" description="Review immutable readiness against purchased Branch setup obligations. OA4 structured completion and activation recovery will extend this workspace.">
    {!tenantId ? <ScopeRequired title="Choose a merchant" body="Branch readiness is merchant-scoped. Select the Business once in the top bar." action={onChooseMerchant} /> : <BranchReadinessAdministration session={session} tenantId={tenantId} />}
  </PageFrame>;
}

function ScopeRequired({ title, body, action }: { title: string; body: string; action?: () => void }) {
  return <section className="workspace-panel admin-scope-required"><div><p className="workspace-eyebrow">Merchant-scoped work</p><h2>{title}</h2><p className="workspace-muted">{body}</p></div>{action ? <button type="button" className="workspace-button primary" onClick={action}>Choose merchant</button> : null}</section>;
}

function CommunicationsPage({ session, bootstrap, audit, onAuditRefresh }: { session: Session; bootstrap: PlatformBootstrap; audit: AuditEvent[]; onAuditRefresh: () => Promise<void> }) {
  const [messageType, setMessageType] = useState<MessageType>('update');
  const [severity, setSeverity] = useState<Severity>('info');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [actionLabel, setActionLabel] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [allBusinesses, setAllBusinesses] = useState(true);
  const [selectedTenantIds, setSelectedTenantIds] = useState<Set<string>>(new Set());
  const [audienceRoles, setAudienceRoles] = useState<Set<MerchantRole>>(new Set(DEFAULT_ROLES));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canPublish = bootstrap.actorRole === 'admin';
  const notificationAudit = useMemo(() => audit.filter((event) => event.action === 'merchant_message_published'), [audit]);
  const selectedCount = allBusinesses ? bootstrap.merchantCount : selectedTenantIds.size;
  const roleList = Array.from(audienceRoles);

  function toggleRole(role: MerchantRole) {
    setAudienceRoles((current) => {
      const next = new Set(current);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  }

  function validate() {
    if (!canPublish) return 'Only a ProcessEdge Platform Admin can publish merchant messages.';
    if (!title.trim() || title.trim().length > 160) return 'Enter a title between 1 and 160 characters.';
    if (!body.trim() || body.trim().length > 1000) return 'Enter a message between 1 and 1000 characters.';
    if (!audienceRoles.size) return 'Select at least one merchant role.';
    if (!allBusinesses && !selectedTenantIds.size) return 'Select at least one SellerTray business.';
    if (messageType === 'promotion' && severity === 'urgent') return 'Promotional messages cannot be marked urgent.';
    if ((actionLabel.trim() && !actionUrl.trim()) || (!actionLabel.trim() && actionUrl.trim())) return 'CTA label and CTA link must be provided together.';
    if (actionLabel.trim().length > 60) return 'CTA label must be 60 characters or fewer.';
    if (actionUrl.trim() && !ACTION_URL_PATTERN.test(actionUrl.trim())) return 'CTA link must use https:// or sellertray://.';
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return 'Expiry must be in the future.';
    return null;
  }

  function requestPublish() {
    setSuccess(null);
    const validation = validate();
    if (validation) return setError(validation);
    setError(null);
    setConfirmOpen(true);
  }

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { messageType, severity, title: title.trim(), body: body.trim(), audienceRoles: roleList };
      if (!allBusinesses) payload.tenantIds = Array.from(selectedTenantIds);
      if (actionLabel.trim()) payload.actionLabel = actionLabel.trim();
      if (actionUrl.trim()) payload.actionUrl = actionUrl.trim();
      if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();
      const result = await invokeJson<PublishResult>('platform-merchant-message', payload, session);
      const count = Number(result.notificationCount ?? 0);
      setSuccess(`Published to ${count.toLocaleString()} SellerTray business${count === 1 ? '' : 'es'}. Campaign ${result.campaignId ?? ''}`.trim());
      setConfirmOpen(false);
      setTitle(''); setBody(''); setActionLabel(''); setActionUrl(''); setExpiresAt('');
      await onAuditRefresh();
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to publish this merchant message.'));
      setConfirmOpen(false);
    } finally {
      setPublishing(false);
    }
  }

  return <PageFrame eyebrow="Communications" title="Merchant messages" description="Compose governed merchant communications and review campaign history in one focused communications workspace.">
    {!canPublish ? <div className="workspace-banner warning">Platform Support can review campaigns. Publishing remains restricted to authorised Platform Admin capability.</div> : null}
    {success ? <div className="workspace-banner success">{success}</div> : null}
    {error ? <div className="workspace-banner error">{error}</div> : null}
    <div className="workspace-grid two composer">
      <section className="workspace-panel workspace-form-stack">
        <PanelHeading title="Compose message" description="Merchant-facing notification content." />
        <div className="workspace-field-grid two"><label>Message type<select value={messageType} onChange={(event) => { const next = event.target.value as MessageType; setMessageType(next); if (next === 'promotion' && severity === 'urgent') setSeverity('attention'); }}>{Object.entries(MESSAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Priority<select value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}><option value="info">Normal</option><option value="attention">Attention</option><option value="urgent" disabled={messageType === 'promotion'}>Urgent</option></select></label></div>
        <label>Title <span className="workspace-counter">{title.trim().length}/160</span><input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 160))} /></label>
        <label>Message <span className="workspace-counter">{body.trim().length}/1000</span><textarea rows={7} value={body} onChange={(event) => setBody(event.target.value.slice(0, 1000))} /></label>
        <div className="workspace-field-grid two"><label>CTA label <span className="workspace-optional">Optional</span><input value={actionLabel} onChange={(event) => setActionLabel(event.target.value.slice(0, 60))} /></label><label>CTA link <span className="workspace-optional">Optional</span><input value={actionUrl} onChange={(event) => setActionUrl(event.target.value)} placeholder="sellertray://… or https://…" /></label></div>
        <label>Expiry <span className="workspace-optional">Optional</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
      </section>
      <aside className="workspace-panel">
        <PanelHeading title="Merchant preview" description="Approximate SellerTray notification appearance." />
        <div className={`workspace-notification-preview severity-${severity}`}><div className="workspace-preview-meta"><span>{MESSAGE_LABELS[messageType]}</span><span>{friendlyLabel(severity)}</span></div><h3>{title.trim() || 'Your notification title'}</h3><p>{body.trim() || 'Your merchant message will appear here.'}</p>{actionLabel.trim() ? <button type="button" className="workspace-preview-cta">{actionLabel.trim()}</button> : null}<small>ProcessEdge · just now</small></div>
      </aside>
    </div>
    <section className="workspace-panel"><PanelHeading title="Audience" description="Choose businesses and merchant roles." /><div className="workspace-filter-row"><button className={allBusinesses ? 'workspace-filter active' : 'workspace-filter'} onClick={() => setAllBusinesses(true)}>All businesses</button><button className={!allBusinesses ? 'workspace-filter active' : 'workspace-filter'} onClick={() => setAllBusinesses(false)}>Selected businesses</button></div><div className="workspace-role-row">{DEFAULT_ROLES.map((role) => <label className="workspace-check-pill" key={role}><input type="checkbox" checked={audienceRoles.has(role)} onChange={() => toggleRole(role)} />{ROLE_LABELS[role]}</label>)}</div>{!allBusinesses ? <MerchantSelector session={session} selectedIds={selectedTenantIds} onChange={setSelectedTenantIds} /> : null}<div className="workspace-publish-bar"><div><strong>{selectedCount.toLocaleString()} business{selectedCount === 1 ? '' : 'es'}</strong><span>{roleList.length} selected role{roleList.length === 1 ? '' : 's'}</span></div><button className="workspace-button primary" disabled={!canPublish || publishing} onClick={requestPublish}>Review & publish</button></div></section>
    <section className="workspace-panel"><PanelHeading title="Campaign history" description="Audited merchant-message publications." /><div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Published</th><th>Type</th><th>Priority</th><th>Businesses</th><th>Actor</th><th>Campaign</th></tr></thead><tbody>{notificationAudit.slice(0, 20).map((event) => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td>{MESSAGE_LABELS[stringValue(event.detail.message_type) as MessageType] ?? friendlyLabel(stringValue(event.detail.message_type))}</td><td>{friendlyLabel(stringValue(event.detail.severity))}</td><td>{numberValue(event.detail.notification_count).toLocaleString()}</td><td>{event.actorEmail || 'Platform Admin'}</td><td><code>{shortId(stringValue(event.detail.campaign_id))}</code></td></tr>)}{!notificationAudit.length ? <tr><td colSpan={6}><EmptyState title="No campaigns yet" body="Published merchant communications will appear here." /></td></tr> : null}</tbody></table></div></section>
    {confirmOpen ? <Modal title="Publish this notification?" onClose={() => setConfirmOpen(false)} actions={<><button className="workspace-button subtle" onClick={() => setConfirmOpen(false)} disabled={publishing}>Cancel</button><button className="workspace-button primary" onClick={() => void publish()} disabled={publishing}>{publishing ? 'Publishing…' : 'Publish notification'}</button></>}><p>This will create notifications for <strong>{selectedCount.toLocaleString()} SellerTray business{selectedCount === 1 ? '' : 'es'}</strong>.</p></Modal> : null}
  </PageFrame>;
}

function OperationsPage({ session, actorRole }: { session: Session; actorRole: AdminRole }) {
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [readiness, setReadiness] = useState<AiReadiness | null>(null);
  const [probe, setProbe] = useState<AiProbe | null>(null);
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadReadiness(); }, [session.access_token]);

  async function loadReadiness() {
    setLoading(true); setError(null);
    try {
      const result = await invokeJson<{ summary?: unknown; readiness?: unknown }>('platform-admin', { action: 'operations_summary' }, session);
      setSummary(normalizeOperationsSummary(result.summary));
      setReadiness(normalizeAiReadiness(result.readiness));
    } catch (cause) { setError(messageFrom(cause, 'Unable to load platform readiness.')); }
    finally { setLoading(false); }
  }

  async function runProbe() {
    setProbing(true); setError(null);
    try {
      const result = await invokeJson<{ probe?: unknown }>('platform-admin', { action: 'ai_parser_probe' }, session);
      setProbe(normalizeAiProbe(result.probe));
    } catch (cause) { setError(messageFrom(cause, 'Unable to run the AI parser probe.')); }
    finally { setProbing(false); }
  }

  return <PageFrame eyebrow="Platform Operations" title="Service health" description="Cross-merchant operational visibility and controlled diagnostics. Merchant business configuration remains in Merchant Web.">
    {error ? <div className="workspace-banner error">{error}</div> : null}
    <div className="workspace-grid two">
      <section className="workspace-panel"><PanelHeading title="WhatsApp estate" description="Connection-state supervision across SellerTray merchants." /><div className="workspace-stat-grid mini"><StatCard label="Connected" value={summary?.whatsappConnected ?? 0} detail="Merchant connections" /><StatCard label="Errors" value={summary?.whatsappErrors ?? 0} detail="Need ProcessEdge attention" /><StatCard label="Pending" value={summary?.whatsappPending ?? 0} detail="Connections in progress" /><StatCard label="Not connected" value={summary?.whatsappNotConnected ?? 0} detail="Merchant configuration" /></div></section>
      <section className="workspace-panel"><PanelHeading title="AI parser health" description="Server-side readiness and controlled diagnostics." action={<button className="workspace-button subtle compact" onClick={() => void loadReadiness()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>} />{readiness ? <div className="workspace-detail-grid"><Detail label="Configured" value={readiness.configured ? 'Yes' : 'No'} /><Detail label="Model" value={readiness.configuredModel || '—'} /><Detail label="Attempts" value={readiness.attempts.toLocaleString()} /><Detail label="Successful parses" value={readiness.successes.toLocaleString()} /><Detail label="Metered orders" value={readiness.meteredExternalOrderUnits.toLocaleString()} /><Detail label="Acceptance ready" value={readiness.productionAcceptanceReady ? 'Yes' : 'No'} /></div> : <EmptyState title="AI readiness unavailable" body="Refresh to retrieve current parser readiness." />}{actorRole === 'admin' ? <div className="workspace-operation-action"><button className="workspace-button primary" onClick={() => void runProbe()} disabled={probing}>{probing ? 'Running probe…' : 'Run controlled parser probe'}</button>{probe ? <span className={probe.ok ? 'workspace-inline-status success' : 'workspace-inline-status warning'}>{friendlyLabel(probe.status)}{probe.durationMs !== null ? ` · ${probe.durationMs}ms` : ''}</span> : null}</div> : <div className="workspace-banner warning">Platform Support can view readiness. Controlled probes remain restricted.</div>}</section>
    </div>
  </PageFrame>;
}

function AuditPage({ audit, onRefresh }: { audit: AuditEvent[]; onRefresh: () => Promise<void> }) {
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return audit;
    return audit.filter((event) => [event.action, event.actorEmail, JSON.stringify(event.detail)].some((value) => value.toLowerCase().includes(needle)));
  }, [audit, search]);
  async function refresh() { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } }
  return <PageFrame eyebrow="Governance" title="Audit log" description="Recent ProcessEdge administrator actions from the governed platform audit log.">
    <section className="workspace-panel"><div className="workspace-toolbar"><div className="workspace-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search action, actor or detail" /></div><button className="workspace-button subtle compact" onClick={() => void refresh()} disabled={refreshing}><Icon name="refresh" />{refreshing ? 'Refreshing…' : 'Refresh'}</button></div><div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Merchant / reference</th></tr></thead><tbody>{filtered.map((event) => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td><strong>{friendlyLabel(event.action)}</strong></td><td>{event.actorEmail || 'Platform administrator'}</td><td><code>{auditReference(event.detail)}</code></td></tr>)}{!filtered.length ? <tr><td colSpan={4}><EmptyState title="No audit events found" body="Adjust the search or refresh the audit log." /></td></tr> : null}</tbody></table></div></section>
  </PageFrame>;
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
    } catch (cause) { setError(messageFrom(cause, 'Unable to sign in.')); }
    finally { setBusy(false); }
  }
  return <div className="workspace-auth-shell"><section className="workspace-auth-brand"><img src={LOCAL_LOGO} alt="SellerTray" /><p className="workspace-eyebrow">ProcessEdge Operations</p><h1>SellerTray Admin</h1><p>Cross-tenant platform operations, commercial administration and governed merchant communications.</p><div className="workspace-security-note">Restricted ProcessEdge access · MFA required</div></section><form className="workspace-auth-card" onSubmit={submit}><div><p className="workspace-eyebrow">Restricted access</p><h2>Sign in</h2><p className="workspace-muted">Use your ProcessEdge platform administrator account.</p></div><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error ? <div className="workspace-banner error">{error}</div> : null}<button className="workspace-button primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Continue securely'}</button></form></div>;
}

function MfaChallenge({ factorId, onVerified, onSignOut }: { factorId: string; onVerified: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function verify(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (verifyError) throw verifyError;
      await supabase.auth.refreshSession();
      await onVerified();
    } catch (cause) { setError(messageFrom(cause, 'The MFA code could not be verified.')); }
    finally { setBusy(false); }
  }
  return <div className="workspace-center-shell"><form className="workspace-security-card" onSubmit={verify}><img src={LOCAL_LOGO} alt="SellerTray" /><p className="workspace-eyebrow">Second factor</p><h1>Verify MFA</h1><p className="workspace-muted">Enter the six-digit code from your authenticator app.</p><input className="workspace-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required />{error ? <div className="workspace-banner error">{error}</div> : null}<button className="workspace-button primary" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and continue'}</button><button className="workspace-button text" type="button" onClick={() => void onSignOut()}>Use another account</button></form></div>;
}

function MfaEnrollment({ enrollment, setEnrollment, onVerified, onSignOut }: { enrollment: Enrollment | null; setEnrollment: (value: Enrollment | null) => void; onVerified: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function beginEnrollment() {
    setBusy(true); setError(null);
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ProcessEdge SellerTray Admin' });
      if (enrollError) throw enrollError;
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch (cause) { setError(messageFrom(cause, 'Unable to start MFA setup.')); }
    finally { setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    setBusy(true); setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code: code.trim() });
      if (verifyError) throw verifyError;
      await supabase.auth.refreshSession();
      setEnrollment(null);
      await onVerified();
    } catch (cause) { setError(messageFrom(cause, 'The MFA code could not be verified.')); }
    finally { setBusy(false); }
  }
  return <div className="workspace-center-shell"><form className="workspace-security-card wide" onSubmit={verify}><img src={LOCAL_LOGO} alt="SellerTray" /><p className="workspace-eyebrow">Administrator protection</p><h1>Set up MFA</h1><p className="workspace-muted">SellerTray Admin requires a verified second factor before privileged platform operations are available.</p>{!enrollment ? <button className="workspace-button primary" type="button" onClick={() => void beginEnrollment()} disabled={busy}>{busy ? 'Preparing…' : 'Set up authenticator'}</button> : <><div className="workspace-enrollment-grid"><div className="workspace-qr"><img src={enrollment.qrCode} alt="Authenticator QR code" /></div><div><strong>Scan with your authenticator app</strong><p className="workspace-muted small">Manual setup key:</p><code>{enrollment.secret}</code></div></div><input className="workspace-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required /><button className="workspace-button primary" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify MFA'}</button></>}{error ? <div className="workspace-banner error">{error}</div> : null}<button className="workspace-button text" type="button" onClick={() => void onSignOut()}>Sign out</button></form></div>;
}

function StatusScreen({ title, body, error, onRetry }: { title: string; body: string; error?: string | null; onRetry?: () => Promise<void> }) {
  return <div className="workspace-center-shell"><section className="workspace-security-card"><img src={LOCAL_LOGO} alt="SellerTray" /><h1>{title}</h1><p className="workspace-muted">{body}</p>{error ? <div className="workspace-banner error">{error}</div> : null}{onRetry ? <button className="workspace-button primary" onClick={() => void onRetry()}>Retry</button> : null}</section></div>;
}

function PageFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <div className="workspace-page"><header className="workspace-page-header"><div><p className="workspace-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div></header>{children}</div>;
}
function PanelHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="workspace-panel-heading"><div><h2>{title}</h2><p>{description}</p></div>{action}</div>; }
function StatCard({ label, value, detail }: { label: string; value: string | number; detail: string }) { return <article className="workspace-stat-card"><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong><small>{detail}</small></article>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="workspace-detail"><span>{label}</span><strong>{value}</strong></div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="workspace-empty"><strong>{title}</strong><p>{body}</p></div>; }
function Modal({ title, children, actions, onClose }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void }) { return <div className="workspace-modal-backdrop" role="presentation" onClick={onClose}><div className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title" onClick={(event) => event.stopPropagation()}><div className="workspace-modal-header"><h2 id="workspace-modal-title">{title}</h2><button className="workspace-icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>{children}<div className="workspace-modal-actions">{actions}</div></div></div>; }

function Icon({ name }: { name: IconName }) {
  const path = (() => {
    switch (name) {
      case 'overview': return <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></>;
      case 'merchants': return <><path d="M4 20v-2a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v2" /><circle cx="9.5" cy="7" r="3" /><path d="M16 4.5a3 3 0 0 1 0 5.8M17 14a4 4 0 0 1 3 3.9V20" /></>;
      case 'commercial': return <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>;
      case 'setup': return <><path d="M4 7h16M6 7v12h12V7" /><path d="M9 4h6v6H9zM9 14h6" /></>;
      case 'communications': return <><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h6" /></>;
      case 'operations': return <><circle cx="12" cy="12" r="3" /><path d="M19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.5-1.5M5.5 18.5 7 17M17 17l1.5 1.5M5.5 5.5 7 7" /></>;
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

function routeFromHash(): AdminRoute {
  const raw = window.location.hash.replace(/^#/, '').split('?')[0];
  const aliases: Record<string, AdminRoute> = {
    overview: 'overview/dashboard',
    merchants: 'merchants/all',
    billing: 'commercial/orders',
    'commercial/core': 'commercial/orders',
    communications: 'communications/messages',
    operations: 'operations/health',
    audit: 'governance/audit',
    settings: 'overview/dashboard',
  };
  const candidate = aliases[raw] ?? raw;
  return ALL_ITEMS.some((item) => item.id === candidate) ? candidate as AdminRoute : 'overview/dashboard';
}
function tenantFromHash(): string | null { const value = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tenant'); return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null; }
function normalizeBootstrap(value: unknown): PlatformBootstrap { if (!isRecord(value)) throw new Error('Platform admin returned an invalid bootstrap response.'); const actorRole = value.actorRole === 'support' ? 'support' : value.actorRole === 'admin' ? 'admin' : null; if (!actorRole) throw new Error('This account is not configured for ProcessEdge platform administration.'); return { actorRole, generatedAt: stringValue(value.generatedAt), merchantCount: numberValue(value.merchantCount), legacyTrialRecords: numberValue(value.legacyTrialRecords) }; }
function normalizeOperationsSummary(value: unknown): OperationsSummary { if (!isRecord(value)) throw new Error('Platform operations returned an invalid summary.'); const whatsapp = isRecord(value.whatsapp) ? value.whatsapp : {}; return { merchantCount: numberValue(value.merchantCount), whatsappConnected: numberValue(whatsapp.connected), whatsappErrors: numberValue(whatsapp.errors), whatsappPending: numberValue(whatsapp.pending), whatsappNotConnected: numberValue(whatsapp.notConnected) }; }
function normalizeAudit(value: unknown): AuditEvent[] { const source = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.events) ? value.events : []; return source.filter(isRecord).map((event) => ({ id: stringValue(event.id) || crypto.randomUUID(), action: stringValue(event.action), detail: isRecord(event.detail) ? event.detail : {}, createdAt: stringValue(event.createdAt), actorEmail: stringValue(event.actorEmail) })); }
function normalizeAiReadiness(value: unknown): AiReadiness { if (!isRecord(value)) throw new Error('AI readiness returned an invalid response.'); const configuration = isRecord(value.configuration) ? value.configuration : {}; const period = isRecord(value.currentPeriod) ? value.currentPeriod : {}; const acceptance = isRecord(value.acceptanceEvidence) ? value.acceptanceEvidence : {}; return { configured: Boolean(value.configured), configuredModel: stringValue(configuration.configuredModel), attempts: numberValue(period.attempts), successes: numberValue(period.successes), nonSuccess: numberValue(period.nonSuccess), totalTokens: numberValue(period.totalTokens), meteredExternalOrderUnits: numberValue(period.meteredExternalOrderUnits), productionAcceptanceReady: Boolean(acceptance.productionAcceptanceReady), generatedAt: stringValue(value.generatedAt) }; }
function normalizeAiProbe(value: unknown): AiProbe { if (!isRecord(value)) throw new Error('AI parser probe returned an invalid response.'); return { ok: Boolean(value.ok), status: stringValue(value.status) || 'unknown', durationMs: nullableNumber(value.durationMs), httpStatus: nullableNumber(value.httpStatus), configuredModel: optionalString(value.configuredModel), structuredOutputValid: typeof value.structuredOutputValid === 'boolean' ? value.structuredOutputValid : null }; }
function auditReference(detail: Record<string, unknown>): string { return shortId(stringValue(detail.tenant_id) || stringValue(detail.tenantId) || stringValue(detail.campaign_id) || stringValue(detail.campaignId) || stringValue(detail.request_id) || stringValue(detail.requestId)); }
function friendlyLabel(value: string): string { if (!value) return 'Unknown'; return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()); }
function messageFrom(value: unknown, fallback: string): string { return value instanceof Error && value.message ? value.message : fallback; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function optionalString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function numberValue(value: unknown): number { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function nullableNumber(value: unknown): number | null { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : null; }
function shortId(value: string): string { return value ? `${value.slice(0, 8)}…` : '—'; }
function formatDate(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
