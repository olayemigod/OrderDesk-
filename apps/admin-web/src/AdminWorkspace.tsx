import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import BusinessDashboard from './BusinessDashboard';
import CommercialBillingAdministration, { type CommercialAdminTenant } from './CommercialBillingAdministration';
import { invokeJson, isRecord, supabase } from './supabase';

type SecurityState = 'checking' | 'needs_mfa' | 'needs_enroll' | 'ready';
type AdminRole = 'admin' | 'support';
type AdminSection = 'overview' | 'merchants' | 'billing' | 'communications' | 'operations' | 'audit' | 'settings';
type MessageType = 'update' | 'service' | 'information' | 'promotion';
type Severity = 'info' | 'attention' | 'urgent';
type MerchantRole = 'owner' | 'manager' | 'staff';

type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  businessEmail: string | null;
  businessPhone: string | null;
  subscriptionStatus: string;
  accessMode: string;
  whatsappStatus: string;
  planCode: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  orders30d: number;
  needsReview: number;
  teamCount: number;
  notificationExceptions: number;
  supportNote: string | null;
};

type PlatformOverview = {
  actorRole: AdminRole;
  generatedAt: string;
  tenants: TenantSummary[];
};

type AuditEvent = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
  actorEmail: string;
};

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type PublishResult = {
  ok?: boolean;
  campaignId?: string;
  notificationCount?: number;
};

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

const MESSAGE_LABELS: Record<MessageType, string> = {
  update: 'Product update',
  service: 'Service notice',
  information: 'Information',
  promotion: 'Promotion',
};

const ROLE_LABELS: Record<MerchantRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Cashier',
};

const DEFAULT_ROLES: MerchantRole[] = ['owner', 'manager', 'staff'];
const ACTION_URL_PATTERN = /^(https:\/\/[^\s]+|sellertray:\/\/[A-Za-z0-9/_?=&.%-]+)$/;
const LOCAL_LOGO = '/brand/sellertray-admin-logo.webp';

const NAV_ITEMS: Array<{ id: AdminSection; label: string; description: string; icon: IconName }> = [
  { id: 'overview', label: 'Overview', description: 'Business performance', icon: 'overview' },
  { id: 'merchants', label: 'Merchants', description: 'Businesses', icon: 'merchants' },
  { id: 'billing', label: 'Billing & Commercial', description: 'Plans and agreements', icon: 'billing' },
  { id: 'communications', label: 'Communications', description: 'Merchant messages', icon: 'communications' },
  { id: 'operations', label: 'Platform Operations', description: 'Service health', icon: 'operations' },
  { id: 'audit', label: 'Audit', description: 'Privileged activity', icon: 'audit' },
  { id: 'settings', label: 'Settings', description: 'Platform settings', icon: 'settings' },
];

type IconName = 'overview' | 'merchants' | 'billing' | 'communications' | 'operations' | 'audit' | 'settings' | 'menu' | 'close' | 'refresh' | 'search';

export default function AdminWorkspace() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [securityState, setSecurityState] = useState<SecurityState>('checking');
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
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
      setOverview(null);
      setAudit([]);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
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
      if (aal.currentLevel === 'aal2') {
        setSecurityState('ready');
        return;
      }

      const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) throw factorError;
      const verified = factors.totp.find((factor) => factor.status === 'verified');
      if (verified) {
        setVerifiedFactorId(verified.id);
        setSecurityState('needs_mfa');
      } else {
        setVerifiedFactorId(null);
        setSecurityState('needs_enroll');
      }
    } catch (error) {
      setPortalError(messageFrom(error, 'Unable to verify the administrator security level.'));
    }
  }

  async function loadPortal() {
    if (!session) return;
    setPortalError(null);
    try {
      const [overviewResult, auditResult] = await Promise.all([
        invokeJson<{ overview?: unknown }>('platform-admin', { action: 'overview' }, session),
        invokeJson<{ audit?: unknown }>('platform-admin', { action: 'audit', tenantId: null, limit: 100 }, session),
      ]);
      setOverview(normalizeOverview(overviewResult.overview));
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

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (booting) return <StatusScreen title="Opening SellerTray Admin" body="Checking your ProcessEdge administrator session…" />;
  if (!session) return <LoginScreen />;
  if (securityState === 'checking') return <StatusScreen title="Verifying administrator security" body="SellerTray Admin requires MFA for privileged platform access." error={portalError} />;
  if (securityState === 'needs_mfa' && verifiedFactorId) {
    return <MfaChallenge factorId={verifiedFactorId} onVerified={assessSecurity} onSignOut={signOut} />;
  }
  if (securityState === 'needs_enroll') {
    return <MfaEnrollment enrollment={enrollment} setEnrollment={setEnrollment} onVerified={assessSecurity} onSignOut={signOut} />;
  }
  if (!overview) return <StatusScreen title="Loading SellerTray Admin" body="Retrieving businesses, platform health and recent administrator activity…" error={portalError} onRetry={loadPortal} />;

  return (
    <WorkspaceShell
      session={session}
      overview={overview}
      audit={audit}
      onReload={loadPortal}
      onAuditRefresh={refreshAudit}
      onSignOut={signOut}
    />
  );
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
    } catch (err) {
      setError(messageFrom(err, 'Unable to sign in.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-auth-shell">
      <section className="workspace-auth-brand">
        <img src={LOCAL_LOGO} alt="SellerTray" />
        <p className="workspace-eyebrow">ProcessEdge Operations</p>
        <h1>SellerTray Admin</h1>
        <p>Cross-tenant platform operations, commercial administration and governed merchant communications.</p>
        <div className="workspace-security-note">Restricted ProcessEdge access · MFA required</div>
      </section>
      <form className="workspace-auth-card" onSubmit={submit}>
        <div>
          <p className="workspace-eyebrow">Restricted access</p>
          <h2>Sign in</h2>
          <p className="workspace-muted">Use your ProcessEdge platform administrator account.</p>
        </div>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error ? <div className="workspace-banner error">{error}</div> : null}
        <button className="workspace-button primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Continue securely'}</button>
      </form>
    </div>
  );
}

function MfaChallenge({ factorId, onVerified, onSignOut }: { factorId: string; onVerified: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (verifyError) throw verifyError;
      await supabase.auth.refreshSession();
      await onVerified();
    } catch (err) {
      setError(messageFrom(err, 'The MFA code could not be verified.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-center-shell">
      <form className="workspace-security-card" onSubmit={verify}>
        <img src={LOCAL_LOGO} alt="SellerTray" />
        <p className="workspace-eyebrow">Second factor</p>
        <h1>Verify MFA</h1>
        <p className="workspace-muted">Enter the six-digit code from your authenticator app.</p>
        <input className="workspace-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required />
        {error ? <div className="workspace-banner error">{error}</div> : null}
        <button className="workspace-button primary" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and continue'}</button>
        <button className="workspace-button text" type="button" onClick={() => void onSignOut()}>Use another account</button>
      </form>
    </div>
  );
}

function MfaEnrollment({ enrollment, setEnrollment, onVerified, onSignOut }: { enrollment: Enrollment | null; setEnrollment: (value: Enrollment | null) => void; onVerified: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function beginEnrollment() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ProcessEdge SellerTray Admin' });
      if (enrollError) throw enrollError;
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      setError(messageFrom(err, 'Unable to start MFA setup.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code: code.trim() });
      if (verifyError) throw verifyError;
      await supabase.auth.refreshSession();
      setEnrollment(null);
      await onVerified();
    } catch (err) {
      setError(messageFrom(err, 'The MFA code could not be verified.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-center-shell">
      <form className="workspace-security-card wide" onSubmit={verify}>
        <img src={LOCAL_LOGO} alt="SellerTray" />
        <p className="workspace-eyebrow">Administrator protection</p>
        <h1>Set up MFA</h1>
        <p className="workspace-muted">SellerTray Admin requires a verified second factor before privileged platform operations are available.</p>
        {!enrollment ? (
          <button className="workspace-button primary" type="button" onClick={() => void beginEnrollment()} disabled={busy}>{busy ? 'Preparing…' : 'Set up authenticator'}</button>
        ) : (
          <>
            <div className="workspace-enrollment-grid">
              <div className="workspace-qr"><img src={enrollment.qrCode} alt="Authenticator QR code" /></div>
              <div><strong>Scan with your authenticator app</strong><p className="workspace-muted small">Manual setup key:</p><code>{enrollment.secret}</code></div>
            </div>
            <input className="workspace-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required />
            <button className="workspace-button primary" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify MFA'}</button>
          </>
        )}
        {error ? <div className="workspace-banner error">{error}</div> : null}
        <button className="workspace-button text" type="button" onClick={() => void onSignOut()}>Sign out</button>
      </form>
    </div>
  );
}

function WorkspaceShell({ session, overview, audit, onReload, onAuditRefresh, onSignOut }: { session: Session; overview: PlatformOverview; audit: AuditEvent[]; onReload: () => Promise<void>; onAuditRefresh: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [section, setSection] = useState<AdminSection>(() => sectionFromHash());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const handleHashChange = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  async function refreshAll() {
    setRefreshing(true);
    try { await onReload(); } finally { setRefreshing(false); }
  }

  const page = (() => {
    switch (section) {
      case 'overview': return <BusinessDashboard session={session} refreshKey={overview.generatedAt} />;
      case 'merchants': return <MerchantsPage overview={overview} />;
      case 'billing': return <BillingPage session={session} overview={overview} />;
      case 'communications': return <CommunicationsPage session={session} overview={overview} audit={audit} onAuditRefresh={onAuditRefresh} />;
      case 'operations': return <OperationsPage session={session} overview={overview} />;
      case 'audit': return <AuditPage audit={audit} onRefresh={onAuditRefresh} />;
      case 'settings': return <SettingsPage />;
    }
  })();

  function navigateTo(next: AdminSection) {
    window.location.hash = next;
    setSection(next);
    setMobileNavOpen(false);
  }

  return (
    <div className="workspace-app-shell">
      <aside className={mobileNavOpen ? 'workspace-sidebar open' : 'workspace-sidebar'} aria-label="SellerTray Admin navigation">
        <div className="workspace-sidebar-brand">
          <img src={LOCAL_LOGO} alt="SellerTray" />
          <div><strong>SellerTray Admin</strong><span>ProcessEdge</span></div>
          <button className="workspace-icon-button mobile-only" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><Icon name="close" /></button>
        </div>
        <nav className="workspace-nav">
          {NAV_ITEMS.map((item) => (
            <a key={item.id} href={`#${item.id}`} className={section === item.id ? 'workspace-nav-link active' : 'workspace-nav-link'} onClick={(event) => { event.preventDefault(); navigateTo(item.id); }}>
              <span className="workspace-nav-icon"><Icon name={item.icon} /></span>
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
            </a>
          ))}
        </nav>
        <div className="workspace-sidebar-footer">
          <span className="workspace-role-badge">{overview.actorRole === 'admin' ? 'Platform Admin' : 'Platform Support'}</span>
          <strong>{session.user.email ?? 'Administrator'}</strong>
          <button className="workspace-button subtle" onClick={() => void onSignOut()}>Sign out</button>
        </div>
      </aside>
      {mobileNavOpen ? <button className="workspace-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}

      <div className="workspace-main-shell">
        <header className="workspace-topbar">
          <button className="workspace-icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Icon name="menu" /></button>
          <div className="workspace-topbar-title"><strong>{NAV_ITEMS.find((item) => item.id === section)?.label}</strong><span>ProcessEdge platform operations</span></div>
          <div className="workspace-topbar-actions">
            <span className="workspace-generated">Updated {formatDate(overview.generatedAt)}</span>
            <button className="workspace-button subtle compact" onClick={() => void refreshAll()} disabled={refreshing}><Icon name="refresh" />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </header>
        <main className="workspace-content">{page}</main>
      </div>
    </div>
  );
}

function MerchantsPage({ overview }: { overview: PlatformOverview }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention' | 'connected' | 'restricted'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(() => merchantFromHash());
  useEffect(() => {
    const update = () => setSelectedId(merchantFromHash());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return overview.tenants.filter((tenant) => {
      const matchesSearch = !needle || [tenant.name, tenant.slug, tenant.businessEmail ?? '', tenant.businessPhone ?? '', tenant.subscriptionStatus, tenant.whatsappStatus, tenant.planCode ?? ''].some((value) => value.toLowerCase().includes(needle));
      if (!matchesSearch) return false;
      if (filter === 'attention') return needsPlatformAttention(tenant);
      if (filter === 'connected') return tenant.whatsappStatus === 'connected';
      if (filter === 'restricted') return tenant.accessMode !== 'full';
      return true;
    });
  }, [overview.tenants, search, filter]);

  const selected = overview.tenants.find((tenant) => tenant.id === selectedId) ?? null;

  return (
    <PageFrame eyebrow="Merchants" title="SellerTray businesses" description="Cross-tenant merchant discovery and platform-level status. Business operations remain in Merchant Web.">
      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div className="workspace-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search business, email, phone, plan or status" /></div>
          <div className="workspace-filter-row">
            {([['all', 'All'], ['attention', 'Needs attention'], ['connected', 'WhatsApp connected'], ['restricted', 'Restricted access']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'workspace-filter active' : 'workspace-filter'} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
        </div>
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead><tr><th>Business</th><th>Plan</th><th>Access state</th><th>WhatsApp</th><th>Orders 30d</th><th>Attention</th></tr></thead>
            <tbody>
              {filtered.map((tenant) => (
                <tr key={tenant.id} className="workspace-clickable-row" onClick={() => setSelectedId(tenant.id)}>
                  <td><strong>{tenant.name}</strong><small>{tenant.businessEmail ?? tenant.businessPhone ?? tenant.slug}</small></td>
                  <td>{tenant.planCode ?? '—'}</td>
                  <td><StatusPill value={tenant.subscriptionStatus} /> <small>{friendlyAccess(tenant.accessMode)}</small></td>
                  <td><StatusPill value={tenant.whatsappStatus} /></td>
                  <td>{tenant.orders30d.toLocaleString()}</td>
                  <td>{tenant.needsReview ? `${tenant.needsReview} review` : needsPlatformAttention(tenant) ? 'Check' : 'Clear'}</td>
                </tr>
              ))}
              {!filtered.length ? <tr><td colSpan={6}><EmptyState title="No merchants found" body="Adjust the search or filters." /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      {selected ? <MerchantSummaryDrawer tenant={selected} onClose={() => setSelectedId(null)} /> : null}
    </PageFrame>
  );
}

function MerchantSummaryDrawer({ tenant, onClose }: { tenant: TenantSummary; onClose: () => void }) {
  return (
    <div className="workspace-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="workspace-drawer" role="dialog" aria-modal="true" aria-labelledby="merchant-summary-title" onClick={(event) => event.stopPropagation()}>
        <div className="workspace-drawer-header"><div><p className="workspace-eyebrow">Merchant summary</p><h2 id="merchant-summary-title">{tenant.name}</h2><p>{tenant.businessEmail ?? tenant.businessPhone ?? tenant.slug}</p></div><button className="workspace-icon-button" aria-label="Close merchant summary" onClick={onClose}><Icon name="close" /></button></div>
        <div className="workspace-detail-grid">
          <Detail label="Plan" value={tenant.planCode ?? 'Not assigned'} />
          <Detail label="Subscription state" value={friendlyLabel(tenant.subscriptionStatus)} />
          <Detail label="Access" value={friendlyAccess(tenant.accessMode)} />
          <Detail label="WhatsApp" value={friendlyLabel(tenant.whatsappStatus)} />
          <Detail label="Orders (30 days)" value={tenant.orders30d.toLocaleString()} />
          <Detail label="Review items" value={tenant.needsReview.toLocaleString()} />
          <Detail label="Team" value={tenant.teamCount ? tenant.teamCount.toLocaleString() : '—'} />
          <Detail label="Current period end" value={formatDate(tenant.currentPeriodEnd)} />
        </div>
        <div className="workspace-banner info">Commercial setup, agreements and installment entitlement are managed through governed commands in Billing & Commercial. This merchant summary remains read-only.</div>
      </aside>
    </div>
  );
}

function BillingPage({ session, overview }: { session: Session; overview: PlatformOverview }) {
  const legacyTrialCount = overview.tenants.filter((tenant) => tenant.subscriptionStatus === 'trial').length;
  const tenants: CommercialAdminTenant[] = overview.tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    businessEmail: tenant.businessEmail,
    businessPhone: tenant.businessPhone,
    slug: tenant.slug,
    planCode: tenant.planCode,
    subscriptionStatus: tenant.subscriptionStatus,
  }));

  return (
    <PageFrame eyebrow="Billing & Commercial" title="Commercial administration" description="Governed SellerTray commercial operations for agreements, Branch setup readiness, installment payment state and entitlement release.">
      <div className="workspace-banner info"><strong>No free trial.</strong> C1B uses governed paid commercial facts. Payment confirmation, agreement acceptance, Branch setup readiness and subscription entitlement remain separate authorities.</div>
      {legacyTrialCount ? <div className="workspace-banner warning"><strong>{legacyTrialCount} legacy record{legacyTrialCount === 1 ? '' : 's'} still report trial status.</strong> These remain compatibility data until the deliberate C2 migration and are not a current SellerTray offer.</div> : null}
      <CommercialBillingAdministration session={session} actorRole={overview.actorRole} tenants={tenants} />
    </PageFrame>
  );
}

function CommunicationsPage({ session, overview, audit, onAuditRefresh }: { session: Session; overview: PlatformOverview; audit: AuditEvent[]; onAuditRefresh: () => Promise<void> }) {
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
  const [search, setSearch] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canPublish = overview.actorRole === 'admin';
  const filteredTenants = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return overview.tenants;
    return overview.tenants.filter((tenant) => [tenant.name, tenant.slug, tenant.businessEmail ?? '', tenant.businessPhone ?? '', tenant.subscriptionStatus, tenant.whatsappStatus].some((value) => value.toLowerCase().includes(needle)));
  }, [overview.tenants, search]);
  const notificationAudit = useMemo(() => audit.filter((event) => event.action === 'merchant_message_published'), [audit]);
  const selectedCount = allBusinesses ? overview.tenants.length : selectedTenantIds.size;
  const roleList = Array.from(audienceRoles);

  function toggleTenant(id: string) {
    setSelectedTenantIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleRole(role: MerchantRole) {
    setAudienceRoles((current) => {
      const next = new Set(current);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  }

  function validate(): string | null {
    if (!canPublish) return 'Only a ProcessEdge Platform Admin can publish merchant messages.';
    if (!title.trim() || title.trim().length > 160) return 'Enter a title between 1 and 160 characters.';
    if (!body.trim() || body.trim().length > 1000) return 'Enter a message between 1 and 1000 characters.';
    if (audienceRoles.size === 0) return 'Select at least one merchant role.';
    if (!allBusinesses && selectedTenantIds.size === 0) return 'Select at least one SellerTray business.';
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
    } catch (err) {
      setError(messageFrom(err, 'Unable to publish this merchant message.'));
      setConfirmOpen(false);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <PageFrame eyebrow="Communications" title="Merchant communications" description="Publish governed platform updates, service notices, information and promotions to SellerTray merchants.">
      {!canPublish ? <div className="workspace-banner warning">Platform Support accounts can review campaigns but only Platform Admin accounts can publish.</div> : null}
      {success ? <div className="workspace-banner success">{success}</div> : null}
      {error ? <div className="workspace-banner error">{error}</div> : null}
      <div className="workspace-grid two composer">
        <section className="workspace-panel workspace-form-stack">
          <PanelHeading title="Compose message" description="Merchant-facing notification content." />
          <div className="workspace-field-grid two"><label>Message type<select value={messageType} onChange={(event) => { const next = event.target.value as MessageType; setMessageType(next); if (next === 'promotion' && severity === 'urgent') setSeverity('attention'); }}>{Object.entries(MESSAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Priority<select value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}><option value="info">Normal</option><option value="attention">Attention</option><option value="urgent" disabled={messageType === 'promotion'}>Urgent</option></select></label></div>
          <label>Title <span className="workspace-counter">{title.trim().length}/160</span><input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 160))} placeholder="What should merchants know?" /></label>
          <label>Message <span className="workspace-counter">{body.trim().length}/1000</span><textarea value={body} onChange={(event) => setBody(event.target.value.slice(0, 1000))} rows={7} placeholder="Write a clear message and action, if any." /></label>
          <div className="workspace-field-grid two"><label>CTA label <span className="workspace-optional">Optional</span><input value={actionLabel} onChange={(event) => setActionLabel(event.target.value.slice(0, 60))} placeholder="Open SellerTray" /></label><label>CTA link <span className="workspace-optional">Optional</span><input value={actionUrl} onChange={(event) => setActionUrl(event.target.value)} placeholder="sellertray://notifications or https://…" /></label></div>
          <label>Expiry <span className="workspace-optional">Optional</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        </section>
        <aside className="workspace-panel">
          <PanelHeading title="Merchant preview" description="Approximate SellerTray notification appearance." />
          <div className={`workspace-notification-preview severity-${severity}`}><div className="workspace-preview-meta"><span>{MESSAGE_LABELS[messageType]}</span><span>{friendlyLabel(severity)}</span></div><h3>{title.trim() || 'Your notification title'}</h3><p>{body.trim() || 'Your merchant message will appear here.'}</p>{actionLabel.trim() ? <button type="button" className="workspace-preview-cta">{actionLabel.trim()}</button> : null}<small>ProcessEdge · just now</small></div>
          <div className="workspace-preview-facts"><Detail label="Target" value={allBusinesses ? 'All businesses' : `${selectedTenantIds.size} selected`} /><Detail label="Roles" value={roleList.map((role) => ROLE_LABELS[role]).join(', ') || 'None'} /><Detail label="Delivery" value="Inbox + push queue" /></div>
        </aside>
      </div>
      <section className="workspace-panel">
        <PanelHeading title="Audience" description="Choose businesses and merchant roles." />
        <div className="workspace-filter-row"><button className={allBusinesses ? 'workspace-filter active' : 'workspace-filter'} onClick={() => setAllBusinesses(true)}>All businesses</button><button className={!allBusinesses ? 'workspace-filter active' : 'workspace-filter'} onClick={() => setAllBusinesses(false)}>Selected businesses</button></div>
        <div className="workspace-role-row">{DEFAULT_ROLES.map((role) => <label className="workspace-check-pill" key={role}><input type="checkbox" checked={audienceRoles.has(role)} onChange={() => toggleRole(role)} />{ROLE_LABELS[role]}</label>)}</div>
        {!allBusinesses ? <div className="workspace-tenant-selector"><div className="workspace-toolbar"><div className="workspace-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search business, email, phone or status" /></div><div className="workspace-filter-row"><button className="workspace-button subtle compact" onClick={() => setSelectedTenantIds(new Set(filteredTenants.map((tenant) => tenant.id)))}>Select visible</button><button className="workspace-button subtle compact" onClick={() => setSelectedTenantIds(new Set())}>Clear</button></div></div><div className="workspace-tenant-list">{filteredTenants.map((tenant) => { const selected = selectedTenantIds.has(tenant.id); return <button key={tenant.id} type="button" className={selected ? 'workspace-tenant-row selected' : 'workspace-tenant-row'} onClick={() => toggleTenant(tenant.id)}><span className="workspace-tenant-check">{selected ? '✓' : ''}</span><span><strong>{tenant.name}</strong><small>{tenant.businessEmail ?? tenant.businessPhone ?? tenant.slug}</small></span><StatusPill value={tenant.subscriptionStatus} /><StatusPill value={tenant.whatsappStatus} /></button>; })}{!filteredTenants.length ? <EmptyState title="No businesses found" body="Adjust the search." /> : null}</div></div> : null}
        <div className="workspace-publish-bar"><div><strong>{selectedCount.toLocaleString()} business{selectedCount === 1 ? '' : 'es'}</strong><span>{roleList.length} selected role{roleList.length === 1 ? '' : 's'}</span></div><button className="workspace-button primary" disabled={!canPublish || publishing} onClick={requestPublish}>Review & publish</button></div>
      </section>
      <section className="workspace-panel">
        <PanelHeading title="Recent campaigns" description="Audited merchant-message publications." />
        <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Published</th><th>Type</th><th>Priority</th><th>Businesses</th><th>Actor</th><th>Campaign</th></tr></thead><tbody>{notificationAudit.slice(0, 20).map((event) => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td>{MESSAGE_LABELS[stringValue(event.detail.message_type) as MessageType] ?? friendlyLabel(stringValue(event.detail.message_type))}</td><td>{friendlyLabel(stringValue(event.detail.severity))}</td><td>{numberValue(event.detail.notification_count).toLocaleString()}</td><td>{event.actorEmail || 'Platform Admin'}</td><td><code>{shortId(stringValue(event.detail.campaign_id))}</code></td></tr>)}{!notificationAudit.length ? <tr><td colSpan={6}><EmptyState title="No campaigns yet" body="Published merchant communications will appear here." /></td></tr> : null}</tbody></table></div>
      </section>
      {confirmOpen ? <Modal title="Publish this notification?" onClose={() => setConfirmOpen(false)} actions={<><button className="workspace-button subtle" onClick={() => setConfirmOpen(false)} disabled={publishing}>Cancel</button><button className="workspace-button primary" onClick={() => void publish()} disabled={publishing}>{publishing ? 'Publishing…' : 'Publish notification'}</button></>}><p>This will create notifications for <strong>{selectedCount.toLocaleString()} SellerTray business{selectedCount === 1 ? '' : 'es'}</strong> and queue push delivery for eligible users.</p><div className="workspace-confirm-summary"><strong>{title.trim()}</strong><span>{MESSAGE_LABELS[messageType]} · {friendlyLabel(severity)}</span><span>{roleList.map((role) => ROLE_LABELS[role]).join(', ')}</span></div></Modal> : null}
    </PageFrame>
  );
}

function OperationsPage({ session, overview }: { session: Session; overview: PlatformOverview }) {
  const [readiness, setReadiness] = useState<AiReadiness | null>(null);
  const [probe, setProbe] = useState<AiProbe | null>(null);
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadReadiness(); }, [session.access_token]);

  async function loadReadiness() {
    setLoading(true); setError(null);
    try { const result = await invokeJson<{ readiness?: unknown }>('platform-admin', { action: 'ai_parser_readiness' }, session); setReadiness(normalizeAiReadiness(result.readiness)); }
    catch (err) { setError(messageFrom(err, 'Unable to load AI parser readiness.')); }
    finally { setLoading(false); }
  }

  async function runProbe() {
    setProbing(true); setError(null);
    try { const result = await invokeJson<{ probe?: unknown }>('platform-admin', { action: 'ai_parser_probe' }, session); setProbe(normalizeAiProbe(result.probe)); }
    catch (err) { setError(messageFrom(err, 'Unable to run the AI parser probe.')); }
    finally { setProbing(false); }
  }

  const connected = overview.tenants.filter((tenant) => tenant.whatsappStatus === 'connected').length;
  const waErrors = overview.tenants.filter((tenant) => tenant.whatsappStatus === 'error').length;

  return (
    <PageFrame eyebrow="Platform Operations" title="Service health" description="Governed operational visibility and controlled diagnostics for SellerTray platform services.">
      {error ? <div className="workspace-banner error">{error}</div> : null}
      <div className="workspace-grid two">
        <section className="workspace-panel"><PanelHeading title="WhatsApp estate" description="Cross-merchant connection state from the governed platform overview." /><div className="workspace-stat-grid mini"><StatCard label="Connected" value={connected} detail="Merchant connections" /><StatCard label="Errors" value={waErrors} detail="Need ProcessEdge attention" /></div><div className="workspace-banner info">Connection configuration remains merchant-owned where appropriate. Admin Web supervises platform health; it is not a substitute for Merchant Web setup.</div></section>
        <section className="workspace-panel"><PanelHeading title="AI parser health" description="Server-side readiness and controlled parser diagnostics." action={<button className="workspace-button subtle compact" onClick={() => void loadReadiness()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>} />{readiness ? <div className="workspace-detail-grid"><Detail label="Configured" value={readiness.configured ? 'Yes' : 'No'} /><Detail label="Model" value={readiness.configuredModel || '—'} /><Detail label="Attempts" value={readiness.attempts.toLocaleString()} /><Detail label="Successful parses" value={readiness.successes.toLocaleString()} /><Detail label="Metered orders" value={readiness.meteredExternalOrderUnits.toLocaleString()} /><Detail label="Acceptance ready" value={readiness.productionAcceptanceReady ? 'Yes' : 'No'} /></div> : <EmptyState title="AI readiness unavailable" body="Refresh to retrieve current parser readiness." />}{overview.actorRole === 'admin' ? <div className="workspace-operation-action"><button className="workspace-button primary" onClick={() => void runProbe()} disabled={probing}>{probing ? 'Running probe…' : 'Run controlled parser probe'}</button>{probe ? <span className={probe.ok ? 'workspace-inline-status success' : 'workspace-inline-status warning'}>{friendlyLabel(probe.status)}{probe.durationMs !== null ? ` · ${probe.durationMs}ms` : ''}</span> : null}</div> : <div className="workspace-banner warning">Platform Support can view readiness. Controlled probes require Platform Admin.</div>}</section>
      </div>
    </PageFrame>
  );
}

function AuditPage({ audit, onRefresh }: { audit: AuditEvent[]; onRefresh: () => Promise<void> }) {
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const filtered = useMemo(() => { const needle = search.trim().toLowerCase(); if (!needle) return audit; return audit.filter((event) => [event.action, event.actorEmail, JSON.stringify(event.detail)].some((value) => value.toLowerCase().includes(needle))); }, [audit, search]);
  async function refresh() { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } }
  return (
    <PageFrame eyebrow="Audit" title="Privileged activity" description="Recent ProcessEdge administrator actions from the governed platform audit log.">
      <section className="workspace-panel"><div className="workspace-toolbar"><div className="workspace-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search action, actor or detail" /></div><button className="workspace-button subtle compact" onClick={() => void refresh()} disabled={refreshing}><Icon name="refresh" />{refreshing ? 'Refreshing…' : 'Refresh'}</button></div><div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Merchant / reference</th></tr></thead><tbody>{filtered.map((event) => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td><strong>{friendlyLabel(event.action)}</strong></td><td>{event.actorEmail || 'Platform administrator'}</td><td><code>{auditReference(event.detail)}</code></td></tr>)}{!filtered.length ? <tr><td colSpan={4}><EmptyState title="No audit events found" body="Adjust the search or refresh the audit log." /></td></tr> : null}</tbody></table></div></section>
    </PageFrame>
  );
}

function SettingsPage() {
  return <PageFrame eyebrow="Settings" title="Platform settings" description="Only true SellerTray platform configuration belongs here."><section className="workspace-panel"><EmptyState title="No platform settings exposed in A1" body="Configuration will be added only when a governed platform-level setting exists. Merchant business configuration remains in Merchant Web." /></section></PageFrame>;
}

function PageFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <div className="workspace-page"><header className="workspace-page-header"><div><p className="workspace-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div></header>{children}</div>;
}

function PanelHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="workspace-panel-heading"><div><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

function StatCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="workspace-stat-card"><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong><small>{detail}</small></article>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="workspace-detail"><span>{label}</span><strong>{value}</strong></div>;
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = ['active', 'connected', 'full', 'paid'].includes(normalized) ? 'good' : ['error', 'suspended', 'cancelled', 'past_due'].includes(normalized) ? 'bad' : ['pending', 'grace', 'trial'].includes(normalized) ? 'warn' : 'neutral';
  return <span className={`workspace-status-pill ${tone}`}>{friendlyLabel(value)}</span>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="workspace-empty"><strong>{title}</strong><p>{body}</p></div>;
}

function Modal({ title, children, actions, onClose }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void }) {
  return <div className="workspace-modal-backdrop" role="presentation" onClick={onClose}><div className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title" onClick={(event) => event.stopPropagation()}><div className="workspace-modal-header"><h2 id="workspace-modal-title">{title}</h2><button className="workspace-icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>{children}<div className="workspace-modal-actions">{actions}</div></div></div>;
}

function StatusScreen({ title, body, error, onRetry }: { title: string; body: string; error?: string | null; onRetry?: () => Promise<void> }) {
  return <div className="workspace-center-shell"><div className="workspace-security-card"><img src={LOCAL_LOGO} alt="SellerTray" /><p className="workspace-eyebrow">SellerTray Admin</p><h1>{title}</h1><p className="workspace-muted">{body}</p>{error ? <div className="workspace-banner error">{error}</div> : null}{onRetry ? <button className="workspace-button primary" onClick={() => void onRetry()}>Try again</button> : <div className="workspace-loader" />}</div></div>;
}

function Icon({ name }: { name: IconName }) {
  const path = (() => {
    switch (name) {
      case 'overview': return <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></>;
      case 'merchants': return <><path d="M4 20v-2a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v2" /><circle cx="9.5" cy="7" r="3" /><path d="M16 4.5a3 3 0 0 1 0 5.8M17 14a4 4 0 0 1 3 3.9V20" /></>;
      case 'billing': return <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>;
      case 'communications': return <><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h6" /></>;
      case 'operations': return <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>;
      case 'audit': return <><path d="M6 3h12v18H6z" /><path d="M9 7h6M9 11h6M9 15h4" /></>;
      case 'settings': return <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7a6 6 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a6 6 0 0 0-1.7-.7L10.5 2h-3l-.7 2a6 6 0 0 0-1.7.7l-1.9-.9L1.1 6l.9 1.9a6 6 0 0 0-.7 1.7l-2 .7v3l2 .7a6 6 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a6 6 0 0 0 1.7.7l.7 2h3l.7-2a6 6 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a6 6 0 0 0 .7-1.7z" transform="translate(3 0) scale(.75)" /></>;
      case 'menu': return <path d="M4 7h16M4 12h16M4 17h16" />;
      case 'close': return <path d="M6 6l12 12M18 6 6 18" />;
      case 'refresh': return <><path d="M20 6v5h-5" /><path d="M18.5 9A7 7 0 1 0 19 15" /></>;
      case 'search': return <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>;
    }
  })();
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{path}</svg>;
}

function sectionFromHash(): AdminSection {
  const raw = window.location.hash.replace(/^#/, '').split('?')[0] as AdminSection;
  return NAV_ITEMS.some((item) => item.id === raw) ? raw : 'overview';
}

function needsPlatformAttention(tenant: TenantSummary): boolean {
  return tenant.whatsappStatus === 'error' || tenant.accessMode !== 'full' || ['past_due', 'grace', 'suspended', 'cancelled'].includes(tenant.subscriptionStatus) || tenant.needsReview > 0 || tenant.notificationExceptions > 0;
}

function normalizeOverview(value: unknown): PlatformOverview {
  if (!isRecord(value)) throw new Error('Platform admin returned an invalid overview.');
  const actorRole = value.actorRole === 'support' ? 'support' : value.actorRole === 'admin' ? 'admin' : null;
  if (!actorRole) throw new Error('This account is not configured for ProcessEdge platform administration.');
  const tenants = Array.isArray(value.tenants) ? value.tenants.filter(isRecord).map((tenant) => ({
    id: stringValue(tenant.id),
    name: stringValue(tenant.name) || 'Unnamed business',
    slug: stringValue(tenant.slug),
    businessEmail: optionalString(tenant.businessEmail),
    businessPhone: optionalString(tenant.businessPhone),
    subscriptionStatus: stringValue(tenant.subscriptionStatus) || 'unknown',
    accessMode: stringValue(tenant.accessMode) || 'unknown',
    whatsappStatus: stringValue(tenant.whatsappStatus) || 'not_connected',
    planCode: optionalString(tenant.planCode),
    currentPeriodEnd: optionalString(tenant.currentPeriodEnd),
    graceEndsAt: optionalString(tenant.graceEndsAt),
    orders30d: numberValue(tenant.orders30d),
    needsReview: numberValue(tenant.needsReview),
    teamCount: numberValue(tenant.teamCount),
    notificationExceptions: numberValue(tenant.notificationExceptions),
    supportNote: optionalString(tenant.supportNote),
  })).filter((tenant) => tenant.id) : [];
  return { actorRole, generatedAt: stringValue(value.generatedAt), tenants };
}

function normalizeAudit(value: unknown): AuditEvent[] {
  const source = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.events) ? value.events : [];
  return source.filter(isRecord).map((event) => ({ id: stringValue(event.id) || crypto.randomUUID(), action: stringValue(event.action), detail: isRecord(event.detail) ? event.detail : {}, createdAt: stringValue(event.createdAt), actorEmail: stringValue(event.actorEmail) }));
}

function normalizeAiReadiness(value: unknown): AiReadiness {
  if (!isRecord(value)) throw new Error('AI readiness returned an invalid response.');
  const configuration = isRecord(value.configuration) ? value.configuration : {};
  const period = isRecord(value.currentPeriod) ? value.currentPeriod : {};
  const acceptance = isRecord(value.acceptanceEvidence) ? value.acceptanceEvidence : {};
  return { configured: Boolean(value.configured), configuredModel: stringValue(configuration.configuredModel), attempts: numberValue(period.attempts), successes: numberValue(period.successes), nonSuccess: numberValue(period.nonSuccess), totalTokens: numberValue(period.totalTokens), meteredExternalOrderUnits: numberValue(period.meteredExternalOrderUnits), productionAcceptanceReady: Boolean(acceptance.productionAcceptanceReady), generatedAt: stringValue(value.generatedAt) };
}

function normalizeAiProbe(value: unknown): AiProbe {
  if (!isRecord(value)) throw new Error('AI parser probe returned an invalid response.');
  return { ok: Boolean(value.ok), status: stringValue(value.status) || 'unknown', durationMs: nullableNumber(value.durationMs), httpStatus: nullableNumber(value.httpStatus), configuredModel: optionalString(value.configuredModel), structuredOutputValid: typeof value.structuredOutputValid === 'boolean' ? value.structuredOutputValid : null };
}

function auditReference(detail: Record<string, unknown>): string {
  return shortId(stringValue(detail.tenant_id) || stringValue(detail.tenantId) || stringValue(detail.campaign_id) || stringValue(detail.campaignId) || stringValue(detail.request_id) || stringValue(detail.requestId));
}

function friendlyAccess(value: string): string {
  if (value === 'full') return 'Full access';
  if (value === 'read_only') return 'Read-only';
  return friendlyLabel(value || 'unknown');
}

function friendlyLabel(value: string): string {
  if (!value) return 'Unknown';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function messageFrom(value: unknown, fallback: string): string { return value instanceof Error && value.message ? value.message : fallback; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function optionalString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function numberValue(value: unknown): number { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function nullableNumber(value: unknown): number | null { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : null; }
function shortId(value: string): string { return value ? `${value.slice(0, 8)}…` : '—'; }
function formatDate(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }

function merchantFromHash(): string | null {
  const value = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tenant');
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}
