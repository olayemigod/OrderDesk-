import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import MerchantSelector from './MerchantSelector';
import { invokeJson } from './supabase';

type CapabilitySet = { canAdjust: boolean; canConfirmDirectPayment: boolean; canManageInstallments: boolean };
type TemplateLine = { sequenceNo: number; percentage: number | null; fixedAmount: number | null; dueOffsetDays: number | null };
type ScheduleTemplate = { id: string; code: string; version: number; displayName: string; provisionalEntitlementMonths: number; qualifyingSettlementSequence: number; lines: TemplateLine[] };
type Settlement = {
  grossAmount: number;
  approvedAdjustmentAmount: number;
  gatewayPaymentAmount: number;
  directPaymentAmount: number;
  totalConfirmedPaymentAmount: number;
  netAmountDue: number;
  outstandingAmount: number;
  overpaymentAmount: number;
  settlementStatus: string;
  nextInstallmentScheduleId: string | null;
  nextPayableAmount: number;
};
type History = { id: string; amount: number; reason?: string; paymentReference?: string; paymentMethod?: string; provider?: string; providerReference?: string; paidAt?: string; approvedAt?: string; recordedAt?: string };
type SettlementOrder = {
  commercialOrderId: string;
  orderReference: string;
  orderedAt: string;
  currency: string;
  grossAmount: number;
  planCode: string | null;
  billingCycle: string | null;
  installmentObligationId: string | null;
  settlement: Settlement;
  currentInstallmentPolicy: Record<string, unknown> | null;
  contractSnapshot: Record<string, unknown> | null;
  adjustments: History[];
  directPayments: History[];
  gatewayPayments: History[];
};
type SettlementCenter = { actorRole: 'admin' | 'support'; tenantId: string; capabilities: CapabilitySet; templates: ScheduleTemplate[]; orders: SettlementOrder[]; generatedAt: string };
type AdminResponse = { ok?: boolean; center?: unknown; order?: unknown };
type CommandSlot = 'adjustment' | 'direct-payment' | 'installment-policy';
type SettlementTab = 'overview' | 'payment' | 'adjustments' | 'policy' | 'history';

export default function CommercialSettlementAdministration({ session, initialTenantId }: { session: Session; initialTenantId?: string | null }) {
  const [tenantId, setTenantId] = useState(initialTenantId ?? '');
  const [center, setCenter] = useState<SettlementCenter | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [tab, setTab] = useState<SettlementTab>('overview');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<CommandSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const commands = useRef(new Map<CommandSlot, string>());
  const loadSequence = useRef(0);

  const [adjustment, setAdjustment] = useState({ amount: '', reason: '', evidenceReference: '', evidenceNote: '' });
  const [directPayment, setDirectPayment] = useState({ amount: '', reference: '', method: 'bank_transfer', paidAt: nowLocal(), reason: '', evidenceNote: '' });
  const [policy, setPolicy] = useState({ scopeKind: 'commercial_order' as 'tenant' | 'commercial_order', billingCycle: 'yearly' as 'monthly' | 'yearly', enabled: true, templateId: '', effectiveFrom: nowLocal(), effectiveUntil: '', reason: '' });

  const selectedOrder = useMemo(() => center?.orders.find((order) => order.commercialOrderId === selectedOrderId) ?? center?.orders[0] ?? null, [center, selectedOrderId]);

  useEffect(() => {
    if (initialTenantId === undefined) return;
    setTenantId(initialTenantId ?? '');
    setTab('overview');
  }, [initialTenantId]);

  useEffect(() => {
    if (!tenantId) { setCenter(null); setSelectedOrderId(''); return; }
    void loadCenter(tenantId);
  }, [tenantId]);

  useEffect(() => {
    if (!center) return;
    const nextOrderId = center.orders.some((order) => order.commercialOrderId === selectedOrderId) ? selectedOrderId : center.orders[0]?.commercialOrderId ?? '';
    setSelectedOrderId(nextOrderId);
    if (!policy.templateId && center.templates[0]) setPolicy((current) => ({ ...current, templateId: center.templates[0].id }));
  }, [center]);

  async function invoke(payload: Record<string, unknown>) {
    return await invokeJson<AdminResponse>('platform-admin-settlement', payload, session);
  }

  async function loadCenter(nextTenantId = tenantId) {
    if (!nextTenantId) return;
    const sequence = ++loadSequence.current;
    setLoading(true); setError(null);
    try {
      const response = await invoke({ action: 'center', tenantId: nextTenantId });
      if (sequence !== loadSequence.current) return;
      setCenter(parseCenter(response.center));
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setCenter(null);
      setError(messageFrom(cause, 'Unable to load commercial settlement authority.'));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  function commandId(slot: CommandSlot) {
    const existing = commands.current.get(slot);
    if (existing) return existing;
    const next = crypto.randomUUID();
    commands.current.set(slot, next);
    return next;
  }

  function applyOrder(raw: unknown) {
    const order = parseOrder(raw);
    setCenter((current) => current ? { ...current, orders: current.orders.map((item) => item.commercialOrderId === order.commercialOrderId ? order : item) } : current);
    setSelectedOrderId(order.commercialOrderId);
  }

  async function recordAdjustment() {
    if (!tenantId || !selectedOrder || saving) return;
    const amount = positiveNumber(adjustment.amount);
    const reason = adjustment.reason.trim();
    if (amount === null) return setError('Enter a positive adjustment amount.');
    if (reason.length < 6) return setError('Enter an adjustment reason of at least 6 characters.');
    setSaving('adjustment'); setError(null); setMessage(null);
    try {
      const response = await invoke({
        action: 'record_adjustment', tenantId, commercialOrderId: selectedOrder.commercialOrderId,
        commandId: commandId('adjustment'), amount, reason,
        evidence: compactEvidence(adjustment.evidenceReference, adjustment.evidenceNote),
      });
      applyOrder(response.order);
      commands.current.delete('adjustment');
      setAdjustment({ amount: '', reason: '', evidenceReference: '', evidenceNote: '' });
      setMessage('Commercial adjustment recorded. The authoritative balance has been recalculated.');
    } catch (cause) { setError(messageFrom(cause, 'Unable to record the commercial adjustment.')); }
    finally { setSaving(null); }
  }

  async function recordDirectPayment() {
    if (!tenantId || !selectedOrder || saving) return;
    const amount = positiveNumber(directPayment.amount);
    const paidAt = isoFromLocal(directPayment.paidAt);
    const reason = directPayment.reason.trim();
    if (amount === null) return setError('Enter a positive direct payment amount.');
    if (!directPayment.reference.trim()) return setError('Enter the ProcessEdge payment reference.');
    if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(directPayment.method.trim())) return setError('Payment method must be a short code such as bank_transfer.');
    if (!paidAt) return setError('Enter a valid payment date and time.');
    if (reason.length < 6) return setError('Enter a direct payment reason of at least 6 characters.');
    setSaving('direct-payment'); setError(null); setMessage(null);
    try {
      const response = await invoke({
        action: 'record_direct_payment', tenantId, commercialOrderId: selectedOrder.commercialOrderId,
        commandId: commandId('direct-payment'), paymentReference: directPayment.reference.trim(),
        paymentMethod: directPayment.method.trim().toLowerCase(), amount, paidAt, reason,
        evidence: directPayment.evidenceNote.trim() ? { note: directPayment.evidenceNote.trim() } : {},
      });
      applyOrder(response.order);
      commands.current.delete('direct-payment');
      setDirectPayment({ amount: '', reference: '', method: 'bank_transfer', paidAt: nowLocal(), reason: '', evidenceNote: '' });
      setMessage('Direct ProcessEdge payment confirmed without creating a synthetic provider transaction.');
    } catch (cause) { setError(messageFrom(cause, 'Unable to confirm the direct payment.')); }
    finally { setSaving(null); }
  }

  async function publishPolicy() {
    if (!tenantId || saving) return;
    const effectiveFrom = isoFromLocal(policy.effectiveFrom);
    const effectiveUntil = policy.effectiveUntil ? isoFromLocal(policy.effectiveUntil) : null;
    const reason = policy.reason.trim();
    if (!effectiveFrom || (policy.effectiveUntil && !effectiveUntil)) return setError('Enter a valid installment-policy effective period.');
    if (reason.length < 6) return setError('Enter an installment-policy reason of at least 6 characters.');
    if (policy.scopeKind === 'commercial_order' && !selectedOrder) return setError('Choose a commercial order for the order-specific override.');
    if (policy.enabled && !policy.templateId) return setError('Choose a governed installment template.');
    setSaving('installment-policy'); setError(null); setMessage(null);
    try {
      const response = await invoke({
        action: 'publish_installment_policy', tenantId, commandId: commandId('installment-policy'),
        scopeKind: policy.scopeKind,
        commercialOrderId: policy.scopeKind === 'commercial_order' ? selectedOrder?.commercialOrderId ?? null : null,
        billingCycle: policy.scopeKind === 'tenant' ? policy.billingCycle : null,
        enabled: policy.enabled, templateId: policy.enabled ? policy.templateId : null,
        effectiveFrom, effectiveUntil, reason,
      });
      setCenter(parseCenter(response.center));
      commands.current.delete('installment-policy');
      setPolicy((current) => ({ ...current, reason: '' }));
      setMessage('Installment policy override published as a new immutable policy version.');
    } catch (cause) { setError(messageFrom(cause, 'Unable to publish the installment policy override.')); }
    finally { setSaving(null); }
  }

  function chooseMerchant(next: Set<string>) {
    const id = [...next][0] ?? '';
    setTenantId(id); setCenter(null); setSelectedOrderId(''); setTab('overview'); commands.current.clear();
  }

  return <div className="workspace-stack">
    <section className="workspace-card">
      <div className="workspace-card-heading"><div><p className="workspace-eyebrow">Business scope</p><h2>Select a SellerTray business</h2></div></div>
      <MerchantSelector session={session} selectedIds={tenantId ? new Set([tenantId]) : new Set()} mode="single" showCommercialPortfolio={false} onChange={chooseMerchant} />
    </section>

    {loading ? <div className="workspace-banner info">Loading authoritative settlement state…</div> : null}
    {error ? <div className="workspace-banner error">{error}<button className="workspace-button text" type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="workspace-banner success">{message}<button className="workspace-button text" type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {center ? <>
      <section className="workspace-card">
        <div className="workspace-card-heading"><div><p className="workspace-eyebrow">Settlement authority</p><h2>Commercial orders</h2><p className="workspace-muted">Discounts, direct payments and provider confirmations remain separate facts. All balances below are server-calculated.</p></div><button className="workspace-button subtle compact" type="button" onClick={() => void loadCenter()} disabled={loading}>Refresh settlement</button></div>
        {!center.orders.length ? <div className="workspace-empty"><strong>No commercial orders</strong><p>Create the initial commercial purchase under Commercial Orders first.</p></div> : <div className="workspace-tenant-list">
          {center.orders.map((order) => <button type="button" key={order.commercialOrderId} className={selectedOrder?.commercialOrderId === order.commercialOrderId ? 'workspace-tenant-row selected' : 'workspace-tenant-row'} onClick={() => { setSelectedOrderId(order.commercialOrderId); setTab('overview'); }}>
            <span><strong>{order.orderReference || shortId(order.commercialOrderId)}</strong><small>{formatDate(order.orderedAt)} · {order.planCode ?? 'Commercial order'}</small></span>
            <span className="workspace-status-pill neutral">{money(order.settlement.outstandingAmount, order.currency)} due</span>
            <span className={`workspace-status-pill ${order.settlement.settlementStatus === 'settled' ? 'good' : order.settlement.settlementStatus === 'partially_settled' ? 'warn' : 'neutral'}`}>{friendly(order.settlement.settlementStatus)}</span>
          </button>)}
        </div>}
      </section>

      {selectedOrder ? <>
        <WorkspaceTabs value={tab} onChange={setTab} />
        {tab === 'overview' ? <section className="workspace-card">
          <div className="workspace-card-heading"><div><p className="workspace-eyebrow">{selectedOrder.orderReference || 'Commercial order'}</p><h2>Authoritative balance</h2><p className="workspace-muted">Settlement remains server-calculated from immutable order value, approved adjustments and confirmed payment facts.</p></div><span className={`workspace-status-pill ${selectedOrder.settlement.settlementStatus === 'settled' ? 'good' : 'warn'}`}>{friendly(selectedOrder.settlement.settlementStatus)}</span></div>
          <div className="workspace-stat-grid">
            <Stat label="Gross order" value={money(selectedOrder.settlement.grossAmount || selectedOrder.grossAmount, selectedOrder.currency)} />
            <Stat label="Approved discounts" value={money(selectedOrder.settlement.approvedAdjustmentAmount, selectedOrder.currency)} />
            <Stat label="Gateway payments" value={money(selectedOrder.settlement.gatewayPaymentAmount, selectedOrder.currency)} />
            <Stat label="Direct payments" value={money(selectedOrder.settlement.directPaymentAmount, selectedOrder.currency)} />
            <Stat label="Outstanding" value={money(selectedOrder.settlement.outstandingAmount, selectedOrder.currency)} />
            <Stat label="Next payable" value={money(selectedOrder.settlement.nextPayableAmount, selectedOrder.currency)} />
          </div>
        </section> : null}

        {tab === 'payment' ? <article className="workspace-card workspace-form-stack">
          <div className="workspace-card-heading"><div><p className="workspace-eyebrow">ProcessEdge payment</p><h3>Confirm direct payment</h3></div><Capability allowed={center.capabilities.canConfirmDirectPayment} /></div>
          <p className="workspace-muted">Records a separately governed direct payment. It never creates a Paystack transaction, provider confirmation or synthetic webhook.</p>
          <label>Amount<input type="number" min="0.01" step="0.01" value={directPayment.amount} onChange={(event) => setDirectPayment((current) => ({ ...current, amount: event.target.value }))} disabled={!center.capabilities.canConfirmDirectPayment} /></label>
          <div className="workspace-field-grid two"><label>Payment reference<input value={directPayment.reference} maxLength={160} onChange={(event) => setDirectPayment((current) => ({ ...current, reference: event.target.value }))} disabled={!center.capabilities.canConfirmDirectPayment} /></label><label>Payment method<input value={directPayment.method} maxLength={32} onChange={(event) => setDirectPayment((current) => ({ ...current, method: event.target.value }))} disabled={!center.capabilities.canConfirmDirectPayment} /></label></div>
          <label>Paid at<input type="datetime-local" value={directPayment.paidAt} onChange={(event) => setDirectPayment((current) => ({ ...current, paidAt: event.target.value }))} disabled={!center.capabilities.canConfirmDirectPayment} /></label>
          <label>Reason<textarea value={directPayment.reason} maxLength={1000} onChange={(event) => setDirectPayment((current) => ({ ...current, reason: event.target.value }))} disabled={!center.capabilities.canConfirmDirectPayment} /></label>
          <label>Evidence note<textarea value={directPayment.evidenceNote} maxLength={1000} onChange={(event) => setDirectPayment((current) => ({ ...current, evidenceNote: event.target.value }))} disabled={!center.capabilities.canConfirmDirectPayment} /></label>
          <button className="workspace-button primary" type="button" disabled={!center.capabilities.canConfirmDirectPayment || saving !== null} onClick={() => void recordDirectPayment()}>{saving === 'direct-payment' ? 'Confirming…' : 'Confirm direct payment'}</button>
        </article> : null}

        {tab === 'adjustments' ? <article className="workspace-card workspace-form-stack">
          <div className="workspace-card-heading"><div><p className="workspace-eyebrow">Commercial adjustment</p><h3>Record discount</h3></div><Capability allowed={center.capabilities.canAdjust} /></div>
          <p className="workspace-muted">Creates an audited discount fact against this order. It does not edit the immutable price snapshot.</p>
          <label>Amount<input type="number" min="0.01" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: event.target.value }))} disabled={!center.capabilities.canAdjust} /></label>
          <label>Reason<textarea value={adjustment.reason} maxLength={1000} onChange={(event) => setAdjustment((current) => ({ ...current, reason: event.target.value }))} disabled={!center.capabilities.canAdjust} /></label>
          <label>Evidence reference<input value={adjustment.evidenceReference} maxLength={160} onChange={(event) => setAdjustment((current) => ({ ...current, evidenceReference: event.target.value }))} disabled={!center.capabilities.canAdjust} /></label>
          <label>Evidence note<textarea value={adjustment.evidenceNote} maxLength={1000} onChange={(event) => setAdjustment((current) => ({ ...current, evidenceNote: event.target.value }))} disabled={!center.capabilities.canAdjust} /></label>
          <button className="workspace-button primary" type="button" disabled={!center.capabilities.canAdjust || saving !== null} onClick={() => void recordAdjustment()}>{saving === 'adjustment' ? 'Recording…' : 'Record discount'}</button>
        </article> : null}

        {tab === 'policy' ? <section className="workspace-card workspace-form-stack">
          <div className="workspace-card-heading"><div><p className="workspace-eyebrow">Installment policy</p><h3>Publish scoped override</h3></div><Capability allowed={center.capabilities.canManageInstallments} /></div>
          <p className="workspace-muted">Publish a new effective-dated policy version for this business or the selected commercial order. Existing contract snapshots and payment history remain immutable.</p>
          <div className="workspace-form-grid">
            <label>Scope<select value={policy.scopeKind} onChange={(event) => setPolicy((current) => ({ ...current, scopeKind: event.target.value === 'tenant' ? 'tenant' : 'commercial_order' }))} disabled={!center.capabilities.canManageInstallments}><option value="commercial_order">Selected commercial order</option><option value="tenant">Business billing cycle</option></select></label>
            {policy.scopeKind === 'tenant' ? <label>Billing cycle<select value={policy.billingCycle} onChange={(event) => setPolicy((current) => ({ ...current, billingCycle: event.target.value === 'monthly' ? 'monthly' : 'yearly' }))} disabled={!center.capabilities.canManageInstallments}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label> : <label>Commercial order<input value={selectedOrder.orderReference || selectedOrder.commercialOrderId} disabled /></label>}
            <label>Availability<select value={policy.enabled ? 'enabled' : 'disabled'} onChange={(event) => setPolicy((current) => ({ ...current, enabled: event.target.value === 'enabled' }))} disabled={!center.capabilities.canManageInstallments}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
            {policy.enabled ? <label>Schedule template<select value={policy.templateId} onChange={(event) => setPolicy((current) => ({ ...current, templateId: event.target.value }))} disabled={!center.capabilities.canManageInstallments}>{center.templates.map((template) => <option key={template.id} value={template.id}>{template.displayName} · v{template.version}</option>)}</select></label> : null}
            <label>Effective from<input type="datetime-local" value={policy.effectiveFrom} onChange={(event) => setPolicy((current) => ({ ...current, effectiveFrom: event.target.value }))} disabled={!center.capabilities.canManageInstallments} /></label>
            <label>Effective until<input type="datetime-local" value={policy.effectiveUntil} onChange={(event) => setPolicy((current) => ({ ...current, effectiveUntil: event.target.value }))} disabled={!center.capabilities.canManageInstallments} /></label>
          </div>
          <label>Reason<textarea value={policy.reason} maxLength={1000} onChange={(event) => setPolicy((current) => ({ ...current, reason: event.target.value }))} disabled={!center.capabilities.canManageInstallments} /></label>
          <button className="workspace-button primary" type="button" disabled={!center.capabilities.canManageInstallments || saving !== null} onClick={() => void publishPolicy()}>{saving === 'installment-policy' ? 'Publishing…' : 'Publish installment override'}</button>
        </section> : null}

        {tab === 'history' ? <section className="workspace-grid three-column">
          <HistoryCard title="Discounts & adjustments" rows={selectedOrder.adjustments} currency={selectedOrder.currency} kind="adjustment" />
          <HistoryCard title="Direct ProcessEdge payments" rows={selectedOrder.directPayments} currency={selectedOrder.currency} kind="direct" />
          <HistoryCard title="Gateway confirmations" rows={selectedOrder.gatewayPayments} currency={selectedOrder.currency} kind="gateway" />
        </section> : null}
      </> : null}
    </> : null}
  </div>;
}

function WorkspaceTabs({ value, onChange }: { value: SettlementTab; onChange: (value: SettlementTab) => void }) {
  const tabs: readonly (readonly [SettlementTab, string])[] = [['overview', 'Overview'], ['payment', 'Record Payment'], ['adjustments', 'Adjustments'], ['policy', 'Installment Policy'], ['history', 'History']];
  return <nav className="workspace-panel" aria-label="Payments and settlement views" style={{ padding: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>{tabs.map(([id, text]) => <button key={id} type="button" className={`workspace-button ${value === id ? 'primary' : 'secondary'}`} aria-current={value === id ? 'page' : undefined} onClick={() => onChange(id)}>{text}</button>)}</nav>;
}

function HistoryCard({ title, rows, currency, kind }: { title: string; rows: History[]; currency: string; kind: 'adjustment' | 'direct' | 'gateway' }) {
  return <article className="workspace-card"><div className="workspace-card-heading"><h3>{title}</h3></div>{!rows.length ? <p className="workspace-muted">No records.</p> : <div className="workspace-stack compact">{rows.map((row) => <div key={row.id} className="workspace-history-row"><div><strong>{money(row.amount, currency)}</strong><small>{kind === 'adjustment' ? row.reason || 'Discount' : kind === 'direct' ? `${row.paymentMethod ? friendly(row.paymentMethod) : 'Direct payment'}${row.paymentReference ? ` · ${row.paymentReference}` : ''}` : `${row.provider ? friendly(row.provider) : 'Gateway'}${row.providerReference ? ` · ${row.providerReference}` : ''}`}</small></div><span>{formatDate(row.paidAt || row.approvedAt || row.recordedAt || '')}</span></div>)}</div>}</article>;
}
function Capability({ allowed }: { allowed: boolean }) { return <span className={`workspace-status-pill ${allowed ? 'good' : 'neutral'}`}>{allowed ? 'Enabled' : 'Read-only'}</span>; }
function Stat({ label, value }: { label: string; value: string }) { return <div className="workspace-stat"><span>{label}</span><strong>{value}</strong></div>; }
function compactEvidence(reference: string, note: string) { const value: Record<string, string> = {}; if (reference.trim()) value.reference = reference.trim(); if (note.trim()) value.note = note.trim(); return value; }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringOrNull(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function numberValue(value: unknown) { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function nullableNumber(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : null; }
function parseHistory(value: unknown): History[] { return Array.isArray(value) ? value.flatMap((raw) => { const row = record(raw); const id = stringOrNull(row.id); return id ? [{ id, amount: numberValue(row.amount), reason: stringOrNull(row.reason) ?? undefined, paymentReference: stringOrNull(row.paymentReference) ?? undefined, paymentMethod: stringOrNull(row.paymentMethod) ?? undefined, provider: stringOrNull(row.provider) ?? undefined, providerReference: stringOrNull(row.providerReference) ?? undefined, paidAt: stringOrNull(row.paidAt) ?? undefined, approvedAt: stringOrNull(row.approvedAt) ?? undefined, recordedAt: stringOrNull(row.recordedAt) ?? undefined }] : []; }) : []; }
function parseOrder(value: unknown): SettlementOrder {
  const row = record(value); const settlementRaw = record(row.settlement); const commercialOrderId = String(row.commercialOrderId ?? '');
  if (!commercialOrderId) throw new Error('Settlement order response is invalid.');
  const settlement: Settlement = { grossAmount: numberValue(settlementRaw.grossAmount), approvedAdjustmentAmount: numberValue(settlementRaw.approvedAdjustmentAmount), gatewayPaymentAmount: numberValue(settlementRaw.gatewayPaymentAmount), directPaymentAmount: numberValue(settlementRaw.directPaymentAmount), totalConfirmedPaymentAmount: numberValue(settlementRaw.totalConfirmedPaymentAmount), netAmountDue: numberValue(settlementRaw.netAmountDue), outstandingAmount: numberValue(settlementRaw.outstandingAmount), overpaymentAmount: numberValue(settlementRaw.overpaymentAmount), settlementStatus: String(settlementRaw.settlementStatus ?? 'unsettled'), nextInstallmentScheduleId: stringOrNull(settlementRaw.nextInstallmentScheduleId), nextPayableAmount: numberValue(settlementRaw.nextPayableAmount) };
  return { commercialOrderId, orderReference: String(row.orderReference ?? ''), orderedAt: String(row.orderedAt ?? ''), currency: String(row.currency ?? settlementRaw.currency ?? 'NGN'), grossAmount: numberValue(row.grossAmount), planCode: stringOrNull(row.planCode), billingCycle: stringOrNull(row.billingCycle), installmentObligationId: stringOrNull(row.installmentObligationId), settlement, currentInstallmentPolicy: Object.keys(record(row.currentInstallmentPolicy)).length ? record(row.currentInstallmentPolicy) : null, contractSnapshot: Object.keys(record(row.contractSnapshot)).length ? record(row.contractSnapshot) : null, adjustments: parseHistory(row.adjustments), directPayments: parseHistory(row.directPayments), gatewayPayments: parseHistory(row.gatewayPayments) };
}
function parseCenter(value: unknown): SettlementCenter {
  const root = record(value); const capabilitiesRaw = record(root.capabilities);
  const templates = Array.isArray(root.templates) ? root.templates.flatMap((raw) => { const row = record(raw); const id = stringOrNull(row.id); if (!id) return []; const lines = Array.isArray(row.lines) ? row.lines.map((lineRaw) => { const line = record(lineRaw); return { sequenceNo: numberValue(line.sequenceNo), percentage: nullableNumber(line.percentage), fixedAmount: nullableNumber(line.fixedAmount), dueOffsetDays: nullableNumber(line.dueOffsetDays) }; }) : []; return [{ id, code: String(row.code ?? ''), version: numberValue(row.version), displayName: String(row.displayName ?? row.code ?? 'Installment template'), provisionalEntitlementMonths: numberValue(row.provisionalEntitlementMonths), qualifyingSettlementSequence: numberValue(row.qualifyingSettlementSequence), lines }]; }) : [];
  const orders = Array.isArray(root.orders) ? root.orders.map(parseOrder) : [];
  return { actorRole: root.actorRole === 'support' ? 'support' : 'admin', tenantId: String(root.tenantId ?? ''), capabilities: { canAdjust: capabilitiesRaw.canAdjust === true, canConfirmDirectPayment: capabilitiesRaw.canConfirmDirectPayment === true, canManageInstallments: capabilitiesRaw.canManageInstallments === true }, templates, orders, generatedAt: String(root.generatedAt ?? '') };
}
function positiveNumber(value: string): number | null { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null; }
function nowLocal() { const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); return date.toISOString().slice(0, 16); }
function isoFromLocal(value: string): string | null { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN' }).format(value); } catch { return `${currency || 'NGN'} ${value.toLocaleString()}`; } }
function formatDate(value: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function shortId(value: string) { return value ? `${value.slice(0, 8)}…` : '—'; }
function friendly(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function messageFrom(value: unknown, fallback: string) { return value instanceof Error && value.message ? value.message : fallback; }
