import { useEffect, useState } from 'react';
import { SellerTrayInput, SellerTraySelect } from './SellerTrayElements';
import { errorMessage, numberValue, supabase } from './supabase';

type Branch = { id: string; name: string; isDefault: boolean };
type Receivable = {
  orderId: string;
  publicOrderId: string;
  branchId: string;
  branchName: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  source: string;
  currency: string;
  totalAmount: number;
  returnedAmount: number;
  netAmountDue: number;
  amountPaid: number;
  outstandingAmount: number;
  createdAt: string;
};
type Method = { id: string | null; name: string; type: string };
type ListResponse = {
  items?: Array<Record<string, unknown>>;
  totalCount?: number | string;
  customerCount?: number | string;
  outstandingAmount?: number | string;
  currency?: string | null;
};

const PAGE_SIZE = 50;

export default function ReceivablesManagement({ tenantId, branches }: { tenantId: string; branches: Branch[] }) {
  const [rows, setRows] = useState<Receivable[]>([]);
  const [query, setQuery] = useState('');
  const [branchId, setBranchId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [customerCount, setCustomerCount] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [currency, setCurrency] = useState('NGN');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<Receivable | null>(null);
  const [methods, setMethods] = useState<Method[]>([]);
  const [methodId, setMethodId] = useState('cash');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_receivables_management_list', {
        p_tenant_id: tenantId,
        p_branch_id: branchId === 'all' ? null : branchId,
        p_search: query.trim() || null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (rpcError) throw rpcError;
      const result = (data ?? {}) as ListResponse;
      setRows((result.items ?? []).map((row) => ({
        orderId: String(row.orderId ?? ''),
        publicOrderId: String(row.publicOrderId ?? 'Sale'),
        branchId: String(row.branchId ?? ''),
        branchName: String(row.branchName ?? 'Branch'),
        customerId: String(row.customerId ?? ''),
        customerName: String(row.customerName ?? 'Customer'),
        customerPhone: typeof row.customerPhone === 'string' ? row.customerPhone : null,
        source: String(row.source ?? 'pos'),
        currency: String(row.currency ?? 'NGN'),
        totalAmount: numberValue(row.totalAmount),
        returnedAmount: numberValue(row.returnedAmount),
        netAmountDue: numberValue(row.netAmountDue),
        amountPaid: numberValue(row.amountPaid),
        outstandingAmount: numberValue(row.outstandingAmount),
        createdAt: String(row.createdAt ?? ''),
      })).filter((row) => row.orderId && row.customerId && row.outstandingAmount > 0));
      setTotalCount(numberValue(result.totalCount));
      setCustomerCount(numberValue(result.customerCount));
      setOutstanding(numberValue(result.outstandingAmount));
      setCurrency(typeof result.currency === 'string' && result.currency ? result.currency : 'NGN');
    } catch (cause) {
      setRows([]);
      setTotalCount(0);
      setCustomerCount(0);
      setOutstanding(0);
      setError(errorMessage(cause, 'Unable to load customer balances.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setPage(0); setCollecting(null); }, [tenantId, branchId, query, dateFrom, dateTo]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, query.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [tenantId, branchId, query, dateFrom, dateTo, page]);

  async function openCollection(row: Receivable) {
    setCollecting(row);
    setAmount(String(row.outstandingAmount));
    setMethodId('cash');
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_branch_pos_payment_methods', { p_tenant_id: tenantId, p_branch_id: row.branchId });
      if (rpcError) throw rpcError;
      setMethods(((data ?? []) as Array<Record<string, unknown>>).map((value) => ({
        id: typeof value.payment_method_id === 'string' ? value.payment_method_id : null,
        name: String(value.display_name ?? 'Payment method'),
        type: String(value.method_type ?? ''),
      })).filter((value) => value.type));
    } catch (cause) {
      setMethods([{ id: null, name: 'Cash', type: 'cash' }]);
      setError(errorMessage(cause, 'Unable to load payment methods for this Branch.'));
    }
  }

  async function collect() {
    if (!collecting || busy) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > collecting.outstandingAmount + 0.005) {
      setError(`Enter an amount from 0.01 to ${money(collecting.outstandingAmount, collecting.currency)}.`);
      return;
    }
    const method = methods.find((item) => (item.id ?? 'cash') === methodId) ?? methods.find((item) => item.type === 'cash');
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('collect_sellertray_customer_receivable', {
        p_tenant_id: tenantId,
        p_order_id: collecting.orderId,
        p_payment_method_id: method?.id ?? null,
        p_amount: value,
        p_command_id: crypto.randomUUID(),
      });
      if (rpcError) throw rpcError;
      const result = (data ?? {}) as Record<string, unknown>;
      setNotice(result.status === 'pending_verification' ? 'Bank payment recorded and sent for verification.' : 'Customer payment collected.');
      setCollecting(null);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to collect this customer payment.'));
    } finally {
      setBusy(false);
    }
  }

  const pageStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);

  return <div className="page-stack">
    <div className="section-heading"><div><p className="eyebrow">Customer balances</p><h2>Receivables</h2></div><p className="muted">Follow up named customers with completed sales that still have an outstanding balance. Completed returns reduce the collectible balance; walk-in sales are excluded.</p></div>
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {notice ? <div className="success-banner">{notice}<button onClick={() => setNotice(null)}>Dismiss</button></div> : null}
    <div className="metric-grid">
      <article className="metric-card"><span>Outstanding</span><strong>{money(outstanding, currency)}</strong><small>Across all balances matching these filters</small></article>
      <article className="metric-card"><span>Customers</span><strong>{customerCount}</strong><small>Distinct customers with balances</small></article>
      <article className="metric-card"><span>Sales</span><strong>{totalCount}</strong><small>Completed sales with collectible balances</small></article>
    </div>
    {collecting ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">Collect payment</p><h3>{collecting.customerName} · {collecting.publicOrderId}</h3></div><strong>{money(collecting.outstandingAmount, collecting.currency)} due</strong></div><div className="form-grid"><label className="field">Amount<SellerTrayInput type="number" min="0.01" step="0.01" max={collecting.outstandingAmount} value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="field">Payment method<SellerTraySelect value={methodId} onChange={(event) => setMethodId(event.target.value)}>{methods.map((method) => <option key={method.id ?? 'cash'} value={method.id ?? 'cash'}>{method.name}</option>)}</SellerTraySelect></label></div><div className="form-actions"><button className="primary-button" disabled={busy || methods.length === 0} onClick={() => void collect()}>{busy ? 'Recording…' : 'Record payment'}</button><button className="secondary-button" disabled={busy} onClick={() => setCollecting(null)}>Cancel</button></div><p className="muted">Cash and card collections confirm immediately. Bank transfers remain pending until verified in Payment reconciliation.</p></article> : null}
    <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">Balances</p><h3>Customer receivables</h3></div><button className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing' : 'Refresh'}</button></div>
      <div className="settings-grid two">
        <label className="field"><span>Search</span><SellerTrayInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, sale or Branch" /></label>
        <label className="select-field"><span>Branch</span><SellerTraySelect value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">All accessible Branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</SellerTraySelect></label>
        <label className="field"><span>From date</span><SellerTrayInput type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label className="field"><span>To date</span><SellerTrayInput type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </div>
      {loading && rows.length === 0 ? <div className="empty-state"><p>Loading balances…</p></div> : rows.length === 0 ? <div className="empty-state"><strong>No customer balances</strong><p>No named customer currently has an outstanding completed sale in this scope.</p></div> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Sale</th><th>Branch</th><th>Total</th><th>Returns</th><th>Collected</th><th>Outstanding</th><th>Date</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.orderId}><td><strong>{row.customerName}</strong><small>{row.customerPhone ?? ''}</small></td><td>{row.publicOrderId}</td><td>{row.branchName}</td><td>{money(row.totalAmount, row.currency)}</td><td>{row.returnedAmount > 0 ? money(row.returnedAmount, row.currency) : '—'}</td><td>{money(row.amountPaid, row.currency)}</td><td><strong>{money(row.outstandingAmount, row.currency)}</strong></td><td>{dateTime(row.createdAt)}</td><td><button className="text-button" onClick={() => void openCollection(row)}>Collect balance</button></td></tr>)}</tbody></table></div>}
      <div className="toolbar-row"><span className="muted-copy">{pageStart}–{pageEnd} of {totalCount}</span><div className="topbar-actions"><button type="button" className="text-button" disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button type="button" className="text-button" disabled={loading || pageEnd >= totalCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </article>
    <p className="muted">Each collection is appended to governed payment history. SellerTray does not rewrite the completed sale or erase its original payment history.</p>
  </div>;
}

function money(value: number, currency: string) { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`; } }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date); }
