import { useEffect, useState } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type Branch = { id: string; name: string; isDefault: boolean };
type Row = {
  id: string;
  orderId: string;
  publicOrderId: string;
  branchId: string;
  branchName: string;
  customerName: string;
  methodType: string;
  provider: string;
  status: string;
  exceptionState: string;
  exceptionReason: string | null;
  amount: number;
  currency: string;
  providerReference: string | null;
  createdAt: string;
};
type ListResponse = {
  items?: Array<Record<string, unknown>>;
  totalCount?: number | string;
  totalAmount?: number | string;
  attentionCount?: number | string;
  attentionAmount?: number | string;
  confirmedAmount?: number | string;
  currency?: string | null;
};

const PAGE_SIZE = 50;

export default function PaymentReconciliationManagement({ tenantId, branches }: { tenantId: string; branches: Branch[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState('attention');
  const [branchId, setBranchId] = useState('all');
  const [methodType, setMethodType] = useState('all');
  const [query, setQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [attentionCount, setAttentionCount] = useState(0);
  const [attentionAmount, setAttentionAmount] = useState(0);
  const [confirmedAmount, setConfirmedAmount] = useState(0);
  const [currency, setCurrency] = useState('NGN');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_payment_management_list', {
        p_tenant_id: tenantId,
        p_branch_id: branchId === 'all' ? null : branchId,
        p_search: query.trim() || null,
        p_state: state,
        p_method_type: methodType === 'all' ? null : methodType,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (rpcError) throw rpcError;
      const result = (data ?? {}) as ListResponse;
      setRows((result.items ?? []).map((row) => ({
        id: String(row.id ?? ''),
        orderId: String(row.orderId ?? ''),
        publicOrderId: String(row.publicOrderId ?? 'Order'),
        branchId: String(row.branchId ?? ''),
        branchName: String(row.branchName ?? 'Branch'),
        customerName: String(row.customerName ?? 'Customer'),
        methodType: String(row.methodType ?? ''),
        provider: String(row.provider ?? ''),
        status: String(row.status ?? ''),
        exceptionState: String(row.exceptionState ?? 'none'),
        exceptionReason: typeof row.exceptionReason === 'string' ? row.exceptionReason : null,
        amount: numberValue(row.amount),
        currency: String(row.currency ?? 'NGN'),
        providerReference: typeof row.providerReference === 'string' ? row.providerReference : null,
        createdAt: String(row.createdAt ?? ''),
      })).filter((row) => row.id));
      setTotalCount(numberValue(result.totalCount));
      setTotalAmount(numberValue(result.totalAmount));
      setAttentionCount(numberValue(result.attentionCount));
      setAttentionAmount(numberValue(result.attentionAmount));
      setConfirmedAmount(numberValue(result.confirmedAmount));
      setCurrency(typeof result.currency === 'string' && result.currency ? result.currency : 'NGN');
    } catch (cause) {
      setRows([]);
      setTotalCount(0);
      setTotalAmount(0);
      setAttentionCount(0);
      setAttentionAmount(0);
      setConfirmedAmount(0);
      setError(errorMessage(cause, 'Unable to load payment reconciliation.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setPage(0); }, [tenantId, branchId, methodType, state, query, dateFrom, dateTo]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, query.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [tenantId, branchId, methodType, state, query, dateFrom, dateTo, page]);

  async function act(row: Row, action: 'confirm_offline' | 'verify_gateway') {
    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      const { error: fnError } = await supabase.functions.invoke('merchant-payment-operations', {
        body: {
          action,
          tenantId,
          paymentId: row.id,
          note: action === 'confirm_offline' ? 'Confirmed from Merchant Web reconciliation' : null,
        },
      });
      if (fnError) throw fnError;
      setNotice(action === 'confirm_offline' ? 'Payment confirmed.' : 'Gateway verification completed.');
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to reconcile this payment.'));
    } finally {
      setBusy(null);
    }
  }

  const pageStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);

  return <div className="page-stack">
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {notice ? <div className="success-banner">{notice}<button onClick={() => setNotice(null)}>Dismiss</button></div> : null}
    <div className="metric-grid">
      <article className="metric-card"><span>Needs attention</span><strong>{attentionCount}</strong><small>{money(attentionAmount, currency)} requiring review</small></article>
      <article className="metric-card"><span>Confirmed</span><strong>{money(confirmedAmount, currency)}</strong><small>Confirmed value in the current Branch, date, method and search scope</small></article>
      <article className="metric-card"><span>This view</span><strong>{money(totalAmount, currency)}</strong><small>{totalCount} payment{totalCount === 1 ? '' : 's'} matching the selected view</small></article>
    </div>
    <article className="panel">
      <div className="panel-head">
        <div><p className="eyebrow">Settlement review</p><h3>Payment reconciliation</h3></div>
        <button className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing' : 'Refresh'}</button>
      </div>
      <div className="settings-grid two">
        <label className="select-field"><span>View</span><select value={state} onChange={(event) => setState(event.target.value)}><option value="attention">Needs attention</option><option value="confirmed">Confirmed</option><option value="all">All payments</option></select></label>
        <label className="select-field"><span>Branch</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">All accessible Branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label className="select-field"><span>Payment method</span><select value={methodType} onChange={(event) => setMethodType(event.target.value)}><option value="all">All methods</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card_terminal">Card terminal</option><option value="paystack">Paystack</option><option value="flutterwave">Flutterwave</option><option value="cash_on_delivery">Cash on delivery</option><option value="pay_on_pickup">Pay on pickup</option></select></label>
        <label className="field"><span>Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order, customer, reference or provider" /></label>
        <label className="field"><span>From date</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label className="field"><span>To date</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </div>
      {loading && rows.length === 0 ? <div className="empty-state"><p>Loading payments…</p></div> : rows.length === 0 ? <div className="empty-state"><strong>No payments in this view</strong><p>Payment verification and exceptions will appear here when attention is required.</p></div> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Branch</th><th>Method</th><th>Status</th><th>Amount</th><th>Reference</th><th>Exception</th><th>Date</th><th>Action</th></tr></thead><tbody>{rows.map((row) => {
        const offline = ['bank_transfer', 'card_terminal', 'cash_on_delivery', 'pay_on_pickup', 'cash'].includes(row.methodType);
        const gateway = ['paystack', 'flutterwave'].includes(row.methodType) || ['paystack', 'flutterwave'].includes(row.provider);
        return <tr key={row.id}><td><strong>{row.publicOrderId}</strong></td><td>{row.customerName}</td><td>{row.branchName}</td><td>{label(row.methodType)}</td><td>{label(row.status)}</td><td>{money(row.amount, row.currency)}</td><td>{row.providerReference ?? '—'}</td><td>{row.exceptionState === 'none' ? '—' : `${label(row.exceptionState)}${row.exceptionReason ? ` · ${row.exceptionReason}` : ''}`}</td><td>{dateTime(row.createdAt)}</td><td>{row.status !== 'confirmed' && offline ? <button className="text-button" disabled={busy === row.id} onClick={() => void act(row, 'confirm_offline')}>{busy === row.id ? 'Working' : 'Confirm received'}</button> : row.status !== 'confirmed' && gateway ? <button className="text-button" disabled={busy === row.id} onClick={() => void act(row, 'verify_gateway')}>{busy === row.id ? 'Working' : 'Verify provider'}</button> : '—'}</td></tr>;
      })}</tbody></table></div>}
      <div className="toolbar-row"><span className="muted-copy">{pageStart}–{pageEnd} of {totalCount}</span><div className="topbar-actions"><button type="button" className="text-button" disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button type="button" className="text-button" disabled={loading || pageEnd >= totalCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </article>
  </div>;
}

function label(value: string) { return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toLocaleString('en-NG')}`; } }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
