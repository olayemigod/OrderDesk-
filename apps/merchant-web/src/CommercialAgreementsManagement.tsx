import { SellerTrayInput } from './SellerTrayElements';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { errorMessage, supabase } from './supabase';

type MasterAcceptance = {
  id: string;
  acceptedAt: string;
  acceptedLegalName: string;
  acceptedRole: 'owner' | 'manager';
  acceptedByCurrentUser: boolean;
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
type OrderFormConfirmation = {
  id: string;
  confirmedAt: string;
  confirmedLegalName: string;
  confirmedRole: 'owner' | 'manager';
  confirmedByCurrentUser: boolean;
  packageFingerprint: string;
};
type OrderForm = {
  id: string;
  reference: string;
  title: string;
  templateVersion: string;
  renderedContent: string;
  contentSha256: string;
  commercialOrderId: string;
  installmentObligationId: string | null;
  supersedesOrderFormId: string | null;
  isCurrent: boolean;
  issuedAt: string;
  confirmation: OrderFormConfirmation | null;
};
type InstallmentLine = {
  id: string;
  sequenceNo: number;
  percentage: number;
  amountDue: number;
  dueAt: string | null;
  paymentStatus: 'paid' | 'unpaid';
  dueState: 'paid' | 'unscheduled' | 'scheduled' | 'past_due';
  paidAt: string | null;
  provider: string | null;
  providerReference: string | null;
};
type InstallmentBilling = {
  tenantId: string;
  commercialOrderId: string;
  installmentObligationId: string;
  structureCode: string;
  currency: string;
  obligatedAmount: number;
  planCode: string;
  billingCycle: string;
  agreementAccepted: boolean;
  agreementAcceptedAt: string | null;
  setupRequiredCount: number;
  setupReadyCount: number;
  setupReady: boolean;
  setupReadyAt: string | null;
  paidInstallmentCount: number;
  installmentCount: number;
  fullyPaid: boolean;
  firstPaidAt: string | null;
  entitlementState: string;
  activationAt: string | null;
  provisionalUntil: string | null;
  fullTermUntil: string | null;
  nextPayableScheduleId: string | null;
  schedule: InstallmentLine[];
  dueEnforcementMode: 'informational_only';
};
type AgreementCenter = {
  tenantId: string;
  actorRole: 'owner' | 'manager';
  canAccept: boolean;
  masterAgreement: MasterAgreement | null;
  masterAcceptanceRequired: boolean;
  orderForms: OrderForm[];
  installmentBilling: InstallmentBilling[];
};

type BillingCheckoutResponse = {
  status?: string;
  needsNewCommand?: boolean;
  authorizationUrl?: string;
  reference?: string;
  installmentScheduleId?: string;
  amount?: number | string;
  currency?: string;
};

export default function CommercialAgreementsManagement({ tenantId }: { tenantId: string }) {
  const [center, setCenter] = useState<AgreementCenter | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legalName, setLegalName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [payingScheduleId, setPayingScheduleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const confirmationCommandIds = useRef(new Map<string, string>());

  useEffect(() => { void load(); }, [tenantId]);

  const orderForms = center?.orderForms ?? [];
  const current = useMemo(() => orderForms.filter((form) => form.isCurrent), [orderForms]);
  const history = useMemo(() => orderForms.filter((form) => !form.isCurrent), [orderForms]);
  const selected = orderForms.find((form) => form.id === selectedId) ?? current[0] ?? orderForms[0] ?? null;

  async function load(preferredId?: string | null) {
    setLoading(true); setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', {
        body: { action: 'merchant_list', tenantId },
      });
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      setCenter(next);
      const wanted = preferredId ?? selectedId;
      setSelectedId(wanted && next.orderForms.some((form) => form.id === wanted)
        ? wanted
        : next.orderForms.find((form) => form.isCurrent)?.id ?? next.orderForms[0]?.id ?? null);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load SellerTray commercial agreements.'));
    } finally { setLoading(false); }
  }

  async function confirmPackage(event: FormEvent) {
    event.preventDefault();
    if (!selected || !selected.isCurrent || selected.confirmation || !center?.canAccept) return;
    const name = legalName.trim().replace(/\s+/g, ' ');
    if (!name) { setError('Enter the authorised representative legal name.'); return; }
    if (!confirmed) { setError('Confirm that you are authorised and approve this purchase before continuing.'); return; }

    const commandId = confirmationCommandIds.current.get(selected.id) ?? crypto.randomUUID();
    confirmationCommandIds.current.set(selected.id, commandId);
    setBusy(true); setError(null); setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('master-agreements', {
        body: {
          action: 'merchant_confirm_package',
          tenantId,
          orderFormId: selected.id,
          legalName: name,
          authorityConfirmed: true,
          commandId,
        },
      });
      if (functionError) throw functionError;
      const next = parseCenter(record(data).center);
      confirmationCommandIds.current.delete(selected.id);
      setCenter(next);
      setSelectedId(selected.id);
      setLegalName(''); setConfirmed(false);
      setMessage(center?.masterAcceptanceRequired
        ? 'Master Agreement accepted and purchase confirmed.'
        : 'Purchase confirmed under your accepted Master Agreement.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to confirm this SellerTray purchase.'));
    } finally { setBusy(false); }
  }

  async function payInstallment(scheduleId: string) {
    if (!center || center.actorRole !== 'owner' || payingScheduleId) return;
    setPayingScheduleId(scheduleId); setError(null); setMessage(null);
    const storageKey = installmentCommandStorageKey(tenantId, scheduleId);
    const storedCommand = safeSessionStorageGet(storageKey);
    const commandId = isUuid(storedCommand) ? storedCommand : crypto.randomUUID();
    safeSessionStorageSet(storageKey, commandId);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('billing-checkout', {
        body: { tenantId, installmentScheduleId: scheduleId, commandId },
      });
      if (functionError) throw functionError;
      const response = record(data) as BillingCheckoutResponse;
      if (response.status === 'paid') {
        safeSessionStorageRemove(storageKey);
        setMessage('This installment is already confirmed as paid.');
        await load(selectedId);
        return;
      }
      if (response.status === 'retry_required' && response.needsNewCommand === true) {
        safeSessionStorageRemove(storageKey);
        setMessage('The previous secure checkout could not start. Select Pay installment again to create a new payment attempt.');
        return;
      }
      if (typeof response.authorizationUrl !== 'string' || !response.authorizationUrl) {
        throw new Error('SellerTray did not return the secure payment page.');
      }
      window.location.assign(response.authorizationUrl);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to start installment payment. Retry to continue the same checkout.'));
    } finally { setPayingScheduleId(null); }
  }

  if (loading && !center) return <article className="panel"><p className="muted">Loading commercial agreements…</p></article>;

  return <section className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Commercial</p><h2>Billing & agreements</h2></div>
      <p className="muted">Review the SellerTray Master Agreement and the exact Order Form for each purchase. Contract evidence, setup readiness, payment confirmation and subscription entitlement remain separate governed facts.</p>
    </div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {center?.installmentBilling.length ? <InstallmentBillingSection
      billing={center.installmentBilling}
      actorRole={center.actorRole}
      payingScheduleId={payingScheduleId}
      onPay={(scheduleId) => void payInstallment(scheduleId)}
    /> : null}

    {!orderForms.length ? <article className="panel empty-state"><strong>No Order Forms issued</strong><p>Purchase-specific SellerTray Order Forms issued by ProcessEdge will appear here for review and confirmation.</p></article> : <div className="team-management-grid">
      <div className="panel member-list">
        {current.map((form) => <OrderFormButton key={form.id} form={form} selected={selected?.id === form.id} onSelect={() => { setSelectedId(form.id); setLegalName(''); setConfirmed(false); }} />)}
        {history.length ? <div className="nav-section">Order Form history</div> : null}
        {history.map((form) => <OrderFormButton key={form.id} form={form} selected={selected?.id === form.id} onSelect={() => { setSelectedId(form.id); setLegalName(''); setConfirmed(false); }} />)}
      </div>

      {selected ? <article className="panel member-editor">
        <div className="panel-head"><div><p className="eyebrow">Order Form</p><h3>{selected.title}</h3><p className="muted">Reference {selected.reference} · Version {selected.templateVersion}</p></div><Status form={selected} /></div>
        <div className="settings-grid two">
          <Fact label="Issued" value={formatDate(selected.issuedAt)} />
          <Fact label="Commercial order" value={shortId(selected.commercialOrderId)} />
          <Fact label="Order Form integrity" value={selected.contentSha256.slice(0, 16) + '…'} />
          <Fact label="Status" value={selected.isCurrent ? selected.confirmation ? 'Confirmed' : 'Awaiting confirmation' : 'Replaced'} />
        </div>
        {center?.masterAgreement ? <div className="panel agreement-document">
          <p className="eyebrow">Master Agreement · Version {center.masterAgreement.versionCode}</p>
          <h3>{center.masterAgreement.title}</h3>
          <p className="muted">Integrity {center.masterAgreement.contentSha256.slice(0, 16)}… · {center.masterAgreement.acceptance ? `Accepted ${formatDate(center.masterAgreement.acceptance.acceptedAt)}` : 'Acceptance required with this purchase'}</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: 0 }}>{center.masterAgreement.contentBody}</pre>
        </div> : <div className="warning-banner">The current SellerTray Master Agreement is not available. Contact ProcessEdge before continuing.</div>}
        <div className="governance-note">This immutable Order Form records the exact purchase. SellerTray creates deterministic package evidence binding it to the current Master Agreement.</div>
        <div className="panel agreement-document"><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', margin: 0 }}>{selected.renderedContent}</pre></div>

        {selected.confirmation ? <div className="success-banner">Purchase confirmed {formatDate(selected.confirmation.confirmedAt)} by {selected.confirmation.confirmedLegalName} ({roleLabel(selected.confirmation.confirmedRole)}). Package fingerprint {selected.confirmation.packageFingerprint.slice(0, 16)}…</div> : null}
        {!selected.isCurrent ? <div className="warning-banner">This Order Form has been replaced. Review and confirm the current replacement where required.</div> : null}
        {selected.isCurrent && !selected.confirmation && !center?.canAccept ? <div className="warning-banner">Only the Business Owner or a Manager explicitly authorised by the Owner can confirm SellerTray purchases.</div> : null}
        {selected.isCurrent && !selected.confirmation && center?.canAccept && center.masterAgreement ? <form className="settings-form" onSubmit={confirmPackage}>
          <label className="field"><span>Authorised representative legal name</span><SellerTrayInput maxLength={200} required value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Full legal name" /></label>
          <label className="access-card"><SellerTrayInput type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>{center.masterAcceptanceRequired ? 'I accept the Master Agreement and confirm this exact Order Form.' : 'I confirm this exact Order Form under the accepted Master Agreement.'}</strong><small>Your authenticated SellerTray identity, authority, exact document hashes and package fingerprint are recorded.</small></span></label>
          <div className="settings-actions"><button className="primary-button" disabled={busy || !confirmed || !legalName.trim()}>{busy ? 'Recording confirmation…' : center.masterAcceptanceRequired ? 'Accept & Continue' : 'Confirm Purchase'}</button></div>
        </form> : null}
      </article> : null}
    </div>}
  </section>;
}

function InstallmentBillingSection({
  billing,
  actorRole,
  payingScheduleId,
  onPay,
}: {
  billing: InstallmentBilling[];
  actorRole: 'owner' | 'manager';
  payingScheduleId: string | null;
  onPay: (scheduleId: string) => void;
}) {
  return <div className="page-stack">
    {billing.map((item) => {
      const next = item.schedule.find((line) => line.id === item.nextPayableScheduleId) ?? null;
      return <article className="panel" key={item.installmentObligationId}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">Installment billing</p>
            <h3>{structureLabel(item.structureCode)}</h3>
            <p className="muted">{money(item.obligatedAmount, item.currency)} annual purchase · {item.paidInstallmentCount} of {item.installmentCount} installments confirmed</p>
          </div>
          <span className="role-pill">{entitlementLabel(item.entitlementState)}</span>
        </div>
        <div className="settings-grid two">
          <Fact label="Agreement" value={item.agreementAccepted ? 'Accepted' : 'Awaiting acceptance'} />
          <Fact label="Branch setup" value={item.setupReady ? 'Ready' : `${item.setupReadyCount} of ${item.setupRequiredCount} ready`} />
          <Fact label="Activation" value={item.activationAt ? formatDate(item.activationAt) : 'Not activated'} />
          <Fact label="Current entitlement" value={item.fullTermUntil ? `Full term to ${formatDate(item.fullTermUntil)}` : item.provisionalUntil ? `Provisional to ${formatDate(item.provisionalUntil)}` : 'Pending prerequisites'} />
        </div>
        <div className="governance-note">Installment due-date enforcement is not yet enabled because SellerTray’s exact due dates and grace policy have not been approved. Governed entitlement periods still expire at their recorded end time.</div>
        <div className="page-stack">
          {item.schedule.map((line) => <div className="access-card" key={line.id}>
            <span style={{ flex: 1 }}>
              <strong>Installment {line.sequenceNo} · {line.percentage}% · {money(line.amountDue, item.currency)}</strong>
              <small>{line.paymentStatus === 'paid' ? `Paid ${line.paidAt ? formatDate(line.paidAt) : ''}` : dueLabel(line)}</small>
            </span>
            {line.paymentStatus === 'paid' ? <span className="role-pill">Paid</span> : item.nextPayableScheduleId === line.id && actorRole === 'owner' ? <button type="button" className="primary-button" disabled={payingScheduleId !== null} onClick={() => onPay(line.id)}>{payingScheduleId === line.id ? 'Opening payment…' : 'Pay installment'}</button> : item.nextPayableScheduleId === line.id ? <span className="role-pill">Owner payment</span> : <span className="role-pill">Pending</span>}
          </div>)}
        </div>
        {next && !item.agreementAccepted ? <div className="warning-banner">Payment can be prepared, but provisional entitlement will not activate until the current installment agreement is accepted.</div> : null}
        {next && !item.setupReady ? <div className="warning-banner">Payment can be confirmed, but provisional entitlement will not activate until all Branch setup items in this purchase are recorded ready.</div> : null}
      </article>;
    })}
  </div>;
}

function OrderFormButton({ form, selected, onSelect }: { form: OrderForm; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={selected ? 'member-row active' : 'member-row'} onClick={onSelect}>
    <span className="member-avatar">{form.isCurrent ? 'O' : 'H'}</span>
    <span><strong>{form.title}</strong><small>{form.reference} · {form.confirmation ? 'Confirmed' : form.isCurrent ? 'Pending' : 'Replaced'}</small></span>
  </button>;
}
function Status({ form }: { form: OrderForm }) {
  const label = form.confirmation ? 'Confirmed' : form.isCurrent ? 'Pending' : 'Replaced';
  return <span className="role-pill">{label}</span>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function roleLabel(value: string) { return value === 'owner' ? 'Owner' : value === 'manager' ? 'Manager' : value; }
function shortId(value: string) { return value ? `${value.slice(0, 8)}…` : '—'; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN' }).format(value); } catch { return `${currency} ${value.toLocaleString()}`; } }
function structureLabel(value: string) { return value === 'two_installment_70_30' ? '70:30 installment plan' : value === 'three_installment_60_20_20' ? '60:20:20 installment plan' : 'Installment plan'; }
function entitlementLabel(value: string) {
  if (value === 'full') return 'Full entitlement';
  if (value === 'provisional') return 'Provisional';
  if (value === 'pending_agreement') return 'Agreement required';
  if (value === 'pending_setup') return 'Setup required';
  if (value === 'awaiting_first_payment') return 'Payment required';
  if (value === 'ready_for_activation') return 'Activation pending';
  return value.replace(/_/g, ' ');
}
function dueLabel(line: InstallmentLine) {
  if (line.dueState === 'past_due') return `Past due since ${line.dueAt ? formatDate(line.dueAt) : 'the scheduled date'}`;
  if (line.dueState === 'scheduled') return `Scheduled for ${line.dueAt ? formatDate(line.dueAt) : 'a future date'}`;
  return 'Due date not yet scheduled';
}
function installmentCommandStorageKey(tenantId: string, scheduleId: string) { return `sellertray:installment-checkout:${tenantId}:${scheduleId}`; }
function safeSessionStorageGet(key: string) { try { return window.sessionStorage.getItem(key); } catch { return null; } }
function safeSessionStorageSet(key: string, value: string) { try { window.sessionStorage.setItem(key, value); } catch { /* browser storage unavailable */ } }
function safeSessionStorageRemove(key: string) { try { window.sessionStorage.removeItem(key); } catch { /* browser storage unavailable */ } }
function isUuid(value: string | null): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function numberValue(value: unknown) { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function nullableString(value: unknown) { return typeof value === 'string' && value ? value : null; }
function parseCenter(value: unknown): AgreementCenter {
  const root = record(value);
  const actorRole = root.actorRole === 'owner' ? 'owner' : 'manager';
  const masterRow = record(root.masterAgreement);
  const masterAcceptanceRow = record(masterRow.acceptance);
  const masterAcceptance = typeof masterAcceptanceRow.id === 'string' ? {
    id: masterAcceptanceRow.id,
    acceptedAt: String(masterAcceptanceRow.acceptedAt ?? ''),
    acceptedLegalName: String(masterAcceptanceRow.acceptedLegalName ?? ''),
    acceptedRole: masterAcceptanceRow.acceptedRole === 'owner' ? 'owner' : 'manager',
    acceptedByCurrentUser: masterAcceptanceRow.acceptedByCurrentUser === true,
  } satisfies MasterAcceptance : null;
  const masterAgreement = typeof masterRow.id === 'string' ? {
    id: masterRow.id,
    versionCode: String(masterRow.versionCode ?? ''),
    title: String(masterRow.title ?? 'SellerTray Master Agreement'),
    contentBody: String(masterRow.contentBody ?? ''),
    contentSha256: String(masterRow.contentSha256 ?? ''),
    effectiveFrom: String(masterRow.effectiveFrom ?? ''),
    acceptance: masterAcceptance,
  } satisfies MasterAgreement : null;
  const orderForms = Array.isArray(root.orderForms) ? root.orderForms.flatMap((raw) => {
    const row = record(raw);
    if (typeof row.id !== 'string') return [];
    const confirmationRow = record(row.confirmation);
    const confirmation = typeof confirmationRow.id === 'string' ? {
      id: confirmationRow.id,
      confirmedAt: String(confirmationRow.confirmedAt ?? ''),
      confirmedLegalName: String(confirmationRow.confirmedLegalName ?? ''),
      confirmedRole: confirmationRow.confirmedRole === 'owner' ? 'owner' : 'manager',
      confirmedByCurrentUser: confirmationRow.confirmedByCurrentUser === true,
      packageFingerprint: String(confirmationRow.packageFingerprint ?? ''),
    } satisfies OrderFormConfirmation : null;
    return [{
      id: row.id,
      reference: String(row.reference ?? ''),
      title: String(row.title ?? 'SellerTray Order Form'),
      templateVersion: String(row.templateVersion ?? ''),
      renderedContent: String(row.renderedContent ?? ''),
      contentSha256: String(row.contentSha256 ?? ''),
      commercialOrderId: String(row.commercialOrderId ?? ''),
      installmentObligationId: typeof row.installmentObligationId === 'string' ? row.installmentObligationId : null,
      supersedesOrderFormId: typeof row.supersedesOrderFormId === 'string' ? row.supersedesOrderFormId : null,
      isCurrent: row.isCurrent === true,
      issuedAt: String(row.issuedAt ?? ''),
      confirmation,
    } satisfies OrderForm];
  }) : [];
  const installmentBilling = Array.isArray(root.installmentBilling) ? root.installmentBilling.flatMap((raw) => {
    const row = record(raw);
    const obligationId = nullableString(row.installmentObligationId);
    if (!obligationId) return [];
    const schedule = Array.isArray(row.schedule) ? row.schedule.flatMap((rawLine) => {
      const line = record(rawLine);
      const id = nullableString(line.id);
      if (!id) return [];
      return [{
        id,
        sequenceNo: numberValue(line.sequenceNo),
        percentage: numberValue(line.percentage),
        amountDue: numberValue(line.amountDue),
        dueAt: nullableString(line.dueAt),
        paymentStatus: line.paymentStatus === 'paid' ? 'paid' : 'unpaid',
        dueState: line.dueState === 'paid' || line.dueState === 'scheduled' || line.dueState === 'past_due' ? line.dueState : 'unscheduled',
        paidAt: nullableString(line.paidAt),
        provider: nullableString(line.provider),
        providerReference: nullableString(line.providerReference),
      } satisfies InstallmentLine];
    }) : [];
    return [{
      tenantId: String(row.tenantId ?? ''),
      commercialOrderId: String(row.commercialOrderId ?? ''),
      installmentObligationId: obligationId,
      structureCode: String(row.structureCode ?? ''),
      currency: String(row.currency ?? 'NGN'),
      obligatedAmount: numberValue(row.obligatedAmount),
      planCode: String(row.planCode ?? ''),
      billingCycle: String(row.billingCycle ?? ''),
      agreementAccepted: row.agreementAccepted === true,
      agreementAcceptedAt: nullableString(row.agreementAcceptedAt),
      setupRequiredCount: numberValue(row.setupRequiredCount),
      setupReadyCount: numberValue(row.setupReadyCount),
      setupReady: row.setupReady === true,
      setupReadyAt: nullableString(row.setupReadyAt),
      paidInstallmentCount: numberValue(row.paidInstallmentCount),
      installmentCount: numberValue(row.installmentCount),
      fullyPaid: row.fullyPaid === true,
      firstPaidAt: nullableString(row.firstPaidAt),
      entitlementState: String(row.entitlementState ?? 'pending'),
      activationAt: nullableString(row.activationAt),
      provisionalUntil: nullableString(row.provisionalUntil),
      fullTermUntil: nullableString(row.fullTermUntil),
      nextPayableScheduleId: nullableString(row.nextPayableScheduleId),
      schedule,
      dueEnforcementMode: 'informational_only',
    } satisfies InstallmentBilling];
  }) : [];
  return {
    tenantId: String(root.tenantId ?? ''),
    actorRole,
    canAccept: root.canAccept === true,
    masterAgreement,
    masterAcceptanceRequired: root.masterAcceptanceRequired === true,
    orderForms,
    installmentBilling,
  };
}
