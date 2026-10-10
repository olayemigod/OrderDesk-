import { useEffect, useMemo, useState } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type SupplierBalance = {
  supplierId: string;
  supplierName: string;
  isActive: boolean;
  receivedValue: number;
  paidAmount: number;
  outstandingAmount: number;
  lastPaymentDate: string | null;
};

type PurchaseOrder = {
  id: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  branchName: string;
  status: string;
  orderDate: string;
};

type SupplierPayment = {
  id: string;
  amount: number;
  currency: string;
  method: string;
  reference: string;
  paymentDate: string;
  notes: string | null;
  createdAt: string;
  reversed: boolean;
  reversalId: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
};

type PaymentSummary = {
  purchaseOrderId: string;
  supplierId: string;
  receivedValue: number;
  paidAmount: number;
  outstandingAmount: number;
  payments: SupplierPayment[];
};

export default function SupplierFinanceManagement({ tenantId, currency }: { tenantId: string; currency: string }) {
  const [balances, setBalances] = useState<SupplierBalance[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'bank_transfer' | 'card' | 'other'>('bank_transfer');
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [reversingPaymentId, setReversingPaymentId] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { void load(); }, [tenantId]);

  const supplierOrders = useMemo(
    () => orders.filter((row) => row.supplierId === supplierId && (row.status === 'partially_received' || row.status === 'received')),
    [orders, supplierId],
  );

  useEffect(() => {
    if (!supplierId) {
      setPurchaseOrderId('');
      setSummary(null);
      return;
    }
    if (!supplierOrders.some((row) => row.id === purchaseOrderId)) {
      setPurchaseOrderId(supplierOrders[0]?.id ?? '');
    }
  }, [supplierId, supplierOrders, purchaseOrderId]);

  useEffect(() => {
    setReversingPaymentId('');
    setReversalReason('');
    if (purchaseOrderId) void loadSummary(purchaseOrderId);
    else setSummary(null);
  }, [purchaseOrderId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [balanceResult, orderResult] = await Promise.all([
        supabase.rpc('get_sellertray_supplier_balances', { p_tenant_id: tenantId }),
        supabase.rpc('get_sellertray_purchase_orders', { p_tenant_id: tenantId, p_branch_id: null, p_status: null }),
      ]);
      if (balanceResult.error) throw balanceResult.error;
      if (orderResult.error) throw orderResult.error;
      const nextBalances = parseBalances(balanceResult.data);
      const nextOrders = parseOrders(orderResult.data);
      setBalances(nextBalances);
      setOrders(nextOrders);
      setSupplierId((current) => current && nextBalances.some((row) => row.supplierId === current)
        ? current
        : nextBalances.find((row) => row.outstandingAmount > 0)?.supplierId ?? nextBalances[0]?.supplierId ?? '');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load Supplier balances.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadSummary(orderId: string) {
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_supplier_payment_summary', {
        p_tenant_id: tenantId,
        p_purchase_order_id: orderId,
      });
      if (rpcError) throw rpcError;
      setSummary(parseSummary(data));
    } catch (cause) {
      setSummary(null);
      setError(errorMessage(cause, 'Unable to load Supplier payment history.'));
    }
  }

  async function recordPayment() {
    const numericAmount = Number(amount);
    if (!purchaseOrderId) {
      setError('Choose a received Purchase Order.');
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid payment amount greater than zero.');
      return;
    }
    if (!reference.trim()) {
      setError('Enter the Supplier payment reference.');
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('record_sellertray_supplier_payment', {
        p_tenant_id: tenantId,
        p_purchase_order_id: purchaseOrderId,
        p_amount: numericAmount,
        p_method: method,
        p_reference: reference,
        p_payment_date: paymentDate,
        p_notes: notes || null,
      });
      if (rpcError) throw rpcError;
      const payload = object(data);
      const replay = payload.idempotentReplay === true;
      const reversed = payload.reversed === true;
      setMessage(replay
        ? reversed
          ? 'This payment reference already exists but has been reversed. No duplicate was created.'
          : 'This payment was already recorded. No duplicate was created.'
        : 'Supplier payment recorded.');
      setAmount('');
      setReference('');
      setNotes('');
      await load();
      await loadSummary(purchaseOrderId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to record Supplier payment.'));
    } finally {
      setBusy(false);
    }
  }

  async function reversePayment(paymentId: string) {
    const reason = reversalReason.trim();
    if (!reason) {
      setError('Enter the reason for reversing this Supplier payment.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('reverse_sellertray_supplier_payment', {
        p_tenant_id: tenantId,
        p_supplier_payment_id: paymentId,
        p_reason: reason,
      });
      if (rpcError) throw rpcError;
      const payload = object(data);
      setMessage(payload.idempotentReplay === true
        ? 'This Supplier payment was already reversed. No duplicate reversal was created.'
        : 'Supplier payment reversed. The original payment remains in history and the outstanding balance was restored.');
      setReversingPaymentId('');
      setReversalReason('');
      await load();
      if (purchaseOrderId) await loadSummary(purchaseOrderId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to reverse Supplier payment.'));
    } finally {
      setBusy(false);
    }
  }

  const selectedSupplier = balances.find((row) => row.supplierId === supplierId) ?? null;
  const selectedOrder = orders.find((row) => row.id === purchaseOrderId) ?? null;

  return <div className="page-stack supplier-finance-page">
    <div className="section-heading purchasing-heading">
      <div>
        <p className="eyebrow">Purchasing finance</p>
        <h2>Supplier Balances</h2>
        <p className="muted">Outstanding is based on stock actually received at its recorded purchase cost, less immutable Supplier payment evidence.</p>
      </div>
      <button className="secondary-button" onClick={() => void load()} disabled={loading || busy}>Refresh</button>
    </div>

    <div className="info-banner">This register accepts Bank Transfer, Card and Other non-drawer payments. Cash paid from a register is not recorded here because SellerTray does not silently alter Cash & Shift balances.</div>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <section className="supplier-balance-grid">
      <Metric label="Received purchase value" value={money(balances.reduce((sum, row) => sum + row.receivedValue, 0), currency)} />
      <Metric label="Supplier payments" value={money(balances.reduce((sum, row) => sum + row.paidAmount, 0), currency)} />
      <Metric label="Outstanding" value={money(balances.reduce((sum, row) => sum + row.outstandingAmount, 0), currency)} />
    </section>

    <div className="two-column purchasing-columns">
      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Business-wide</p><h3>Supplier balances</h3></div><span className="count-badge">{balances.length}</span></div>
        {loading ? <p className="muted">Loading Supplier balances…</p> : balances.length ? <div className="supplier-list">{balances.map((balance) => <button key={balance.supplierId} className={supplierId === balance.supplierId ? 'supplier-row active' : 'supplier-row'} onClick={() => setSupplierId(balance.supplierId)}><div><strong>{balance.supplierName}</strong><span>{balance.lastPaymentDate ? `Last payment ${dateLabel(balance.lastPaymentDate)}` : 'No active Supplier payment recorded'}</span></div><div className="purchase-order-meta"><strong>{money(balance.outstandingAmount, currency)}</strong><span>{money(balance.receivedValue, currency)} received</span></div></button>)}</div> : <Empty title="No Supplier balances yet" body="Receive a Purchase Order to create Supplier outstanding value." />}
      </article>

      <article className="panel supplier-payment-panel">
        <div className="panel-head"><div><p className="eyebrow">{selectedSupplier?.supplierName ?? 'Supplier'}</p><h3>Record payment</h3></div>{summary ? <span className={`status-pill ${summary.outstandingAmount > 0 ? 'neutral' : 'good'}`}>{summary.outstandingAmount > 0 ? 'Outstanding' : 'Paid'}</span> : null}</div>
        <div className="form-grid">
          <label className="full-field">Received Purchase Order<select value={purchaseOrderId} onChange={(event) => setPurchaseOrderId(event.target.value)}><option value="">Choose Purchase Order</option>{supplierOrders.map((order) => <option key={order.id} value={order.id}>{order.purchaseNumber} · {order.branchName} · {dateLabel(order.orderDate)}</option>)}</select></label>
          <label>Amount ({currency})<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={summary ? String(summary.outstandingAmount) : '0'} /></label>
          <label>Payment method<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="bank_transfer">Bank Transfer</option><option value="card">Card</option><option value="other">Other</option></select></label>
          <label>Payment date<input type="date" max={today()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
          <label>Reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Transfer, card or payment reference" /></label>
          <label className="full-field">Notes<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        </div>
        {summary ? <div className="supplier-payment-summary"><span><small>Received value</small><strong>{money(summary.receivedValue, currency)}</strong></span><span><small>Paid</small><strong>{money(summary.paidAmount, currency)}</strong></span><span><small>Outstanding</small><strong>{money(summary.outstandingAmount, currency)}</strong></span></div> : null}
        <div className="form-actions"><button className="primary-button" disabled={busy || !selectedOrder || !summary || summary.outstandingAmount <= 0} onClick={() => void recordPayment()}>{busy ? 'Recording' : 'Record Supplier payment'}</button></div>
      </article>
    </div>

    {summary ? <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">{selectedOrder?.purchaseNumber ?? 'Purchase Order'}</p><h3>Payment history</h3></div><strong>{money(summary.outstandingAmount, currency)} outstanding</strong></div>
      {summary.payments.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Notes</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>{summary.payments.map((payment) => <tr key={payment.id} className={payment.reversed ? 'reversed-payment-row' : ''}><td>{dateLabel(payment.paymentDate)}</td><td>{methodLabel(payment.method)}</td><td>{payment.reference}</td><td>{payment.notes ?? '—'}</td><td><strong>{money(payment.amount, payment.currency || currency)}</strong></td><td>{payment.reversed ? <span className="status-pill bad">Reversed</span> : <span className="status-pill good">Recorded</span>}{payment.reversed && payment.reversalReason ? <div className="reversal-note">{payment.reversalReason}{payment.reversedAt ? ` · ${dateTime(payment.reversedAt)}` : ''}</div> : null}</td><td>{payment.reversed ? '—' : reversingPaymentId === payment.id ? <div className="reversal-editor"><textarea rows={2} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="Reason for reversal" /><div><button className="secondary-button compact-button" disabled={busy} onClick={() => { setReversingPaymentId(''); setReversalReason(''); }}>Cancel</button><button className="danger-button compact-button" disabled={busy || !reversalReason.trim()} onClick={() => void reversePayment(payment.id)}>{busy ? 'Reversing' : 'Confirm reversal'}</button></div></div> : <button className="text-button danger-text" disabled={busy} onClick={() => { setReversingPaymentId(payment.id); setReversalReason(''); }}>Reverse payment</button>}</td></tr>)}</tbody></table></div> : <Empty title="No payments recorded" body="Record a payment only when the Supplier has actually been paid." />}
      <p className="muted finance-audit-note">Recorded Supplier payments are never edited or deleted. If an entry was made in error, use Reverse payment with a reason so the original evidence remains visible.</p>
    </article> : null}
  </div>;
}

function parseBalances(value: unknown): SupplierBalance[] {
  return rows(value).map((row) => ({
    supplierId: text(row.supplier_id), supplierName: text(row.supplier_name), isActive: row.is_active === true,
    receivedValue: numberValue(row.received_value), paidAmount: numberValue(row.paid_amount), outstandingAmount: numberValue(row.outstanding_amount),
    lastPaymentDate: optionalText(row.last_payment_date),
  })).filter((row) => row.supplierId);
}

function parseOrders(value: unknown): PurchaseOrder[] {
  return rows(value).map((row) => ({
    id: text(row.id), purchaseNumber: text(row.purchase_number), supplierId: text(row.supplier_id), supplierName: text(row.supplier_name),
    branchName: text(row.branch_name), status: text(row.status), orderDate: text(row.order_date),
  })).filter((row) => row.id);
}

function parseSummary(value: unknown): PaymentSummary {
  const row = object(value);
  return {
    purchaseOrderId: text(row.purchaseOrderId), supplierId: text(row.supplierId), receivedValue: numberValue(row.receivedValue),
    paidAmount: numberValue(row.paidAmount), outstandingAmount: numberValue(row.outstandingAmount),
    payments: rows(row.payments).map((payment) => ({
      id: text(payment.id), amount: numberValue(payment.amount), currency: text(payment.currency), method: text(payment.method),
      reference: text(payment.reference), paymentDate: text(payment.paymentDate), notes: optionalText(payment.notes), createdAt: text(payment.createdAt),
      reversed: payment.reversed === true, reversalId: optionalText(payment.reversalId), reversalReason: optionalText(payment.reversalReason), reversedAt: optionalText(payment.reversedAt),
    })).filter((payment) => payment.id),
  };
}

function rows(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : []; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return typeof value === 'string' ? value : value == null ? '' : String(value); }
function optionalText(value: unknown): string | null { const clean = text(value).trim(); return clean || null; }
function today(): string { return new Date().toISOString().slice(0,10); }
function money(value: number, currency: string): string { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); }
function dateLabel(value: string): string { const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date); }
function dateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function methodLabel(value: string): string { return value.replace(/_/g,' ').replace(/\b\w/g,(letter) => letter.toUpperCase()); }
function Metric({ label, value }: { label: string; value: string }) { return <article className="metric-card"><span>{label}</span><strong>{value}</strong></article>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>; }
