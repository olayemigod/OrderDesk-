import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson, isRecord, supabase } from './supabase';

type SecurityState = 'checking' | 'needs_mfa' | 'needs_enroll' | 'ready';
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
  whatsappStatus: string;
  planCode: string | null;
  orders30d: number;
  needsReview: number;
};

type PlatformOverview = {
  actorRole: 'admin' | 'support';
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

const MESSAGE_LABELS: Record<MessageType, string> = {
  update: 'Product update',
  service: 'Service notice',
  information: 'Information',
  promotion: 'Promotion',
};

const ROLE_LABELS: Record<MerchantRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

const DEFAULT_ROLES: MerchantRole[] = ['owner', 'manager', 'staff'];
const ACTION_URL_PATTERN = /^(https:\/\/[^\s]+|sellertray:\/\/[A-Za-z0-9/_?=&.%-]+)$/;

export default function App() {
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

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (booting) return <FullPageStatus title="Opening SellerTray Admin" body="Checking your ProcessEdge administrator session…" />;
  if (!session) return <LoginScreen />;
  if (securityState === 'checking') return <FullPageStatus title="Verifying administrator security" body="SellerTray requires MFA before platform messaging is available." error={portalError} />;
  if (securityState === 'needs_mfa' && verifiedFactorId) {
    return <MfaChallenge factorId={verifiedFactorId} onVerified={assessSecurity} onSignOut={signOut} />;
  }
  if (securityState === 'needs_enroll') {
    return <MfaEnrollment enrollment={enrollment} setEnrollment={setEnrollment} onVerified={assessSecurity} onSignOut={signOut} />;
  }
  if (!overview) return <FullPageStatus title="Loading notification console" body="Retrieving SellerTray businesses and recent platform messaging activity…" error={portalError} onRetry={loadPortal} />;

  return (
    <AdminPortal
      session={session}
      overview={overview}
      audit={audit}
      onAuditRefresh={async () => {
        const result = await invokeJson<{ audit?: unknown }>('platform-admin', { action: 'audit', tenantId: null, limit: 100 }, session);
        setAudit(normalizeAudit(result.audit));
      }}
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
    <div className="auth-shell">
      <section className="auth-brand-panel">
        <img className="brand-logo" src="https://sellertray.vercel.app/brand/sellertray-logo-v2.png" alt="SellerTray" />
        <p className="eyebrow">ProcessEdge Operations</p>
        <h1>SellerTray Admin</h1>
        <p>Secure platform communications for SellerTray merchants.</p>
        <div className="security-note">Administrator access requires password authentication and MFA.</div>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <div>
          <p className="eyebrow">Restricted access</p>
          <h2>Sign in</h2>
          <p className="muted">Use your ProcessEdge platform administrator account.</p>
        </div>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </label>
        {error ? <div className="error-banner">{error}</div> : null}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Continue securely'}</button>
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
    <div className="center-shell">
      <form className="security-card" onSubmit={verify}>
        <div className="security-icon">2</div>
        <p className="eyebrow">Second factor</p>
        <h1>Verify MFA</h1>
        <p className="muted">Enter the six-digit code from your authenticator app.</p>
        <input className="otp-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required />
        {error ? <div className="error-banner">{error}</div> : null}
        <button className="primary-button" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and continue'}</button>
        <button className="text-button" type="button" onClick={() => void onSignOut()}>Use another account</button>
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
    <div className="center-shell">
      <form className="security-card wide" onSubmit={verify}>
        <div className="security-icon">2</div>
        <p className="eyebrow">Administrator protection</p>
        <h1>Set up MFA</h1>
        <p className="muted">SellerTray platform messaging requires a verified second factor. This protects merchant-wide broadcasts from account takeover.</p>
        {!enrollment ? (
          <button className="primary-button" type="button" onClick={() => void beginEnrollment()} disabled={busy}>{busy ? 'Preparing…' : 'Set up authenticator'}</button>
        ) : (
          <>
            <div className="enrollment-grid">
              <div className="qr-frame"><img src={enrollment.qrCode} alt="Authenticator QR code" /></div>
              <div>
                <strong>Scan with your authenticator app</strong>
                <p className="muted small">If scanning is unavailable, enter this setup key manually:</p>
                <code className="secret-code">{enrollment.secret}</code>
              </div>
            </div>
            <input className="otp-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required />
            <button className="primary-button" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify MFA'}</button>
          </>
        )}
        {error ? <div className="error-banner">{error}</div> : null}
        <button className="text-button" type="button" onClick={() => void onSignOut()}>Sign out</button>
      </form>
    </div>
  );
}

function AdminPortal({ session, overview, audit, onAuditRefresh, onSignOut }: { session: Session; overview: PlatformOverview; audit: AuditEvent[]; onAuditRefresh: () => Promise<void>; onSignOut: () => Promise<void> }) {
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
  const [refreshingAudit, setRefreshingAudit] = useState(false);

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
    if (!canPublish) return 'Only a ProcessEdge platform Admin can publish merchant messages.';
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
      const payload: Record<string, unknown> = {
        messageType,
        severity,
        title: title.trim(),
        body: body.trim(),
        audienceRoles: roleList,
      };
      if (!allBusinesses) payload.tenantIds = Array.from(selectedTenantIds);
      if (actionLabel.trim()) payload.actionLabel = actionLabel.trim();
      if (actionUrl.trim()) payload.actionUrl = actionUrl.trim();
      if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();

      const result = await invokeJson<PublishResult>('platform-merchant-message', payload, session);
      const count = Number(result.notificationCount ?? 0);
      setSuccess(`Published successfully to ${count.toLocaleString()} SellerTray business${count === 1 ? '' : 'es'}. Campaign ${result.campaignId ?? ''}`.trim());
      setConfirmOpen(false);
      setTitle('');
      setBody('');
      setActionLabel('');
      setActionUrl('');
      setExpiresAt('');
      await onAuditRefresh();
    } catch (err) {
      setError(messageFrom(err, 'Unable to publish this merchant message.'));
      setConfirmOpen(false);
    } finally {
      setPublishing(false);
    }
  }

  async function refreshAudit() {
    setRefreshingAudit(true);
    try { await onAuditRefresh(); } finally { setRefreshingAudit(false); }
  }

  return (
    <div className="portal-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <img className="brand-icon small-mark" src="https://sellertray.vercel.app/brand/sellertray-app-icon-v2.png" alt="" aria-hidden="true" />
          <div><strong>SellerTray Admin</strong><span>ProcessEdge</span></div>
        </div>
        <div className="topbar-actions">
          <span className="role-pill">{overview.actorRole === 'admin' ? 'Platform Admin' : 'Platform Support'}</span>
          <span className="admin-email">{session.user.email ?? 'Administrator'}</span>
          <button className="ghost-button" onClick={() => void onSignOut()}>Sign out</button>
        </div>
      </header>

      <main className="portal-main">
        <section className="page-heading">
          <div>
            <p className="eyebrow">Merchant communications</p>
            <h1>Send a SellerTray notification</h1>
            <p className="muted">Publish governed platform updates, service notices, information and promotions to merchant notification inboxes and push devices.</p>
          </div>
          <div className="summary-card"><strong>{overview.tenants.length}</strong><span>SellerTray businesses</span></div>
        </section>

        {!canPublish ? <div className="warning-banner">This account has Platform Support access. Publishing is restricted to Platform Admin accounts.</div> : null}
        {success ? <div className="success-banner">{success}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}

        <div className="composer-grid">
          <section className="panel form-panel">
            <div className="panel-heading"><div><h2>Message</h2><p>Compose the merchant-facing notification.</p></div></div>
            <div className="field-grid two">
              <label>Message type
                <select value={messageType} onChange={(event) => {
                  const next = event.target.value as MessageType;
                  setMessageType(next);
                  if (next === 'promotion' && severity === 'urgent') setSeverity('attention');
                }}>
                  {Object.entries(MESSAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>Priority
                <select value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}>
                  <option value="info">Normal</option>
                  <option value="attention">Attention</option>
                  <option value="urgent" disabled={messageType === 'promotion'}>Urgent</option>
                </select>
              </label>
            </div>
            <label>Title <span className="counter">{title.trim().length}/160</span>
              <input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 160))} placeholder="What should merchants know?" />
            </label>
            <label>Message <span className="counter">{body.trim().length}/1000</span>
              <textarea value={body} onChange={(event) => setBody(event.target.value.slice(0, 1000))} rows={7} placeholder="Write a clear, human message with the action merchants need to take, if any." />
            </label>
            <div className="field-grid two">
              <label>CTA label <span className="optional">Optional</span>
                <input value={actionLabel} onChange={(event) => setActionLabel(event.target.value.slice(0, 60))} placeholder="Open SellerTray" />
              </label>
              <label>CTA link <span className="optional">Optional</span>
                <input value={actionUrl} onChange={(event) => setActionUrl(event.target.value)} placeholder="sellertray://notifications or https://…" />
              </label>
            </div>
            <label>Expiry <span className="optional">Optional</span>
              <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </label>
          </section>

          <aside className="panel preview-panel">
            <div className="panel-heading"><div><h2>Merchant preview</h2><p>Approximate SellerTray notification appearance.</p></div></div>
            <div className={`notification-preview severity-${severity}`}>
              <div className="preview-meta"><span>{MESSAGE_LABELS[messageType]}</span><span>{severity === 'info' ? 'Normal' : severity === 'attention' ? 'Attention' : 'Urgent'}</span></div>
              <h3>{title.trim() || 'Your notification title'}</h3>
              <p>{body.trim() || 'Your merchant message will appear here.'}</p>
              {actionLabel.trim() ? <button type="button" className="preview-cta">{actionLabel.trim()}</button> : null}
              <small>ProcessEdge · just now</small>
            </div>
            <div className="preview-facts">
              <div><span>Target</span><strong>{allBusinesses ? 'All businesses' : `${selectedTenantIds.size} selected`}</strong></div>
              <div><span>Roles</span><strong>{roleList.map((role) => ROLE_LABELS[role]).join(', ') || 'None'}</strong></div>
              <div><span>Delivery</span><strong>Inbox + push queue</strong></div>
            </div>
          </aside>
        </div>

        <section className="panel audience-panel">
          <div className="panel-heading audience-heading">
            <div><h2>Audience</h2><p>Choose which businesses and merchant roles receive this message.</p></div>
            <div className="audience-count">{selectedCount.toLocaleString()} business{selectedCount === 1 ? '' : 'es'}</div>
          </div>
          <div className="audience-mode">
            <button className={allBusinesses ? 'segmented active' : 'segmented'} onClick={() => setAllBusinesses(true)}>All businesses</button>
            <button className={!allBusinesses ? 'segmented active' : 'segmented'} onClick={() => setAllBusinesses(false)}>Selected businesses</button>
          </div>
          <div className="role-row">
            {DEFAULT_ROLES.map((role) => (
              <label className="check-pill" key={role}><input type="checkbox" checked={audienceRoles.has(role)} onChange={() => toggleRole(role)} />{ROLE_LABELS[role]}</label>
            ))}
          </div>
          {!allBusinesses ? (
            <div className="tenant-selector">
              <div className="tenant-tools">
                <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search business, email, phone or status" />
                <button className="ghost-button" type="button" onClick={() => setSelectedTenantIds(new Set(filteredTenants.map((tenant) => tenant.id)))}>Select visible</button>
                <button className="ghost-button" type="button" onClick={() => setSelectedTenantIds(new Set())}>Clear</button>
              </div>
              <div className="tenant-list">
                {filteredTenants.map((tenant) => {
                  const selected = selectedTenantIds.has(tenant.id);
                  return (
                    <button key={tenant.id} type="button" className={selected ? 'tenant-row selected' : 'tenant-row'} onClick={() => toggleTenant(tenant.id)}>
                      <span className="tenant-check">{selected ? '✓' : ''}</span>
                      <span className="tenant-primary"><strong>{tenant.name}</strong><small>{tenant.businessEmail ?? tenant.businessPhone ?? tenant.slug}</small></span>
                      <span className="tenant-status">{tenant.subscriptionStatus}</span>
                      <span className="tenant-status">WA: {tenant.whatsappStatus.replace(/_/g, ' ')}</span>
                    </button>
                  );
                })}
                {filteredTenants.length === 0 ? <div className="empty-state">No SellerTray business matches this search.</div> : null}
              </div>
            </div>
          ) : null}
        </section>

        <div className="publish-bar">
          <div><strong>Ready to publish?</strong><span>{selectedCount.toLocaleString()} business{selectedCount === 1 ? '' : 'es'} · {roleList.length} role{roleList.length === 1 ? '' : 's'}</span></div>
          <button className="primary-button publish-button" disabled={!canPublish || publishing} onClick={requestPublish}>Review & publish</button>
        </div>

        <section className="panel audit-panel">
          <div className="panel-heading audience-heading">
            <div><h2>Recent notification campaigns</h2><p>Platform audit records for merchant messages.</p></div>
            <button className="ghost-button" onClick={() => void refreshAudit()} disabled={refreshingAudit}>{refreshingAudit ? 'Refreshing…' : 'Refresh'}</button>
          </div>
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead><tr><th>Published</th><th>Type</th><th>Priority</th><th>Businesses</th><th>Roles</th><th>Actor</th><th>Campaign</th></tr></thead>
              <tbody>
                {notificationAudit.slice(0, 20).map((event) => (
                  <tr key={event.id}>
                    <td>{formatDate(event.createdAt)}</td>
                    <td>{MESSAGE_LABELS[(stringValue(event.detail.message_type) as MessageType)] ?? stringValue(event.detail.message_type)}</td>
                    <td>{stringValue(event.detail.severity)}</td>
                    <td>{numberValue(event.detail.notification_count).toLocaleString()}</td>
                    <td>{arrayValue(event.detail.audience_roles).join(', ') || 'All roles'}</td>
                    <td>{event.actorEmail || 'Platform admin'}</td>
                    <td><code>{shortId(stringValue(event.detail.campaign_id))}</code></td>
                  </tr>
                ))}
                {notificationAudit.length === 0 ? <tr><td colSpan={7}><div className="empty-state">No merchant notification campaigns have been published yet.</div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {confirmOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title">
            <p className="eyebrow">Final confirmation</p>
            <h2 id="publish-title">Publish this notification?</h2>
            <p>This will create merchant notifications for <strong>{selectedCount.toLocaleString()} SellerTray business{selectedCount === 1 ? '' : 'es'}</strong> and queue push delivery for eligible users in the selected roles.</p>
            <div className="confirm-summary">
              <strong>{title.trim()}</strong>
              <span>{MESSAGE_LABELS[messageType]} · {severity}</span>
              <span>{roleList.map((role) => ROLE_LABELS[role]).join(', ')}</span>
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setConfirmOpen(false)} disabled={publishing}>Cancel</button>
              <button className="primary-button" onClick={() => void publish()} disabled={publishing}>{publishing ? 'Publishing…' : 'Publish notification'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FullPageStatus({ title, body, error, onRetry }: { title: string; body: string; error?: string | null; onRetry?: () => Promise<void> }) {
  return <div className="center-shell"><div className="security-card"><img className="brand-logo status-logo" src="https://sellertray.vercel.app/brand/sellertray-logo-v2.png" alt="SellerTray" /><p className="eyebrow">SellerTray Admin</p><h1>{title}</h1><p className="muted">{body}</p>{error ? <div className="error-banner">{error}</div> : null}{onRetry ? <button className="primary-button" onClick={() => void onRetry()}>Try again</button> : <div className="loader" />}</div></div>;
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
    whatsappStatus: stringValue(tenant.whatsappStatus) || 'not_connected',
    planCode: optionalString(tenant.planCode),
    orders30d: numberValue(tenant.orders30d),
    needsReview: numberValue(tenant.needsReview),
  })).filter((tenant) => tenant.id) : [];
  return { actorRole, generatedAt: stringValue(value.generatedAt), tenants };
}

function normalizeAudit(value: unknown): AuditEvent[] {
  const source = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.events) ? value.events : [];
  return source.filter(isRecord).map((event) => ({
    id: stringValue(event.id) || crypto.randomUUID(),
    action: stringValue(event.action),
    detail: isRecord(event.detail) ? event.detail : {},
    createdAt: stringValue(event.createdAt),
    actorEmail: stringValue(event.actorEmail),
  }));
}

function messageFrom(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function optionalString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function numberValue(value: unknown): number { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function arrayValue(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []; }
function shortId(value: string): string { return value ? `${value.slice(0, 8)}…` : '—'; }
function formatDate(value: string): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
