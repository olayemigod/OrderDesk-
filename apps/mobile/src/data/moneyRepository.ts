import { supabase } from '../lib/supabase';

export type CashOutType = 'bank_deposit' | 'owner_withdrawal';
export type BusinessExpenseFundingSource = 'cash' | 'bank';

export type BusinessBankAccount = {
  id: string;
  displayName: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
};

export type OpenCashDrawer = {
  shiftId: string;
  registerId: string;
  registerName: string;
  cashierUserId: string;
  openedAt: string;
  expectedCash: number;
};

export type MoneyOperationOptions = {
  currency: string;
  canRecordBusinessExpense: boolean;
  bankAccounts: BusinessBankAccount[];
  openCashDrawers: OpenCashDrawer[];
};

export type TypedCashOutResult = {
  movementId: string;
  shiftId: string;
  movementType: 'cash_out';
  cashOutType: CashOutType;
  bankPaymentMethodId: string | null;
  amount: number;
  currency: string;
  expectedCash: number;
  idempotentReplay: boolean;
};

export type BusinessExpenseResult = {
  expenseId: string;
  fundingSource: BusinessExpenseFundingSource;
  amount: number;
  currency: string;
  cashMovementId: string | null;
  expectedCash?: number;
  idempotentReplay: boolean;
};

export async function loadMoneyOperationOptions(
  tenantId: string,
  branchId: string,
): Promise<MoneyOperationOptions> {
  if (!tenantId || !branchId) return { currency: 'NGN', canRecordBusinessExpense: false, bankAccounts: [], openCashDrawers: [] };
  const { data, error } = await supabase.rpc('get_sellertray_money_operation_options', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('SellerTray returned invalid money options.');
  const row = data as Record<string, unknown>;
  return {
    currency: typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) ? row.currency : 'NGN',
    canRecordBusinessExpense: row.canRecordBusinessExpense === true,
    bankAccounts: Array.isArray(row.bankAccounts) ? row.bankAccounts.map(parseBankAccount) : [],
    openCashDrawers: Array.isArray(row.openCashDrawers) ? row.openCashDrawers.map(parseCashDrawer) : [],
  };
}

export async function recordTypedCashOut(input: {
  tenantId: string;
  shiftId: string;
  cashOutType: CashOutType;
  bankPaymentMethodId?: string | null;
  commandId: string;
  amount: number;
  reference: string;
  reason: string;
}): Promise<TypedCashOutResult> {
  if (!input.tenantId || !input.shiftId) throw new Error('Business and cashier shift are required.');
  if (!input.commandId.trim()) throw new Error('Restart this Cash Out and try again.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Amount must be greater than zero.');
  if (!input.reference.trim()) throw new Error('Reference is required.');
  if (!input.reason.trim()) throw new Error('Reason is required.');
  if (input.cashOutType === 'bank_deposit' && !input.bankPaymentMethodId) {
    throw new Error('Choose the Business bank account receiving this deposit.');
  }
  const data = await invokeMoney({
    action: 'typed_cash_out',
    tenantId: input.tenantId,
    shiftId: input.shiftId,
    cashOutType: input.cashOutType,
    bankPaymentMethodId: input.cashOutType === 'bank_deposit' ? input.bankPaymentMethodId : null,
    commandId: input.commandId.trim(),
    amount: input.amount,
    reference: input.reference.trim(),
    reason: input.reason.trim(),
  }, 'Unable to record this Cash Out.');
  if (typeof data.movementId !== 'string' || data.movementType !== 'cash_out'
      || (data.cashOutType !== 'bank_deposit' && data.cashOutType !== 'owner_withdrawal')) {
    throw new Error('SellerTray returned an invalid Cash Out result.');
  }
  return {
    movementId: data.movementId,
    shiftId: String(data.shiftId ?? input.shiftId),
    movementType: 'cash_out',
    cashOutType: data.cashOutType,
    bankPaymentMethodId: typeof data.bankPaymentMethodId === 'string' ? data.bankPaymentMethodId : null,
    amount: numberValue(data.amount),
    currency: String(data.currency ?? 'NGN'),
    expectedCash: numberValue(data.expectedCash),
    idempotentReplay: data.idempotentReplay === true,
  };
}

export async function recordBusinessExpense(input: {
  tenantId: string;
  branchId: string;
  fundingSource: BusinessExpenseFundingSource;
  paymentMethodId?: string | null;
  cashShiftId?: string | null;
  expenseCategory: string;
  amount: number;
  reference: string;
  reason: string;
  commandId: string;
}): Promise<BusinessExpenseResult> {
  if (!input.tenantId || !input.branchId) throw new Error('Business and Branch are required.');
  if (!input.commandId.trim()) throw new Error('Restart this Business Expense and try again.');
  if (!input.expenseCategory.trim()) throw new Error('Expense category is required.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Amount must be greater than zero.');
  if (!input.reference.trim()) throw new Error('Reference is required.');
  if (!input.reason.trim()) throw new Error('Reason is required.');
  if (input.fundingSource === 'bank' && !input.paymentMethodId) throw new Error('Choose the Business bank account paying this expense.');
  if (input.fundingSource === 'cash' && !input.cashShiftId) throw new Error('Choose the open cash drawer paying this expense.');

  const data = await invokeMoney({
    action: 'business_expense',
    tenantId: input.tenantId,
    branchId: input.branchId,
    fundingSource: input.fundingSource,
    paymentMethodId: input.fundingSource === 'bank' ? input.paymentMethodId : null,
    cashShiftId: input.fundingSource === 'cash' ? input.cashShiftId : null,
    expenseCategory: input.expenseCategory.trim(),
    amount: input.amount,
    reference: input.reference.trim(),
    reason: input.reason.trim(),
    commandId: input.commandId.trim(),
  }, 'Unable to record this Business Expense.');
  if (typeof data.expenseId !== 'string' || (data.fundingSource !== 'cash' && data.fundingSource !== 'bank')) {
    throw new Error('SellerTray returned an invalid Business Expense result.');
  }
  return {
    expenseId: data.expenseId,
    fundingSource: data.fundingSource,
    amount: numberValue(data.amount),
    currency: String(data.currency ?? 'NGN'),
    cashMovementId: typeof data.cashMovementId === 'string' ? data.cashMovementId : null,
    expectedCash: data.expectedCash == null ? undefined : numberValue(data.expectedCash),
    idempotentReplay: data.idempotentReplay === true,
  };
}

function parseBankAccount(value: unknown): BusinessBankAccount {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id ?? ''),
    displayName: String(row.displayName ?? 'Business bank'),
    bankName: String(row.bankName ?? ''),
    accountName: String(row.accountName ?? ''),
    accountNumber: String(row.accountNumber ?? ''),
  };
}

function parseCashDrawer(value: unknown): OpenCashDrawer {
  const row = value as Record<string, unknown>;
  return {
    shiftId: String(row.shiftId ?? ''),
    registerId: String(row.registerId ?? ''),
    registerName: String(row.registerName ?? 'Cash drawer'),
    cashierUserId: String(row.cashierUserId ?? ''),
    openedAt: String(row.openedAt ?? ''),
    expectedCash: numberValue(row.expectedCash),
  };
}

async function invokeMoney(body: Record<string, unknown>, fallback: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('money-operation', { body });
  if (error) throw new Error(await functionErrorMessage(error, fallback));
  if (!data || typeof data !== 'object') throw new Error('SellerTray returned an invalid money result.');
  return data as Record<string, unknown>;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  let message = error instanceof Error && error.message ? error.message : fallback;
  if (!error || typeof error !== 'object' || !('context' in error)) return message;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('clone' in context)) return message;
  try {
    const payload = await (context as Response).clone().json() as { error?: string };
    if (payload?.error) message = payload.error;
  } catch { /* no-op */ }
  return message;
}