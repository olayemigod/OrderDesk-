import { useEffect, useRef, useState } from 'react';
import { errorMessage, supabase } from './supabase';
import SellerTrayInitialPurchase from './SellerTrayInitialPurchase';

type OrderFormState = 'confirmed' | 'ready_for_review' | 'preparing' | 'legacy';
type SettlementState = {
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
type HistoryRow = {
  id: string;
  amount: number;
  reason?: string;
  paymentReference?: string;
  paymentMethod?: string;
  provider?: string;
  providerReference?: string;
  paidAt?: string;
  approvedAt?: string;
  recordedAt?: string;
};
type CommercialOrder = {
  commercialOrderId: string;
  orderReference: string;
  orderedAt: string;
  currency: string;
  grossAmount: number;
  planCode: string | null;
  billingCycle: string | null;
  installmentObligationId: string | null;
  orderFormId: string | null;
  orderFormReference: string | null;
  orderFormState: OrderFormState;
  settlement: SettlementState;
  adjustments: HistoryRow[];
  directPayments: HistoryRow[];
  gatewayPayments: HistoryRow[];
};
type BillingCenter = {
  tenantId: string;
  actorRole: 'owner' | 'manager';
  canPay: boolean;
  orders: CommercialOrder[];
};
type CheckoutResponse = { status?: string; needsNewCommand?: boolean; authorizationUrl?: string };
type BillingProps = { tenantId: string; onReviewOrderForm: () => void };

export default function SellerTrayBillingManagement({ tenantId, onReviewOrderForm }: BillingProps) {
  const [center, setCenter] = useState<BillingCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const loadSequence = useRef(0);

  useEffect(() => { void load(); }, [tenantId]);

  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('commercial-billing', { body: { action: 'center', tenantId } });
      if (functionError) throw functionError;
      if (sequence !== loadSequence.current) return;
      setCenter(parseCenter(record(data).center));
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setCenter(null);
      setError(errorMessage(cause, 'Unable to load SellerTray billing.'));
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }

  async function pay(order: CommercialOrder) {
    const scheduleId = order.settlement.nextInstallmentScheduleId;
    const paymentReady = order.orderFormState === 'confirmed' || order.orderFormState === 'legacy';
    if (!paymentReady || !center?.canPay || !scheduleId || order.settlement.outstandingAmount < 0.005 || payingOrderId) return;
    setPayingOrderId(order.commercialOrderId); setError(null); setMessage(null);
    const storageKey = checkoutStorageKey(tenantId, scheduleId);
    const storedCommand = safeSessionStorageGet(storageKey);
    const commandId = isUuid(storedCommand) ? storedCommand : crypto.randomUUID();
    safeSessionStorageSet(storageKey, commandId);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('billing-checkout', { body: { tenantId, installmentScheduleId: scheduleId, commandId } });
      if (functionError) throw functionError;
      const response = record(data) as CheckoutResponse;
      if (response.status === 'paid') {
        safeSessionStorageRemove(storageKey);
        setMessage('This SellerTray balance is already paid.');
        await load();
        return;
      }
      if (response.status === 'retry_required' && response.needsNewCommand === true) {
        safeSessionStorageRemove(storageKey);
        setMessage('The previous secure checkout could not start. Select Pay SellerTray again to create a new payment attempt.');
        await load();
        return;
      }
      if (typeof response.authorizationUrl !== 'string' || !response.authorizationUrl) throw new Error('SellerTray did not return the secure payment page.');
      window.location.assign(response.authorizationUrl);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to start SellerTray payment. Retry to continue the same checkout.'));
    } finally { setPayingOrderId(null); }
  }

  if (loading && !center) return <article className="panel"><p className="muted">Loading billing…</p></article>;

  return <section className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">SellerTray subscription</p><h2>Billing</h2></div>
      <p className="muted">Choose your SellerTray plan, review the purchase-specific Order Form, then complete the amount due. Customer receivables remain under Payments & Receivables.</p>
    </div>
    <article className="panel" aria-label="Commercial onboarding workflow">
      <div className="section-heading"><div><p className="eyebrow">Commercial onboarding</p><h3>Step 2 of 3 · Billing</h3></div><span className="status-chip">Current step</span></div>
      <div className="settings-grid two">
        <Fact label="Step 1" value="Agreements ✓" />
        <Fact label="Step 2" value="Billing · Current" />
        <Fact label="Step 3" value="Setup & Activation" />
      </div>
      <p className="muted">Choose the plan and Branches for this purchase. SellerTray then prepares an Order Form for your review before payment.</p>
    </article>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <SellerTrayInitialPurchase tenantId={tenantId} onChanged={load} onContinueToOrderForm={onReviewOrderForm} />

    {!center?.orders.length ? <article className="panel empty-state"><strong>No SellerTray purchase yet</strong><p>The Business Owner can choose a plan above to prepare the first purchase and its Order Form.</p></article> : center.orders.map((order) => {
      const state = order.settlement;
      const paymentReady = order.orderFormState === 'confirmed' || order.orderFormState === 'legacy';
      const canPay = paymentReady && center.canPay && state.outstandingAmount >= 0.005 && Boolean(state.nextInstallmentScheduleId);
      return <article className="panel" key={order.commercialOrderId}>
        <div className="panel-head">
          <div><p className="eyebrow">{order.orderReference || 'SellerTray purchase'}</p><h3>{order.planCode ? `${title(order.planCode)} SellerTray` : 'SellerTray purchase'}</h3><p className="muted">Created {formatDate(order.orderedAt)}{order.billingCycle ? ` · ${title(order.billingCycle)} billing` : ''}</p></div>
          <span className="role-pill">{title(state.settlementStatus.replaceAll('_', ' '))}</span>
        </div>
        <div className="settings-grid two">
          <Fact label="Purchase total" value={money(state.grossAmount || order.grossAmount, order.currency)} />
          <Fact label="Discounts" value={money(state.approvedAdjustmentAmount, order.currency)} />
          <Fact label="Paid" value={money(state.totalConfirmedPaymentAmount, order.currency)} />
          <Fact label="Outstanding" value={money(state.outstandingAmount, order.currency)} />
        </div>

        {order.orderFormState === 'ready_for_review' ? <div className="access-card">
          <span style={{ flex: 1 }}><strong>Order Form ready for review</strong><small>{order.orderFormReference ? `${order.orderFormReference} · ` : ''}Review and confirm the purchase-specific Order Form before payment.</small></span>
          <button type="button" className="primary-button" onClick={onReviewOrderForm}>Review Order Form</button>
        </div> : null}
        {order.orderFormState === 'preparing' ? <div className="warning-banner">SellerTray is preparing the Order Form for this purchase. Payment will become available after the Order Form is ready and confirmed.</div> : null}
        {order.orderFormState === 'legacy' ? <div className="governance-note">This existing purchase predates the current Order Form workflow. Its payment history remains available without rewriting the original commercial record.</div> : null}

        {state.outstandingAmount >= 0.005 && paymentReady ? <div className="access-card">
          <span style={{ flex: 1 }}><strong>Amount due now: {money(state.nextPayableAmount, order.currency)}</strong><small>SellerTray calculates this from the confirmed purchase, approved discounts and payments already received.</small></span>
          {canPay ? <button type="button" className="primary-button" disabled={payingOrderId !== null} onClick={() => void pay(order)}>{payingOrderId === order.commercialOrderId ? 'Opening secure payment…' : 'Pay SellerTray'}</button> : center.canPay ? <span className="role-pill">No payable installment</span> : <span className="role-pill">Owner payment</span>}
        </div> : state.outstandingAmount < 0.005 ? <div className="success-banner">This SellerTray purchase is fully paid.</div> : null}

        <HistorySection title="Discounts & adjustments" empty="No approved discount or adjustment." rows={order.adjustments} currency={order.currency} kind="adjustment" />
        <HistorySection title="Direct ProcessEdge payments" empty="No direct ProcessEdge payment confirmation." rows={order.directPayments} currency={order.currency} kind="direct" />
        <HistorySection title="Gateway payments" empty="No gateway payment confirmation." rows={order.gatewayPayments} currency={order.currency} kind="gateway" />
      </article>;
    })}
  </section>;
}

function HistorySection({ title: heading, empty, rows, currency, kind }: { title: string; empty: string; rows: HistoryRow[]; currency: string; kind: 'adjustment' | 'direct' | 'gateway' }) {
  return <div className="page-stack">
    <div className="section-heading"><div><h3>{heading}</h3></div></div>
    {!rows.length ? <div className="empty-state"><p>{empty}</p></div> : rows.map((row) => <div className="access-card" key={row.id}>
      <span style={{ flex: 1 }}><strong>{money(row.amount, currency)}</strong><small>{kind === 'adjustment' ? row.reason || 'Approved discount' : kind === 'direct' ? `${row.paymentMethod ? title(row.paymentMethod.replaceAll('_', ' ')) : 'Direct payment'}${row.paymentReference ? ` · ${row.paymentReference}` : ''}` : `${row.provider ? title(row.provider) : 'Gateway'}${row.providerReference ? ` · ${row.providerReference}` : ''}`}</small></span>
      <span className="role-pill">{formatDate(row.paidAt || row.approvedAt || row.recordedAt || '')}</span>
    </div>)}
  </div>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="role-lock"><span>{label}</span><strong>{value}</strong></div>; }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringOrNull(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function numberValue(value: unknown): number { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function parseHistory(value: unknown): HistoryRow[] {
  return Array.isArray(value) ? value.flatMap((raw) => {
    const row = record(raw); const id = stringOrNull(row.id); if (!id) return [];
    return [{ id, amount: numberValue(row.amount), reason: stringOrNull(row.reason) ?? undefined, paymentReference: stringOrNull(row.paymentReference) ?? undefined, paymentMethod: stringOrNull(row.paymentMethod) ?? undefined, provider: stringOrNull(row.provider) ?? undefined, providerReference: stringOrNull(row.providerReference) ?? undefined, paidAt: stringOrNull(row.paidAt) ?? undefined, approvedAt: stringOrNull(row.approvedAt) ?? undefined, recordedAt: stringOrNull(row.recordedAt) ?? undefined }];
  }) : [];
}
function parseCenter(value: unknown): BillingCenter {
  const root = record(value);
  const orders = Array.isArray(root.orders) ? root.orders.flatMap((raw) => {
    const row = record(raw); const commercialOrderId = stringOrNull(row.commercialOrderId); if (!commercialOrderId) return [];
    const settlementRaw = record(row.settlement);
    const settlement: SettlementState = {
      grossAmount: numberValue(settlementRaw.grossAmount), approvedAdjustmentAmount: numberValue(settlementRaw.approvedAdjustmentAmount), gatewayPaymentAmount: numberValue(settlementRaw.gatewayPaymentAmount), directPaymentAmount: numberValue(settlementRaw.directPaymentAmount), totalConfirmedPaymentAmount: numberValue(settlementRaw.totalConfirmedPaymentAmount), netAmountDue: numberValue(settlementRaw.netAmountDue), outstandingAmount: numberValue(settlementRaw.outstandingAmount), overpaymentAmount: numberValue(settlementRaw.overpaymentAmount), settlementStatus: String(settlementRaw.settlementStatus ?? 'unsettled'), nextInstallmentScheduleId: stringOrNull(settlementRaw.nextInstallmentScheduleId), nextPayableAmount: numberValue(settlementRaw.nextPayableAmount),
    };
    const rawOrderFormState = String(row.orderFormState ?? 'legacy');
    const orderFormState: OrderFormState = rawOrderFormState === 'confirmed' || rawOrderFormState === 'ready_for_review' || rawOrderFormState === 'preparing' ? rawOrderFormState : 'legacy';
    return [{ commercialOrderId, orderReference: String(row.orderReference ?? ''), orderedAt: String(row.orderedAt ?? ''), currency: String(row.currency ?? settlementRaw.currency ?? 'NGN'), grossAmount: numberValue(row.grossAmount), planCode: stringOrNull(row.planCode), billingCycle: stringOrNull(row.billingCycle), installmentObligationId: stringOrNull(row.installmentObligationId), orderFormId: stringOrNull(row.orderFormId), orderFormReference: stringOrNull(row.orderFormReference), orderFormState, settlement, adjustments: parseHistory(row.adjustments), directPayments: parseHistory(row.directPayments), gatewayPayments: parseHistory(row.gatewayPayments) } satisfies CommercialOrder];
  }) : [];
  return { tenantId: String(root.tenantId ?? ''), actorRole: root.actorRole === 'owner' ? 'owner' : 'manager', canPay: root.canPay === true, orders };
}
function checkoutStorageKey(tenantId: string, scheduleId: string) { return `sellertray:installment-checkout:${tenantId}:${scheduleId}`; }
function safeSessionStorageGet(key: string) { try { return window.sessionStorage.getItem(key); } catch { return null; } }
function safeSessionStorageSet(key: string, value: string) { try { window.sessionStorage.setItem(key, value); } catch { /* browser storage unavailable */ } }
function safeSessionStorageRemove(key: string) { try { window.sessionStorage.removeItem(key); } catch { /* browser storage unavailable */ } }
function isUuid(value: string | null): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN' }).format(value); } catch { return `${currency || 'NGN'} ${value.toLocaleString()}`; } }
function formatDate(value: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function title(value: string) { return value ? value.replace(/\b\w/g, (letter) => letter.toUpperCase()) : value; }
