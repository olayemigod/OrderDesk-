import { useEffect, useMemo, useRef, useState } from 'react';
import { SellerTrayInput, SellerTraySelect } from './SellerTrayElements';
import { errorMessage, numberValue, supabase } from './supabase';

type Branch = { id: string; name: string; isDefault: boolean };
type Cashier = { userId: string; name: string };
type ShiftRow = {
  shiftId: string;
  branchId: string;
  branchName: string;
  registerId: string;
  registerName: string;
  status: string;
  currency: string;
  cashierUserId: string;
  cashierName: string;
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expenses: number;
  expectedCash: number;
  declaredCash: number | null;
  variance: number | null;
  reviewDecision: string | null;
  openedAt: string;
  closedAt: string | null;
  reviewedAt: string | null;
};
type Movement = {
  movementId: string;
  movementType: 'cash_in' | 'cash_out' | 'expense';
  amount: number;
  currency: string;
  reference: string;
  reason: string;
  expenseCategory: string | null;
  actorUserId: string;
  actorName: string;
  createdAt: string;
  replacementForCorrectionId: string | null;
  correctionReason: string | null;
};
type Correction = {
  correctionId: string;
  correctionKind: 'remove' | 'replace';
  reason: string;
  actorUserId: string;
  actorName: string;
  originalMovementId: string;
  replacementMovementId: string | null;
  createdAt: string;
};
type PaymentSummary = {
  methodKey: string;
  paymentMethodId: string | null;
  methodType: string;
  displayName: string;
  transactionCount: number;
  amount: number;
  currency: string;
};
type ShiftTransaction = {
  orderId: string;
  reference: string;
  customerName: string;
  source: string;
  status: string;
  paymentStatus: string;
  paymentMethods: string;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  capturedInShift: number;
  outstandingAmount: number;
  currency: string;
  operatorName: string;
  businessAt: string;
  createdAt: string;
};
type ShiftDetail = ShiftRow & {
  closeNote: string | null;
  reviewNote: string | null;
  movements: Movement[];
  corrections: Correction[];
  paymentSummary: PaymentSummary[];
  transactions: ShiftTransaction[];
  canCorrect: boolean;
  canReview: boolean;
};
type ListResponse = {
  items?: unknown;
  totalCount?: unknown;
  openCount?: unknown;
  pendingReviewCount?: unknown;
  varianceCount?: unknown;
  expectedCash?: unknown;
  declaredCash?: unknown;
  varianceAmount?: unknown;
  currency?: unknown;
  cashiers?: unknown;
};

type CorrectionDraft = {
  movementId: string;
  correctionKind: 'remove' | 'replace';
  correctionReason: string;
  replacementType: 'cash_in' | 'cash_out' | 'expense';
  replacementAmount: string;
  replacementReference: string;
  replacementReason: string;
  replacementExpenseCategory: string;
};

const PAGE_SIZE = 40;

export default function CashShiftsManagement({
  tenantId,
  currency: businessCurrency,
  branches,
  initialBranchId,
}: {
  tenantId: string;
  currency: string;
  branches: Branch[];
  initialBranchId?: string;
}) {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [branchId, setBranchId] = useState(initialBranchId || 'all');
  const [cashierId, setCashierId] = useState('all');
  const [status, setStatus] = useState('all');
  const [varianceState, setVarianceState] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [varianceCount, setVarianceCount] = useState(0);
  const [expectedCash, setExpectedCash] = useState(0);
  const [declaredCash, setDeclaredCash] = useState(0);
  const [varianceAmount, setVarianceAmount] = useState(0);
  const [aggregateCurrency, setAggregateCurrency] = useState(businessCurrency);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShiftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'accepted' | 'follow_up'>('accepted');
  const [reviewNote, setReviewNote] = useState('');
  const [correction, setCorrection] = useState<CorrectionDraft | null>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  useEffect(() => {
    setBranchId(initialBranchId || 'all');
    setCashierId('all');
    setStatus('all');
    setVarianceState('all');
    setDateFrom('');
    setDateTo('');
    setPage(0);
    setSelectedId(null);
    setDetail(null);
  }, [tenantId]);

  useEffect(() => {
    if (initialBranchId && branches.some((row) => row.id === initialBranchId)) {
      setBranchId(initialBranchId);
    }
  }, [initialBranchId, branches]);

  useEffect(() => { setPage(0); }, [branchId, cashierId, status, varianceState, dateFrom, dateTo]);
  useEffect(() => { void load(); }, [tenantId, branchId, cashierId, status, varianceState, dateFrom, dateTo, page]);
  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId]);

  async function load(preferredId?: string | null) {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_cash_shift_management_list', {
        p_tenant_id: tenantId,
        p_branch_id: branchId === 'all' ? null : branchId,
        p_cashier_id: cashierId === 'all' ? null : cashierId,
        p_status: status,
        p_variance_state: varianceState,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (rpcError) throw rpcError;
      if (requestId !== listRequestRef.current) return;
      const result = (data ?? {}) as ListResponse;
      const nextRows = (Array.isArray(result.items) ? result.items : []).map((raw) => mapShift(raw as Record<string, unknown>)).filter((row) => row.shiftId);
      const nextCashiers = (Array.isArray(result.cashiers) ? result.cashiers : []).map((raw) => {
        const row = raw as Record<string, unknown>;
        return { userId: String(row.userId ?? ''), name: String(row.name ?? 'Cashier') };
      }).filter((row) => row.userId);
      setRows(nextRows);
      setCashiers(nextCashiers);
      setTotalCount(numberValue(result.totalCount));
      setOpenCount(numberValue(result.openCount));
      setPendingReviewCount(numberValue(result.pendingReviewCount));
      setVarianceCount(numberValue(result.varianceCount));
      setExpectedCash(numberValue(result.expectedCash));
      setDeclaredCash(numberValue(result.declaredCash));
      setVarianceAmount(numberValue(result.varianceAmount));
      setAggregateCurrency(typeof result.currency === 'string' && result.currency ? result.currency : businessCurrency);
      const wanted = preferredId ?? selectedId;
      if (wanted && nextRows.some((row) => row.shiftId === wanted)) setSelectedId(wanted);
      else setSelectedId(nextRows[0]?.shiftId ?? null);
    } catch (cause) {
      if (requestId !== listRequestRef.current) return;
      setRows([]);
      setTotalCount(0);
      setOpenCount(0);
      setPendingReviewCount(0);
      setVarianceCount(0);
      setExpectedCash(0);
      setDeclaredCash(0);
      setVarianceAmount(0);
      setError(errorMessage(cause, 'Unable to load cashier shifts.'));
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }

  async function loadDetail(shiftId: string) {
    const requestId = ++detailRequestRef.current;
    setDetailLoading(true);
    setCorrection(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_cash_shift_management_detail', {
        p_tenant_id: tenantId,
        p_shift_id: shiftId,
      });
      if (rpcError) throw rpcError;
      if (requestId !== detailRequestRef.current) return;
      setDetail(mapDetail((data ?? {}) as Record<string, unknown>));
      setReviewDecision('accepted');
      setReviewNote('');
    } catch (cause) {
      if (requestId === detailRequestRef.current) setError(errorMessage(cause, 'Unable to load cashier shift detail.'));
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }

  async function reviewShift() {
    if (!detail) return;
    if (reviewDecision === 'follow_up' && !reviewNote.trim()) {
      setError('Enter a follow-up note before completing the review.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('cash-shift', {
        body: {
          action: 'review',
          tenantId,
          shiftId: detail.shiftId,
          decision: reviewDecision,
          note: reviewNote.trim() || null,
        },
      });
      if (fnError) throw fnError;
      const result = asObject(data);
      if (result.ok !== true) throw new Error(String(result.error ?? 'Cashier shift review failed.'));
      setNotice(reviewDecision === 'accepted' ? 'Cashier shift reviewed and accepted.' : 'Cashier shift marked for follow-up.');
      await load(detail.shiftId);
      await loadDetail(detail.shiftId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to review this cashier shift.'));
    } finally {
      setBusy(false);
    }
  }

  async function correctMovement() {
    if (!detail || !correction) return;
    const amount = Number(correction.replacementAmount);
    if (!correction.correctionReason.trim()) {
      setError('Enter why this cash activity is being corrected.');
      return;
    }
    if (correction.correctionKind === 'replace') {
      if (!Number.isFinite(amount) || amount <= 0 || !correction.replacementReference.trim() || !correction.replacementReason.trim()) {
        setError('Enter the replacement amount, reference and reason.');
        return;
      }
      if (correction.replacementType === 'expense' && !correction.replacementExpenseCategory.trim()) {
        setError('Expense category is required for the replacement expense.');
        return;
      }
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('cash-shift', {
        body: {
          action: 'correct',
          tenantId,
          shiftId: detail.shiftId,
          movementId: correction.movementId,
          correctionKind: correction.correctionKind,
          correctionReason: correction.correctionReason.trim(),
          commandId: `merchant-web-cash:${newCommandId()}`,
          replacementType: correction.correctionKind === 'replace' ? correction.replacementType : null,
          replacementAmount: correction.correctionKind === 'replace' ? amount : null,
          replacementReference: correction.correctionKind === 'replace' ? correction.replacementReference.trim() : null,
          replacementReason: correction.correctionKind === 'replace' ? correction.replacementReason.trim() : null,
          replacementExpenseCategory: correction.correctionKind === 'replace' && correction.replacementType === 'expense'
            ? correction.replacementExpenseCategory.trim()
            : null,
        },
      });
      if (fnError) throw fnError;
      const result = asObject(data);
      if (result.ok !== true) throw new Error(String(result.error ?? 'Cash activity correction failed.'));
      setNotice(correction.correctionKind === 'remove' ? 'Cash activity removed through an audited correction.' : 'Cash activity replaced through an audited correction.');
      setCorrection(null);
      await load(detail.shiftId);
      await loadDetail(detail.shiftId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to correct this cash activity.'));
    } finally {
      setBusy(false);
    }
  }

  function beginCorrection(movement: Movement) {
    setCorrection({
      movementId: movement.movementId,
      correctionKind: 'replace',
      correctionReason: '',
      replacementType: movement.movementType,
      replacementAmount: String(movement.amount),
      replacementReference: movement.reference,
      replacementReason: movement.reason,
      replacementExpenseCategory: movement.expenseCategory ?? '',
    });
  }

  const selectedMovement = useMemo(
    () => correction && detail ? detail.movements.find((row) => row.movementId === correction.movementId) ?? null : null,
    [correction, detail],
  );
  const pageStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);

  return <div className="page-stack">
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {notice ? <div className="success-banner">{notice}<button onClick={() => setNotice(null)}>Dismiss</button></div> : null}

    <div className="metric-grid">
      <article className="metric-card"><span>Open shifts</span><strong>{openCount}</strong><small>Cashier shifts still operating in the selected scope</small></article>
      <article className="metric-card"><span>Pending review</span><strong>{pendingReviewCount}</strong><small>Closed shifts awaiting management review</small></article>
      <article className="metric-card"><span>Variance</span><strong>{money(varianceAmount, aggregateCurrency)}</strong><small>{varianceCount} shift{varianceCount === 1 ? '' : 's'} with non-zero variance</small></article>
      <article className="metric-card"><span>Expected cash</span><strong>{money(expectedCash, aggregateCurrency)}</strong><small>{declaredCash ? `${money(declaredCash, aggregateCurrency)} declared in this view` : 'Drawer expectation in this view'}</small></article>
    </div>

    <article className="panel">
      <div className="panel-head">
        <div><p className="eyebrow">Cash control</p><h3>Cashier shifts</h3><p className="muted">Review cashier, Branch, date, variance and reconciliation without changing the operational cash ledger.</p></div>
        <button className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing' : 'Refresh'}</button>
      </div>
      <div className="settings-grid two">
        <label className="select-field"><span>Branch</span><SellerTraySelect value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">All accessible Branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</SellerTraySelect></label>
        <label className="select-field"><span>Cashier</span><SellerTraySelect value={cashierId} onChange={(event) => setCashierId(event.target.value)}><option value="all">All cashiers</option>{cashiers.map((cashier) => <option key={cashier.userId} value={cashier.userId}>{cashier.name}</option>)}</SellerTraySelect></label>
        <label className="select-field"><span>Status</span><SellerTraySelect value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="closed">Closed · pending review</option><option value="reviewed">Reviewed</option></SellerTraySelect></label>
        <label className="select-field"><span>Variance</span><SellerTraySelect value={varianceState} onChange={(event) => setVarianceState(event.target.value)}><option value="all">All shifts</option><option value="balanced">Balanced</option><option value="variance">Non-zero variance</option><option value="pending_review">Pending review</option></SellerTraySelect></label>
        <label className="field"><span>From date</span><SellerTrayInput type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label className="field"><span>To date</span><SellerTrayInput type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </div>

      {loading && rows.length === 0 ? <div className="empty-state"><p>Loading cashier shifts…</p></div> : rows.length === 0 ? <div className="empty-state"><strong>No cashier shifts in this view</strong><p>Change the filters or operate a cashier shift from SellerTray mobile.</p></div> : <div className="table-wrap"><table><thead><tr><th>Cashier</th><th>Branch</th><th>Register</th><th>Status</th><th>Expected</th><th>Declared</th><th>Variance</th><th>Opened</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.shiftId}><td><strong>{row.cashierName}</strong></td><td>{row.branchName}</td><td>{row.registerName}</td><td><StatusPill value={row.status} /></td><td>{money(row.expectedCash, row.currency)}</td><td>{row.declaredCash == null ? '—' : money(row.declaredCash, row.currency)}</td><td className={row.variance != null && Math.abs(row.variance) >= 0.01 ? 'danger-text' : ''}>{row.variance == null ? '—' : money(row.variance, row.currency)}</td><td>{dateTime(row.openedAt)}</td><td><button className="text-button" onClick={() => setSelectedId(row.shiftId)}>{selectedId === row.shiftId ? 'Selected' : 'Review'}</button></td></tr>)}</tbody></table></div>}
      <div className="toolbar-row"><span className="muted-copy">{pageStart}–{pageEnd} of {totalCount}</span><div className="topbar-actions"><button type="button" className="text-button" disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button type="button" className="text-button" disabled={loading || pageEnd >= totalCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </article>

    {selectedId ? <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">Shift reconciliation</p><h3>{detail?.cashierName ?? 'Cashier shift'}</h3><p className="muted">{detail ? `${detail.branchName} · ${detail.registerName} · opened ${dateTime(detail.openedAt)}` : 'Loading cashier shift detail.'}</p></div>{detail ? <StatusPill value={detail.status} /> : null}</div>
      {detailLoading && !detail ? <div className="empty-state"><p>Loading shift detail…</p></div> : detail ? <div className="page-stack">
        <div className="metric-grid">
          <MiniMetric label="Opening" value={money(detail.openingCash, detail.currency)} />
          <MiniMetric label="Cash sales" value={money(detail.cashSales, detail.currency)} />
          <MiniMetric label="Cash refunds" value={money(detail.cashRefunds, detail.currency)} />
          <MiniMetric label="Cash in" value={money(detail.cashIn, detail.currency)} />
          <MiniMetric label="Cash out" value={money(detail.cashOut, detail.currency)} />
          <MiniMetric label="Expenses" value={money(detail.expenses, detail.currency)} />
          <MiniMetric label="Expected" value={money(detail.expectedCash, detail.currency)} />
          <MiniMetric label="Variance" value={detail.variance == null ? '—' : money(detail.variance, detail.currency)} />
        </div>

        {detail.closeNote || detail.reviewDecision || detail.reviewNote ? <div className="settings-grid two">
          <ReadValue label="Close note" value={detail.closeNote || '—'} />
          <ReadValue label="Review" value={detail.reviewDecision ? label(detail.reviewDecision) : 'Pending'} />
          {detail.reviewNote ? <ReadValue label="Review note" value={detail.reviewNote} /> : null}
          {detail.closedAt ? <ReadValue label="Closed" value={dateTime(detail.closedAt)} /> : null}
        </div> : null}

        <div>
          <div className="panel-head"><div><p className="eyebrow">Transactions</p><h3>Shift sales & payments</h3><p className="muted">Sales captured against this shift from the immutable payment ledger, with authoritative order totals and historical cashier attribution.</p></div></div>
          {detail.transactions.length ? <div className="table-wrap"><table><thead><tr><th>Sale</th><th>Customer</th><th>Source</th><th>Payment</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Cashier</th><th>Time</th></tr></thead><tbody>{detail.transactions.map((row) => <tr key={row.orderId}><td><strong>{row.reference}</strong><br /><small>{label(row.status)}</small></td><td>{row.customerName}</td><td>{label(row.source)}</td><td>{row.paymentMethods || label(row.paymentStatus)}</td><td>{money(row.subtotalAmount, row.currency)}</td><td>{money(row.taxAmount, row.currency)}</td><td><strong>{money(row.totalAmount, row.currency)}</strong></td><td>{money(row.amountPaid, row.currency)}</td><td>{money(row.outstandingAmount, row.currency)}</td><td>{row.operatorName}</td><td>{dateTime(row.businessAt)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><p>No sale transactions are linked to this shift.</p></div>}
        </div>

        <div>
          <div className="panel-head"><div><p className="eyebrow">Payments</p><h3>Payment-method reconciliation</h3></div></div>
          {detail.paymentSummary.length ? <div className="table-wrap"><table><thead><tr><th>Method</th><th>Transactions</th><th>Amount</th></tr></thead><tbody>{detail.paymentSummary.map((row) => <tr key={row.methodKey}><td>{row.displayName || label(row.methodType)}</td><td>{row.transactionCount}</td><td>{money(row.amount, row.currency || detail.currency)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><p>No captured payments for this shift.</p></div>}
        </div>

        <div>
          <div className="panel-head"><div><p className="eyebrow">Drawer activity</p><h3>Cash movements & expenses</h3></div></div>
          {detail.movements.length ? <div className="table-wrap"><table><thead><tr><th>Activity</th><th>Reference</th><th>Reason</th><th>Amount</th><th>By</th><th>Date</th><th></th></tr></thead><tbody>{detail.movements.map((row) => <tr key={row.movementId}><td>{label(row.movementType)}{row.expenseCategory ? ` · ${row.expenseCategory}` : ''}</td><td>{row.reference}</td><td>{row.reason}{row.correctionReason ? ` · corrected: ${row.correctionReason}` : ''}</td><td>{money(row.amount, row.currency)}</td><td>{row.actorName}</td><td>{dateTime(row.createdAt)}</td><td>{detail.canCorrect ? <button className="text-button" disabled={busy} onClick={() => beginCorrection(row)}>Correct</button> : '—'}</td></tr>)}</tbody></table></div> : <div className="empty-state"><p>No cash movements or expenses for this shift.</p></div>}
        </div>

        {correction && selectedMovement ? <div className="settings-card">
          <div className="panel-head"><div><p className="eyebrow">Audited correction</p><h3>Correct {selectedMovement.reference}</h3><p className="muted">The original entry remains in audit history. SellerTray will either remove it from effective totals or supersede it with the replacement below.</p></div><button className="text-button" disabled={busy} onClick={() => setCorrection(null)}>Cancel</button></div>
          <div className="settings-grid two">
            <label className="select-field"><span>Correction</span><SellerTraySelect value={correction.correctionKind} onChange={(event) => setCorrection((current) => current ? { ...current, correctionKind: event.target.value as 'remove' | 'replace' } : current)}><option value="replace">Replace with correct entry</option><option value="remove">Remove from effective cash</option></SellerTraySelect></label>
            <label className="field"><span>Why is this being corrected?</span><SellerTrayInput value={correction.correctionReason} onChange={(event) => setCorrection((current) => current ? { ...current, correctionReason: event.target.value } : current)} placeholder="Required audit reason" /></label>
            {correction.correctionKind === 'replace' ? <>
              <label className="select-field"><span>Activity</span><SellerTraySelect value={correction.replacementType} onChange={(event) => setCorrection((current) => current ? { ...current, replacementType: event.target.value as CorrectionDraft['replacementType'] } : current)}><option value="cash_in">Cash in</option><option value="cash_out">Cash out</option><option value="expense">Expense</option></SellerTraySelect></label>
              <label className="field"><span>Amount</span><SellerTrayInput type="number" min="0.01" step="0.01" value={correction.replacementAmount} onChange={(event) => setCorrection((current) => current ? { ...current, replacementAmount: event.target.value } : current)} /></label>
              <label className="field"><span>Reference</span><SellerTrayInput value={correction.replacementReference} onChange={(event) => setCorrection((current) => current ? { ...current, replacementReference: event.target.value } : current)} /></label>
              <label className="field"><span>Reason</span><SellerTrayInput value={correction.replacementReason} onChange={(event) => setCorrection((current) => current ? { ...current, replacementReason: event.target.value } : current)} /></label>
              {correction.replacementType === 'expense' ? <label className="field"><span>Expense category</span><SellerTrayInput value={correction.replacementExpenseCategory} onChange={(event) => setCorrection((current) => current ? { ...current, replacementExpenseCategory: event.target.value } : current)} /></label> : null}
            </> : null}
          </div>
          <div className="toolbar-row"><span className="muted-copy">Corrections are immutable after posting.</span><button className="primary-button" disabled={busy} onClick={() => void correctMovement()}>{busy ? 'Saving correction' : 'Apply audited correction'}</button></div>
        </div> : null}

        {detail.corrections.length ? <div>
          <div className="panel-head"><div><p className="eyebrow">Audit history</p><h3>Corrections</h3></div></div>
          <div className="table-wrap"><table><thead><tr><th>Action</th><th>Reason</th><th>By</th><th>Date</th></tr></thead><tbody>{detail.corrections.map((row) => <tr key={row.correctionId}><td>{label(row.correctionKind)}</td><td>{row.reason}</td><td>{row.actorName}</td><td>{dateTime(row.createdAt)}</td></tr>)}</tbody></table></div>
        </div> : null}

        {detail.canReview ? <div className="settings-card">
          <div className="panel-head"><div><p className="eyebrow">Manager review</p><h3>Complete shift review</h3><p className="muted">Accept the reconciliation or mark it for follow-up. Closed cash facts remain historical evidence.</p></div></div>
          <div className="settings-grid two">
            <label className="select-field"><span>Decision</span><SellerTraySelect value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value as 'accepted' | 'follow_up')}><option value="accepted">Accept reconciliation</option><option value="follow_up">Needs follow-up</option></SellerTraySelect></label>
            <label className="field"><span>Review note</span><SellerTrayInput value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder={reviewDecision === 'follow_up' ? 'Required for follow-up' : 'Optional management note'} /></label>
          </div>
          <div className="toolbar-row"><span className="muted-copy">Expected {money(detail.expectedCash, detail.currency)} · Declared {detail.declaredCash == null ? '—' : money(detail.declaredCash, detail.currency)}</span><button className="primary-button" disabled={busy} onClick={() => void reviewShift()}>{busy ? 'Saving review' : 'Complete review'}</button></div>
        </div> : null}
      </div> : null}
    </article> : null}
  </div>;
}

function mapShift(row: Record<string, unknown>): ShiftRow {
  return {
    shiftId: String(row.shiftId ?? ''), branchId: String(row.branchId ?? ''), branchName: String(row.branchName ?? 'Branch'),
    registerId: String(row.registerId ?? ''), registerName: String(row.registerName ?? 'Register'), status: String(row.status ?? ''),
    currency: String(row.currency ?? 'NGN'), cashierUserId: String(row.cashierUserId ?? ''), cashierName: String(row.cashierName ?? 'Cashier'),
    openingCash: numberValue(row.openingCash), cashSales: numberValue(row.cashSales), cashRefunds: numberValue(row.cashRefunds),
    cashIn: numberValue(row.cashIn), cashOut: numberValue(row.cashOut), expenses: numberValue(row.expenses), expectedCash: numberValue(row.expectedCash),
    declaredCash: nullableNumber(row.declaredCash), variance: nullableNumber(row.variance), reviewDecision: typeof row.reviewDecision === 'string' ? row.reviewDecision : null,
    openedAt: String(row.openedAt ?? ''), closedAt: typeof row.closedAt === 'string' ? row.closedAt : null, reviewedAt: typeof row.reviewedAt === 'string' ? row.reviewedAt : null,
  };
}

function mapDetail(row: Record<string, unknown>): ShiftDetail {
  const base = mapShift(row);
  return {
    ...base,
    closeNote: typeof row.closeNote === 'string' ? row.closeNote : null,
    reviewNote: typeof row.reviewNote === 'string' ? row.reviewNote : null,
    movements: (Array.isArray(row.movements) ? row.movements : []).map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        movementId: String(item.movementId ?? ''), movementType: movementType(item.movementType), amount: numberValue(item.amount), currency: String(item.currency ?? base.currency),
        reference: String(item.reference ?? ''), reason: String(item.reason ?? ''), expenseCategory: typeof item.expenseCategory === 'string' ? item.expenseCategory : null,
        actorUserId: String(item.actorUserId ?? ''), actorName: String(item.actorName ?? 'Team member'), createdAt: String(item.createdAt ?? ''),
        replacementForCorrectionId: typeof item.replacementForCorrectionId === 'string' ? item.replacementForCorrectionId : null,
        correctionReason: typeof item.correctionReason === 'string' ? item.correctionReason : null,
      };
    }).filter((item) => item.movementId),
    corrections: (Array.isArray(row.corrections) ? row.corrections : []).map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        correctionId: String(item.correctionId ?? ''), correctionKind: (item.correctionKind === 'remove' ? 'remove' : 'replace') as Correction['correctionKind'], reason: String(item.reason ?? ''),
        actorUserId: String(item.actorUserId ?? ''), actorName: String(item.actorName ?? 'Team member'), originalMovementId: String(item.originalMovementId ?? ''),
        replacementMovementId: typeof item.replacementMovementId === 'string' ? item.replacementMovementId : null, createdAt: String(item.createdAt ?? ''),
      };
    }).filter((item) => item.correctionId),
    paymentSummary: (Array.isArray(row.paymentSummary) ? row.paymentSummary : []).map((raw) => {
      const item = raw as Record<string, unknown>;
      return { methodKey: String(item.methodKey ?? ''), paymentMethodId: typeof item.paymentMethodId === 'string' ? item.paymentMethodId : null, methodType: String(item.methodType ?? ''), displayName: String(item.displayName ?? ''), transactionCount: numberValue(item.transactionCount), amount: numberValue(item.amount), currency: String(item.currency ?? base.currency) };
    }).filter((item) => item.methodKey),
    transactions: (Array.isArray(row.transactions) ? row.transactions : []).map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        orderId: String(item.orderId ?? ''),
        reference: String(item.reference ?? 'Sale'),
        customerName: String(item.customerName ?? 'Walk-in customer'),
        source: String(item.source ?? 'pos'),
        status: String(item.status ?? 'unknown'),
        paymentStatus: String(item.paymentStatus ?? 'unknown'),
        paymentMethods: String(item.paymentMethods ?? ''),
        subtotalAmount: numberValue(item.subtotalAmount),
        taxAmount: numberValue(item.taxAmount),
        totalAmount: numberValue(item.totalAmount),
        amountPaid: numberValue(item.amountPaid),
        capturedInShift: numberValue(item.capturedInShift),
        outstandingAmount: numberValue(item.outstandingAmount),
        currency: String(item.currency ?? base.currency),
        operatorName: String(item.operatorName ?? base.cashierName),
        businessAt: String(item.businessAt ?? item.createdAt ?? ''),
        createdAt: String(item.createdAt ?? ''),
      };
    }).filter((item) => item.orderId),
    canCorrect: row.canCorrect === true,
    canReview: row.canReview === true,
  };
}

function movementType(value: unknown): Movement['movementType'] { return value === 'cash_out' || value === 'expense' ? value : 'cash_in'; }
function nullableNumber(value: unknown): number | null { return value == null ? null : numberValue(value); }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function newCommandId(): string { return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function label(value: string): string { return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); } catch { return `${currency || 'NGN'} ${value.toLocaleString('en-NG')}`; } }
function dateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function StatusPill({ value }: { value: string }) { const tone = value === 'reviewed' ? 'good' : value === 'closed' ? 'neutral' : 'neutral'; return <span className={`status-pill ${tone}`}>{label(value)}</span>; }
function MiniMetric({ label: metricLabel, value }: { label: string; value: string }) { return <article className="metric-card"><span>{metricLabel}</span><strong>{value}</strong></article>; }
function ReadValue({ label: fieldLabel, value }: { label: string; value: string }) { return <div className="read-value"><span>{fieldLabel}</span><strong>{value}</strong></div>; }
