import { useEffect, useRef, useState, type FormEvent } from 'react';
import CommercialAgreementPackageManagement from './CommercialAgreementPackageManagement';
import { SellerTrayInput } from './SellerTrayElements';
import VerifiedPdfPreview from './VerifiedPdfPreview';
import { fetchVerifiedPdf } from './agreementPdf';
import { errorMessage, supabase } from './supabase';
import './agreement-documents.css';

type MasterAcceptance = { id: string; acceptedAt: string; acceptedLegalName: string; acceptedRole: 'owner' | 'manager' };
type MasterAgreement = { id: string; versionCode: string; title: string; contentBody: string; contentSha256: string; effectiveFrom: string; acceptance: MasterAcceptance | null };
type MasterReviewDocument = { documentKind: 'master_agreement_pdf'; agreementVersionId: string; versionCode: string; title: string; contentSha256: string; pdfSha256: string; byteSize: number; fileName: string; signedUrl: string; expiresInSeconds: number };
type AgreementCenter = { tenantId: string; actorRole: 'owner' | 'manager'; canAccept: boolean; masterAgreement: MasterAgreement | null; masterAcceptanceRequired: boolean; orderForms: unknown[] };
type Props = { tenantId: string; onContinueToBilling: () => void };

export default function CommercialAgreementsManagement({ tenantId, onContinueToBilling }: Props) {
  const [center, setCenter] = useState<AgreementCenter | null>(null);
  const [reviewDocument, setReviewDocument] = useState<MasterReviewDocument | null>(null);
  const [reviewedPdfSha256, setReviewedPdfSha256] = useState<string | null>(null);
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const commandIds = useRef(new Map<string, string>());

  useEffect(() => { void load(); }, [tenantId]);
  useEffect(() => {
    if (!previewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreviewOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); };
  }, [previewOpen]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', { body: { action: 'merchant_get', tenantId } });
      if (functionError) throw functionError;
      setCenter(parseCenter(record(data).center));
      clearPreview();
    } catch (cause) { setError(errorMessage(cause, 'Unable to load SellerTray agreements.')); }
    finally { setLoading(false); }
  }

  function clearPreview() {
    setReviewDocument(null); setReviewedPdfSha256(null); setPreviewBytes(null); setPreviewOpen(false);
  }

  async function openMasterAgreement() {
    const master = center?.masterAgreement;
    if (!master || documentBusy) return;
    setDocumentBusy(true); setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreement-prepurchase', { body: { action: 'merchant_get_document', tenantId, agreementVersionId: master.id } });
      if (functionError) throw functionError;
      const document = parseReviewDocument(record(data).document);
      const bytes = await fetchVerifiedPdf(document);
      setReviewDocument(document);
      setReviewedPdfSha256(null);
      setPreviewBytes(bytes);
      setPreviewOpen(true);
    } catch (cause) {
      clearPreview();
      setError(errorMessage(cause, 'Unable to load the current SellerTray Master Agreement PDF preview.'));
    } finally { setDocumentBusy(false); }
  }

  function markPreviewRendered() {
    if (reviewDocument && previewBytes && center?.masterAcceptanceRequired) setReviewedPdfSha256(reviewDocument.pdfSha256);
  }

  function handlePreviewError(message: string) {
    setReviewedPdfSha256(null);
    setError(`Master Agreement preview failed: ${message}`);
  }

  async function acceptMaster(event: FormEvent) {
    event.preventDefault();
    const master = center?.masterAgreement;
    const reviewReady = Boolean(reviewDocument && previewBytes && reviewedPdfSha256 === reviewDocument.pdfSha256);
    if (!master || !center?.canAccept || !center.masterAcceptanceRequired || !reviewDocument || !reviewReady) return;
    const name = legalName.trim().replace(/\s+/g, ' ');
    if (!name) { setError('Enter the authorised representative legal name.'); return; }
    if (!confirmed) { setError('Confirm that you are authorised and accept the current Master Agreement before continuing.'); return; }
    const commandId = commandIds.current.get(master.id) ?? crypto.randomUUID();
    commandIds.current.set(master.id, commandId);
    setBusy(true); setError(null); setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreement-prepurchase', { body: { action: 'merchant_accept', tenantId, agreementVersionId: master.id, legalName: name, authorityConfirmed: true, reviewedPdfSha256: reviewDocument.pdfSha256, reviewedContentSha256: reviewDocument.contentSha256, commandId } });
      if (functionError) throw functionError;
      commandIds.current.delete(master.id);
      setCenter(parseCenter(record(data).center));
      clearPreview(); setLegalName(''); setConfirmed(false);
      setMessage('Master Agreement accepted. Continue to Billing to prepare your SellerTray purchase.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to accept the SellerTray Master Agreement.')); }
    finally { setBusy(false); }
  }

  if (loading && !center) return <article className="panel"><p className="muted">Loading agreements…</p></article>;

  const master = center?.masterAgreement ?? null;
  const reviewReady = Boolean(reviewDocument && previewBytes && reviewedPdfSha256 === reviewDocument.pdfSha256);
  const agreementsComplete = Boolean(master?.acceptance && !center?.masterAcceptanceRequired);
  const hasOrderForms = Boolean(center?.orderForms.length);
  const currentOrderFormConfirmed = Boolean(center?.orderForms.some((value) => {
    const form = record(value);
    return form.isCurrent === true && typeof record(form.confirmation).id === 'string';
  }));

  return <section className="page-stack">
    <div className="section-heading"><div><p className="eyebrow">Commercial onboarding</p><h2>Agreements</h2></div><p className="muted">The Master Agreement is accepted once per required version. Each SellerTray purchase has its own Order Form for review and confirmation.</p></div>
    <article className="panel" aria-label="Commercial onboarding workflow">
      <div className="section-heading"><div><p className="eyebrow">Commercial onboarding</p><h3>{!agreementsComplete ? 'Step 1 of 3 · Agreements' : hasOrderForms ? 'Step 2 of 3 · Billing' : 'Agreements complete'}</h3></div><span className={`status-chip ${agreementsComplete && !hasOrderForms ? 'success' : ''}`}>{!agreementsComplete ? 'Current step' : currentOrderFormConfirmed ? 'Order Form confirmed' : hasOrderForms ? 'Purchase review' : 'Completed'}</span></div>
      <div className="settings-grid two"><Fact label="Step 1" value={agreementsComplete ? 'Agreements ✓' : 'Agreements'} /><Fact label="Step 2" value={hasOrderForms ? 'Billing · Current' : agreementsComplete ? 'Billing · Next' : 'Billing'} /><Fact label="Step 3" value="Setup & Activation" /></div>
      <p className="muted">{!agreementsComplete ? 'Review and accept the current Master Agreement to continue.' : currentOrderFormConfirmed ? 'Purchase confirmed. Continue to Billing to complete the amount due.' : hasOrderForms ? 'Review and confirm the purchase-specific Order Form below. Payment remains in Billing.' : 'Continue to Billing to choose your plan and prepare the Order Form.'}</p>
      {agreementsComplete && (!hasOrderForms || currentOrderFormConfirmed) ? <div className="settings-actions"><button type="button" className="primary-button" onClick={onContinueToBilling}>Continue to Billing</button></div> : null}
    </article>

    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {!master ? <article className="panel empty-state"><strong>Master Agreement not yet published</strong><p>ProcessEdge must publish the current SellerTray Master Agreement before a new commercial commitment can proceed.</p></article> : <article className="panel agreement-brand-panel">
      <div className="agreement-brand-heading"><img className="agreement-brand-logo" src="/brand/sellertray-logo-v2.svg" alt="SellerTray" /><div><p className="eyebrow">Master Agreement</p><h3>{master.title}</h3><p className="muted">Version {master.versionCode} · Effective {formatDate(master.effectiveFrom)}</p></div><span className="role-pill">{center?.masterAcceptanceRequired ? 'Acceptance required' : 'Accepted'}</span></div>
      <div className="settings-grid two"><Fact label="Version" value={master.versionCode} /><Fact label="Status" value={center?.masterAcceptanceRequired ? 'Acceptance required' : 'Accepted'} /><Fact label="Accepted by" value={master.acceptance?.acceptedLegalName ?? '—'} /><Fact label="Accepted at" value={master.acceptance?.acceptedAt ? formatDate(master.acceptance.acceptedAt) : '—'} /></div>
      <div className="governance-note">The Master Agreement is the continuing legal framework for this Business. Purchase details such as plan, Branches, prices and installments belong to the separate Order Form.</div>
      <div className="agreement-package-card"><div className="agreement-package-card-copy"><p className="eyebrow">Agreement document</p><h3>{center?.masterAcceptanceRequired ? 'Review Master Agreement PDF' : 'View Master Agreement'}</h3><p>{center?.masterAcceptanceRequired ? 'Preview the exact current Master Agreement before accepting.' : 'The accepted Master Agreement remains available for reference without changing your acceptance record.'}</p></div><div className="agreement-package-actions"><button type="button" className={center?.masterAcceptanceRequired ? 'primary-button' : 'secondary-button'} disabled={documentBusy} onClick={() => void openMasterAgreement()}>{documentBusy ? 'Preparing preview…' : center?.masterAcceptanceRequired ? (reviewReady ? 'Review agreement again' : 'Review Master Agreement') : 'View Master Agreement'}</button>{center?.masterAcceptanceRequired && reviewReady ? <small>Verified PDF rendered successfully. Complete the representative details below.</small> : null}</div></div>
      {!center?.masterAcceptanceRequired ? <div className="success-banner">Master Agreement accepted. This document remains available here for reference.</div> : null}
      {center?.masterAcceptanceRequired && !center.canAccept ? <div className="warning-banner">Your current role cannot accept this Master Agreement. Use an authorised Business representative to continue.</div> : null}
      {center?.masterAcceptanceRequired && center.canAccept ? <form className="settings-form agreement-signature-form" onSubmit={acceptMaster}>
        <div className={`agreement-review-status ${reviewReady ? 'ready' : ''}`}><strong>{reviewReady ? 'Master Agreement rendered and ready to accept' : 'Review the Master Agreement PDF before continuing'}</strong><span>{reviewReady ? 'SellerTray will bind acceptance to the exact verified PDF rendered in the preview.' : 'Accept & Continue remains unavailable until SellerTray successfully renders the verified PDF.'}</span></div>
        <label className="field"><span>Authorised representative legal name</span><SellerTrayInput maxLength={200} required value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Full legal name" /></label>
        <label className="access-card"><SellerTrayInput type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>I confirm I am authorised to act for this Business and accept this current SellerTray Master Agreement.</strong><small>This accepts only the current Master Agreement. It does not confirm any purchase, plan or Order Form.</small></span></label>
        <div className="settings-actions"><button className="primary-button" disabled={busy || !confirmed || !legalName.trim() || !reviewReady}>{busy ? 'Recording acceptance…' : 'Accept & Continue'}</button></div>
      </form> : null}
    </article>}

    {hasOrderForms ? <CommercialAgreementPackageManagement tenantId={tenantId} onChanged={load} /> : null}

    {previewOpen && reviewDocument && previewBytes ? <div className="agreement-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}><section className="agreement-preview-modal" role="dialog" aria-modal="true" aria-labelledby="master-agreement-preview-title"><header className="agreement-preview-header"><div><p className="eyebrow">Master Agreement preview</p><h2 id="master-agreement-preview-title">{reviewDocument.title}</h2><p className="muted">Version {reviewDocument.versionCode}</p></div><button type="button" className="secondary-button agreement-preview-close" onClick={() => setPreviewOpen(false)} aria-label="Close Master Agreement preview">Close</button></header><div className="agreement-preview-frame-wrap"><VerifiedPdfPreview bytes={previewBytes} fileName={reviewDocument.fileName} title={reviewDocument.title} onFirstPageRendered={markPreviewRendered} onRenderError={handlePreviewError} /></div><footer className="agreement-preview-footer"><div className={`agreement-review-status ${reviewReady ? 'ready' : ''}`}><strong>{center?.masterAcceptanceRequired ? (reviewReady ? 'Agreement PDF rendered successfully' : 'Rendering agreement PDF…') : 'Master Agreement ready to view'}</strong><span>{center?.masterAcceptanceRequired ? (reviewReady ? 'The exact verified PDF is marked as reviewed for this acceptance session.' : 'Accept & Continue remains locked until the first page is actually rendered.') : 'Closing this preview does not change your existing acceptance record.'}</span></div><button type="button" className="primary-button" disabled={Boolean(center?.masterAcceptanceRequired) && !reviewReady} onClick={() => setPreviewOpen(false)}>{center?.masterAcceptanceRequired ? (reviewReady ? 'Close preview & continue' : 'Rendering preview…') : 'Close preview'}</button></footer></section></div> : null}
  </section>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function parseAcceptance(value: unknown): MasterAcceptance | null { const row = record(value); if (typeof row.id !== 'string') return null; return { id: row.id, acceptedAt: String(row.acceptedAt ?? ''), acceptedLegalName: String(row.acceptedLegalName ?? ''), acceptedRole: row.acceptedRole === 'manager' ? 'manager' : 'owner' }; }
function parseMaster(value: unknown): MasterAgreement | null { const row = record(value); if (typeof row.id !== 'string') return null; return { id: row.id, versionCode: String(row.versionCode ?? ''), title: String(row.title ?? 'SellerTray Master Agreement'), contentBody: String(row.contentBody ?? ''), contentSha256: String(row.contentSha256 ?? ''), effectiveFrom: String(row.effectiveFrom ?? ''), acceptance: parseAcceptance(row.acceptance) }; }
function parseReviewDocument(value: unknown): MasterReviewDocument { const row = record(value); const result: MasterReviewDocument = { documentKind: 'master_agreement_pdf', agreementVersionId: String(row.agreementVersionId ?? ''), versionCode: String(row.versionCode ?? ''), title: String(row.title ?? 'SellerTray Master Agreement'), contentSha256: String(row.contentSha256 ?? ''), pdfSha256: String(row.pdfSha256 ?? '').toLowerCase(), byteSize: Number(row.byteSize ?? 0), fileName: String(row.fileName ?? 'SellerTray-Master-Agreement.pdf'), signedUrl: String(row.signedUrl ?? ''), expiresInSeconds: Number(row.expiresInSeconds ?? 0) }; if (!result.agreementVersionId || !result.contentSha256 || !result.pdfSha256 || !result.signedUrl) throw new Error('Master Agreement PDF response is incomplete.'); return result; }
function parseCenter(value: unknown): AgreementCenter { const root = record(value); return { tenantId: String(root.tenantId ?? ''), actorRole: root.actorRole === 'manager' ? 'manager' : 'owner', canAccept: root.canAccept === true, masterAgreement: parseMaster(root.masterAgreement), masterAcceptanceRequired: root.masterAcceptanceRequired === true, orderForms: Array.isArray(root.orderForms) ? root.orderForms : [] }; }
