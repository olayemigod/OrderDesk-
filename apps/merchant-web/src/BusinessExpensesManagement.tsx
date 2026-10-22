import { useEffect, useMemo, useRef, useState } from 'react';
import { SellerTrayInput, SellerTraySelect, SellerTrayTextarea } from './SellerTrayElements';
import { errorMessage, numberValue, supabase } from './supabase';

type Branch = { id: string; name: string; isDefault: boolean };
type FundingSource = 'cash' | 'bank';
type BankAccount = { id: string; displayName: string; bankName: string; accountName: string; accountNumber: string };
type CashDrawer = { shiftId: string; registerId: string; registerName: string; cashierUserId: string; openedAt: string; expectedCash: number };
type ExpenseCategory = { id: string; name: string; isActive: boolean };
type ExpenseRow = {
  expenseId: string;
  branchId: string;
  branchName: string;
  fundingSource: FundingSource;
  paymentMethodId: string | null;
  bankAccount: string | null;
  cashShiftId: string | null;
  expenseCategory: string;
  originalAmount: number;
  amount: number;
  currency: string;
  reference: string;
  reason: string;
  actorUserId: string;
  status: 'effective' | 'removed';
  cashMovementId: string | null;
  createdAt: string;
};
type ListResponse = { items?: unknown; totalCount?: unknown; totalAmount?: unknown; currency?: unknown };
type OptionsResponse = { canRecordBusinessExpense?: unknown; expenseCategories?: unknown; bankAccounts?: unknown; openCashDrawers?: unknown };

const PAGE_SIZE = 40;

export default function BusinessExpensesManagement({
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
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [branchId, setBranchId] = useState(initialBranchId || 'all');
  const [fundingFilter, setFundingFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [aggregateCurrency, setAggregateCurrency] = useState(businessCurrency);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [categoryBusyId, setCategoryBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [createBranchId, setCreateBranchId] = useState(initialBranchId || branches[0]?.id || '');
  const [canCreate, setCanCreate] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [cashDrawers, setCashDrawers] = useState<CashDrawer[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [categoryDraft, setCategoryDraft] = useState('');
  const [categoryEdits, setCategoryEdits] = useState<Record<string, string>>({});
  const [fundingSource, setFundingSource] = useState<FundingSource>('cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [cashShiftId, setCashShiftId] = useState('');
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState(newReference());
  const [reason, setReason] = useState('');
  const [commandId, setCommandId] = useState(newCommandId());
  const listRequestRef = useRef(0);
  const optionsRequestRef = useRef(0);
  const categoryRequestRef = useRef(0);

  useEffect(() => {
    listRequestRef.current += 1;
    optionsRequestRef.current += 1;
    categoryRequestRef.current += 1;
    setBranchId(initialBranchId || 'all');
    setCreateBranchId(initialBranchId || branches[0]?.id || '');
    setFundingFilter('all');
    setSearch('');
    setSearchDraft('');
    setPage(0);
    setShowCreate(false);
    setShowCategories(false);
    setExpenseCategories([]);
    setCategoryDraft('');
    setCategoryEdits({});
    resetDraft();
  }, [tenantId]);

  useEffect(() => {
    if (initialBranchId && branches.some((row) => row.id === initialBranchId)) {
      setBranchId(initialBranchId);
      setCreateBranchId(initialBranchId);
    }
  }, [initialBranchId, branches]);

  useEffect(() => { setPage(0); }, [branchId, fundingFilter, search]);
  useEffect(() => { void load(); }, [tenantId, branchId, fundingFilter, search, page]);
  useEffect(() => { void loadCategories(false); }, [tenantId]);
  useEffect(() => {
    if (createBranchId) void loadOptions(createBranchId);
    else {
      setCanCreate(false);
      setBankAccounts([]);
      setCashDrawers([]);
    }
  }, [tenantId, createBranchId]);

  async function load() {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_business_expense_management_list', {
        p_tenant_id: tenantId,
        p_branch_id: branchId === 'all' ? null : branchId,
        p_funding_source: fundingFilter,
        p_search: search || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (rpcError) throw rpcError;
      if (requestId !== listRequestRef.current) return;
      const result = (data ?? {}) as ListResponse;
      const nextRows = (Array.isArray(result.items) ? result.items : [])
        .map((raw) => mapExpense(raw as Record<string, unknown>))
        .filter((row) => row.expenseId);
      setRows(nextRows);
      setTotalCount(numberValue(result.totalCount));
      setTotalAmount(numberValue(result.totalAmount));
      setAggregateCurrency(typeof result.currency === 'string' && result.currency ? result.currency : businessCurrency);
    } catch (cause) {
      if (requestId !== listRequestRef.current) return;
      setRows([]);
      setTotalCount(0);
      setTotalAmount(0);
      setError(errorMessage(cause, 'Unable to load Business Expenses.'));
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }

  async function loadOptions(selectedBranchId: string) {
    const requestId = ++optionsRequestRef.current;
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_money_operation_options', {
        p_tenant_id: tenantId,
        p_branch_id: selectedBranchId,
      });
      if (rpcError) throw rpcError;
      if (requestId !== optionsRequestRef.current) return;
      const result = (data ?? {}) as OptionsResponse;
      const nextBanks = (Array.isArray(result.bankAccounts) ? result.bankAccounts : []).map((raw) => mapBank(raw as Record<string, unknown>)).filter((row) => row.id);
      const nextDrawers = (Array.isArray(result.openCashDrawers) ? result.openCashDrawers : []).map((raw) => mapDrawer(raw as Record<string, unknown>)).filter((row) => row.shiftId);
      const nextCategories = (Array.isArray(result.expenseCategories) ? result.expenseCategories : []).map((raw) => mapCategory(raw as Record<string, unknown>)).filter((row) => row.id && row.name);
      const permitted = result.canRecordBusinessExpense === true;
      setCanCreate(permitted);
      setBankAccounts(nextBanks);
      setCashDrawers(nextDrawers);
      if (nextCategories.length) mergeActiveCategories(nextCategories);
      setExpenseCategoryId((current) => nextCategories.some((row) => row.id === current) ? current : nextCategories[0]?.id ?? '');
      setBankAccountId((current) => nextBanks.some((row) => row.id === current) ? current : nextBanks[0]?.id ?? '');
      setCashShiftId((current) => nextDrawers.some((row) => row.shiftId === current) ? current : nextDrawers[0]?.shiftId ?? '');
      if (permitted) void loadCategories(true);
    } catch (cause) {
      if (requestId !== optionsRequestRef.current) return;
      setCanCreate(false);
      setBankAccounts([]);
      setCashDrawers([]);
      setError(errorMessage(cause, 'Unable to load Business Expense options.'));
    }
  }

  async function loadCategories(includeInactive: boolean, preferredId?: string) {
    const requestId = ++categoryRequestRef.current;
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_expense_category_list', {
        p_tenant_id: tenantId,
        p_include_inactive: includeInactive,
      });
      if (rpcError) throw rpcError;
      if (requestId !== categoryRequestRef.current) return;
      const next = (Array.isArray(data) ? data : []).map((raw) => mapCategory(raw as Record<string, unknown>)).filter((row) => row.id && row.name);
      setExpenseCategories(next);
      setCategoryEdits(Object.fromEntries(next.map((category) => [category.id, category.name])));
      const active = next.filter((category) => category.isActive);
      setExpenseCategoryId((current) => {
        const wanted = preferredId || current;
        return active.some((row) => row.id === wanted) ? wanted : active[0]?.id ?? '';
      });
    } catch (cause) {
      if (requestId !== categoryRequestRef.current) return;
      setError(errorMessage(cause, 'Unable to load Expense Categories.'));
    }
  }

  function mergeActiveCategories(active: ExpenseCategory[]) {
    setExpenseCategories((current) => {
      const byId = new Map(current.map((category) => [category.id, category]));
      active.forEach((category) => byId.set(category.id, { ...category, isActive: true }));
      return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function createCategory() {
    const name = categoryDraft.trim();
    if (!name) return setError('Enter the new Expense Category name.');
    if (!canCreate) return setError('Only an authorised Owner or Manager can manage Expense Categories.');
    setCategoryBusyId('new');
    setError(null);
    setNotice(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('create_sellertray_expense_category', { p_tenant_id: tenantId, p_name: name });
      if (rpcError) throw rpcError;
      const result = asObject(data);
      const id = typeof result.id === 'string' ? result.id : undefined;
      setCategoryDraft('');
      await loadCategories(true, id);
      setNotice('Expense Category added. Mobile and Merchant Web now use the same Business master.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to add this Expense Category.'));
    } finally {
      setCategoryBusyId(null);
    }
  }

  async function renameCategory(category: ExpenseCategory) {
    const name = (categoryEdits[category.id] ?? '').trim();
    if (!name) return setError('Expense Category name is required.');
    if (name === category.name) return;
    setCategoryBusyId(category.id);
    setError(null);
    setNotice(null);
    try {
      const { error: rpcError } = await supabase.rpc('rename_sellertray_expense_category', { p_tenant_id: tenantId, p_category_id: category.id, p_name: name });
      if (rpcError) throw rpcError;
      await loadCategories(true, expenseCategoryId);
      setNotice('Expense Category renamed for future selection. Historical expense labels remain unchanged.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to rename this Expense Category.'));
    } finally {
      setCategoryBusyId(null);
    }
  }

  async function setCategoryActive(category: ExpenseCategory, isActive: boolean) {
    setCategoryBusyId(category.id);
    setError(null);
    setNotice(null);
    try {
      const { error: rpcError } = await supabase.rpc('set_sellertray_expense_category_active', { p_tenant_id: tenantId, p_category_id: category.id, p_is_active: isActive });
      if (rpcError) throw rpcError;
      await loadCategories(true, expenseCategoryId === category.id && !isActive ? undefined : expenseCategoryId);
      setNotice(isActive ? 'Expense Category activated.' : 'Expense Category archived. Historical expenses were not changed.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to update this Expense Category.'));
    } finally {
      setCategoryBusyId(null);
    }
  }

  function resetDraft() {
    setFundingSource('cash');
    setBankAccountId('');
    setCashShiftId('');
    setExpenseCategoryId('');
    setAmount('');
    setReference(newReference());
    setReason('');
    setCommandId(newCommandId());
  }

  async function createExpense() {
    const parsedAmount = Number(amount);
    if (!createBranchId) return setError('Choose a Branch for this Business Expense.');
    if (!canCreate) return setError('Only an authorised Owner or Manager can record Business Expenses.');
    if (!expenseCategoryId) return setError('Choose an Expense Category.');
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return setError('Enter an amount greater than zero.');
    if (!reference.trim()) return setError('Enter a reference.');
    if (!reason.trim()) return setError('Enter a reason.');
    if (fundingSource === 'bank' && !bankAccountId) return setError('Choose the Business bank account paying this expense.');
    if (fundingSource === 'cash' && !cashShiftId) return setError('Choose an open cash drawer paying this expense.');
    if (!commandId) return setError('Restart this Business Expense and try again.');

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const selectedCategoryId = expenseCategoryId;
      const { data, error: fnError } = await supabase.functions.invoke('money-operation', {
        body: {
          action: 'business_expense',
          tenantId,
          branchId: createBranchId,
          fundingSource,
          paymentMethodId: fundingSource === 'bank' ? bankAccountId : null,
          cashShiftId: fundingSource === 'cash' ? cashShiftId : null,
          expenseCategoryId: selectedCategoryId,
          amount: parsedAmount,
          reference: reference.trim(),
          reason: reason.trim(),
          commandId,
        },
      });
      if (fnError) throw fnError;
      const result = asObject(data);
      if (result.ok !== true || typeof result.expenseId !== 'string') throw new Error(String(result.error ?? 'Business Expense was not recorded.'));
      setNotice(result.idempotentReplay === true ? 'This Business Expense was already recorded.' : 'Business Expense recorded.');
      setShowCreate(false);
      resetDraft();
      setExpenseCategoryId(selectedCategoryId);
      await load();
      await loadOptions(createBranchId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to record this Business Expense.'));
    } finally {
      setBusy(false);
    }
  }

  const activeCategories = useMemo(() => expenseCategories.filter((category) => category.isActive), [expenseCategories]);
  const pageStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);
  const selectedDrawer = useMemo(() => cashDrawers.find((row) => row.shiftId === cashShiftId) ?? null, [cashDrawers, cashShiftId]);

  return <div className="page-stack">
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {notice ? <div className="success-banner">{notice}<button onClick={() => setNotice(null)}>Dismiss</button></div> : null}

    <div className="metric-grid">
      <article className="metric-card"><span>Operating expenses</span><strong>{money(totalAmount, aggregateCurrency)}</strong><small>Business Expenses in the current filtered scope</small></article>
      <article className="metric-card"><span>Records</span><strong>{totalCount}</strong><small>Bank Deposit and Owner Withdrawal are excluded</small></article>
      <article className="metric-card"><span>Expense Categories</span><strong>{activeCategories.length}</strong><small>Active Business-wide categories shared with Mobile</small></article>
    </div>

    <article className="panel">
      <div className="panel-head">
        <div><p className="eyebrow">Money</p><h3>Business Expenses</h3><p className="muted">Record operating expenses against governed Business-wide categories without mixing transfers or owner withdrawals into expense reporting.</p></div>
        <div className="panel-actions">
          <button className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing' : 'Refresh'}</button>
          {canCreate ? <button className="secondary-button" onClick={() => { setShowCategories((value) => !value); setError(null); void loadCategories(true); }}>{showCategories ? 'Close categories' : 'Manage Expense Categories'}</button> : null}
          <button className="primary-button" onClick={() => { setShowCreate((value) => !value); setError(null); }}>{showCreate ? 'Close form' : 'New Business Expense'}</button>
        </div>
      </div>

      {showCategories && canCreate ? <div className="settings-card">
        <div className="panel-head compact"><div><h4>Expense Categories</h4><p className="muted">One Business master drives Merchant Web and both Mobile expense flows. Archive instead of deleting used categories; historical snapshots remain unchanged.</p></div></div>
        <div className="search-inline"><SellerTrayInput value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="New Expense Category" maxLength={120} /><button type="button" className="primary-button" disabled={categoryBusyId !== null || !categoryDraft.trim()} onClick={() => void createCategory()}>{categoryBusyId === 'new' ? 'Adding' : 'Add category'}</button></div>
        <div className="table-wrap"><table><thead><tr><th>Category</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {expenseCategories.length === 0 ? <tr><td colSpan={3}>No Expense Categories yet.</td></tr> : expenseCategories.map((category) => <tr key={category.id}><td><SellerTrayInput value={categoryEdits[category.id] ?? category.name} onChange={(event) => setCategoryEdits((current) => ({ ...current, [category.id]: event.target.value }))} maxLength={120} /></td><td><span className={category.isActive ? 'status-badge success' : 'status-badge muted'}>{category.isActive ? 'Active' : 'Archived'}</span></td><td><div className="panel-actions"><button className="secondary-button" disabled={categoryBusyId !== null || (categoryEdits[category.id] ?? category.name).trim() === category.name} onClick={() => void renameCategory(category)}>{categoryBusyId === category.id ? 'Saving' : 'Rename'}</button><button className="secondary-button" disabled={categoryBusyId !== null} onClick={() => void setCategoryActive(category, !category.isActive)}>{category.isActive ? 'Archive' : 'Activate'}</button></div></td></tr>)}
        </tbody></table></div>
      </div> : null}

      {showCreate ? <div className="settings-card">
        <div className="panel-head compact"><div><h4>New Business Expense</h4><p className="muted">Owner/Manager authority only. Cash funding requires an open drawer; Bank funding requires a governed Business bank account.</p></div></div>
        <div className="settings-grid two">
          <label className="select-field"><span>Branch</span><SellerTraySelect value={createBranchId} onChange={(event) => setCreateBranchId(event.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</SellerTraySelect></label>
          <label className="select-field"><span>Funding source</span><SellerTraySelect value={fundingSource} onChange={(event) => setFundingSource(event.target.value as FundingSource)}><option value="cash">Cash</option><option value="bank">Bank</option></SellerTraySelect></label>
          {fundingSource === 'bank' ? <label className="select-field"><span>Business bank account</span><SellerTraySelect value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}><option value="">Choose bank account</option>{bankAccounts.map((bank) => <option key={bank.id} value={bank.id}>{bankLabel(bank)}</option>)}</SellerTraySelect></label> : null}
          {fundingSource === 'cash' ? <label className="select-field"><span>Open cash drawer</span><SellerTraySelect value={cashShiftId} onChange={(event) => setCashShiftId(event.target.value)}><option value="">Choose cash drawer</option>{cashDrawers.map((drawer) => <option key={drawer.shiftId} value={drawer.shiftId}>{drawer.registerName} · {money(drawer.expectedCash, businessCurrency)}</option>)}</SellerTraySelect></label> : null}
          <label className="select-field"><span>Expense Category</span><SellerTraySelect value={expenseCategoryId} onChange={(event) => setExpenseCategoryId(event.target.value)}><option value="">Choose Expense Category</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</SellerTraySelect></label>
          <label><span>Amount</span><SellerTrayInput value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" /></label>
          <label><span>Reference</span><SellerTrayInput value={reference} onChange={(event) => setReference(event.target.value)} maxLength={160} /></label>
          <label className="settings-span-two"><span>Reason</span><SellerTrayTextarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="What was this expense for?" /></label>
        </div>
        {activeCategories.length === 0 ? <div className="empty-state compact"><strong>No active Expense Category</strong><p>Create or activate an Expense Category before recording an expense.</p></div> : null}
        {fundingSource === 'cash' && selectedDrawer ? <p className="muted">Selected drawer currently expects {money(selectedDrawer.expectedCash, businessCurrency)}. SellerTray records the expense and its drawer effect atomically.</p> : null}
        {fundingSource === 'cash' && cashDrawers.length === 0 ? <div className="empty-state compact"><strong>No open cash drawer</strong><p>Use Bank funding or open a cashier shift in the selected Branch before recording a cash-funded Business Expense.</p></div> : null}
        {fundingSource === 'bank' && bankAccounts.length === 0 ? <div className="empty-state compact"><strong>No enabled Business bank account</strong><p>Configure and enable a Bank Transfer payment method before recording a bank-funded Business Expense.</p></div> : null}
        <div className="panel-actions"><button className="secondary-button" disabled={busy} onClick={() => { setShowCreate(false); resetDraft(); }}>Cancel</button><button className="primary-button" disabled={busy || !canCreate || !expenseCategoryId || (fundingSource === 'cash' ? !cashShiftId : !bankAccountId)} onClick={() => void createExpense()}>{busy ? 'Recording' : 'Record Business Expense'}</button></div>
      </div> : null}

      <div className="settings-grid three">
        <label className="select-field"><span>Branch</span><SellerTraySelect value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">All accessible Branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</SellerTraySelect></label>
        <label className="select-field"><span>Funding</span><SellerTraySelect value={fundingFilter} onChange={(event) => setFundingFilter(event.target.value)}><option value="all">Cash + Bank</option><option value="cash">Cash</option><option value="bank">Bank</option></SellerTraySelect></label>
        <label><span>Search</span><div className="search-inline"><SellerTrayInput value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Category, reference or reason" /><button className="secondary-button" onClick={() => setSearch(searchDraft.trim())}>Apply</button></div></label>
      </div>

      <div className="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Expense</th><th>Funding</th><th>Reference</th><th>Status</th><th className="number-cell">Amount</th></tr></thead><tbody>
        {loading && rows.length === 0 ? <tr><td colSpan={7}>Loading Business Expenses…</td></tr> : null}
        {!loading && rows.length === 0 ? <tr><td colSpan={7}>No Business Expenses match these filters.</td></tr> : null}
        {rows.map((row) => <tr key={row.expenseId}><td>{dateTime(row.createdAt)}</td><td>{row.branchName}</td><td><strong>{row.expenseCategory}</strong><small>{row.reason}</small></td><td>{row.fundingSource === 'bank' ? row.bankAccount || 'Bank' : 'Cash drawer'}</td><td>{row.reference}</td><td><span className={row.status === 'effective' ? 'status-badge success' : 'status-badge muted'}>{row.status === 'effective' ? 'Effective' : 'Removed'}</span></td><td className="number-cell"><strong>{money(row.amount, row.currency)}</strong>{row.status === 'removed' ? <small>Original {money(row.originalAmount, row.currency)}</small> : null}</td></tr>)}
      </tbody></table></div>

      <div className="pagination-row"><span>{pageStart}–{pageEnd} of {totalCount}</span><div><button className="secondary-button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button className="secondary-button" disabled={pageEnd >= totalCount || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </article>
  </div>;
}

function mapCategory(row: Record<string, unknown>): ExpenseCategory { return { id: String(row.id ?? ''), name: String(row.name ?? ''), isActive: row.isActive !== false }; }
function mapExpense(row: Record<string, unknown>): ExpenseRow { return { expenseId: String(row.expenseId ?? ''), branchId: String(row.branchId ?? ''), branchName: String(row.branchName ?? 'Branch'), fundingSource: row.fundingSource === 'bank' ? 'bank' : 'cash', paymentMethodId: typeof row.paymentMethodId === 'string' ? row.paymentMethodId : null, bankAccount: typeof row.bankAccount === 'string' ? row.bankAccount : null, cashShiftId: typeof row.cashShiftId === 'string' ? row.cashShiftId : null, expenseCategory: String(row.expenseCategory ?? 'Expense'), originalAmount: numberValue(row.originalAmount), amount: numberValue(row.amount), currency: String(row.currency ?? 'NGN'), reference: String(row.reference ?? ''), reason: String(row.reason ?? ''), actorUserId: String(row.actorUserId ?? ''), status: row.status === 'removed' ? 'removed' : 'effective', cashMovementId: typeof row.cashMovementId === 'string' ? row.cashMovementId : null, createdAt: String(row.createdAt ?? '') }; }
function mapBank(row: Record<string, unknown>): BankAccount { return { id: String(row.id ?? ''), displayName: String(row.displayName ?? 'Business bank'), bankName: String(row.bankName ?? ''), accountName: String(row.accountName ?? ''), accountNumber: String(row.accountNumber ?? '') }; }
function mapDrawer(row: Record<string, unknown>): CashDrawer { return { shiftId: String(row.shiftId ?? ''), registerId: String(row.registerId ?? ''), registerName: String(row.registerName ?? 'Cash drawer'), cashierUserId: String(row.cashierUserId ?? ''), openedAt: String(row.openedAt ?? ''), expectedCash: numberValue(row.expectedCash) }; }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function bankLabel(bank: BankAccount): string { return [bank.displayName, bank.bankName, bank.accountNumber].filter(Boolean).join(' · '); }
function money(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
function dateTime(value: string): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
function newReference(): string { const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14); return `BEXP-${stamp}-${randomToken(4)}`; }
function newCommandId(): string { return `business-expense:${Date.now().toString(36)}-${randomToken(12)}`; }
function randomToken(length: number): string { const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; let value = ''; for (let index = 0; index < length; index += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)] ?? 'x'; return value; }
