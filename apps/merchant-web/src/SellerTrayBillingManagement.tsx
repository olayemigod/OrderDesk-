import { useEffect, useRef, useState } from 'react';
import { errorMessage, supabase } from './supabase';

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
  settlement: SettlementState;
  contractSnapshot: Record<string, unknown> | null;
  currentInstallmentPolicy: Record<string, unknown> | null;
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
type CheckoutResponse = {
  status?: string;
  needsNewCommand?: boolean;
  authorizationUrl?: string;
};

export default function SellerTrayBillingManagement({ tenantId }: { tenantId: string }) {
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
      const { data, error: functionError } = await supabase.functions.invoke('commercial-billing', {
        body: { action: 'center', tenantId },
      });
      if (functionError) throw functionError;
      if (sequence !== loadSequence.current) return;
      setCenter(parseCenter(record(data).center));
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setCenter(null);
      setError(errorMessage(cause, 'Unable to load SellerTray billing.'));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  async function pay(order: CommercialOrder) {
    const scheduleId = order.settlement.nextInstallmentScheduleId;
    if (!center?.canPay || !scheduleId || order.settlement.outstandingAmount < 0.005 || payingOrderId) return;
    setPayingOrderId(order.commercialOrderId); setError(null); setMessage(null);
    const storageKey = checkoutStorageKey(tenantId, scheduleId);
    const storedCommand = safeSessionStorageGet(storageKey);
    const commandId = isUuid(storedCommand) ? storedCommand : crypto.randomUUID();
    safeSessionStorageSet(storageKey, commandId);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('billing-checkout', {
        body: { tenantId, installmentScheduleId: scheduleId, commandId },
      });
      if (functionError) throw functionError;
      const response = record(data) as CheckoutResponse;
      if (response.status === 'paid') {
        safeSessionStorageRemove(storageKey);
        setMessage('This SellerTray commercial balance is already confirmed as paid.');
        await load();
        return;
      }
      if (response.status === 'retry_required' && response.needsNewCommand === true) {
        safeSessionStorageRemove(storageKey);
        setMessage('The previous secure checkout could not start. Select Pay SellerTray again to create a new payment attempt.');
        await load();
        return;
      }
      if (typeof response.authorizationUrl !== 'string' || !response.authorizationUrl) {
        throw new Error('SellerTray did not return the secure payment page.');
      }
      window.location.assign(response.authorizationUrl);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to start SellerTray payment. Retry to continue the same checkout.'));
    } finally { setPayingOrderId(null); }
  }

  if (loading && !center) return <article className="panel"><p className="muted">Loading SellerTray billing…</p></article>;

  return <section className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">ProcessEdge commercial account</p><h2>SellerTray Billing</h2></div>
      <p className="muted">Review what your business owes ProcessEdge for SellerTray. Customer receivables remain under Payments & Receivables.</p>
    </div>
    <div className="governance-note">Discounts, direct ProcessEdge payments and provider payments are separate immutable settlement facts. The balance and next payable amount shown here come from SellerTray’s server authority.</div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {!center?.orders.length ? <article className="panel empty-state"><strong>No SellerTray commercial order</strong><p>ProcessEdge commercial purchases for this business will appear here when issued.</p></article> : center.orders.map((order) => {
      const state = order.settlement;
      const canPay = center.canPay && state.outstandingAmount >= 0.005 && Boolean(state.nextInstallmentScheduleId);
      return <article className="panel" key={order.commercialOrderId}>
        <div className="panel-head">
          <div><p className="eyebrow">{order.orderReference || 'Commercial order'}</p><h3>{order.planCode ? `${title(order.planCode)} SellerTray` : 'SellerTray commercial order'}</h3><p className="muted">Ordered {formatDate(order.orderedAt)}{order.billingCycle ? ` · ${title(order.billingCycle)} billing` : ''}</p></div>
          <span className="role-pill">{title(state.settlementStatus.replaceAll('_', ' '))}</span>
        </div>
        <div className="settings-grid two">
          <Fact label="Gross order" value={money(state.grossAmount || order.grossAmount, order.currency)} />
          <Fact label="Approved discounts" value={money(state.approvedAdjustmentAmount, order.currency)} />
          <Fact label="Confirmed payments" value={money(state.totalConfirmedPaymentAmount, order.currency)} />
          <Fact label="Outstanding" value={money(state.outstandingAmount, order.currency)} />
          <Fact label="Direct ProcessEdge payments" value={money(state.directPaymentAmount, order.currency)} />
          <Fact label="Gateway payments" value={money(state.gatewayPaymentAmount, order.currency)} />
        </div>

        {state.outstandingAmount >= 0.005 ? <div className="access-card">
          <span style={{ flex: 1 }}><strong>Next payable: {money(state.nextPayableAmount, order.currency)}</strong><small>This value is resolved by the server after all approved adjustments and confirmed payments.</small></span>
          {canPay ? <button type="button" className="primary-button" disabled={payingOrderId !== null} onClick={() => void pay(order)}>{payingOrderId === order.commercialOrderId ? 'Opening secure payment…' : 'Pay SellerTray'}</button> : center.canPay ? <span className="role-pill">No payable installment</span> : <span className="role-pill">Owner payment</span>}
        </div> : <div className="success-banner">This commercial order is fully settled.</div>}

        <HistorySection title="Discounts & adjustments" empty="No approved commercial adjustment." rows={order.adjustments} currency={order.currency} kind="adjustment" />
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
      <span style={{ flex: 1 }}>
        <strong>{money(row.amount, currency)}</strong>
        <small>{kind === 'adjustment' ? row.reason || 'Approved discount' : kind === 'direct' ? `${row.paymentMethod ? title(row.paymentMethod.replaceAll('_', ' ')) : 'Direct payment'}${row.paymentReference ? ` · ${row.paymentReference}` : ''}` : `${row.provider ? title(row.provider) : 'Gateway'}${row.providerReference ? ` · ${row.providerReference}` : ''}`}</small>
      </span>
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
    const row = record(raw);
    const id = stringOrNull(row.id);
    if (!id) return [];
    return [{ id, amount: numberValue(row.amount), reason: stringOrNull(row.reason) ?? undefined, paymentReference: stringOrNull(row.paymentReference) ?? undefined, paymentMethod: stringOrNull(row.paymentMethod) ?? undefined, provider: stringOrNull(row.provider) ?? undefined, providerReference: stringOrNull(row.providerReference) ?? undefined, paidAt: stringOrNull(row.paidAt) ?? undefined, approvedAt: stringOrNull(row.approvedAt) ?? undefined, recordedAt: stringOrNull(row.recordedAt) ?? undefined }];
  }) : [];
}
function parseCenter(value: unknown): BillingCenter {
  const root = record(value);
  const orders = Array.isArray(root.orders) ? root.orders.flatMap((raw) => {
    const row = record(raw);
    const commercialOrderId = stringOrNull(row.commercialOrderId);
    if (!commercialOrderId) return [];
    const settlementRaw = record(row.settlement);
    const settlement: SettlementState = {
      grossAmount: numberValue(settlementRaw.grossAmount),
      approvedAdjustmentAmount: numberValue(settlementRaw.approvedAdjustmentAmount),
      gatewayPaymentAmount: numberValue(settlementRaw.gatewayPaymentAmount),
      directPaymentAmount: numberValue(settlementRaw.directPaymentAmount),
      totalConfirmedPaymentAmount: numberValue(settlementRaw.totalConfirmedPaymentAmount),
      netAmountDue: numberValue(settlementRaw.netAmountDue),
      outstandingAmount: numberValue(settlementRaw.outstandingAmount),
      overpaymentAmount: numberValue(settlementRaw.overpaymentAmount),
      settlementStatus: String(settlementRaw.settlementStatus ?? 'unsettled'),
      nextInstallmentScheduleId: stringOrNull(settlementRaw.nextInstallmentScheduleId),
      nextPayableAmount: numberValue(settlementRaw.nextPayableAmount),
    };
    return [{
      commercialOrderId,
      orderReference: String(row.orderReference ?? ''),
      orderedAt: String(row.orderedAt ?? ''),
      currency: String(row.currency ?? settlementRaw.currency ?? 'NGN'),
      grossAmount: numberValue(row.grossAmount),
      planCode: stringOrNull(row.planCode),
      billingCycle: stringOrNull(row.billingCycle),
      installmentObligationId: stringOrNull(row.installmentObligationId),
      settlement,
      contractSnapshot: Object.keys(record(row.contractSnapshot)).length ? record(row.contractSnapshot) : null,
      currentInstallmentPolicy: Object.keys(record(row.currentInstallmentPolicy)).length ? record(row.currentInstallmentPolicy) : null,
      adjustments: parseHistory(row.adjustments),
      directPayments: parseHistory(row.directPayments),
      gatewayPayments: parseHistory(row.gatewayPayments),
    } satisfies CommercialOrder];
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
