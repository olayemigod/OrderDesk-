import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

type AgreementVersion = {
  id: string;
  versionCode: string;
  title: string;
  contentBody: string;
  contentSha256: string;
  effectiveFrom: string;
  publishedAt: string;
  publishedByUserId: string;
  publishReason: string;
};

type Acceptance = {
  id: string;
  versionCode: string;
  acceptedAt: string;
  acceptedLegalName: string;
  acceptedRole: string;
  acceptedByUserId: string;
};

type TenantState = {
  published: boolean;
  accepted: boolean;
  acceptanceRequired: boolean;
  serviceDeliveryAllowed: boolean;
  currentVersion: AgreementVersion | null;
  acceptance: Acceptance | null;
};

type AgreementOverview = {
  actorRole: string;
  canPublish: boolean;
  versions: AgreementVersion[];
  tenantState: TenantState | null;
};

type AdminResponse = { ok?: boolean; overview?: unknown };

type PublishForm = {
  versionCode: string;
  title: string;
  contentBody: string;
  effectiveFrom: string;
  reason: string;
};

const emptyForm = (): PublishForm => ({
  versionCode: '',
  title: 'SellerTray Master Agreement',
  contentBody: '',
  effectiveFrom: localDateTime(new Date()),
  reason: '',
});

export default function AgreementLifecycleManagement({ session, tenantId }: { session: Session; tenantId?: string }) {
  const [state, setState] = useState<AgreementOverview | null>(null);
  const [form, setForm] = useState<PublishForm>(() => emptyForm());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => { setMessage(null); void load(); }, [tenantId, session]);

  async function load(preferredId?: string | null) {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await invokeJson<AdminResponse>('master-agreements', {
        action: 'admin_get',
        ...(tenantId ? { tenantId } : {}),
      }, session);
      if (sequence !== requestSequence.current) return;
      const next = parseOverview(response.overview);
      setState(next);
      const wanted = preferredId ?? selectedId;
      setSelectedId(wanted && next.versions.some((version) => version.id === wanted)
        ? wanted
        : next.tenantState?.currentVersion?.id ?? next.versions[0]?.id ?? null);
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setState(null);
      setError(messageFrom(cause, 'Unable to load Master Agreement governance.'));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!state?.canPublish) return;
    const effective = new Date(form.effectiveFrom);
    if (Number.isNaN(effective.getTime())) { setError('Enter a valid effective date and time.'); return; }
    if (!form.versionCode.trim() || !form.title.trim() || !form.contentBody.trim() || form.reason.trim().length < 6) {
      setError('Version, title, agreement content and a publication reason are required.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await invokeJson<AdminResponse & { agreementVersionId?: string }>('master-agreements', {
        action: 'admin_publish',
        ...(tenantId ? { tenantId } : {}),
        versionCode: form.versionCode.trim(),
        title: form.title.trim(),
        contentBody: form.contentBody.trim(),
        effectiveFrom: effective.toISOString(),
        reason: form.reason.trim(),
      }, session);
      const next = parseOverview(response.overview);
      setState(next);
      setSelectedId(response.agreementVersionId ?? next.tenantState?.currentVersion?.id ?? next.versions[0]?.id ?? null);
      setForm(emptyForm());
      setMessage('Universal Master Agreement version published. The same immutable content applies to every SellerTray Business when it becomes effective.');
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to publish this Master Agreement version.'));
    } finally {
      setSaving(false);
    }
  }

  const versions = state?.versions ?? [];
  const selected = versions.find((version) => version.id === selectedId) ?? versions[0] ?? null;
  const tenantState = state?.tenantState ?? null;

  return <section className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Platform legal governance</p><h2>SellerTray Master Agreement</h2></div>
      <p className="muted">Publish one immutable agreement version for the entire SellerTray platform. Merchant-specific issuance and order-specific agreement replacement are retired.</p>
    </div>

    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {tenantState ? <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">Selected Merchant</p><h3>Acceptance status</h3></div><span className="role-pill">{tenantState.accepted ? 'Accepted' : tenantState.published ? 'Pending' : 'Not published'}</span></div>
      <div className="settings-grid two">
        <Fact label="Current version" value={tenantState.currentVersion?.versionCode ?? 'No effective version'} />
        <Fact label="Service-delivery agreement gate" value={tenantState.serviceDeliveryAllowed ? 'Satisfied' : 'Blocked'} />
        <Fact label="Accepted by" value={tenantState.acceptance?.acceptedLegalName ?? '—'} />
        <Fact label="Accepted at" value={tenantState.acceptance?.acceptedAt ? formatDate(tenantState.acceptance.acceptedAt) : '—'} />
      </div>
      <div className="governance-note">This status is Business + Master Agreement version evidence. It is not tied to a commercial order, installment, Branch or payment.</div>
    </article> : null}

    <div className="two-column">
      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Version history</p><h3>Published Master Agreement versions</h3></div></div>
        {loading && !state ? <p className="muted">Loading agreement versions…</p> : null}
        {!loading && !versions.length ? <div className="empty-state"><strong>No Master Agreement published</strong><p>Publish the reviewed universal legal text before a new SellerTray service-delivery activation is allowed.</p></div> : null}
        {versions.map((version) => <button key={version.id} type="button" className={selected?.id === version.id ? 'member-row active' : 'member-row'} onClick={() => setSelectedId(version.id)}>
          <span className="member-avatar">V</span>
          <span><strong>{version.title}</strong><small>Version {version.versionCode} · Effective {formatDate(version.effectiveFrom)}</small></span>
        </button>)}
      </article>

      <article className="panel">
        {selected ? <>
          <div className="panel-head"><div><p className="eyebrow">Immutable published version</p><h3>{selected.title}</h3><p className="muted">Version {selected.versionCode}</p></div></div>
          <div className="settings-grid two">
            <Fact label="Effective" value={formatDate(selected.effectiveFrom)} />
            <Fact label="Published" value={formatDate(selected.publishedAt)} />
            <Fact label="Content integrity" value={`${selected.contentSha256.slice(0, 16)}…`} />
            <Fact label="Scope" value="All SellerTray Businesses" />
          </div>
          <div className="governance-note">Reason: {selected.publishReason}</div>
          <div className="panel agreement-document"><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: 0 }}>{selected.contentBody}</pre></div>
        </> : <div className="empty-state"><strong>No version selected</strong><p>Published versions are immutable and remain available for legal history.</p></div>}
      </article>
    </div>

    <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">Publish version</p><h3>New universal Master Agreement</h3></div>{!state?.canPublish ? <span className="role-pill">Review only</span> : null}</div>
      <div className="governance-note">Do not enter merchant-specific pricing, order IDs, Branch terms or bespoke merchant clauses here. The exact content published here applies to every SellerTray Business.</div>
      {state?.canPublish ? <form className="settings-form" onSubmit={publish}>
        <div className="settings-grid two">
          <label className="field"><span>Version code</span><input maxLength={64} required value={form.versionCode} onChange={(event) => setForm((current) => ({ ...current, versionCode: event.target.value }))} placeholder="e.g. 2026.1" /></label>
          <label className="field"><span>Title</span><input maxLength={200} required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
          <label className="field"><span>Effective from</span><input type="datetime-local" required value={form.effectiveFrom} onChange={(event) => setForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
          <label className="field"><span>Publication reason</span><input maxLength={1000} required value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Reviewed legal version publication" /></label>
        </div>
        <label className="field"><span>Master Agreement content</span><textarea rows={18} maxLength={200000} required value={form.contentBody} onChange={(event) => setForm((current) => ({ ...current, contentBody: event.target.value }))} placeholder="Paste the reviewed universal SellerTray Master Agreement text here." /></label>
        <div className="settings-actions"><button className="primary-button" disabled={saving}>{saving ? 'Publishing…' : 'Publish immutable version'}</button></div>
      </form> : <p className="muted">Your ProcessEdge access is review-only for Master Agreement publication.</p>}
    </article>
  </section>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function localDateTime(date: Date) { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16); }
function messageFrom(value: unknown, fallback: string) { return value instanceof Error && value.message ? value.message : fallback; }
function parseVersion(value: unknown): AgreementVersion | null {
  const row = record(value);
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    versionCode: String(row.versionCode ?? ''),
    title: String(row.title ?? 'SellerTray Master Agreement'),
    contentBody: String(row.contentBody ?? ''),
    contentSha256: String(row.contentSha256 ?? ''),
    effectiveFrom: String(row.effectiveFrom ?? ''),
    publishedAt: String(row.publishedAt ?? ''),
    publishedByUserId: String(row.publishedByUserId ?? ''),
    publishReason: String(row.publishReason ?? ''),
  };
}
function parseAcceptance(value: unknown): Acceptance | null {
  const row = record(value);
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    versionCode: String(row.versionCode ?? ''),
    acceptedAt: String(row.acceptedAt ?? ''),
    acceptedLegalName: String(row.acceptedLegalName ?? ''),
    acceptedRole: String(row.acceptedRole ?? ''),
    acceptedByUserId: String(row.acceptedByUserId ?? ''),
  };
}
function parseTenantState(value: unknown): TenantState | null {
  const row = record(value);
  if (!Object.keys(row).length) return null;
  return {
    published: row.published === true,
    accepted: row.accepted === true,
    acceptanceRequired: row.acceptanceRequired === true,
    serviceDeliveryAllowed: row.serviceDeliveryAllowed === true,
    currentVersion: parseVersion(row.currentVersion),
    acceptance: parseAcceptance(row.acceptance),
  };
}
function parseOverview(value: unknown): AgreementOverview {
  const root = record(value);
  const versions = Array.isArray(root.versions) ? root.versions.flatMap((item) => {
    const parsed = parseVersion(item);
    return parsed ? [parsed] : [];
  }) : [];
  return {
    actorRole: String(root.actorRole ?? ''),
    canPublish: root.canPublish === true,
    versions,
    tenantState: parseTenantState(root.tenantState),
  };
}
