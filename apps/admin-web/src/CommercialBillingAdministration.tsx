import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson, isRecord } from './supabase';

export type CommercialAdminTenant = {
  id: string;
  name: string;
  businessEmail: string | null;
  businessPhone: string | null;
  slug: string;
  planCode: string | null;
  subscriptionStatus: string;
};

type BranchSetupState = {
  commercialOrderId: string;
  installmentObligationId: string | null;
  lineNo: number;
  branchId: string;
  branchCode: string;
  branchName: string;
  description: string;
  currency: string;
  grossAmount: number;
  ready: boolean;
  readinessId: string | null;
  readyAt: string | null;
  reason: string | null;
  recordedAt: string | null;
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
  providerReference: string | null;
};

type InstallmentState = {
  commercialOrderId: string;
  installmentObligationId: string;
  structureCode: string;
  currency: string;
  obligatedAmount: number;
  planCode: string;
  agreementAccepted: boolean;
  setupRequiredCount: number;
  setupReadyCount: number;
  setupReady: boolean;
  paidInstallmentCount: number;
  installmentCount: number;
  fullyPaid: boolean;
  entitlementState: string;
  activationAt: string | null;
  provisionalUntil: string | null;
  fullTermUntil: string | null;
  schedule: InstallmentLine[];
};

type CommercialOverview = {
  actorRole: 'admin' | 'support';
  canManage: boolean;
  tenantId: string | null;
  installmentBilling: InstallmentState[];
  branchSetup: BranchSetupState[];
};

type AdminResponse = { ok?: boolean; overview?: unknown; readinessId?: string };

type SetupForm = {
  key: string;
  reason: string;
  readyAtLocal: string;
  confirmed: boolean;
};

export default function CommercialBillingAdministration({
  session,
  actorRole,
  tenants,
}: {
  session: Session;
  actorRole: 'admin' | 'support';
  tenants: CommercialAdminTenant[];
}) {
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [search, setSearch] = useState('');
  const [overview, setOverview] = useState<CommercialOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [setupForm, setSetupForm] = useState<SetupForm | null>(null);
  const setupCommandIds = useRef(new Map<string, string>());

  const filteredTenants = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return tenants;
    return tenants.filter((tenant) => [
      tenant.name,
      tenant.businessEmail ?? '',
      tenant.businessPhone ?? '',
      tenant.slug,
      tenant.planCode ?? '',
      tenant.subscriptionStatus,
    ].some((value) => value.toLowerCase().includes(needle)));
  }, [search, tenants]);

  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;

  useEffect(() => {
    if (!selectedTenantId) {
      setOverview(null);
      return;
    }
    void loadTenant(selectedTenantId);
  }, [selectedTenantId]);

  async function loadTenant(tenantId: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await invokeJson<AdminResponse>('commercial-agreements', {
        action: 'admin_overview',
        tenantId,
      }, session);
      setOverview(parseOverview(response.overview));
    } catch (cause) {
      setOverview(null);
      setError(messageFrom(cause, 'Unable to load governed commercial state for this business.'));
    } finally {
      setLoading(false);
    }
  }

  function openSetupForm(row: BranchSetupState) {
    if (actorRole !== 'admin' || row.ready) return;
    setError(null);
    setMessage(null);
    setSetupForm({
      key: setupKey(row),
      reason: '',
      readyAtLocal: toLocalDateTimeInput(new Date()),
      confirmed: false,
    });
  }

  async function markSetupReady(row: BranchSetupState) {
    if (actorRole !== 'admin' || row.ready || saving || setupForm?.key !== setupKey(row)) return;
    const reason = setupForm.reason.trim().replace(/\s+/g, ' ');
    if (!reason) return setError('Enter the operational reason confirming Branch setup readiness.');
    if (!setupForm.confirmed) return setError('Confirm that the Branch setup has actually been completed before recording readiness.');
    const readyAtDate = new Date(setupForm.readyAtLocal);
    if (Number.isNaN(readyAtDate.getTime())) return setError('Enter a valid setup completion time.');
    if (readyAtDate.getTime() > Date.now() + 5 * 60 * 1000) return setError('Setup completion time cannot be in the future.');

    const key = setupKey(row);
    const storageKey = `sellertray-admin:c1b-setup-ready:${row.commercialOrderId}:${row.branchId}`;
    const storedCommand = safeSessionStorageGet(storageKey);
    const commandId = isUuid(storedCommand)
      ? storedCommand
      : setupCommandIds.current.get(key) ?? crypto.randomUUID();
    setupCommandIds.current.set(key, commandId);
    safeSessionStorageSet(storageKey, commandId);

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await invokeJson<AdminResponse>('commercial-agreements', {
        action: 'admin_mark_setup_ready',
        tenantId: selectedTenantId,
        commercialOrderId: row.commercialOrderId,
        branchId: row.branchId,
        commandId,
        reason,
        readyAt: readyAtDate.toISOString(),
        evidence: { source: 'sellertray_admin_web' },
      }, session);
      const next = parseOverview(response.overview);
      setOverview(next);
      setupCommandIds.current.delete(key);
      safeSessionStorageRemove(storageKey);
      setSetupForm(null);
      setMessage(`${row.branchName} setup readiness recorded.`);
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to record Branch setup readiness. Retry continues the same command.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="workspace-grid two">
      <section className="workspace-panel">
        <div className="workspace-panel-heading">
          <div><h2>Merchant commercial state</h2><p>Select a business to review governed installment, agreement and Branch setup state.</p></div>
        </div>
        <div className="workspace-form-stack">
          <label>Search businesses<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Business, email, phone, plan or status" /></label>
          <label>Business<select value={selectedTenantId} onChange={(event) => { setSelectedTenantId(event.target.value); setSetupForm(null); setMessage(null); }}>
            <option value="">Select a SellerTray business</option>
            {filteredTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}{tenant.planCode ? ` · ${tenant.planCode}` : ''}</option>)}
          </select></label>
        </div>
        {selectedTenant ? <div className="workspace-detail-grid">
          <Detail label="Business" value={selectedTenant.name} />
          <Detail label="Plan" value={selectedTenant.planCode ?? 'Not assigned'} />
          <Detail label="Subscription state" value={label(selectedTenant.subscriptionStatus)} />
          <Detail label="Contact" value={selectedTenant.businessEmail ?? selectedTenant.businessPhone ?? selectedTenant.slug} />
        </div> : null}
        {actorRole === 'support' ? <div className="workspace-banner info">Platform Support can review C1B commercial state but cannot record Branch setup readiness.</div> : null}
      </section>

      <section className="workspace-panel">
        <div className="workspace-panel-heading"><div><h2>C1B status</h2><p>Payment, agreement, setup readiness and entitlement remain separate governed facts.</p></div></div>
        {!selectedTenantId ? <Empty title="Select a business" body="Choose a SellerTray business to load its commercial state." /> : loading ? <Empty title="Loading commercial state" body="Reading governed C1/C1A/C1B records…" /> : overview ? <div className="workspace-detail-grid">
          <Detail label="Installment purchases" value={String(overview.installmentBilling.length)} />
          <Detail label="Branch setup lines" value={String(overview.branchSetup.length)} />
          <Detail label="Setup ready" value={`${overview.branchSetup.filter((row) => row.ready).length} of ${overview.branchSetup.length}`} />
          <Detail label="Admin authority" value={overview.canManage ? 'Manage' : 'Review only'} />
        </div> : <Empty title="No commercial state loaded" body="Retry the selected business if a temporary error occurred." />}
      </section>

      {error ? <div className="workspace-banner error">{error}</div> : null}
      {message ? <div className="workspace-banner success">{message}</div> : null}

      {overview ? <section className="workspace-panel" style={{ gridColumn: '1 / -1' }}>
        <div className="workspace-panel-heading"><div><h2>Branch setup readiness</h2><p>Readiness is an immutable commercial fact tied to the exact Branch setup purchase line.</p></div></div>
        <div className="workspace-table-wrap">
          <table className="workspace-table compact-table">
            <thead><tr><th>Branch</th><th>Commercial order</th><th>Setup line</th><th>Amount</th><th>Status</th><th>Recorded</th><th>Action</th></tr></thead>
            <tbody>
              {overview.branchSetup.map((row) => <tr key={setupKey(row)}>
                <td><strong>{row.branchName}</strong><small>{row.branchCode}</small></td>
                <td>{shortId(row.commercialOrderId)}</td>
                <td>{row.description}</td>
                <td>{money(row.grossAmount,row.currency)}</td>
                <td><span className={`workspace-status ${row.ready ? 'success' : 'attention'}`}>{row.ready ? 'Ready' : 'Pending'}</span></td>
                <td>{row.readyAt ? formatDate(row.readyAt) : '—'}</td>
                <td>{row.ready ? 'Immutable' : actorRole === 'admin' ? <button type="button" className="workspace-button subtle compact" onClick={() => openSetupForm(row)}>Record ready</button> : 'Review only'}</td>
              </tr>)}
              {!overview.branchSetup.length ? <tr><td colSpan={7}><Empty title="No Branch setup purchase lines" body="C1B activation intentionally remains pending setup until a governed Branch setup line exists and is recorded ready." /></td></tr> : null}
            </tbody>
          </table>
        </div>
        {setupForm ? (() => {
          const row = overview.branchSetup.find((item) => setupKey(item) === setupForm.key);
          if (!row) return null;
          return <div className="workspace-form-stack" style={{ marginTop: 16 }}>
            <div className="workspace-banner warning"><strong>Immutable commercial fact.</strong> Record readiness only after {row.branchName} setup is actually complete. SellerTray will not invent equipment, handover or inspection evidence.</div>
            <div className="workspace-field-grid two">
              <label>Completion time<input type="datetime-local" value={setupForm.readyAtLocal} onChange={(event) => setSetupForm({ ...setupForm, readyAtLocal: event.target.value })} /></label>
              <label>Reason<input maxLength={1000} value={setupForm.reason} onChange={(event) => setSetupForm({ ...setupForm, reason: event.target.value })} placeholder="Why is this Branch setup ready?" /></label>
            </div>
            <label className="workspace-check-pill"><input type="checkbox" checked={setupForm.confirmed} onChange={(event) => setSetupForm({ ...setupForm, confirmed: event.target.checked })} />I confirm this Branch setup has been completed and this immutable readiness record is accurate.</label>
            <div className="workspace-filter-row">
              <button type="button" className="workspace-button primary" disabled={saving || !setupForm.confirmed || !setupForm.reason.trim()} onClick={() => void markSetupReady(row)}>{saving ? 'Recording…' : 'Record setup ready'}</button>
              <button type="button" className="workspace-button subtle" disabled={saving} onClick={() => setSetupForm(null)}>Cancel</button>
            </div>
          </div>;
        })() : null}
      </section> : null}

      {overview ? <section className="workspace-panel" style={{ gridColumn: '1 / -1' }}>
        <div className="workspace-panel-heading"><div><h2>Installment entitlement</h2><p>Due dates are informational until an explicit grace/suspension policy is approved. Recorded entitlement end dates still govern access.</p></div></div>
        {overview.installmentBilling.length ? <div className="workspace-form-stack">{overview.installmentBilling.map((item) => <article key={item.installmentObligationId} className="workspace-module-card">
          <div className="workspace-panel-heading"><div><h3>{structureLabel(item.structureCode)}</h3><p>{money(item.obligatedAmount,item.currency)} · {item.paidInstallmentCount} of {item.installmentCount} installments confirmed</p></div><span className="workspace-status info">{label(item.entitlementState)}</span></div>
          <div className="workspace-detail-grid">
            <Detail label="Agreement" value={item.agreementAccepted ? 'Accepted' : 'Awaiting acceptance'} />
            <Detail label="Branch setup" value={item.setupReady ? 'Ready' : `${item.setupReadyCount} of ${item.setupRequiredCount} ready`} />
            <Detail label="Activation" value={item.activationAt ? formatDate(item.activationAt) : 'Not activated'} />
            <Detail label="Entitlement end" value={item.fullTermUntil ? formatDate(item.fullTermUntil) : item.provisionalUntil ? formatDate(item.provisionalUntil) : 'Pending prerequisites'} />
          </div>
          <div className="workspace-table-wrap"><table className="workspace-table compact-table"><thead><tr><th>Installment</th><th>Share</th><th>Amount</th><th>Due state</th><th>Payment</th></tr></thead><tbody>{item.schedule.map((line) => <tr key={line.id}><td>{line.sequenceNo}</td><td>{line.percentage}%</td><td>{money(line.amountDue,item.currency)}</td><td>{dueLabel(line)}</td><td>{line.paymentStatus === 'paid' ? `Paid ${line.paidAt ? formatDate(line.paidAt) : ''}` : 'Unpaid'}</td></tr>)}</tbody></table></div>
        </article>)}</div> : <Empty title="No installment purchase" body="This business has no governed C1B installment obligation." />}
      </section> : null}
    </div>
  );
}

function parseOverview(value: unknown): CommercialOverview {
  const root = record(value);
  return {
    actorRole: root.actorRole === 'admin' ? 'admin' : 'support',
    canManage: root.canManage === true,
    tenantId: nullableString(root.tenantId),
    installmentBilling: Array.isArray(root.installmentBilling) ? root.installmentBilling.flatMap(parseInstallment) : [],
    branchSetup: Array.isArray(root.branchSetup) ? root.branchSetup.flatMap(parseBranchSetup) : [],
  };
}

function parseBranchSetup(value: unknown): BranchSetupState[] {
  const row = record(value);
  const commercialOrderId = nullableString(row.commercialOrderId);
  const branchId = nullableString(row.branchId);
  if (!commercialOrderId || !branchId) return [];
  return [{
    commercialOrderId,
    installmentObligationId: nullableString(row.installmentObligationId),
    lineNo: numberValue(row.lineNo),
    branchId,
    branchCode: String(row.branchCode ?? ''),
    branchName: String(row.branchName ?? 'Branch'),
    description: String(row.description ?? 'Branch setup'),
    currency: String(row.currency ?? 'NGN'),
    grossAmount: numberValue(row.grossAmount),
    ready: row.ready === true,
    readinessId: nullableString(row.readinessId),
    readyAt: nullableString(row.readyAt),
    reason: nullableString(row.reason),
    recordedAt: nullableString(row.recordedAt),
  }];
}

function parseInstallment(value: unknown): InstallmentState[] {
  const row = record(value);
  const id = nullableString(row.installmentObligationId);
  if (!id) return [];
  const schedule = Array.isArray(row.schedule) ? row.schedule.flatMap((raw) => {
    const line = record(raw);
    const lineId = nullableString(line.id);
    if (!lineId) return [];
    return [{
      id: lineId,
      sequenceNo: numberValue(line.sequenceNo),
      percentage: numberValue(line.percentage),
      amountDue: numberValue(line.amountDue),
      dueAt: nullableString(line.dueAt),
      paymentStatus: line.paymentStatus === 'paid' ? 'paid' : 'unpaid',
      dueState: line.dueState === 'paid' || line.dueState === 'scheduled' || line.dueState === 'past_due' ? line.dueState : 'unscheduled',
      paidAt: nullableString(line.paidAt),
      providerReference: nullableString(line.providerReference),
    } satisfies InstallmentLine];
  }) : [];
  return [{
    commercialOrderId: String(row.commercialOrderId ?? ''),
    installmentObligationId: id,
    structureCode: String(row.structureCode ?? ''),
    currency: String(row.currency ?? 'NGN'),
    obligatedAmount: numberValue(row.obligatedAmount),
    planCode: String(row.planCode ?? ''),
    agreementAccepted: row.agreementAccepted === true,
    setupRequiredCount: numberValue(row.setupRequiredCount),
    setupReadyCount: numberValue(row.setupReadyCount),
    setupReady: row.setupReady === true,
    paidInstallmentCount: numberValue(row.paidInstallmentCount),
    installmentCount: numberValue(row.installmentCount),
    fullyPaid: row.fullyPaid === true,
    entitlementState: String(row.entitlementState ?? 'pending'),
    activationAt: nullableString(row.activationAt),
    provisionalUntil: nullableString(row.provisionalUntil),
    fullTermUntil: nullableString(row.fullTermUntil),
    schedule,
  }];
}

function Detail({ label: name, value }: { label: string; value: string }) {
  return <div><span className="workspace-muted small">{name}</span><strong style={{ display: 'block', marginTop: 4 }}>{value}</strong></div>;
}
function Empty({ title, body }: { title: string; body: string }) { return <div className="workspace-empty"><strong>{title}</strong><p>{body}</p></div>; }
function setupKey(row: BranchSetupState) { return `${row.commercialOrderId}:${row.branchId}`; }
function shortId(value: string) { return value ? `${value.slice(0, 8)}…` : '—'; }
function label(value: string) { return value.split('_').map((part) => part ? part[0].toUpperCase()+part.slice(1) : '').join(' '); }
function structureLabel(value: string) { return value === 'two_installment_70_30' ? '70:30 annual installments' : value === 'three_installment_60_20_20' ? '60:20:20 annual installments' : label(value); }
function dueLabel(line: InstallmentLine) { return line.dueState === 'past_due' ? 'Past due (informational)' : line.dueState === 'scheduled' ? (line.dueAt ? `Scheduled ${formatDate(line.dueAt)}` : 'Scheduled') : line.dueState === 'paid' ? 'Paid' : 'Not scheduled'; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG',{dateStyle:'medium',timeStyle:'short'}).format(date); }
function money(value: number,currency: string) { try { return new Intl.NumberFormat('en-NG',{style:'currency',currency:currency || 'NGN',maximumFractionDigits:2}).format(value); } catch { return `${currency} ${value.toLocaleString()}`; } }
function toLocalDateTimeInput(date: Date) { const offset = date.getTimezoneOffset(); return new Date(date.getTime()-offset*60_000).toISOString().slice(0,16); }
function safeSessionStorageGet(key: string) { try { return window.sessionStorage.getItem(key); } catch { return null; } }
function safeSessionStorageSet(key: string,value: string) { try { window.sessionStorage.setItem(key,value); } catch { /* unavailable */ } }
function safeSessionStorageRemove(key: string) { try { window.sessionStorage.removeItem(key); } catch { /* unavailable */ } }
function isUuid(value: string | null): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function record(value: unknown): Record<string,unknown> { return isRecord(value) ? value : {}; }
function nullableString(value: unknown) { return typeof value === 'string' && value ? value : null; }
function numberValue(value: unknown) { const parsed=typeof value==='number'?value:Number(value); return Number.isFinite(parsed)?parsed:0; }
function messageFrom(value: unknown,fallback: string) { return value instanceof Error && value.message ? value.message : fallback; }
