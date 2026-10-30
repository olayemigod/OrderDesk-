import { SellerTrayInput } from './SellerTrayElements';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { errorMessage, supabase } from './supabase';

type MasterAcceptance = { id: string; acceptedAt: string; acceptedLegalName: string; acceptedRole: 'owner' | 'manager' };
type MasterAgreement = { id: string; versionCode: string; title: string; contentBody: string; contentSha256: string; effectiveFrom: string; acceptance: MasterAcceptance | null };
type OrderFormConfirmation = { id: string; confirmedAt: string; confirmedLegalName: string; confirmedRole: 'owner' | 'manager'; packageFingerprint: string };
type PriceLine = { lineNo: number; description: string; quantity: number; currency: string; grossAmount: number; taxRatePercent: number | null; taxAmount: number };
type InstallmentLine = { sequenceNo: number; percentage: number; amountDue: number; dueAt: string | null };
type CommercialSnapshot = {
  businessName: string; businessEmail: string; businessPhone: string; orderReference: string; currency: string;
  totalGrossAmount: number; orderedAt: string; approvedAdjustmentAmount: number; netAmountDue: number;
  priceLines: PriceLine[]; installmentStructure: string | null; installmentAmount: number | null; installmentSchedule: InstallmentLine[];
};
type OrderForm = {
  id: string; reference: string; title: string; templateVersion: string; renderedContent: string; contentSha256: string;
  commercialSnapshotSha256: string; commercialSnapshot: CommercialSnapshot; commercialOrderId: string;
  installmentObligationId: string | null; supersedesOrderFormId: string | null; isCurrent: boolean; issuedAt: string;
  confirmation: OrderFormConfirmation | null;
};
type AgreementCenter = { tenantId: string; actorRole: 'owner' | 'manager'; canAccept: boolean; masterAgreement: MasterAgreement | null; masterAcceptanceRequired: boolean; orderForms: OrderForm[] };
type ConfirmResult = { orderFormConfirmationCreated: boolean; agreementPackageId: string; packageFingerprint: string };
type AgreementDocument = {
  artifactId: string; artifactKind: 'review_pdf' | 'executed_pdf'; packageId: string; packageFingerprint: string;
  pdfSha256: string; byteSize: number; generatedAt: string; fileName: string; signedUrl: string; expiresInSeconds: number;
};

export default function CommercialAgreementPackageManagement({ tenantId }: { tenantId: string }) {
  const [center, setCenter] = useState<AgreementCenter | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legalName, setLegalName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [reviewDocument, setReviewDocument] = useState<AgreementDocument | null>(null);
  const [executedDocument, setExecutedDocument] = useState<AgreementDocument | null>(null);
  const [reviewedFingerprint, setReviewedFingerprint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState<'review_pdf' | 'executed_pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const confirmationCommandIds = useRef(new Map<string, string>());

  useEffect(() => { void load(); }, [tenantId]);

  const orderForms = center?.orderForms ?? [];
  const current = useMemo(() => orderForms.filter((form) => form.isCurrent), [orderForms]);
  const history = useMemo(() => orderForms.filter((form) => !form.isCurrent), [orderForms]);
  const selected = orderForms.find((form) => form.id === selectedId) ?? current[0] ?? orderForms[0] ?? null;
  const actionRequired = Boolean(selected?.isCurrent && !selected.confirmation);
  const reviewReady = Boolean(reviewDocument && reviewedFingerprint === reviewDocument.packageFingerprint);

  async function load(preferredId?: string | null) {
    setLoading(true); setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', { body: { action: 'merchant_get', tenantId } });
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      setCenter(next);
      const wanted = preferredId ?? selectedId;
      setSelectedId(wanted && next.orderForms.some((form) => form.id === wanted)
        ? wanted
        : next.orderForms.find((form) => form.isCurrent && !form.confirmation)?.id
          ?? next.orderForms.find((form) => form.isCurrent)?.id
          ?? next.orderForms[0]?.id ?? null);
    } catch (cause) { setError(errorMessage(cause, 'Unable to load SellerTray Order Forms.')); }
    finally { setLoading(false); }
  }

  async function openDocument(artifactKind: 'review_pdf' | 'executed_pdf') {
    if (!selected || documentBusy) return;
    if (artifactKind === 'review_pdf' && center?.masterAcceptanceRequired) {
      setError('Accept the current Master Agreement separately before reviewing this Order Form.');
      return;
    }
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setDocumentBusy(artifactKind); setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', {
        body: { action: 'merchant_get_document', tenantId, orderFormId: selected.id, artifactKind },
      });
      if (functionError) throw functionError;
      const document = parseDocument(record(data).document);
      if (artifactKind === 'review_pdf') {
        setReviewDocument(document);
        if (popup) setReviewedFingerprint(document.packageFingerprint);
      } else setExecutedDocument(document);
      if (popup) popup.location.href = document.signedUrl;
    } catch (cause) {
      if (popup) popup.close();
      setError(errorMessage(cause, artifactKind === 'review_pdf' ? 'Unable to open this SellerTray Order Form package.' : 'Unable to open the signed SellerTray Order Form package.'));
    } finally { setDocumentBusy(null); }
  }

  async function confirmPackage(event: FormEvent) {
    event.preventDefault();
    if (!selected || !selected.isCurrent || !center?.canAccept || !center.masterAgreement || center.masterAcceptanceRequired || !actionRequired || !reviewDocument || !reviewReady) return;
    const name = legalName.trim().replace(/\s+/g, ' ');
    if (!name) { setError('Enter the authorised representative legal name.'); return; }
    if (!confirmed) { setError('Confirm your authority and purchase approval before continuing.'); return; }

    const commandKey = `${selected.id}:${reviewDocument.packageFingerprint}`;
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
      parseConfirmResult(response.result);
      const next = parseCenter(response.center);
      confirmationCommandIds.current.delete(commandKey);
      setCenter(next); setSelectedId(selected.id); setLegalName(''); setConfirmed(false);
      setReviewDocument(null); setReviewedFingerprint(null); setExecutedDocument(null);
      setMessage('Purchase confirmed under your accepted Master Agreement.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to confirm this SellerTray Order Form.')); }
    finally { setBusy(false); }
  }

  if (loading && !center) return <article className="panel"><p className="muted">Loading Order Forms…</p></article>;

  return <section className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Commercial</p><h2>Order Forms</h2></div>
      <p className="muted">Each governed purchase or commercial change has its own Order Form. Confirming an Order Form does not re-accept an unchanged Master Agreement.</p>
    </div>

    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {center?.masterAcceptanceRequired ? <div className="warning-banner">The current Master Agreement must be reviewed and accepted separately before any new Order Form can be reviewed or confirmed.</div> : null}

    {center?.masterAgreement ? <article className="panel agreement-brand-panel">
      <div className="agreement-brand-heading">
        <img className="agreement-brand-logo" src="/brand/sellertray-logo-v2.svg" alt="SellerTray" />
        <div><p className="eyebrow">Governing Master Agreement</p><h3>{center.masterAgreement.title}</h3><p className="muted">Version {center.masterAgreement.versionCode} · Effective {formatDate(center.masterAgreement.effectiveFrom)}</p></div>
        <span className="role-pill">{center.masterAcceptanceRequired ? 'Acceptance required' : 'Accepted'}</span>
      </div>
      <div className="settings-grid two">
        <Fact label="Version" value={center.masterAgreement.versionCode} />
        <Fact label="Accepted by" value={center.masterAgreement.acceptance?.acceptedLegalName ?? '—'} />
        <Fact label="Accepted at" value={center.masterAgreement.acceptance?.acceptedAt ? formatDate(center.masterAgreement.acceptance.acceptedAt) : '—'} />
        <Fact label="Order Form authority" value={center.masterAcceptanceRequired ? 'Blocked until Master acceptance' : 'Ready'} />
      </div>
    </article> : <div className="warning-banner">The current SellerTray Master Agreement is not available. Order Form confirmation is unavailable until it is published and accepted.</div>}

    {!orderForms.length ? <article className="panel empty-state">
      <strong>No Order Form yet</strong>
      <p>SellerTray creates the purchase-specific Order Form from each governed commercial order or change that requires confirmation.</p>
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
        <div className="settings-grid two"><Fact label="Created" value={formatDate(selected.issuedAt)} /><Fact label="Order reference" value={selected.commercialSnapshot.orderReference || selected.reference} /></div>
        <CommercialFacts snapshot={selected.commercialSnapshot} />
        <details className="agreement-transcript"><summary>Read Order Form text</summary><div className="panel agreement-document"><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: 0 }}>{selected.renderedContent}</pre></div></details>

        <div className="agreement-package-card">
          <div className="agreement-package-card-copy"><p className="eyebrow">Purchase document</p><h3>Review Order Form PDF</h3><p>Review the exact purchase terms under the Master Agreement you already accepted. The package may include the governing Master Agreement for reference, but this action confirms only this Order Form.</p></div>
          <div className="agreement-package-actions">
            <button type="button" className="primary-button" disabled={documentBusy !== null || !selected.isCurrent || center?.masterAcceptanceRequired === true} onClick={() => void openDocument('review_pdf')}>{documentBusy === 'review_pdf' ? 'Opening Order Form…' : reviewReady ? 'Review Order Form again' : 'Review Order Form'}</button>
            {reviewDocument && !reviewReady ? <a className="primary-button agreement-document-link" href={reviewDocument.signedUrl} target="_blank" rel="noreferrer" onClick={() => setReviewedFingerprint(reviewDocument.packageFingerprint)}>Open Order Form</a> : null}
            {reviewReady ? <small>Order Form opened for review. You can confirm this purchase below.</small> : null}
            {selected.confirmation ? <button type="button" className="secondary-button" disabled={documentBusy !== null} onClick={() => void openDocument('executed_pdf')}>{documentBusy === 'executed_pdf' ? 'Opening signed copy…' : 'Open confirmed copy'}</button> : null}
            {executedDocument ? <a className="secondary-button agreement-document-link" href={executedDocument.signedUrl} target="_blank" rel="noreferrer">Open confirmed copy again</a> : null}
          </div>
        </div>

        {selected.confirmation ? <div className="success-banner">Order Form confirmed {formatDate(selected.confirmation.confirmedAt)} by {selected.confirmation.confirmedLegalName} ({roleLabel(selected.confirmation.confirmedRole)}).</div> : null}
        {!selected.isCurrent ? <div className="warning-banner">This Order Form has been replaced. Review the current replacement instead.</div> : null}
        {selected.isCurrent && actionRequired && center?.masterAcceptanceRequired ? <div className="warning-banner">Accept the current Master Agreement separately before confirming this Order Form.</div> : null}
        {selected.isCurrent && actionRequired && !center?.masterAcceptanceRequired && !center?.canAccept ? <div className="warning-banner">Only the Business Owner or an explicitly authorised Manager can confirm this Order Form.</div> : null}

        {selected.isCurrent && actionRequired && !center?.masterAcceptanceRequired && center?.canAccept && center.masterAgreement ? <form className="settings-form agreement-signature-form" onSubmit={confirmPackage}>
          <div className={`agreement-review-status ${reviewReady ? 'ready' : ''}`}><strong>{reviewReady ? 'Order Form reviewed and ready to confirm' : 'Review the Order Form PDF before continuing'}</strong><span>{reviewReady ? 'SellerTray will record your authenticated confirmation against the exact purchase document you opened.' : 'Use Review Order Form above to open the exact document for this purchase.'}</span></div>
          <label className="field"><span>Authorised representative legal name</span><SellerTrayInput maxLength={200} required value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Full legal name" /></label>
          <label className="access-card"><SellerTrayInput type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>I confirm this purchase under the SellerTray Master Agreement already accepted by this Business and confirm my authority to continue.</strong><small>This confirms only this Order Form and purchase. It does not create or replace Master Agreement acceptance.</small></span></label>
          <div className="settings-actions"><button className="primary-button" disabled={busy || !confirmed || !legalName.trim() || !reviewReady}>{busy ? 'Recording confirmation…' : 'Confirm Purchase'}</button></div>
        </form> : null}
      </article> : null}
    </div>}
  </section>;

  function selectForm(id: string) {
    setSelectedId(id); setLegalName(''); setConfirmed(false); setError(null); setMessage(null);
    setReviewDocument(null); setExecutedDocument(null); setReviewedFingerprint(null);
  }
}

function CommercialFacts({ snapshot }: { snapshot: CommercialSnapshot }) {
  return <div className="page-stack">
    <article className="panel"><div className="panel-head"><div><p className="eyebrow">Purchase summary</p><h3>{snapshot.businessName || 'SellerTray purchase'}</h3></div></div><div className="settings-grid two"><Fact label="Business" value={snapshot.businessName || '—'} /><Fact label="Order reference" value={snapshot.orderReference || '—'} /><Fact label="Order total" value={money(snapshot.totalGrossAmount, snapshot.currency)} /><Fact label="Current amount due" value={money(snapshot.netAmountDue, snapshot.currency)} /><Fact label="Approved adjustments" value={money(snapshot.approvedAdjustmentAmount, snapshot.currency)} /><Fact label="Order date" value={snapshot.orderedAt ? formatDate(snapshot.orderedAt) : '—'} /></div>{snapshot.businessEmail || snapshot.businessPhone ? <p className="muted">Business contact: {[snapshot.businessEmail, snapshot.businessPhone].filter(Boolean).join(' · ')}</p> : null}</article>
    {snapshot.priceLines.length ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">Purchase lines</p><h3>Commercial items</h3></div></div><div className="table-wrap"><table><thead><tr><th>Description</th><th>Qty</th><th>Gross</th><th>Tax</th></tr></thead><tbody>{snapshot.priceLines.map((line) => <tr key={line.lineNo}><td>{line.description || `Line ${line.lineNo}`}</td><td>{line.quantity}</td><td>{money(line.grossAmount, line.currency || snapshot.currency)}</td><td>{line.taxRatePercent === null ? 'Included / not separately stated' : `${line.taxRatePercent}% (${money(line.taxAmount, line.currency || snapshot.currency)})`}</td></tr>)}</tbody></table></div></article> : null}
    {snapshot.installmentStructure ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">Payment schedule</p><h3>{structureLabel(snapshot.installmentStructure)}</h3></div><span className="role-pill">{snapshot.installmentAmount === null ? 'Installment purchase' : money(snapshot.installmentAmount, snapshot.currency)}</span></div><div className="table-wrap"><table><thead><tr><th>Installment</th><th>Share</th><th>Amount</th><th>Due</th></tr></thead><tbody>{snapshot.installmentSchedule.map((line) => <tr key={line.sequenceNo}><td>{line.sequenceNo}</td><td>{line.percentage}%</td><td>{money(line.amountDue, snapshot.currency)}</td><td>{line.dueAt ? formatDate(line.dueAt) : 'Not scheduled'}</td></tr>)}</tbody></table></div></article> : null}
  </div>;
}

function OrderFormButton({ form, selected, onSelect }: { form: OrderForm; selected: boolean; onSelect: () => void }) { return <button type="button" className={selected ? 'member-row active' : 'member-row'} onClick={onSelect}><span className="member-avatar">O</span><span><strong>{form.reference}</strong><small>{form.isCurrent ? form.confirmation ? 'Confirmed' : 'Action required' : 'Replaced'} · {formatDate(form.issuedAt)}</small></span></button>; }
function Status({ form, masterAcceptanceRequired }: { form: OrderForm; masterAcceptanceRequired: boolean }) { const label = !form.isCurrent ? 'Replaced' : masterAcceptanceRequired ? 'Blocked by Master Agreement' : form.confirmation ? 'Confirmed' : 'Action required'; return <span className="role-pill">{label}</span>; }
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
function parseMaster(value: unknown): MasterAgreement | null { const row = record(value); if (!stringValue(row.id)) return null; return { id: stringValue(row.id), versionCode: stringValue(row.versionCode), title: stringValue(row.title, 'SellerTray Master Agreement'), contentBody: stringValue(row.contentBody), contentSha256: stringValue(row.contentSha256), effectiveFrom: stringValue(row.effectiveFrom), acceptance: parseAcceptance(row.acceptance) }; }
function parseSnapshot(value: unknown): CommercialSnapshot {
  const row = record(value); const merchant = record(row.merchant); const settlement = record(row.settlementTerms); const installment = record(row.installment);
  return { businessName: stringValue(merchant.business_name), businessEmail: stringValue(merchant.business_email), businessPhone: stringValue(merchant.business_phone), orderReference: stringValue(row.order_reference), currency: stringValue(row.currency, 'NGN'), totalGrossAmount: numberValue(row.total_gross_amount), orderedAt: stringValue(row.ordered_at), approvedAdjustmentAmount: numberValue(settlement.approvedAdjustmentAmount), netAmountDue: numberValue(settlement.netAmountDue), priceLines: array(row.price_snapshots).map((item) => { const line = record(item); return { lineNo: numberValue(line.line_no), description: stringValue(line.description), quantity: numberValue(line.quantity), currency: stringValue(line.currency, stringValue(row.currency, 'NGN')), grossAmount: numberValue(line.gross_amount), taxRatePercent: nullableNumber(line.tax_rate_percent), taxAmount: numberValue(line.tax_amount) }; }), installmentStructure: nullableString(installment.structure_code), installmentAmount: nullableNumber(installment.obligated_amount), installmentSchedule: array(installment.schedule).map((item) => { const line = record(item); return { sequenceNo: numberValue(line.sequence_no), percentage: numberValue(line.percentage), amountDue: numberValue(line.amount_due), dueAt: nullableString(line.due_at) }; }) };
}
function parseOrderForm(value: unknown): OrderForm | null {
  const row = record(value); const id = stringValue(row.id); if (!id) return null; const confirmationRow = record(row.confirmation);
  const confirmation = stringValue(confirmationRow.id) ? { id: stringValue(confirmationRow.id), confirmedAt: stringValue(confirmationRow.confirmedAt), confirmedLegalName: stringValue(confirmationRow.confirmedLegalName), confirmedRole: confirmationRow.confirmedRole === 'manager' ? 'manager' as const : 'owner' as const, packageFingerprint: stringValue(confirmationRow.packageFingerprint) } : null;
  return { id, reference: stringValue(row.reference), title: stringValue(row.title, 'SellerTray Order Form'), templateVersion: stringValue(row.templateVersion), renderedContent: stringValue(row.renderedContent), contentSha256: stringValue(row.contentSha256), commercialSnapshotSha256: stringValue(row.commercialSnapshotSha256), commercialSnapshot: parseSnapshot(row.commercialSnapshot), commercialOrderId: stringValue(row.commercialOrderId), installmentObligationId: nullableString(row.installmentObligationId), supersedesOrderFormId: nullableString(row.supersedesOrderFormId), isCurrent: row.isCurrent === true, issuedAt: stringValue(row.issuedAt), confirmation };
}
function parseCenter(value: unknown): AgreementCenter { const root = record(value); return { tenantId: stringValue(root.tenantId), actorRole: root.actorRole === 'manager' ? 'manager' : 'owner', canAccept: root.canAccept === true, masterAgreement: parseMaster(root.masterAgreement), masterAcceptanceRequired: root.masterAcceptanceRequired === true, orderForms: array(root.orderForms).flatMap((item) => { const form = parseOrderForm(item); return form ? [form] : []; }) }; }
function parseConfirmResult(value: unknown): ConfirmResult { const row = record(value); const result = { orderFormConfirmationCreated: row.orderFormConfirmationCreated === true, agreementPackageId: stringValue(row.agreementPackageId), packageFingerprint: stringValue(row.packageFingerprint) }; if (!result.agreementPackageId || !result.packageFingerprint) throw new Error('Order Form confirmation response is incomplete.'); return result; }
function parseDocument(value: unknown): AgreementDocument {
  const row = record(value); const artifactKind: AgreementDocument['artifactKind'] = row.artifactKind === 'executed_pdf' ? 'executed_pdf' : 'review_pdf';
  const result: AgreementDocument = { artifactId: stringValue(row.artifactId), artifactKind, packageId: stringValue(row.packageId), packageFingerprint: stringValue(row.packageFingerprint), pdfSha256: stringValue(row.pdfSha256), byteSize: numberValue(row.byteSize), generatedAt: stringValue(row.generatedAt), fileName: stringValue(row.fileName), signedUrl: stringValue(row.signedUrl), expiresInSeconds: numberValue(row.expiresInSeconds) };
  if (!result.artifactId || !result.packageId || !result.packageFingerprint || !result.signedUrl) throw new Error('Order Form PDF response is incomplete.');
  return result;
}
