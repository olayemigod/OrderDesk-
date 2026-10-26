import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { SellerTrayInput } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';

type Acceptance = {
  id: string;
  acceptedAt: string;
  acceptedLegalName: string;
  acceptedRole: 'owner' | 'manager';
  acceptedByCurrentUser?: boolean;
};

type AgreementVersion = {
  id: string;
  versionCode: string;
  title: string;
  contentBody: string;
  contentSha256: string;
  effectiveFrom: string;
  publishedAt: string;
  acceptance: Acceptance | null;
};

type AgreementCenter = {
  tenantId: string;
  actorRole: 'owner' | 'manager';
  canAccept: boolean;
  published: boolean;
  accepted: boolean;
  acceptanceRequired: boolean;
  serviceDeliveryAllowed: boolean;
  currentVersion: AgreementVersion | null;
  acceptance: Acceptance | null;
  versions: AgreementVersion[];
};

export default function CommercialAgreementsManagement({ tenantId }: { tenantId: string }) {
  const [center, setCenter] = useState<AgreementCenter | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legalName, setLegalName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const acceptanceCommandIds = useRef(new Map<string, string>());

  useEffect(() => { void load(); }, [tenantId]);

  const versions = center?.versions ?? [];
  const current = center?.currentVersion ?? null;
  const selected = useMemo(
    () => versions.find((version) => version.id === selectedId) ?? current ?? versions[0] ?? null,
    [versions, selectedId, current],
  );

  async function load(preferredId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', {
        body: { action: 'merchant_get', tenantId },
      });
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      setCenter(next);
      const wanted = preferredId ?? selectedId;
      setSelectedId(wanted && next.versions.some((version) => version.id === wanted)
        ? wanted
        : next.currentVersion?.id ?? next.versions[0]?.id ?? null);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load the SellerTray Master Agreement.'));
    } finally {
      setLoading(false);
    }
  }

  async function accept(event: FormEvent) {
    event.preventDefault();
    if (!center?.currentVersion || center.accepted || !center.canAccept) return;
    const name = legalName.trim().replace(/\s+/g, ' ');
    if (!name) { setError('Enter the authorised representative legal name.'); return; }
    if (!confirmed) { setError('Confirm that you are authorised and accept the Master Agreement before continuing.'); return; }

    const versionId = center.currentVersion.id;
    const commandId = acceptanceCommandIds.current.get(versionId) ?? crypto.randomUUID();
    acceptanceCommandIds.current.set(versionId, commandId);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', {
        body: {
          action: 'merchant_accept',
          tenantId,
          agreementVersionId: versionId,
          legalName: name,
          authorityConfirmed: true,
          commandId,
        },
      });
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      acceptanceCommandIds.current.delete(versionId);
      setCenter(next);
      setSelectedId(versionId);
      setLegalName('');
      setConfirmed(false);
      setMessage(`Master Agreement version ${next.currentVersion?.versionCode ?? ''} accepted and recorded.`.trim());
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to accept the SellerTray Master Agreement.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !center) return <article className="panel"><p className="muted">Loading Master Agreement…</p></article>;

  return <section className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Legal agreement</p><h2>SellerTray Master Agreement</h2></div>
      <p className="muted">One platform-wide agreement applies to every SellerTray Business. Your Business accepts each published version once; new orders do not require the same agreement again.</p>
    </div>

    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {!center?.published || !current ? <article className="panel empty-state">
      <strong>Master Agreement not yet published</strong>
      <p>ProcessEdge must publish the universal SellerTray Master Agreement before a new service-delivery activation can complete. Commercial orders and payments remain separate.</p>
    </article> : <div className="team-management-grid">
      <div className="panel member-list">
        {versions.map((version) => <button
          key={version.id}
          type="button"
          className={selected?.id === version.id ? 'member-row active' : 'member-row'}
          onClick={() => { setSelectedId(version.id); setLegalName(''); setConfirmed(false); }}
        >
          <span className="member-avatar">{version.id === current.id ? 'C' : 'H'}</span>
          <span><strong>{version.title}</strong><small>Version {version.versionCode} · {version.acceptance ? 'Accepted' : version.id === current.id ? 'Current' : 'Historical'}</small></span>
        </button>)}
      </div>

      {selected ? <article className="panel member-editor">
        <div className="panel-head">
          <div><p className="eyebrow">{selected.id === current.id ? 'Current universal version' : 'Version history'}</p><h3>{selected.title}</h3><p className="muted">Version {selected.versionCode}</p></div>
          <span className="role-pill">{selected.acceptance ? 'Accepted' : selected.id === current.id ? 'Pending' : 'Historical'}</span>
        </div>

        <div className="settings-grid two">
          <Fact label="Effective" value={formatDate(selected.effectiveFrom)} />
          <Fact label="Published" value={formatDate(selected.publishedAt)} />
          <Fact label="Agreement integrity" value={selected.contentSha256 ? `${selected.contentSha256.slice(0, 16)}…` : '—'} />
          <Fact label="Applies to" value="All SellerTray Businesses" />
        </div>

        <div className="governance-note">This exact published version is identical for every SellerTray merchant. It is independent of your commercial orders, plans, Branches and payment schedule.</div>
        <div className="panel agreement-document"><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: 0 }}>{selected.contentBody}</pre></div>

        {selected.acceptance ? <div className="success-banner">Accepted {formatDate(selected.acceptance.acceptedAt)} by {selected.acceptance.acceptedLegalName} ({roleLabel(selected.acceptance.acceptedRole)}).</div> : null}
        {selected.id !== current.id && !selected.acceptance ? <div className="governance-note">This historical version was not accepted by this Business. Only the current required version controls new service delivery.</div> : null}
        {selected.id === current.id && !center.canAccept && !center.accepted ? <div className="warning-banner">Only the Business Owner or a Manager explicitly authorised by the Owner can accept the current Master Agreement.</div> : null}

        {selected.id === current.id && !center.accepted && center.canAccept ? <form className="settings-form" onSubmit={accept}>
          <label className="field"><span>Authorised representative legal name</span><SellerTrayInput maxLength={200} required value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Full legal name" /></label>
          <label className="access-card"><SellerTrayInput type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>I confirm I am authorised to act for this Business and accept this SellerTray Master Agreement version.</strong><small>Your authenticated identity, authority, version and content integrity evidence are recorded once for this Business.</small></span></label>
          <div className="settings-actions"><button className="primary-button" disabled={busy || !confirmed || !legalName.trim()}>{busy ? 'Recording acceptance…' : 'Accept Master Agreement'}</button></div>
        </form> : null}
      </article> : null}
    </div>}
  </section>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function roleLabel(value: string) { return value === 'owner' ? 'Owner' : 'Manager'; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function parseAcceptance(value: unknown): Acceptance | null {
  const row = record(value);
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    acceptedAt: String(row.acceptedAt ?? ''),
    acceptedLegalName: String(row.acceptedLegalName ?? ''),
    acceptedRole: row.acceptedRole === 'owner' ? 'owner' : 'manager',
    acceptedByCurrentUser: row.acceptedByCurrentUser === true,
  };
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
    acceptance: parseAcceptance(row.acceptance),
  };
}
function parseCenter(value: unknown): AgreementCenter {
  const root = record(value);
  const versions = Array.isArray(root.versions) ? root.versions.flatMap((item) => {
    const parsed = parseVersion(item);
    return parsed ? [parsed] : [];
  }) : [];
  const current = parseVersion(root.currentVersion);
  const acceptance = parseAcceptance(root.acceptance);
  return {
    tenantId: String(root.tenantId ?? ''),
    actorRole: root.actorRole === 'owner' ? 'owner' : 'manager',
    canAccept: root.canAccept === true,
    published: root.published === true,
    accepted: root.accepted === true,
    acceptanceRequired: root.acceptanceRequired === true,
    serviceDeliveryAllowed: root.serviceDeliveryAllowed === true,
    currentVersion: current ? { ...current, acceptance } : null,
    acceptance,
    versions,
  };
}
