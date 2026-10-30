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
  effectiveFrom: string;
  reason: string;
};

const MAX_MASTER_PDF_BYTES = 8 * 1024 * 1024;

const emptyForm = (): PublishForm => ({
  versionCode: '',
  title: 'SellerTray Master Services and Subscription Agreement',
  effectiveFrom: localDateTime(new Date()),
  reason: '',
});

export default function AgreementLifecycleManagement({ session, tenantId }: { session: Session; tenantId: string }) {
  const [state, setState] = useState<AgreementOverview | null>(null);
  const [form, setForm] = useState<PublishForm>(() => emptyForm());
  const [sourcePdf, setSourcePdf] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
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
        tenantId,
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
    if (!form.versionCode.trim() || !form.title.trim() || form.reason.trim().length < 6 || !sourcePdf) {
      setError('Version, title, reviewed PDF and a publication reason are required.');
      return;
    }
    if (!isPdfFile(sourcePdf)) {
      setError('Upload a PDF document for the reviewed Master Agreement.');
      return;
    }
    if (sourcePdf.size < 1 || sourcePdf.size > MAX_MASTER_PDF_BYTES) {
      setError('Reviewed Master Agreement PDF must be 8 MB or smaller.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const sourcePdfBase64 = await fileToBase64(sourcePdf);
      const response = await invokeJson<AdminResponse & { agreementVersionId?: string; sourcePdfSha256?: string }>('master-agreements', {
        action: 'admin_publish_pdf',
        tenantId,
        versionCode: form.versionCode.trim(),
        title: form.title.trim(),
        effectiveFrom: effective.toISOString(),
        reason: form.reason.trim(),
        sourceFileName: sourcePdf.name,
        sourcePdfBase64,
        commandId: crypto.randomUUID(),
      }, session);
      const next = parseOverview(response.overview);
      setState(next);
      setSelectedId(response.agreementVersionId ?? next.tenantState?.currentVersion?.id ?? next.versions[0]?.id ?? null);
      setForm(emptyForm());
      setSourcePdf(null);
      setFileInputKey((value) => value + 1);
      setMessage('Reviewed Master Agreement PDF published as a new immutable universal version. Merchant acceptance will bind to this exact governed document.');
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to publish this reviewed Master Agreement PDF.'));
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
      <p className="muted">Publish one reviewed, immutable Master Agreement PDF for the entire SellerTray platform. Merchant-specific commercial terms remain in governed Order Forms.</p>
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
      <div className="governance-note">This status is Business + Master Agreement version evidence. It is not tied to a commercial order, installment, Branch, Order Form confirmation or payment.</div>
    </article> : null}

    <div className="two-column">
      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Version history</p><h3>Published Master Agreement versions</h3></div></div>
        {loading && !state ? <p className="muted">Loading agreement versions…</p> : null}
        {!loading && !versions.length ? <div className="empty-state"><strong>No Master Agreement published</strong><p>Publish the reviewed universal legal PDF before a new SellerTray service-delivery activation is allowed.</p></div> : null}
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
      <div className="panel-head"><div><p className="eyebrow">Publish reviewed version</p><h3>New universal Master Agreement</h3></div>{!state?.canPublish ? <span className="role-pill">Review only</span> : null}</div>
      <div className="governance-note">Upload the exact reviewed text-based PDF approved for publication. SellerTray extracts and hashes its legal text, stores the source PDF immutably, and binds merchant acceptance to that governed document. Do not include merchant-specific pricing, order IDs, Branch terms or bespoke merchant clauses.</div>
      {state?.canPublish ? <form className="settings-form" onSubmit={publish}>
        <div className="settings-grid two">
          <label className="field"><span>Version code</span><input maxLength={64} required value={form.versionCode} onChange={(event) => setForm((current) => ({ ...current, versionCode: event.target.value }))} placeholder="e.g. v1.0" /></label>
          <label className="field"><span>Title</span><input maxLength={200} required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
          <label className="field"><span>Effective from</span><input type="datetime-local" required value={form.effectiveFrom} onChange={(event) => setForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
          <label className="field"><span>Publication reason</span><input maxLength={1000} required value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Reviewed legal successor publication" /></label>
        </div>
        <label className="field"><span>Reviewed Master Agreement PDF</span><input key={fileInputKey} type="file" accept="application/pdf,.pdf" required onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          setSourcePdf(file);
          if (!file) return;
          if (!isPdfFile(file)) setError('Upload a PDF document for the reviewed Master Agreement.');
          else if (file.size < 1 || file.size > MAX_MASTER_PDF_BYTES) setError('Reviewed Master Agreement PDF must be 8 MB or smaller.');
          else setError(null);
        }} />{sourcePdf ? <small>{sourcePdf.name} · {formatFileSize(sourcePdf.size)}</small> : <small>Text-based PDF only · maximum 8 MB</small>}</label>
        <div className="settings-actions"><button className="primary-button" disabled={saving}>{saving ? 'Publishing reviewed PDF…' : 'Publish reviewed PDF version'}</button></div>
      </form> : <p className="muted">Your ProcessEdge access is review-only for Master Agreement publication.</p>}
    </article>
  </section>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function localDateTime(date: Date) { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16); }
function messageFrom(value: unknown, fallback: string) { return value instanceof Error && value.message ? value.message : fallback; }
function isPdfFile(file: File) { return file.name.toLowerCase().endsWith('.pdf') && (!file.type || file.type === 'application/pdf'); }
function formatFileSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
async function fileToBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read the selected Master Agreement PDF.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const separator = result.indexOf(',');
      const encoded = separator >= 0 ? result.slice(separator + 1) : '';
      if (!encoded) reject(new Error('Unable to encode the selected Master Agreement PDF.'));
      else resolve(encoded);
    };
    reader.readAsDataURL(file);
  });
}
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