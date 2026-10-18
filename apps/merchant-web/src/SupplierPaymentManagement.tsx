import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';
import './supplier-payments.css';

type PaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'other';

type SupplierPayment = {
  paymentId: string;
  reference: string;
  method: PaymentMethod;
  amount: number;
  currency: string;
  paidAt: string;
  notes: string | null;
  reversed: boolean;
  reversalId: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
};

type PaymentSummary = {
  purchaseOrderId: string;
  currency: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid';
  payments: SupplierPayment[];
};

type SupplierOutstanding = {
  supplierId: string;
  supplierName: string;
  currency: string;
  purchaseTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  purchaseCount: number;
};

const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

export function PurchasePaymentManagement({
  tenantId,
  purchaseOrderId,
  onChanged,
}: {
  tenantId: string;
  purchaseOrderId: string;
  onChanged?: () => void;
}) {
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(nowLocalInput());
  const [notes, setNotes] = useState('');
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_purchase_payment_summary', {
        p_tenant_id: tenantId,
        p_purchase_order_id: purchaseOrderId,
      });
      if (rpcError) throw rpcError;
      const next = parsePaymentSummary(data);
      setSummary(next);
      setAmount(next.outstandingAmount > 0 ? String(next.outstandingAmount) : '');
    } catch (cause) {
      setSummary(null);
      setError(errorMessage(cause, 'Unable to load supplier payments.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setReference('');
    setNotes('');
    setReverseId(null);
    setReverseReason('');
    setPaidAt(nowLocalInput());
    void refresh();
  }, [tenantId, purchaseOrderId]);

  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    const paymentAmount = Number(amount);
    if (!reference.trim()) return setError('Enter the supplier payment reference.');
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) return setError('Enter a valid payment amount.');
    if (summary && paymentAmount > summary.outstandingAmount + 0.005) return setError('Payment cannot exceed the outstanding amount.');

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const paidAtIso = paidAt ? new Date(paidAt).toISOString() : null;
      const { data, error: rpcError } = await supabase.rpc('record_sellertray_supplier_payment', {
        p_tenant_id: tenantId,
        p_purchase_order_id: purchaseOrderId,
        p_reference: reference.trim(),
        p_method: method,
        p_amount: paymentAmount,
        p_paid_at: paidAtIso,
        p_notes: notes.trim() || null,
      });
      if (rpcError) throw rpcError;
      const result = object(data);
      setMessage(result.idempotentReplay === true
        ? 'This supplier payment was already recorded. No duplicate payment was created.'
        : 'Supplier payment recorded.');
      setReference('');
      setNotes('');
      setPaidAt(nowLocalInput());
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to record supplier payment.'));
    } finally {
      setBusy(false);
    }
  }

  async function reversePayment(paymentId: string) {
    if (!reverseReason.trim()) return setError('Enter the reversal reason.');
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('reverse_sellertray_supplier_payment', {
        p_tenant_id: tenantId,
        p_payment_id: paymentId,
        p_reason: reverseReason.trim(),
      });
      if (rpcError) throw rpcError;
      const result = object(data);
      setMessage(result.idempotentReplay === true
        ? 'This supplier payment was already reversed.'
        : 'Supplier payment reversed. The original payment remains in history.');
      setReverseId(null);
      setReverseReason('');
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to reverse supplier payment.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !summary) {
    return <div className="supplier-payment-card"><p className="muted">Loading supplier payments…</p></div>;
  }

  return <section className="supplier-payment-card">
    <div className="supplier-payment-heading">
      <div><p className="eyebrow">Supplier payment</p><h4>Payment & outstanding</h4></div>
      {summary ? <span className={`supplier-payment-status ${summary.paymentStatus}`}>{paymentStatusLabel(summary.paymentStatus)}</span> : null}
    </div>

    {error ? <div className="error-banner compact-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner compact-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    {summary ? <>
      <div className="supplier-payment-metrics">
        <Metric label="Purchase total" value={money(summary.totalAmount, summary.currency)} />
        <Metric label="Paid" value={money(summary.paidAmount, summary.currency)} />
        <Metric label="Outstanding" value={money(summary.outstandingAmount, summary.currency)} strong />
      </div>

      {summary.outstandingAmount > 0 ? <form className="supplier-payment-form" onSubmit={recordPayment}>
        <div className="supplier-payment-fields">
          <label><span>Reference</span><input required value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Transfer / receipt reference" /></label>
          <label><span>Method</span><select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{METHODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>Amount ({summary.currency})</span><input required type="number" min="0.01" step="0.01" max={summary.outstandingAmount} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label><span>Paid at</span><input type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></label>
        </div>
        <label className="supplier-payment-note"><span>Notes</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional payment note" /></label>
        <div className="supplier-payment-actions"><button className="primary-button" disabled={busy}>{busy ? 'Recording…' : 'Record payment'}</button></div>
        <p className="supplier-payment-hint">Payment records supplier settlement evidence only. Cash entries here do not change a cashier drawer or accounting ledger.</p>
      </form> : <div className="supplier-payment-paid"><strong>Fully paid</strong><span>No outstanding supplier amount remains on this Purchase Order.</span></div>}

      <div className="supplier-payment-history">
        <div className="supplier-payment-history-head"><strong>Payment history</strong><span>{summary.payments.length} records</span></div>
        {summary.payments.length ? summary.payments.map((payment) => <div className={`supplier-payment-row ${payment.reversed ? 'reversed' : ''}`} key={payment.paymentId}>
          <div className="supplier-payment-row-copy">
            <strong>{payment.reference}</strong>
            <span>{methodLabel(payment.method)} · {dateTime(payment.paidAt)}{payment.notes ? ` · ${payment.notes}` : ''}</span>
            {payment.reversed ? <em>Reversed{payment.reversalReason ? ` · ${payment.reversalReason}` : ''}{payment.reversedAt ? ` · ${dateTime(payment.reversedAt)}` : ''}</em> : null}
          </div>
          <div className="supplier-payment-row-value"><strong>{money(payment.amount, payment.currency)}</strong>{!payment.reversed ? <button type="button" className="text-button danger-text" disabled={busy} onClick={() => { setReverseId(payment.paymentId); setReverseReason(''); }}>Reverse</button> : null}</div>
          {reverseId === payment.paymentId ? <div className="supplier-payment-reversal"><input autoFocus value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="Required reversal reason" /><button type="button" className="secondary-button danger-text" disabled={busy || !reverseReason.trim()} onClick={() => void reversePayment(payment.paymentId)}>Confirm reversal</button><button type="button" className="text-button" onClick={() => { setReverseId(null); setReverseReason(''); }}>Cancel</button></div> : null}
        </div>) : <p className="muted">No supplier payment has been recorded for this Purchase Order.</p>}
      </div>
    </> : null}
  </section>;
}

export function SupplierOutstandingSummary({ tenantId, supplierId }: { tenantId: string; supplierId: string | null }) {
  const [summary, setSummary] = useState<SupplierOutstanding | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supplierId) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void supabase.rpc('get_sellertray_supplier_outstanding_summary', { p_tenant_id: tenantId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setSummary(null);
      } else {
        const row = rows(data).find((item) => String(item.supplier_id ?? '') === supplierId);
        setSummary(row ? mapSupplierOutstanding(row) : null);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenantId, supplierId]);

  if (!supplierId) return null;
  if (loading && !summary) return <div className="supplier-outstanding-strip"><span>Loading supplier outstanding…</span></div>;
  if (!summary) return null;

  return <div className="supplier-outstanding-strip">
    <span><small>Purchases</small><strong>{money(summary.purchaseTotal, summary.currency)}</strong></span>
    <span><small>Paid</small><strong>{money(summary.paidAmount, summary.currency)}</strong></span>
    <span className={summary.outstandingAmount > 0 ? 'due' : ''}><small>Outstanding</small><strong>{money(summary.outstandingAmount, summary.currency)}</strong></span>
  </div>;
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={strong ? 'supplier-payment-metric strong' : 'supplier-payment-metric'}><span>{label}</span><strong>{value}</strong></div>;
}

function parsePaymentSummary(value: unknown): PaymentSummary {
  const row = object(value);
  const status = row.paymentStatus === 'partially_paid' || row.paymentStatus === 'paid' ? row.paymentStatus : 'unpaid';
  return {
    purchaseOrderId: String(row.purchaseOrderId ?? ''),
    currency: String(row.currency ?? 'NGN'),
    totalAmount: numberValue(row.totalAmount),
    paidAmount: numberValue(row.paidAmount),
    outstandingAmount: numberValue(row.outstandingAmount),
    paymentStatus: status,
    payments: array(row.payments).map((item) => {
      const payment = object(item);
      return {
        paymentId: String(payment.paymentId ?? ''),
        reference: String(payment.reference ?? 'Payment'),
        method: normalizeMethod(payment.method),
        amount: numberValue(payment.amount),
        currency: String(payment.currency ?? row.currency ?? 'NGN'),
        paidAt: String(payment.paidAt ?? ''),
        notes: optionalText(payment.notes),
        reversed: payment.reversed === true,
        reversalId: optionalText(payment.reversalId),
        reversalReason: optionalText(payment.reversalReason),
        reversedAt: optionalText(payment.reversedAt),
      };
    }).filter((payment) => payment.paymentId),
  };
}

function mapSupplierOutstanding(row: Record<string, unknown>): SupplierOutstanding {
  return {
    supplierId: String(row.supplier_id ?? ''),
    supplierName: String(row.supplier_name ?? 'Supplier'),
    currency: String(row.currency ?? 'NGN'),
    purchaseTotal: numberValue(row.purchase_total),
    paidAmount: numberValue(row.paid_amount),
    outstandingAmount: numberValue(row.outstanding_amount),
    purchaseCount: numberValue(row.purchase_count),
  };
}

function normalizeMethod(value: unknown): PaymentMethod {
  return value === 'cash' || value === 'card' || value === 'other' ? value : 'bank_transfer';
}

function methodLabel(value: PaymentMethod): string {
  return METHODS.find((item) => item.value === value)?.label ?? 'Payment';
}

function paymentStatusLabel(value: PaymentSummary['paymentStatus']): string {
  return value === 'partially_paid' ? 'Part paid' : value === 'paid' ? 'Paid' : 'Unpaid';
}

function nowLocalInput(): string {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency || 'NGN'} ${value.toFixed(2)}`;
  }
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function rows(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.map(object) : []; }
function optionalText(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
