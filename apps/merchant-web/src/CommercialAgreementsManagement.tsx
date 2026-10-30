import { useEffect, useRef, useState, type FormEvent } from 'react';
import CommercialAgreementPackageManagement from './CommercialAgreementPackageManagement';
import {
  MerchantEmptyState,
  MerchantFact,
  MerchantFactGrid,
  MerchantLoadingState,
  MerchantNotice,
  MerchantPageHeader,
  MerchantStatusBadge,
} from './MerchantPagePrimitives';
import { SellerTrayInput } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';
import './agreement-documents.css';

type MasterAcceptance = {
  id: string;
  acceptedAt: string;
  acceptedLegalName: string;
  acceptedRole: 'owner' | 'manager';
};

type MasterAgreement = {
  id: string;
  versionCode: string;
  title: string;
  contentBody: string;
  contentSha256: string;
  effectiveFrom: string;
  acceptance: MasterAcceptance | null;
};

type AgreementCenter = {
  tenantId: string;
  actorRole: 'owner' | 'manager';
  canAccept: boolean;
  masterAgreement: MasterAgreement | null;
  masterAcceptanceRequired: boolean;
  orderForms: unknown[];
};

export default function CommercialAgreementsManagement({ tenantId }: { tenantId: string }) {
  const [center, setCenter] = useState<AgreementCenter | null>(null);
  const [legalName, setLegalName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const commandIds = useRef(new Map<string, string>());

  useEffect(() => { void load(); }, [tenantId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', {
        body: { action: 'merchant_get', tenantId },
      });
      if (functionError) throw functionError;
      setCenter(parseCenter(record(data).center));
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load SellerTray agreements.'));
    } finally {
      setLoading(false);
    }
  }

  async function acceptPrepurchaseMaster(event: FormEvent) {
    event.preventDefault();
    const master = center?.masterAgreement;
    if (!master || !center?.canAccept || !center.masterAcceptanceRequired || center.orderForms.length) return;
    const name = legalName.trim().replace(/\s+/g, ' ');
    if (!name) { setError('Enter the authorised representative legal name.'); return; }
    if (!confirmed) { setError('Confirm that you are authorised and accept the current Master Agreement before continuing.'); return; }

    const commandId = commandIds.current.get(master.id) ?? crypto.randomUUID();
    commandIds.current.set(master.id, commandId);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreement-prepurchase', {
        body: {
          tenantId,
          agreementVersionId: master.id,
          legalName: name,
          authorityConfirmed: true,
          commandId,
        },
      });
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      commandIds.current.delete(master.id);
      setCenter(next);
      setLegalName('');
      setConfirmed(false);
      setMessage('Master Agreement accepted. Continue to SellerTray Billing to choose your plan.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to accept the SellerTray Master Agreement.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !center) return <MerchantLoadingState label="Loading agreements…" />;
  if (center?.orderForms.length) return <CommercialAgreementPackageManagement tenantId={tenantId} />;

  const master = center?.masterAgreement ?? null;
  return <section className="page-stack">
    <MerchantPageHeader eyebrow="Legal" title="Agreements" description="Review and accept the current SellerTray Master Agreement before choosing your first plan. Your purchase terms will be shown in an Order Form after you confirm your subscription." />

    {error ? <MerchantNotice tone="error" onDismiss={() => setError(null)}>{error}</MerchantNotice> : null}
    {message ? <MerchantNotice tone="success" onDismiss={() => setMessage(null)}>{message}</MerchantNotice> : null}

    {!master ? <MerchantEmptyState title="Master Agreement not yet published" body="ProcessEdge must publish the current SellerTray Master Agreement before the first subscription purchase can begin." /> : <article className="panel agreement-brand-panel">
      <div className="agreement-brand-heading">
        <img className="agreement-brand-logo" src="/brand/sellertray-logo-v2.svg" alt="SellerTray" />
        <div><p className="eyebrow">Master Agreement</p><h3>{master.title}</h3><p className="muted">Version {master.versionCode} · Effective {formatDate(master.effectiveFrom)}</p></div>
        <MerchantStatusBadge tone={center?.masterAcceptanceRequired ? 'warning' : 'success'}>{center?.masterAcceptanceRequired ? 'Acceptance required' : 'Accepted'}</MerchantStatusBadge>
      </div>

      <MerchantFactGrid>
        <MerchantFact label="Version" value={master.versionCode} />
        <MerchantFact label="Status" value={center?.masterAcceptanceRequired ? 'Acceptance required' : 'Accepted'} />
        <MerchantFact label="Accepted by" value={master.acceptance?.acceptedLegalName ?? '—'} />
        <MerchantFact label="Accepted at" value={master.acceptance?.acceptedAt ? formatDate(master.acceptance.acceptedAt) : '—'} />
      </MerchantFactGrid>

      <MerchantNotice tone="info">The Master Agreement applies to your use of SellerTray. After accepting it, continue to Billing to choose your plan and Branches. Your purchase terms will then be shown in an Order Form for review and confirmation.</MerchantNotice>
      <details className="agreement-transcript" open><summary>Read Master Agreement text</summary><div className="panel agreement-document"><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: 0 }}>{master.contentBody}</pre></div></details>

      {!center?.masterAcceptanceRequired ? <MerchantNotice tone="success">Master Agreement accepted. Continue to SellerTray Billing to choose your plan and complete your first purchase.</MerchantNotice> : null}
      {center?.masterAcceptanceRequired && !center.canAccept ? <MerchantNotice tone="warning">Your current role cannot accept this Master Agreement. Use an authorised Business representative before the first purchase can proceed.</MerchantNotice> : null}

      {center?.masterAcceptanceRequired && center.canAccept ? <form className="settings-form agreement-signature-form" onSubmit={acceptPrepurchaseMaster}>
        <label className="field"><span>Authorised representative legal name</span><SellerTrayInput maxLength={200} required value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Full legal name" /></label>
        <label className="access-card"><SellerTrayInput type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>I confirm I am authorised to act for this Business and accept this current SellerTray Master Agreement.</strong><small>Your signed-in SellerTray account, legal name, agreement version and acceptance time are recorded. This does not confirm a purchase.</small></span></label>
        <div className="settings-actions"><button className="primary-button" disabled={busy || !confirmed || !legalName.trim()}>{busy ? 'Recording acceptance…' : 'Accept & Continue'}</button></div>
      </form> : null}
    </article>}
  </section>;
}

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function parseAcceptance(value: unknown): MasterAcceptance | null { const row = record(value); if (typeof row.id !== 'string') return null; return { id: row.id, acceptedAt: String(row.acceptedAt ?? ''), acceptedLegalName: String(row.acceptedLegalName ?? ''), acceptedRole: row.acceptedRole === 'manager' ? 'manager' : 'owner' }; }
function parseMaster(value: unknown): MasterAgreement | null { const row = record(value); if (typeof row.id !== 'string') return null; return { id: row.id, versionCode: String(row.versionCode ?? ''), title: String(row.title ?? 'SellerTray Master Agreement'), contentBody: String(row.contentBody ?? ''), contentSha256: String(row.contentSha256 ?? ''), effectiveFrom: String(row.effectiveFrom ?? ''), acceptance: parseAcceptance(row.acceptance) }; }
function parseCenter(value: unknown): AgreementCenter {
  const root = record(value);
  return {
    tenantId: String(root.tenantId ?? ''),
    actorRole: root.actorRole === 'manager' ? 'manager' : 'owner',
    canAccept: root.canAccept === true,
    masterAgreement: parseMaster(root.masterAgreement),
    masterAcceptanceRequired: root.masterAcceptanceRequired === true,
    orderForms: Array.isArray(root.orderForms) ? root.orderForms : [],
  };
}
