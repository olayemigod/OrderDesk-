import { useEffect, useMemo, useRef, useState } from 'react';
import { SellerTrayInput, SellerTraySelect, SellerTrayTextarea } from './SellerTrayElements';
import { errorMessage, numberValue, supabase } from './supabase';

type Branch = { id: string; name: string; isDefault: boolean };
type FundingSource = 'cash' | 'bank';
type BankAccount = {
  id: string;
  displayName: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
};
type CashDrawer = {
  shiftId: string;
  registerId: string;
  registerName: string;
  cashierUserId: string;
  openedAt: string;
  expectedCash: number;
};
type ExpenseCategory = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
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
type ListResponse = {
  items?: unknown;
  totalCount?: unknown;
  totalAmount?: unknown;
  currency?: unknown;
};
type OptionsResponse = {
  canRecordBusinessExpense?: unknown;
  bankAccounts?: unknown;
  openCashDrawers?: unknown;
};
type CategoryResponse = {
  canManage?: unknown;
  items?: unknown;
};

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
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createBranchId, setCreateBranchId] = useState(initialBranchId || branches[0]?.id || '');
  const [canCreate, setCanCreate] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [cashDrawers, setCashDrawers] = useState<CashDrawer[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [canManageCategories, setCanManageCategories] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
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

  const activeCategories = useMemo(() => categories.filter((category) => category.isActive), [categories]);

  useEffect(() => {
    setBranchId(initialBranchId || 'all');
    setCreateBranchId(initialBranchId || branches[0]?.id || '');
    setFundingFilter('all');
    setSearch('');
    setSearchDraft('');
    setPage(0);
    setShowCreate(false);
    setCategories([]);
    setCanManageCategories(false);
    setNewCategoryName('');
    setEditingCategoryId(null);
    setEditingCategoryName('');
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
  useEffect(() => { void loadCategories(); }, [tenantId]);
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

  async function loadCategories() {
    const requestId = ++categoryRequestRef.current;
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_expense_categories', {
        p_tenant_id: tenantId,
        p_include_inactive: false,
      });
      if (rpcError) throw rpcError;
      if (requestId !== categoryRequestRef.current) return;
      const activeResult = (data ?? {}) as CategoryResponse;
      const canManage = activeResult.canManage === true;
      let nextCategories = mapCategories(activeResult.items);

      if (canManage) {
        const { data: allData, error: allError } = await supabase.rpc('get_sellertray_expense_categories', {
          p_tenant_id: tenantId,
          p_include_inactive: true,
        });
        if (allError) throw allError;
        if (requestId !== categoryRequestRef.current) return;
        const allResult = (allData ?? {}) as CategoryResponse;
        nextCategories = mapCategories(allResult.items);
      }

      setCanManageCategories(canManage);
      setCategories(nextCategories);
      const nextActive = nextCategories.filter((category) => category.isActive);
      setExpenseCategoryId((current) => nextActive.some((category) => category.id === current)
        ? current
        : nextActive[0]?.id ?? '');
    } catch (cause) {
      if (requestId !== categoryRequestRef.current) return;
      setCategories([]);
      setCanManageCategories(false);
      setExpenseCategoryId('');
      setError(errorMessage(cause, 'Unable to load Expense Categories.'));
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
      const nextBanks = (Array.isArray(result.bankAccounts) ? result.bankAccounts : [])
        .map((raw) => mapBank(raw as Record<string, unknown>))
        .filter((row) => row.id);
      const nextDrawers = (Array.isArray(result.openCashDrawers) ? result.openCashDrawers : [])
        .map((raw) => mapDrawer(raw as Record<string, unknown>))
        .filter((row) => row.shiftId);
      setCanCreate(result.canRecordBusinessExpense === true);
      setBankAccounts(nextBanks);
      setCashDrawers(nextDrawers);
      setBankAccountId((current) => nextBanks.some((row) => row.id === current) ? current : nextBanks[0]?.id ?? '');
      setCashShiftId((current) => nextDrawers.some((row) => row.shiftId === current) ? current : nextDrawers[0]?.shiftId ?? '');
    } catch (cause) {
      if (requestId !== optionsRequestRef.current) return;
      setCanCreate(false);
      setBankAccounts([]);
      setCashDrawers([]);
      setError(errorMessage(cause, 'Unable to load Business Expense funding options.'));
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

  async function manageCategory(action: 'create' | 'rename' | 'archive' | 'reactivate', categoryId?: string, categoryName?: string) {
    if (!canManageCategories) return setError('Only an authorised Owner or Manager can manage Expense Categories.');
    const name = categoryName?.trim() ?? '';
    if ((action === 'create' || action === 'rename') && !name) return setError('Enter an Expense Category name.');

    setCategoryBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('manage_sellertray_expense_category', {
        p_tenant_id: tenantId,
        p_action: action,
        p_category_id: categoryId ?? null,
        p_name: action === 'create' || action === 'rename' ? name : null,
      });
      if (rpcError) throw rpcError;
      const result = asObject(data);
      if (typeof result.id !== 'string') throw new Error('SellerTray returned an invalid Expense Category result.');
      setNotice(action === 'create'
        ? 'Expense Category created.'
        : action === 'rename'
          ? 'Expense Category renamed. Historical expenses keep their original category snapshot.'
          : action === 'archive'
            ? 'Expense Category archived. Historical expenses are unchanged.'
            : 'Expense Category reactivated.');
      setNewCategoryName('');
      setEditingCategoryId(null);
      setEditingCategoryName('');
      await loadCategories();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to update this Expense Category.'));
    } finally {
      setCategoryBusy(false);
    }
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
      const { data, error: fnError } = await supabase.functions.invoke('money-operation', {
        body: {
          action: 'business_expense',
          tenantId,
          branchId: createBranchId,
          fundingSource,
          paymentMethodId: fundingSource === 'bank' ? bankAccountId : null,
          cashShiftId: fundingSource === 'cash' ? cashShiftId : null,
          expenseCategoryId,
          amount: parsedAmount,
          reference: reference.trim(),
          reason: reason.trim(),
          commandId,
        },
      });
      if (fnError) throw fnError;
      const result = asObject(data);
      if (result.ok !== true || typeof result.expenseId !== 'string') {
        throw new Error(String(result.error ?? 'Business Expense was not recorded.'));
      }
      const replay = result.idempotentReplay === true;
      setNotice(replay ? 'This Business Expense was already recorded.' : 'Business Expense recorded.');
      setShowCreate(false);
      resetDraft();
      await Promise.all([load(), loadOptions(createBranchId), loadCategories()]);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to record this Business Expense.'));
    } finally {
      setBusy(false);
    }
  }

  const pageStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, totalCount);
  const selectedDrawer = useMemo(
    () => cashDrawers.find((row) => row.shiftId === cashShiftId) ?? null,
    [cashDrawers, cashShiftId],
  );

  return <div className="page-stack">
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {notice ? <div className="success-banner">{notice}<button onClick={() => setNotice(null)}>Dismiss</button></div> : null}

    <div className="metric-grid">
      <article className="metric-card"><span>Operating expenses</span><strong>{money(totalAmount, aggregateCurrency)}</strong><small>Business Expenses in the current filtered scope</small></article>
      <article className="metric-card"><span>Records</span><strong>{totalCount}</strong><small>Bank Deposit and Owner Withdrawal are excluded</small></article>
      <article className="metric-card"><span>Funding</span><strong>{fundingFilter === 'all' ? 'Cash + Bank' : fundingFilter === 'cash' ? 'Cash' : 'Bank'}</strong><small>Cash funding links to one governed drawer effect</small></article>
    </div>

    <article className="panel">
      <div className="panel-head">
        <div><p className="eyebrow">Business master</p><h3>Expense Categories</h3><p className="muted">Manage the Business-wide categories used by Merchant Web and Mobile. Renaming or archiving never rewrites historical expense labels.</p></div>
        <button className="secondary-button" disabled={categoryBusy} onClick={() => void loadCategories()}>{categoryBusy ? 'Updating' : 'Refresh categories'}</button>
      </div>

      {canManageCategories ? <div className="settings-card">
        <div className="settings-grid two">
          <label><span>New Expense Category</span><SellerTrayInput value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="e.g. Utilities" maxLength={120} /></label>
          <div className="panel-actions"><button className="primary-button" disabled={categoryBusy || !newCategoryName.trim()} onClick={() => void manageCategory('create', undefined, newCategoryName)}>{categoryBusy ? 'Saving' : 'Add category'}</button></div>
        </div>
      </div> : <p className="muted">Expense Categories are managed by an authorised Owner or Manager.</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Category</th><th>Status</th><th>Last updated</th>{canManageCategories ? <th>Action</th> : null}</tr></thead>
          <tbody>{categories.length === 0 ? <tr><td colSpan={canManageCategories ? 4 : 3}><div className="empty-state compact"><strong>No Expense Categories yet</strong><p>Create the first category before recording a new expense.</p></div></td></tr> : categories.map((category) => <tr key={category.id}>
            <td>{editingCategoryId === category.id
              ? <SellerTrayInput value={editingCategoryName} onChange={(event) => setEditingCategoryName(event.target.value)} maxLength={120} />
              : <strong>{category.name}</strong>}</td>
            <td><span className={category.isActive ? 'status-badge success' : 'status-badge muted'}>{category.isActive ? 'Active' : 'Archived'}</span></td>
            <td>{dateTime(category.updatedAt)}</td>
            {canManageCategories ? <td><div className="panel-actions">{editingCategoryId === category.id
              ? <><button className="secondary-button" disabled={categoryBusy} onClick={() => { setEditingCategoryId(null); setEditingCategoryName(''); }}>Cancel</button><button className="primary-button" disabled={categoryBusy || !editingCategoryName.trim()} onClick={() => void manageCategory('rename', category.id, editingCategoryName)}>Save name</button></>
              : <><button className="secondary-button" disabled={categoryBusy} onClick={() => { setEditingCategoryId(category.id); setEditingCategoryName(category.name); }}>Rename</button><button className="secondary-button" disabled={categoryBusy} onClick={() => void manageCategory(category.isActive ? 'archive' : 'reactivate', category.id)}>{category.isActive ? 'Archive' : 'Reactivate'}</button></>}</div></td> : null}
          </tr>)}</tbody>
        </table>
      </div>
    </article>

    <article className="panel">
      <div className="panel-head">
        <div><p className="eyebrow">Money</p><h3>Business Expenses</h3><p className="muted">Record management-level operating expenses without mixing transfers or owner withdrawals into expense reporting.</p></div>
        <div className="panel-actions"><button className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing' : 'Refresh'}</button><button className="primary-button" onClick={() => { setShowCreate((value) => !value); setError(null); if (!expenseCategoryId) setExpenseCategoryId(activeCategories[0]?.id ?? ''); }}>{showCreate ? 'Close form' : 'New Business Expense'}</button></div>
      </div>

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
        {activeCategories.length === 0 ? <div className="empty-state compact"><strong>No active Expense Category</strong><p>Create or reactivate an Expense Category before recording a Business Expense.</p></div> : null}
        {fundingSource === 'cash' && selectedDrawer ? <p className="muted">Selected drawer currently expects {money(selectedDrawer.expectedCash, businessCurrency)}. SellerTray records the expense and its drawer effect atomically.</p> : null}
        {fundingSource === 'cash' && cashDrawers.length === 0 ? <div className="empty-state compact"><strong>No open cash drawer</strong><p>Use Bank funding or open a cashier shift in the selected Branch before recording a cash-funded Business Expense.</p></div> : null}
        {fundingSource === 'bank' && bankAccounts.length === 0 ? <div className="empty-state compact"><strong>No enabled Business bank account</strong><p>Configure and enable a Bank Transfer payment method before recording a bank-funded Business Expense.</p></div> : null}
        <div className="panel-actions"><button className="secondary-button" disabled={busy} onClick={() => { setShowCreate(false); resetDraft(); }}>Cancel</button><button className="primary-button" disabled={busy || !canCreate || !expenseCategoryId || (fundingSource === 'cash' ? !cashShiftId : !bankAccountId)} onClick={() => void createExpense()}>{busy ? 'Recording' : 'Record Business Expense'}</button></div>
      </div> : null}

      <div className="settings-grid three">
        <label className="select-field"><span>Branch</span><SellerTraySelect value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">All accessible Branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</SellerTraySelect></label>
        <label className="select-field"><span>Funding</span><SellerTraySelect value={fundingFilter} onChange={(event) => setFundingFilter(event.target.value)}><option value="all">Cash + Bank</option><option value="cash">Cash</option><option value="bank">Bank</option></SellerTraySelect></label>
        <form onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}><label><span>Search</span><div className="search-inline"><SellerTrayInput value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Reference, category or reason" /><button className="secondary-button">Apply</button></div></label></form>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Date</th><th>Branch</th><th>Category</th><th>Funding</th><th>Reference</th><th>Status</th><th className="number-cell">Amount</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={7}>Loading Business Expenses…</td></tr> : rows.length === 0 ? <tr><td colSpan={7}><div className="empty-state compact"><strong>No Business Expenses found</strong><p>Transfers and owner withdrawals intentionally do not appear here.</p></div></td></tr> : rows.map((row) => <tr key={row.expenseId}>
            <td>{dateTime(row.createdAt)}</td>
            <td>{row.branchName}</td>
            <td><strong>{row.expenseCategory}</strong><small>{row.reason}</small></td>
            <td>{row.fundingSource === 'bank' ? row.bankAccount || 'Bank' : 'Cash drawer'}</td>
            <td>{row.reference}</td>
            <td><span className={row.status === 'effective' ? 'status-badge success' : 'status-badge muted'}>{row.status === 'effective' ? 'Effective' : 'Removed'}</span></td>
            <td className="number-cell"><strong>{money(row.amount, row.currency)}</strong>{row.status === 'removed' ? <small>Original {money(row.originalAmount, row.currency)}</small> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <div className="pagination-row"><span>{pageStart}–{pageEnd} of {totalCount}</span><div><button className="secondary-button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button className="secondary-button" disabled={pageEnd >= totalCount || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </article>
  </div>;
}

function mapExpense(row: Record<string, unknown>): ExpenseRow {
  return {
    expenseId: String(row.expenseId ?? ''),
    branchId: String(row.branchId ?? ''),
    branchName: String(row.branchName ?? 'Branch'),
    fundingSource: row.fundingSource === 'bank' ? 'bank' : 'cash',
    paymentMethodId: typeof row.paymentMethodId === 'string' ? row.paymentMethodId : null,
    bankAccount: typeof row.bankAccount === 'string' ? row.bankAccount : null,
    cashShiftId: typeof row.cashShiftId === 'string' ? row.cashShiftId : null,
    expenseCategory: String(row.expenseCategory ?? 'Expense'),
    originalAmount: numberValue(row.originalAmount),
    amount: numberValue(row.amount),
    currency: String(row.currency ?? 'NGN'),
    reference: String(row.reference ?? ''),
    reason: String(row.reason ?? ''),
    actorUserId: String(row.actorUserId ?? ''),
    status: row.status === 'removed' ? 'removed' : 'effective',
    cashMovementId: typeof row.cashMovementId === 'string' ? row.cashMovementId : null,
    createdAt: String(row.createdAt ?? ''),
  };
}

function mapCategories(value: unknown): ExpenseCategory[] {
  return (Array.isArray(value) ? value : []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id ?? ''),
      name: String(row.name ?? 'Expense Category'),
      isActive: row.isActive === true,
      createdAt: String(row.createdAt ?? ''),
      updatedAt: String(row.updatedAt ?? ''),
    };
  }).filter((category) => category.id);
}

function mapBank(row: Record<string, unknown>): BankAccount {
  return {
    id: String(row.id ?? ''),
    displayName: String(row.displayName ?? 'Business bank'),
    bankName: String(row.bankName ?? ''),
    accountName: String(row.accountName ?? ''),
    accountNumber: String(row.accountNumber ?? ''),
  };
}

function mapDrawer(row: Record<string, unknown>): CashDrawer {
  return {
    shiftId: String(row.shiftId ?? ''),
    registerId: String(row.registerId ?? ''),
    registerName: String(row.registerName ?? 'Cash drawer'),
    cashierUserId: String(row.cashierUserId ?? ''),
    openedAt: String(row.openedAt ?? ''),
    expectedCash: numberValue(row.expectedCash),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function bankLabel(bank: BankAccount): string {
  return [bank.displayName, bank.bankName, bank.accountNumber].filter(Boolean).join(' · ');
}

function money(value: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency || 'NGN'} ${value.toLocaleString()}`; }
}

function dateTime(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function newReference(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `BEXP-${stamp}-${randomToken(4)}`;
}

function newCommandId(): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${randomToken(12)}`;
  return `merchant-web-expense:${uuid}`;
}

function randomToken(length: number): string {
  return Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(2, 2 + length).toUpperCase().padEnd(length, '0');
}