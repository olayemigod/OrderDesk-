import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { SellerTrayInput } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';

type Acceptance = {
  id: string;
  acceptedAt: string;
  acceptedLegalName: string;
  acceptedRole: 'owner' | 'manager';
  acceptedByCurrentUser: boolean;
};

type Agreement = {
  id: string;
  reference: string;
  family: string;
  title: string;
  templateVersion: string;
  renderedContent: string;
  contentSha256: string;
  commercialOrderId: string;
  installmentObligationId: string | null;
  supersedesAgreementId: string | null;
  isCurrent: boolean;
  issuedAt: string;
  acceptance: Acceptance | null;
};

type AgreementCenter = {
  tenantId: string;
  actorRole: 'owner' | 'manager';
  canAccept: boolean;
  agreements: Agreement[];
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

  const agreements = center?.agreements ?? [];
  const current = useMemo(() => agreements.filter((agreement) => agreement.isCurrent), [agreements]);
  const history = useMemo(() => agreements.filter((agreement) => !agreement.isCurrent), [agreements]);
  const selected = agreements.find((agreement) => agreement.id === selectedId) ?? current[0] ?? agreements[0] ?? null;

  async function load(preferredId?: string | null) {
    setLoading(true); setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('commercial-agreements', {
        body: { action: 'merchant_list', tenantId },
      });
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      setCenter(next);
      const wanted = preferredId ?? selectedId;
      setSelectedId(wanted && next.agreements.some((agreement) => agreement.id === wanted)
        ? wanted
        : next.agreements.find((agreement) => agreement.isCurrent)?.id ?? next.agreements[0]?.id ?? null);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load SellerTray commercial agreements.'));
    } finally { setLoading(false); }
  }

  async function accept(event: FormEvent) {
    event.preventDefault();
    if (!selected || !selected.isCurrent || selected.acceptance || !center?.canAccept) return;
    const name = legalName.trim().replace(/\s+/g, ' ');
    if (!name) { setError('Enter the authorised representative legal name.'); return; }
    if (!confirmed) { setError('Confirm that you are authorised and accept the agreement before continuing.'); return; }

    const commandId = acceptanceCommandIds.current.get(selected.id) ?? crypto.randomUUID();
    acceptanceCommandIds.current.set(selected.id, commandId);
    setBusy(true); setError(null); setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('commercial-agreements', {
        body: { action: 'merchant_accept', tenantId, agreementId: selected.id, legalName: name, authorityConfirmed: true, commandId },
      });
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      acceptanceCommandIds.current.delete(selected.id);
      setCenter(next);
      setSelectedId(selected.id);
      setLegalName(''); setConfirmed(false);
      setMessage('Commercial agreement accepted and recorded.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to accept this commercial agreement.'));
    } finally { setBusy(false); }
  }

  if (loading && !center) return <article className="panel"><p className="muted">Loading commercial agreements…</p></article>;

  return <section className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Legal & commercial documents</p><h2>Agreements</h2></div>
      <p className="muted">Review immutable SellerTray agreements and acceptance history. Balances, discounts and payments are managed separately under SellerTray Billing.</p>
    </div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {!agreements.length ? <article className="panel empty-state"><strong>No commercial agreements issued</strong><p>SellerTray commercial documents issued by ProcessEdge will appear here for review and acceptance.</p></article> : <div className="team-management-grid">
      <div className="panel member-list">
        {current.map((agreement) => <AgreementButton key={agreement.id} agreement={agreement} selected={selected?.id === agreement.id} onSelect={() => selectAgreement(agreement.id)} />)}
        {history.length ? <div className="nav-section">Agreement history</div> : null}
        {history.map((agreement) => <AgreementButton key={agreement.id} agreement={agreement} selected={selected?.id === agreement.id} onSelect={() => selectAgreement(agreement.id)} />)}
      </div>

      {selected ? <article className="panel member-editor">
        <div className="panel-head"><div><p className="eyebrow">{familyLabel(selected.family)}</p><h3>{selected.title}</h3><p className="muted">Reference {selected.reference} · Version {selected.templateVersion}</p></div><span className="role-pill">{selected.acceptance ? 'Accepted' : selected.isCurrent ? 'Pending' : 'Replaced'}</span></div>
        <div className="settings-grid two">
          <Fact label="Issued" value={formatDate(selected.issuedAt)} />
          <Fact label="Commercial order" value={shortId(selected.commercialOrderId)} />
          <Fact label="Agreement integrity" value={selected.contentSha256 ? `${selected.contentSha256.slice(0, 16)}…` : '—'} />
          <Fact label="Status" value={selected.isCurrent ? selected.acceptance ? 'Accepted' : 'Awaiting acceptance' : 'Replaced'} />
        </div>
        <div className="governance-note">This is the immutable agreement content recorded for your business. Replaced versions remain visible as historical evidence.</div>
        <div className="panel agreement-document"><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: 0 }}>{selected.renderedContent}</pre></div>
        {selected.acceptance ? <div className="success-banner">Accepted {formatDate(selected.acceptance.acceptedAt)} by {selected.acceptance.acceptedLegalName} ({roleLabel(selected.acceptance.acceptedRole)}).</div> : null}
        {!selected.isCurrent ? <div className="warning-banner">This agreement has been replaced. Review and accept the current replacement where required.</div> : null}
        {selected.isCurrent && !selected.acceptance && !center?.canAccept ? <div className="warning-banner">Only the Business Owner or a Manager explicitly authorised by the Owner can accept SellerTray commercial agreements.</div> : null}
        {selected.isCurrent && !selected.acceptance && center?.canAccept ? <form className="settings-form" onSubmit={accept}>
          <label className="field"><span>Authorised representative legal name</span><SellerTrayInput maxLength={200} required value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Full legal name" /></label>
          <label className="access-card"><SellerTrayInput type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>I confirm I am authorised to act for this business and accept this agreement.</strong><small>Your authenticated SellerTray identity, authority, agreement version and integrity evidence are recorded.</small></span></label>
          <div className="settings-actions"><button className="primary-button" disabled={busy || !confirmed || !legalName.trim()}>{busy ? 'Recording acceptance…' : 'Accept agreement'}</button></div>
        </form> : null}
      </article> : null}
    </div>}
  </section>;

  function selectAgreement(id: string) { setSelectedId(id); setLegalName(''); setConfirmed(false); }
}

function AgreementButton({ agreement, selected, onSelect }: { agreement: Agreement; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={selected ? 'member-row active' : 'member-row'} onClick={onSelect}>
    <span className="member-avatar">{agreement.isCurrent ? 'A' : 'H'}</span>
    <span><strong>{agreement.title}</strong><small>{agreement.reference} · {agreement.acceptance ? 'Accepted' : agreement.isCurrent ? 'Pending' : 'Replaced'}</small></span>
  </button>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function familyLabel(value: string) { return value.split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' '); }
function roleLabel(value: string) { return value === 'owner' ? 'Owner' : 'Manager'; }
function shortId(value: string) { return value ? `${value.slice(0, 8)}…` : '—'; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function parseCenter(value: unknown): AgreementCenter {
  const root = record(value);
  const actorRole = root.actorRole === 'owner' ? 'owner' : 'manager';
  const agreements = Array.isArray(root.agreements) ? root.agreements.flatMap((raw) => {
    const row = record(raw);
    if (typeof row.id !== 'string') return [];
    const acceptanceRow = record(row.acceptance);
    const acceptance = typeof acceptanceRow.id === 'string' ? {
      id: acceptanceRow.id,
      acceptedAt: String(acceptanceRow.acceptedAt ?? ''),
      acceptedLegalName: String(acceptanceRow.acceptedLegalName ?? ''),
      acceptedRole: acceptanceRow.acceptedRole === 'owner' ? 'owner' : 'manager',
      acceptedByCurrentUser: acceptanceRow.acceptedByCurrentUser === true,
    } satisfies Acceptance : null;
    return [{
      id: row.id,
      reference: String(row.reference ?? ''),
      family: String(row.family ?? ''),
      title: String(row.title ?? 'SellerTray agreement'),
      templateVersion: String(row.templateVersion ?? ''),
      renderedContent: String(row.renderedContent ?? ''),
      contentSha256: String(row.contentSha256 ?? ''),
      commercialOrderId: String(row.commercialOrderId ?? ''),
      installmentObligationId: typeof row.installmentObligationId === 'string' ? row.installmentObligationId : null,
      supersedesAgreementId: typeof row.supersedesAgreementId === 'string' ? row.supersedesAgreementId : null,
      isCurrent: row.isCurrent === true,
      issuedAt: String(row.issuedAt ?? ''),
      acceptance,
    } satisfies Agreement];
  }) : [];
  return { tenantId: String(root.tenantId ?? ''), actorRole, canAccept: root.canAccept === true, agreements };
}
