import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson, isRecord, supabase } from './supabase';

type TenantSubscriptionSummary = {
  id: string;
  name: string;
  slug: string;
  businessEmail: string | null;
  planCode: string | null;
  subscriptionStatus: string;
  accessMode: 'full' | 'read_only' | string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
};

type PlatformOverview = {
  actorRole: 'admin' | 'support';
  tenants: TenantSubscriptionSummary[];
};

type PlatformAdminResult = {
  ok?: boolean;
  overview?: unknown;
};

export default function SubscriptionAccess() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [days, setDays] = useState(14);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setSessionReady(true);
      setOverview(null);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadOverview(session);
  }, [session?.access_token]);

  const filteredTenants = useMemo(() => {
    if (!overview) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return overview.tenants;
    return overview.tenants.filter((tenant) =>
      [tenant.name, tenant.slug, tenant.businessEmail ?? '', tenant.subscriptionStatus, tenant.accessMode]
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [overview, search]);

  const selectedTenant = useMemo(
    () => overview?.tenants.find((tenant) => tenant.id === selectedTenantId) ?? null,
    [overview, selectedTenantId],
  );

  async function loadOverview(activeSession: Session = session as Session) {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeJson<{ overview?: unknown }>(
        'platform-admin',
        { action: 'overview' },
        activeSession,
      );
      const normalized = normalizeOverview(result.overview);
      setOverview(normalized);
      setSelectedTenantId((current) =>
        normalized.tenants.some((tenant) => tenant.id === current)
          ? current
          : normalized.tenants[0]?.id ?? '',
      );
    } catch (err) {
      setOverview(null);
      setError(messageFrom(err, 'Unable to load subscription access.'));
    } finally {
      setLoading(false);
    }
  }

  function requestExtension() {
    setSuccess(null);
    setError(null);
    if (overview?.actorRole !== 'admin') {
      setError('Only a ProcessEdge Platform Admin can change subscription access.');
      return;
    }
    if (!selectedTenant) {
      setError('Select a SellerTray business.');
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      setError('Trial extension must be between 1 and 90 days.');
      return;
    }
    setConfirmOpen(true);
  }

  async function extendTrial() {
    if (!session || !selectedTenant) return;
    setMutating(true);
    setError(null);
    try {
      const result = await invokeJson<PlatformAdminResult>(
        'platform-admin',
        {
          action: 'extend_trial_days',
          tenantId: selectedTenant.id,
          value: days,
        },
        session,
      );
      const normalized = normalizeOverview(result.overview);
      setOverview(normalized);
      setSuccess(`Extended ${selectedTenant.name} trial access by ${days} day${days === 1 ? '' : 's'}.`);
      setConfirmOpen(false);
    } catch (err) {
      setError(messageFrom(err, 'Unable to extend this trial.'));
      setConfirmOpen(false);
    } finally {
      setMutating(false);
    }
  }

  if (!sessionReady) {
    return <SubscriptionStatus title="Checking administrator session" body="Verifying your ProcessEdge administrator session…" />;
  }

  if (!session) {
    return (
      <SubscriptionStatus
        title="Sign in required"
        body="Sign in and complete MFA in SellerTray Admin before managing subscription access."
        action={<a className="primary-button admin-link-button" href="#">Open administrator sign in</a>}
      />
    );
  }

  if (loading && !overview) {
    return <SubscriptionStatus title="Loading subscription access" body="Retrieving SellerTray business access status…" />;
  }

  if (!overview) {
    return (
      <SubscriptionStatus
        title="Subscription access unavailable"
        body={error ?? 'Complete MFA in the notification console, then try again.'}
        action={<a className="primary-button admin-link-button" href="#">Complete administrator verification</a>}
      />
    );
  }

  const canManage = overview.actorRole === 'admin';
  const projectedEnd = selectedTenant ? projectTrialEnd(selectedTenant.trialEndsAt, days) : null;

  return (
    <div className="subscription-shell">
      <header className="subscription-topbar">
        <div className="subscription-brand">
          <img src="/brand/sellertray-admin-logo.webp" alt="SellerTray" />
          <div><strong>SellerTray Admin</strong><span>ProcessEdge</span></div>
        </div>
        <div className="subscription-topbar-actions">
          <span className="role-pill">{canManage ? 'Platform Admin' : 'Platform Support'}</span>
          <span className="admin-email">{session.user.email ?? 'Administrator'}</span>
        </div>
      </header>

      <main className="subscription-main">
        <section className="page-heading subscription-heading">
          <div>
            <p className="eyebrow">Business access</p>
            <h1>Subscription access</h1>
            <p className="muted">Review a SellerTray business subscription and extend trial access through the governed, audited administrator action.</p>
          </div>
          <div className="summary-card"><strong>{overview.tenants.length}</strong><span>SellerTray businesses</span></div>
        </section>

        {!canManage ? (
          <div className="warning-banner">This account has Platform Support access. Subscription changes require a Platform Admin.</div>
        ) : null}
        {success ? <div className="success-banner">{success}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}

        <section className="panel subscription-panel">
          <div className="panel-heading">
            <div><h2>Trial access</h2><p>Extending a trial never marks a merchant as paid. The action is recorded in the platform audit history.</p></div>
          </div>

          <div className="field-grid two">
            <label>
              Find business
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search business, email or status" />
            </label>
            <label>
              Business
              <select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>
                {filteredTenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.name} · {friendlyStatus(tenant.subscriptionStatus)}</option>
                ))}
              </select>
            </label>
          </div>

          {selectedTenant ? (
            <>
              <div className="subscription-facts">
                <div><span>Business</span><strong>{selectedTenant.name}</strong><small>{selectedTenant.businessEmail ?? selectedTenant.slug}</small></div>
                <div><span>Current status</span><strong>{friendlyStatus(selectedTenant.subscriptionStatus)}</strong><small>{selectedTenant.planCode ?? 'No plan'}</small></div>
                <div><span>Access</span><strong>{selectedTenant.accessMode === 'full' ? 'Full access' : 'Read-only'}</strong><small>{selectedTenant.accessMode === 'full' ? 'Operational writes available' : 'Operational writes blocked'}</small></div>
                <div><span>Trial ends</span><strong>{formatDate(selectedTenant.trialEndsAt)}</strong><small>{selectedTenant.trialEndsAt ? relativeState(selectedTenant.trialEndsAt) : 'No trial end recorded'}</small></div>
              </div>

              <div className="subscription-action-row">
                <label>
                  Extend by days
                  <input
                    type="number"
                    min={1}
                    max={90}
                    step={1}
                    value={days}
                    onChange={(event) => setDays(Math.trunc(Number(event.target.value) || 0))}
                  />
                </label>
                <div className="extension-preview">
                  <span>Projected trial end</span>
                  <strong>{formatDate(projectedEnd)}</strong>
                  <small>Calculated from the later of the current trial end or now.</small>
                </div>
                <button className="primary-button" type="button" disabled={!canManage || mutating} onClick={requestExtension}>
                  Review trial extension
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">No SellerTray business matches this search.</div>
          )}
        </section>
      </main>

      {confirmOpen && selectedTenant ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="extend-trial-title">
            <p className="eyebrow">Final confirmation</p>
            <h2 id="extend-trial-title">Extend trial access?</h2>
            <p>This will extend <strong>{selectedTenant.name}</strong> by <strong>{days} day{days === 1 ? '' : 's'}</strong>. It does not record a payment or convert the business to a paid subscription.</p>
            <div className="confirm-summary">
              <span>Current trial end: {formatDate(selectedTenant.trialEndsAt)}</span>
              <span>Projected trial end: {formatDate(projectedEnd)}</span>
              <span>This administrator action will be written to the platform audit history.</span>
            </div>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setConfirmOpen(false)} disabled={mutating}>Cancel</button>
              <button className="primary-button" type="button" onClick={() => void extendTrial()} disabled={mutating}>{mutating ? 'Extending…' : `Extend by ${days} days`}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SubscriptionStatus({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="subscription-status-shell">
      <div className="security-card">
        <img className="brand-logo status-logo" src="/brand/sellertray-admin-logo.webp" alt="SellerTray" />
        <p className="eyebrow">SellerTray Admin</p>
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        {action ?? <div className="loader" />}
      </div>
    </div>
  );
}

function normalizeOverview(value: unknown): PlatformOverview {
  if (!isRecord(value)) throw new Error('Platform admin returned an invalid overview.');
  const actorRole = value.actorRole === 'support' ? 'support' : value.actorRole === 'admin' ? 'admin' : null;
  if (!actorRole) throw new Error('This account is not configured for ProcessEdge platform administration.');
  const tenants = Array.isArray(value.tenants)
    ? value.tenants.filter(isRecord).map((tenant) => ({
        id: stringValue(tenant.id),
        name: stringValue(tenant.name) || 'Unnamed business',
        slug: stringValue(tenant.slug),
        businessEmail: optionalString(tenant.businessEmail),
        planCode: optionalString(tenant.planCode),
        subscriptionStatus: stringValue(tenant.subscriptionStatus) || 'unknown',
        accessMode: stringValue(tenant.accessMode) || 'read_only',
        trialEndsAt: optionalString(tenant.trialEndsAt),
        currentPeriodEnd: optionalString(tenant.currentPeriodEnd),
        graceEndsAt: optionalString(tenant.graceEndsAt),
      })).filter((tenant) => tenant.id)
    : [];
  return { actorRole, tenants };
}

function projectTrialEnd(currentTrialEnd: string | null, days: number): string | null {
  if (!Number.isInteger(days) || days < 1 || days > 90) return null;
  const now = Date.now();
  const current = currentTrialEnd ? new Date(currentTrialEnd).getTime() : Number.NaN;
  const base = Number.isFinite(current) && current > now ? current : now;
  return new Date(base + days * 86_400_000).toISOString();
}

function relativeState(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Date unavailable';
  const days = Math.ceil(Math.abs(timestamp - Date.now()) / 86_400_000);
  return timestamp > Date.now() ? `${days} day${days === 1 ? '' : 's'} remaining` : `Expired ${days} day${days === 1 ? '' : 's'} ago`;
}

function friendlyStatus(value: string): string {
  if (!value) return 'Unknown';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function messageFrom(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
