import { SellerTrayInput } from './SellerTrayElements';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
  agreements: Agreement[];
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
        body: {
          action: 'merchant_accept',
          tenantId,
          agreementId: selected.id,
          legalName: name,
          authorityConfirmed: true,
          commandId,
        },
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
      <p className="muted">Review issued SellerTray commercial documents, setup readiness and installment payments. Agreement acceptance, setup completion, payment confirmation and subscription entitlement remain separate governed facts.</p>
    </div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {center?.installmentBilling.length ? <InstallmentBillingSection
      billing={center.installmentBilling}
      actorRole={center.actorRole}
      payingScheduleId={payingScheduleId}
      onPay={(scheduleId) => void payInstallment(scheduleId)}
    /> : null}

    {!agreements.length ? <article className="panel empty-state"><strong>No commercial agreements issued</strong><p>SellerTray commercial documents issued by ProcessEdge will appear here for review and acceptance.</p></article> : <div className="team-management-grid">
      <div className="panel member-list">
        {current.map((agreement) => <AgreementButton key={agreement.id} agreement={agreement} selected={selected?.id === agreement.id} onSelect={() => { setSelectedId(agreement.id); setLegalName(''); setConfirmed(false); }} />)}
        {history.length ? <div className="nav-section">Agreement history</div> : null}
        {history.map((agreement) => <AgreementButton key={agreement.id} agreement={agreement} selected={selected?.id === agreement.id} onSelect={() => { setSelectedId(agreement.id); setLegalName(''); setConfirmed(false); }} />)}
      </div>

      {selected ? <article className="panel member-editor">
        <div className="panel-head"><div><p className="eyebrow">{familyLabel(selected.family)}</p><h3>{selected.title}</h3><p className="muted">Reference {selected.reference} · Version {selected.templateVersion}</p></div><Status agreement={selected} /></div>
        <div className="settings-grid two">
          <Fact label="Issued" value={formatDate(selected.issuedAt)} />
          <Fact label="Commercial order" value={shortId(selected.commercialOrderId)} />
          <Fact label="Agreement integrity" value={selected.contentSha256.slice(0, 16) + '…'} />
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

function AgreementButton({ agreement, selected, onSelect }: { agreement: Agreement; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={selected ? 'member-row active' : 'member-row'} onClick={onSelect}>
    <span className="member-avatar">{agreement.isCurrent ? 'A' : 'H'}</span>
    <span><strong>{agreement.title}</strong><small>{agreement.reference} · {agreement.acceptance ? 'Accepted' : agreement.isCurrent ? 'Pending' : 'Replaced'}</small></span>
  </button>;
}
function Status({ agreement }: { agreement: Agreement }) {
  const label = agreement.acceptance ? 'Accepted' : agreement.isCurrent ? 'Pending' : 'Replaced';
  return <span className="role-pill">{label}</span>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function familyLabel(value: string) { return value.split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' '); }
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
  return { tenantId: String(root.tenantId ?? ''), actorRole, canAccept: root.canAccept === true, agreements, installmentBilling };
}
