import { useEffect, useRef, useState, type FormEvent } from 'react';
import CommercialAgreementPackageManagement from './CommercialAgreementPackageManagement';
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

type MasterReviewDocument = {
  documentKind: 'master_agreement_pdf';
  agreementVersionId: string;
  versionCode: string;
  title: string;
  contentSha256: string;
  pdfSha256: string;
  byteSize: number;
  fileName: string;
  signedUrl: string;
  expiresInSeconds: number;
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
  const [reviewDocument, setReviewDocument] = useState<MasterReviewDocument | null>(null);
  const [reviewedPdfSha256, setReviewedPdfSha256] = useState<string | null>(null);
  const [legalName, setLegalName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
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
      setReviewDocument(null);
      setReviewedPdfSha256(null);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load SellerTray agreements.'));
    } finally {
      setLoading(false);
    }
  }

  async function openMasterAgreement() {
    const master = center?.masterAgreement;
    if (!master || !center?.masterAcceptanceRequired || center.orderForms.length || documentBusy) return;
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setDocumentBusy(true);
    setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreement-prepurchase', {
        body: { action: 'merchant_get_document', tenantId, agreementVersionId: master.id },
      });
      if (functionError) throw functionError;
      const document = parseReviewDocument(record(data).document);
      setReviewDocument(document);
      if (popup) {
        setReviewedPdfSha256(document.pdfSha256);
        popup.location.href = document.signedUrl;
      }
    } catch (cause) {
      if (popup) popup.close();
      setError(errorMessage(cause, 'Unable to open the current SellerTray Master Agreement PDF.'));
    } finally {
      setDocumentBusy(false);
    }
  }

  async function acceptPrepurchaseMaster(event: FormEvent) {
    event.preventDefault();
    const master = center?.masterAgreement;
    const reviewReady = Boolean(reviewDocument && reviewedPdfSha256 === reviewDocument.pdfSha256);
    if (!master || !center?.canAccept || !center.masterAcceptanceRequired || center.orderForms.length || !reviewDocument || !reviewReady) return;
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
          action: 'merchant_accept',
          tenantId,
          agreementVersionId: master.id,
          legalName: name,
          authorityConfirmed: true,
          reviewedPdfSha256: reviewDocument.pdfSha256,
          reviewedContentSha256: reviewDocument.contentSha256,
          commandId,
        },
      });
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      commandIds.current.delete(master.id);
      setCenter(next);
      setReviewDocument(null);
      setReviewedPdfSha256(null);
      setLegalName('');
      setConfirmed(false);
      setMessage('Master Agreement accepted. SellerTray Billing is now the governed next step for the Business Owner.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to accept the SellerTray Master Agreement.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !center) return <article className="panel"><p className="muted">Loading agreements…</p></article>;
  if (center?.orderForms.length) return <CommercialAgreementPackageManagement tenantId={tenantId} />;

  const master = center?.masterAgreement ?? null;
  const reviewReady = Boolean(reviewDocument && reviewedPdfSha256 === reviewDocument.pdfSha256);
  return <section className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Commercial</p><h2>Agreements</h2></div>
      <p className="muted">Review and accept the current SellerTray Master Agreement once for this Business. Purchase-specific Order Forms are created and confirmed separately for each governed commercial purchase or change.</p>
    </div>

    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {!master ? <article className="panel empty-state">
      <strong>Master Agreement not yet published</strong>
      <p>ProcessEdge must publish the current SellerTray Master Agreement before the first commercial purchase can begin.</p>
    </article> : <article className="panel agreement-brand-panel">
      <div className="agreement-brand-heading">
        <img className="agreement-brand-logo" src="/brand/sellertray-logo-v2.svg" alt="SellerTray" />
        <div><p className="eyebrow">Master Agreement</p><h3>{master.title}</h3><p className="muted">Version {master.versionCode} · Effective {formatDate(master.effectiveFrom)}</p></div>
        <span className="role-pill">{center?.masterAcceptanceRequired ? 'Acceptance required' : 'Accepted'}</span>
      </div>

      <div className="settings-grid two">
        <Fact label="Version" value={master.versionCode} />
        <Fact label="Status" value={center?.masterAcceptanceRequired ? 'Acceptance required' : 'Accepted'} />
        <Fact label="Accepted by" value={master.acceptance?.acceptedLegalName ?? '—'} />
        <Fact label="Accepted at" value={master.acceptance?.acceptedAt ? formatDate(master.acceptance.acceptedAt) : '—'} />
      </div>

      <div className="governance-note">The Master Agreement is the continuing legal framework for this Business and is accepted once per required version. Each initial purchase, plan change or other governed commercial commitment uses its own Order Form and confirmation without re-accepting an unchanged Master Agreement.</div>

      {center?.masterAcceptanceRequired ? <div className="agreement-package-card">
        <div className="agreement-package-card-copy">
          <p className="eyebrow">Agreement document</p>
          <h3>Review Master Agreement PDF</h3>
          <p>Open the professionally formatted, exact current Master Agreement before accepting. SellerTray records the document integrity you reviewed.</p>
        </div>
        <div className="agreement-package-actions">
          <button type="button" className="primary-button" disabled={documentBusy} onClick={() => void openMasterAgreement()}>{documentBusy ? 'Opening agreement…' : reviewReady ? 'Review agreement again' : 'Review Master Agreement'}</button>
          {reviewDocument && !reviewReady ? <a className="primary-button agreement-document-link" href={reviewDocument.signedUrl} target="_blank" rel="noreferrer" onClick={() => setReviewedPdfSha256(reviewDocument.pdfSha256)}>Open agreement</a> : null}
          {reviewReady ? <small>Master Agreement opened for review. You can accept below when ready.</small> : null}
        </div>
      </div> : null}

      {!center?.masterAcceptanceRequired ? <div className="success-banner">Master Agreement accepted. Continue to SellerTray Billing to choose or change the governed plan. The resulting commercial commitment will have its own Order Form.</div> : null}
      {center?.masterAcceptanceRequired && !center.canAccept ? <div className="warning-banner">Your current role cannot accept this Master Agreement. Use an authorised Business representative before the first purchase can proceed.</div> : null}

      {center?.masterAcceptanceRequired && center.canAccept ? <form className="settings-form agreement-signature-form" onSubmit={acceptPrepurchaseMaster}>
        <div className={`agreement-review-status ${reviewReady ? 'ready' : ''}`}><strong>{reviewReady ? 'Master Agreement reviewed and ready to accept' : 'Review the Master Agreement PDF before continuing'}</strong><span>{reviewReady ? 'SellerTray will record your authenticated acceptance against the exact Master Agreement PDF you opened.' : 'Use Review Master Agreement above to open the exact current document.'}</span></div>
        <label className="field"><span>Authorised representative legal name</span><SellerTrayInput maxLength={200} required value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Full legal name" /></label>
        <label className="access-card"><SellerTrayInput type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>I confirm I am authorised to act for this Business and accept this current SellerTray Master Agreement.</strong><small>This accepts only the current Master Agreement. It does not confirm any purchase, plan or Order Form.</small></span></label>
        <div className="settings-actions"><button className="primary-button" disabled={busy || !confirmed || !legalName.trim() || !reviewReady}>{busy ? 'Recording acceptance…' : 'Accept & Continue'}</button></div>
      </form> : null}
    </article>}
  </section>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function parseAcceptance(value: unknown): MasterAcceptance | null { const row = record(value); if (typeof row.id !== 'string') return null; return { id: row.id, acceptedAt: String(row.acceptedAt ?? ''), acceptedLegalName: String(row.acceptedLegalName ?? ''), acceptedRole: row.acceptedRole === 'manager' ? 'manager' : 'owner' }; }
function parseMaster(value: unknown): MasterAgreement | null { const row = record(value); if (typeof row.id !== 'string') return null; return { id: row.id, versionCode: String(row.versionCode ?? ''), title: String(row.title ?? 'SellerTray Master Agreement'), contentBody: String(row.contentBody ?? ''), contentSha256: String(row.contentSha256 ?? ''), effectiveFrom: String(row.effectiveFrom ?? ''), acceptance: parseAcceptance(row.acceptance) }; }
function parseReviewDocument(value: unknown): MasterReviewDocument {
  const row = record(value);
  const result: MasterReviewDocument = {
    documentKind: 'master_agreement_pdf',
    agreementVersionId: String(row.agreementVersionId ?? ''),
    versionCode: String(row.versionCode ?? ''),
    title: String(row.title ?? 'SellerTray Master Agreement'),
    contentSha256: String(row.contentSha256 ?? ''),
    pdfSha256: String(row.pdfSha256 ?? ''),
    byteSize: Number(row.byteSize ?? 0),
    fileName: String(row.fileName ?? 'SellerTray-Master-Agreement.pdf'),
    signedUrl: String(row.signedUrl ?? ''),
    expiresInSeconds: Number(row.expiresInSeconds ?? 0),
  };
  if (!result.agreementVersionId || !result.contentSha256 || !result.pdfSha256 || !result.signedUrl) throw new Error('Master Agreement PDF response is incomplete.');
  return result;
}
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
