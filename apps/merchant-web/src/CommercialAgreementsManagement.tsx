import { SellerTrayInput } from './SellerTrayElements';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AgreementDocumentRequestGate } from './agreement-document-request';
import { errorMessage, supabase } from './supabase';

type MasterAcceptance = { id: string; acceptedAt: string; acceptedLegalName: string; acceptedRole: 'owner' | 'manager' };
type MasterAgreement = { id: string; versionCode: string; title: string; contentSha256: string; effectiveFrom: string; acceptance: MasterAcceptance | null };
type OrderFormConfirmation = { id: string; confirmedAt: string; confirmedLegalName: string; confirmedRole: 'owner' | 'manager'; packageFingerprint: string };
type PriceLine = { lineNo: number; description: string; quantity: number; currency: string; grossAmount: number; taxRatePercent: number | null; taxAmount: number };
type InstallmentLine = { sequenceNo: number; percentage: number; amountDue: number; dueAt: string | null };
type CommercialSnapshot = {
  businessName: string; businessEmail: string; businessPhone: string; orderReference: string; currency: string;
  totalGrossAmount: number; orderedAt: string; approvedAdjustmentAmount: number; netAmountDue: number;
  priceLines: PriceLine[]; installmentStructure: string | null; installmentAmount: number | null; installmentSchedule: InstallmentLine[];
};
type OrderForm = {
  id: string; reference: string; title: string; templateVersion: string; contentSha256: string;
  commercialSnapshotSha256: string; commercialSnapshot: CommercialSnapshot; commercialOrderId: string;
  installmentObligationId: string | null; supersedesOrderFormId: string | null; isCurrent: boolean; issuedAt: string;
  confirmation: OrderFormConfirmation | null;
};
type AgreementCenter = { tenantId: string; actorRole: 'owner' | 'manager'; canAccept: boolean; masterAgreement: MasterAgreement | null; masterAcceptanceRequired: boolean; orderForms: OrderForm[] };
type ConfirmResult = { masterAcceptanceCreated: boolean; orderFormConfirmationCreated: boolean; agreementPackageId: string; packageFingerprint: string };
type AgreementDocument = {
  artifactId: string; artifactKind: 'review_pdf' | 'executed_pdf'; packageId: string; packageFingerprint: string;
  pdfSha256: string; byteSize: number; generatedAt: string; fileName: string; signedUrl: string; expiresInSeconds: number;
};
type AgreementDocumentRequest = ReturnType<AgreementDocumentRequestGate['begin']>;
type AgreementDocumentState = { request: AgreementDocumentRequest; document: AgreementDocument };
type ViewerKind = AgreementDocument['artifactKind'] | null;

export default function CommercialAgreementsManagement({ tenantId }: { tenantId: string }) {
  const [center, setCenter] = useState<AgreementCenter | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legalName, setLegalName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [reviewDocumentState, setReviewDocumentState] = useState<AgreementDocumentState | null>(null);
  const [executedDocumentState, setExecutedDocumentState] = useState<AgreementDocumentState | null>(null);
  const [reviewedFingerprint, setReviewedFingerprint] = useState<string | null>(null);
  const [viewerKind, setViewerKind] = useState<ViewerKind>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState<AgreementDocument['artifactKind'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const confirmationCommandIds = useRef(new Map<string, string>());
  const documentRequestGate = useRef(new AgreementDocumentRequestGate());
  const activeTenantId = useRef(tenantId);
  const loadRequestGeneration = useRef(0);

  if (activeTenantId.current !== tenantId) {
    activeTenantId.current = tenantId;
    loadRequestGeneration.current += 1;
    documentRequestGate.current.invalidate(tenantId, null);
  }

  useEffect(() => {
    setCenter(null);
    setSelectedId(null);
    invalidateDocumentRequest(null);
    void load();
    return () => {
      loadRequestGeneration.current += 1;
      documentRequestGate.current.invalidate(tenantId, null);
    };
  }, [tenantId]);

  useEffect(() => {
    if (!viewerKind) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setViewerKind(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [viewerKind]);

  const orderForms = center?.orderForms ?? [];
  const current = useMemo(() => orderForms.filter((form) => form.isCurrent), [orderForms]);
  const history = useMemo(() => orderForms.filter((form) => !form.isCurrent), [orderForms]);
  const selected = orderForms.find((form) => form.id === selectedId) ?? current[0] ?? orderForms[0] ?? null;
  const actionRequired = Boolean(selected?.isCurrent && (center?.masterAcceptanceRequired || !selected.confirmation));
  const reviewDocument = currentDocument(reviewDocumentState, selected, tenantId, documentRequestGate.current);
  const executedDocument = currentDocument(executedDocumentState, selected, tenantId, documentRequestGate.current);
  const viewerDocument = viewerKind === 'review_pdf' ? reviewDocument : viewerKind === 'executed_pdf' ? executedDocument : null;
  const reviewReady = Boolean(reviewDocument && reviewedFingerprint === reviewDocument.packageFingerprint);

  async function load(preferredId?: string | null) {
    const requestTenantId = tenantId;
    const requestGeneration = ++loadRequestGeneration.current;
    setLoading(true); setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', { body: { action: 'merchant_get', tenantId: requestTenantId } });
      if (requestGeneration !== loadRequestGeneration.current || activeTenantId.current !== requestTenantId) return;
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      const wanted = preferredId ?? selectedId;
      const nextSelectedId = wanted && next.orderForms.some((form) => form.id === wanted)
        ? wanted
        : next.orderForms.find((form) => form.isCurrent && !form.confirmation)?.id
          ?? next.orderForms.find((form) => form.isCurrent)?.id
          ?? next.orderForms[0]?.id ?? null;
      setCenter(next);
      replaceSelection(nextSelectedId);
    } catch (cause) {
      if (requestGeneration === loadRequestGeneration.current && activeTenantId.current === requestTenantId) setError(errorMessage(cause, 'Unable to load SellerTray agreements.'));
    } finally {
      if (requestGeneration === loadRequestGeneration.current && activeTenantId.current === requestTenantId) setLoading(false);
    }
  }

  async function openDocument(artifactKind: AgreementDocument['artifactKind']) {
    if (!selected || documentBusy) return;
    const request = documentRequestGate.current.begin(tenantId, selected.id);
    setViewerKind(artifactKind);
    setDocumentBusy(artifactKind);
    setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', {
        body: { action: 'merchant_get_document', tenantId: request.tenantId, orderFormId: request.orderFormId, artifactKind },
      });
      if (!documentRequestGate.current.isCurrent(request)) return;
      if (functionError) throw functionError;
      const document = parseDocument(record(data).document);
      if (artifactKind === 'review_pdf') setReviewDocumentState({ request, document });
      else setExecutedDocumentState({ request, document });
    } catch (cause) {
      if (!documentRequestGate.current.isCurrent(request)) return;
      setViewerKind(null);
      setError(errorMessage(cause, artifactKind === 'review_pdf' ? 'Unable to open this SellerTray Agreement Package.' : 'Unable to open the signed SellerTray Agreement Package.'));
    } finally {
      if (documentRequestGate.current.isCurrent(request)) setDocumentBusy(null);
    }
  }

  function markReviewOpened(document: AgreementDocument) {
    if (document.artifactKind !== 'review_pdf') return;
    const state = reviewDocumentState;
    if (!state || !documentRequestGate.current.isCurrent(state.request) || state.document.packageFingerprint !== document.packageFingerprint) return;
    setReviewedFingerprint(document.packageFingerprint);
  }

  async function confirmPackage(event: FormEvent) {
    event.preventDefault();
    if (!selected || !selected.isCurrent || !center?.canAccept || !center.masterAgreement || !actionRequired || !reviewDocument || !reviewReady) return;
    const name = legalName.trim().replace(/\s+/g, ' ');
    if (!name) { setError('Enter the authorised representative legal name.'); return; }
    if (!confirmed) { setError('Confirm your authority and approval before continuing.'); return; }

    const commandKey = `${selected.id}:${center.masterAgreement.id}:${reviewDocument.packageFingerprint}`;
    const commandId = confirmationCommandIds.current.get(commandKey) ?? crypto.randomUUID();
    confirmationCommandIds.current.set(commandKey, commandId);
    setBusy(true); setError(null); setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', {
        body: {
          action: 'merchant_confirm_package', tenantId, orderFormId: selected.id,
          expectedPackageId: reviewDocument.packageId,
          expectedPackageFingerprint: reviewDocument.packageFingerprint,
          legalName: name, authorityConfirmed: true, commandId,
        },
      });
      if (functionError) throw functionError;
      const response = record(data);
      const result = parseConfirmResult(response.result);
      const next = parseCenter(response.center);
      confirmationCommandIds.current.delete(commandKey);
      setCenter(next); setSelectedId(selected.id); setLegalName(''); setConfirmed(false); setViewerKind(null);
      setReviewDocumentState(null); setReviewedFingerprint(null); setExecutedDocumentState(null);
      setMessage(result.masterAcceptanceCreated
        ? selected.confirmation
          ? 'Current Master Agreement accepted. Your purchase confirmation remains valid.'
          : 'Agreement accepted and purchase confirmed.'
        : 'Purchase confirmed under your accepted Master Agreement.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to confirm this SellerTray agreement.')); }
    finally { setBusy(false); }
  }

  if (loading && !center) return <article className="panel agreement-loading-card"><strong>Opening Agreements</strong><p className="muted">Loading the current agreement summary…</p></article>;

  return <section className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Commercial</p><h2>Agreements</h2></div>
      <p className="muted">Review the agreement for your purchase, then accept or confirm it when required.</p>
    </div>

    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {center?.masterAgreement ? <article className="panel agreement-brand-panel">
      <div className="agreement-brand-heading">
        <img className="agreement-brand-logo" src="/brand/sellertray-logo-v2.svg" alt="SellerTray" />
        <div><p className="eyebrow">Master Agreement</p><h3>{center.masterAgreement.title}</h3><p className="muted">Version {center.masterAgreement.versionCode} · Effective {formatDate(center.masterAgreement.effectiveFrom)}</p></div>
        <span className="role-pill">{center.masterAcceptanceRequired ? 'Acceptance required' : 'Accepted'}</span>
      </div>
      <div className="settings-grid two">
        <Fact label="Version" value={center.masterAgreement.versionCode} />
        <Fact label="Status" value={center.masterAcceptanceRequired ? 'Acceptance required' : 'Accepted'} />
        <Fact label="Accepted by" value={center.masterAgreement.acceptance?.acceptedLegalName ?? '—'} />
        <Fact label="Accepted at" value={center.masterAgreement.acceptance?.acceptedAt ? formatDate(center.masterAgreement.acceptance.acceptedAt) : '—'} />
      </div>
    </article> : <div className="warning-banner">The current SellerTray Master Agreement is not available yet. You can keep your commercial record, but activation cannot proceed until the approved agreement is available.</div>}

    {!orderForms.length ? <article className="panel empty-state">
      <strong>Agreement is being prepared automatically</strong>
      <p>SellerTray creates the purchase-specific Order Form from the governed commercial order. If this status persists, ProcessEdge can reconcile the configuration without recreating your purchase.</p>
    </article> : <div className="team-management-grid">
      <div className="panel member-list">
        {current.map((form) => <OrderFormButton key={form.id} form={form} selected={selected?.id === form.id} onSelect={() => selectForm(form.id)} />)}
        {history.length ? <div className="nav-section">Order Form history</div> : null}
        {history.map((form) => <OrderFormButton key={form.id} form={form} selected={selected?.id === form.id} onSelect={() => selectForm(form.id)} />)}
      </div>

      {selected ? <article className="panel member-editor">
        <div className="panel-head">
          <div><p className="eyebrow">Order Form</p><h3>{selected.title}</h3><p className="muted">Reference {selected.reference} · Version {selected.templateVersion}</p></div>
          <Status form={selected} masterAcceptanceRequired={center?.masterAcceptanceRequired === true} />
        </div>
        <div className="settings-grid two">
          <Fact label="Created" value={formatDate(selected.issuedAt)} />
          <Fact label="Order reference" value={selected.commercialSnapshot.orderReference || selected.reference} />
        </div>

        <CommercialFacts snapshot={selected.commercialSnapshot} />

        <div className="agreement-package-card">
          <div className="agreement-package-card-copy">
            <p className="eyebrow">Agreement document</p><h3>SellerTray Agreement Package</h3>
            <p>Review the Master Agreement and the exact purchase terms together in one professional document.</p>
          </div>
          <div className="agreement-package-actions">
            <button type="button" className="primary-button" disabled={documentBusy !== null || !selected.isCurrent} onClick={() => void openDocument('review_pdf')}>{documentBusy === 'review_pdf' ? 'Preparing agreement…' : reviewReady ? 'Review agreement again' : 'Review agreement'}</button>
            {reviewReady ? <small>Agreement opened for review. You can continue below when ready.</small> : <small>The approval button unlocks after the exact Agreement Package opens successfully.</small>}
            {selected.confirmation ? <button type="button" className="secondary-button" disabled={documentBusy !== null} onClick={() => void openDocument('executed_pdf')}>{documentBusy === 'executed_pdf' ? 'Preparing signed copy…' : 'Open signed copy'}</button> : null}
          </div>
        </div>

        {selected.confirmation ? <div className="success-banner">Purchase confirmed {formatDate(selected.confirmation.confirmedAt)} by {selected.confirmation.confirmedLegalName} ({roleLabel(selected.confirmation.confirmedRole)}).</div> : null}
        {!selected.isCurrent ? <div className="warning-banner">This Order Form has been replaced. Review the current replacement instead.</div> : null}
        {selected.isCurrent && actionRequired && !center?.canAccept ? <div className="warning-banner">Only the Business Owner or a Manager explicitly authorised by the Owner can accept or confirm SellerTray agreements.</div> : null}

        {selected.isCurrent && actionRequired && center?.canAccept && center.masterAgreement ? <form className="settings-form agreement-signature-form" onSubmit={confirmPackage}>
          <div className={`agreement-review-status ${reviewReady ? 'ready' : ''}`}><strong>{reviewReady ? 'Agreement reviewed and ready to confirm' : 'Review the Agreement Package before continuing'}</strong><span>{reviewReady ? 'SellerTray will record your authenticated approval against the exact agreement you opened.' : 'Use Review agreement above. Accept & Continue becomes available after the exact PDF opens.'}</span></div>
          <label className="field"><span>Authorised representative legal name</span><SellerTrayInput maxLength={200} required value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Full legal name" /></label>
          <label className="access-card">
            <SellerTrayInput type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span><strong>{center.masterAcceptanceRequired
              ? selected.confirmation
                ? 'I accept the current Master Agreement and confirm my authority to continue.'
                : 'I accept the Master Agreement, confirm this purchase and confirm my authority to continue.'
              : 'I confirm this purchase under the accepted Master Agreement and confirm my authority to continue.'}</strong>
            <small>Your authenticated SellerTray identity, authority and the exact agreement reviewed are recorded as acceptance evidence.</small></span>
          </label>
          <div className="settings-actions"><button className="primary-button" disabled={busy || !confirmed || !legalName.trim() || !reviewReady}>{busy ? 'Recording approval…' : center.masterAcceptanceRequired ? 'Accept & Continue' : 'Confirm Purchase'}</button></div>
        </form> : null}
      </article> : null}
    </div>}

    {viewerKind ? <div className="agreement-viewer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewerKind(null); }}>
      <section className="agreement-viewer" role="dialog" aria-modal="true" aria-label={viewerKind === 'review_pdf' ? 'Review SellerTray Agreement Package' : 'Signed SellerTray Agreement Package'}>
        <header className="agreement-viewer-header">
          <div><p className="eyebrow">{viewerKind === 'review_pdf' ? 'Agreement review' : 'Signed agreement'}</p><h3>{viewerDocument?.fileName ?? 'Preparing Agreement Package…'}</h3></div>
          <div className="agreement-viewer-actions">
            {viewerDocument ? <a className="secondary-button agreement-document-link" href={viewerDocument.signedUrl} target="_blank" rel="noreferrer" onClick={() => markReviewOpened(viewerDocument)}>Open in new tab</a> : null}
            <button type="button" className="secondary-button" onClick={() => setViewerKind(null)}>Close</button>
          </div>
        </header>
        {viewerDocument ? <iframe
          className="agreement-viewer-frame"
          title={viewerKind === 'review_pdf' ? 'SellerTray Agreement Package review' : 'SellerTray signed Agreement Package'}
          src={viewerDocument.signedUrl}
          onLoad={() => markReviewOpened(viewerDocument)}
        /> : <div className="agreement-viewer-loading"><strong>Preparing your agreement…</strong><p className="muted">SellerTray is generating the exact governed document for this purchase.</p></div>}
      </section>
    </div> : null}
  </section>;

  function selectForm(id: string) { replaceSelection(id); }
  function replaceSelection(id: string | null) {
    invalidateDocumentRequest(id);
    setSelectedId(id); setLegalName(''); setConfirmed(false); setError(null); setMessage(null);
  }
  function invalidateDocumentRequest(orderFormId: string | null) {
    documentRequestGate.current.invalidate(tenantId, orderFormId);
    setReviewDocumentState(null); setExecutedDocumentState(null); setReviewedFingerprint(null); setViewerKind(null); setDocumentBusy(null);
  }
}

function currentDocument(state: AgreementDocumentState | null, selected: OrderForm | null, tenantId: string, gate: AgreementDocumentRequestGate): AgreementDocument | null {
  return state && selected && state.request.tenantId === tenantId && state.request.orderFormId === selected.id && gate.isCurrent(state.request) ? state.document : null;
}
function CommercialFacts({ snapshot }: { snapshot: CommercialSnapshot }) {
  return <div className="page-stack">
    <article className="panel"><div className="panel-head"><div><p className="eyebrow">Purchase summary</p><h3>{snapshot.businessName || 'SellerTray purchase'}</h3></div></div><div className="settings-grid two"><Fact label="Business" value={snapshot.businessName || '—'} /><Fact label="Order reference" value={snapshot.orderReference || '—'} /><Fact label="Order total" value={money(snapshot.totalGrossAmount, snapshot.currency)} /><Fact label="Current amount due" value={money(snapshot.netAmountDue, snapshot.currency)} /><Fact label="Approved adjustments" value={money(snapshot.approvedAdjustmentAmount, snapshot.currency)} /><Fact label="Order date" value={snapshot.orderedAt ? formatDate(snapshot.orderedAt) : '—'} /></div>{snapshot.businessEmail || snapshot.businessPhone ? <p className="muted">Business contact: {[snapshot.businessEmail, snapshot.businessPhone].filter(Boolean).join(' · ')}</p> : null}</article>
    {snapshot.priceLines.length ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">Purchase lines</p><h3>Commercial items</h3></div></div><div className="table-wrap"><table><thead><tr><th>Description</th><th>Qty</th><th>Gross</th><th>Tax</th></tr></thead><tbody>{snapshot.priceLines.map((line) => <tr key={line.lineNo}><td>{line.description || `Line ${line.lineNo}`}</td><td>{line.quantity}</td><td>{money(line.grossAmount, line.currency || snapshot.currency)}</td><td>{line.taxRatePercent === null ? 'Included / not separately stated' : `${line.taxRatePercent}% (${money(line.taxAmount, line.currency || snapshot.currency)})`}</td></tr>)}</tbody></table></div></article> : null}
    {snapshot.installmentStructure ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">Payment schedule</p><h3>{structureLabel(snapshot.installmentStructure)}</h3></div><span className="role-pill">{snapshot.installmentAmount === null ? 'Installment purchase' : money(snapshot.installmentAmount, snapshot.currency)}</span></div><div className="table-wrap"><table><thead><tr><th>Installment</th><th>Share</th><th>Amount</th><th>Due</th></tr></thead><tbody>{snapshot.installmentSchedule.map((line) => <tr key={line.sequenceNo}><td>{line.sequenceNo}</td><td>{line.percentage}%</td><td>{money(line.amountDue, snapshot.currency)}</td><td>{line.dueAt ? formatDate(line.dueAt) : 'Not scheduled'}</td></tr>)}</tbody></table></div></article> : null}
  </div>;
}
function OrderFormButton({ form, selected, onSelect }: { form: OrderForm; selected: boolean; onSelect: () => void }) { return <button type="button" className={selected ? 'member-row active' : 'member-row'} onClick={onSelect}><span className="member-avatar">O</span><span><strong>{form.reference}</strong><small>{form.isCurrent ? form.confirmation ? 'Confirmed' : 'Action required' : 'Replaced'} · {formatDate(form.issuedAt)}</small></span></button>; }
function Status({ form, masterAcceptanceRequired }: { form: OrderForm; masterAcceptanceRequired: boolean }) { const label = !form.isCurrent ? 'Replaced' : masterAcceptanceRequired ? 'Action required' : form.confirmation ? 'Confirmed' : 'Action required'; return <span className="role-pill">{label}</span>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function roleLabel(value: string) { return value === 'owner' ? 'Owner' : value === 'manager' ? 'Manager' : value; }
function structureLabel(value: string) { return value === 'two_installment_70_30' ? '70% + 30%' : value === 'three_installment_60_20_20' ? '60% + 20% + 20%' : value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${value.toFixed(2)}`; } }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function numberValue(value: unknown): number { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function nullableNumber(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function parseAcceptance(value: unknown): MasterAcceptance | null { const row = record(value); if (!stringValue(row.id)) return null; return { id: stringValue(row.id), acceptedAt: stringValue(row.acceptedAt), acceptedLegalName: stringValue(row.acceptedLegalName), acceptedRole: row.acceptedRole === 'manager' ? 'manager' : 'owner' }; }
function parseMaster(value: unknown): MasterAgreement | null { const row = record(value); if (!stringValue(row.id)) return null; return { id: stringValue(row.id), versionCode: stringValue(row.versionCode), title: stringValue(row.title, 'SellerTray Master Agreement'), contentSha256: stringValue(row.contentSha256), effectiveFrom: stringValue(row.effectiveFrom), acceptance: parseAcceptance(row.acceptance) }; }
function parseSnapshot(value: unknown): CommercialSnapshot {
  const row = record(value); const merchant = record(row.merchant); const settlement = record(row.settlementTerms); const installment = record(row.installment);
  return { businessName: stringValue(merchant.business_name), businessEmail: stringValue(merchant.business_email), businessPhone: stringValue(merchant.business_phone), orderReference: stringValue(row.order_reference), currency: stringValue(row.currency, 'NGN'), totalGrossAmount: numberValue(row.total_gross_amount), orderedAt: stringValue(row.ordered_at), approvedAdjustmentAmount: numberValue(settlement.approvedAdjustmentAmount), netAmountDue: numberValue(settlement.netAmountDue), priceLines: array(row.price_snapshots).map((item) => { const line = record(item); return { lineNo: numberValue(line.line_no), description: stringValue(line.description), quantity: numberValue(line.quantity), currency: stringValue(line.currency, stringValue(row.currency, 'NGN')), grossAmount: numberValue(line.gross_amount), taxRatePercent: nullableNumber(line.tax_rate_percent), taxAmount: numberValue(line.tax_amount) }; }), installmentStructure: nullableString(installment.structure_code), installmentAmount: nullableNumber(installment.obligated_amount), installmentSchedule: array(installment.schedule).map((item) => { const line = record(item); return { sequenceNo: numberValue(line.sequence_no), percentage: numberValue(line.percentage), amountDue: numberValue(line.amount_due), dueAt: nullableString(line.due_at) }; }) };
}
function parseOrderForm(value: unknown): OrderForm | null {
  const row = record(value); const id = stringValue(row.id); if (!id) return null; const confirmationRow = record(row.confirmation);
  const confirmation = stringValue(confirmationRow.id) ? { id: stringValue(confirmationRow.id), confirmedAt: stringValue(confirmationRow.confirmedAt), confirmedLegalName: stringValue(confirmationRow.confirmedLegalName), confirmedRole: confirmationRow.confirmedRole === 'manager' ? 'manager' as const : 'owner' as const, packageFingerprint: stringValue(confirmationRow.packageFingerprint) } : null;
  return { id, reference: stringValue(row.reference), title: stringValue(row.title, 'SellerTray Order Form'), templateVersion: stringValue(row.templateVersion), contentSha256: stringValue(row.contentSha256), commercialSnapshotSha256: stringValue(row.commercialSnapshotSha256), commercialSnapshot: parseSnapshot(row.commercialSnapshot), commercialOrderId: stringValue(row.commercialOrderId), installmentObligationId: nullableString(row.installmentObligationId), supersedesOrderFormId: nullableString(row.supersedesOrderFormId), isCurrent: row.isCurrent === true, issuedAt: stringValue(row.issuedAt), confirmation };
}
function parseCenter(value: unknown): AgreementCenter { const root = record(value); return { tenantId: stringValue(root.tenantId), actorRole: root.actorRole === 'manager' ? 'manager' : 'owner', canAccept: root.canAccept === true, masterAgreement: parseMaster(root.masterAgreement), masterAcceptanceRequired: root.masterAcceptanceRequired === true, orderForms: array(root.orderForms).flatMap((item) => { const form = parseOrderForm(item); return form ? [form] : []; }) }; }
function parseConfirmResult(value: unknown): ConfirmResult { const row = record(value); return { masterAcceptanceCreated: row.masterAcceptanceCreated === true, orderFormConfirmationCreated: row.orderFormConfirmationCreated === true, agreementPackageId: stringValue(row.agreementPackageId), packageFingerprint: stringValue(row.packageFingerprint) }; }
function parseDocument(value: unknown): AgreementDocument {
  const row = record(value);
  const artifactKind: AgreementDocument['artifactKind'] = row.artifactKind === 'executed_pdf' ? 'executed_pdf' : 'review_pdf';
  const result: AgreementDocument = { artifactId: stringValue(row.artifactId), artifactKind, packageId: stringValue(row.packageId), packageFingerprint: stringValue(row.packageFingerprint), pdfSha256: stringValue(row.pdfSha256), byteSize: numberValue(row.byteSize), generatedAt: stringValue(row.generatedAt), fileName: stringValue(row.fileName), signedUrl: stringValue(row.signedUrl), expiresInSeconds: numberValue(row.expiresInSeconds) };
  if (!result.artifactId || !result.packageId || !result.packageFingerprint || !result.signedUrl) throw new Error('Agreement Package PDF response is incomplete.');
  return result;
}
