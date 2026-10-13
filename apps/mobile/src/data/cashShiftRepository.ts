import { supabase } from '../lib/supabase';

export type CashRegister = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
};

export type CashShiftCapabilities = {
  canOpenShift: boolean;
  canRecordCashMovement: boolean;
  canRecordExpense: boolean;
  canCloseShift: boolean;
  canReviewShift: boolean;
};

export type CashShiftStatus = 'open' | 'closed' | 'reviewed';
export type CashMovementType = 'cash_in' | 'cash_out' | 'expense';
export type ShiftReviewDecision = 'accepted' | 'follow_up';

export type CashShiftMovement = {
  movementId: string;
  movementType: CashMovementType;
  amount: number;
  currency: string;
  reference: string;
  reason: string;
  expenseCategory: string | null;
  actorUserId: string;
  createdAt: string;
};

export type CashShift = {
  shiftId: string;
  branchId: string;
  registerId: string;
  registerName: string;
  status: CashShiftStatus;
  currency: string;
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expenses: number;
  expectedCash: number;
  declaredCash: number | null;
  variance: number | null;
  closeNote: string | null;
  reviewDecision: ShiftReviewDecision | null;
  reviewNote: string | null;
  openedByUserId: string;
  openedAt: string;
  closedAt: string | null;
  reviewedAt: string | null;
  movements: CashShiftMovement[];
};

export type CashShiftActionResult = {
  shiftId: string;
  status?: CashShiftStatus;
  expectedCash?: number;
  declaredCash?: number;
  variance?: number;
  decision?: ShiftReviewDecision;
  idempotentReplay?: boolean;
};

export type CashMovementResult = {
  movementId: string;
  shiftId: string;
  movementType: CashMovementType;
  amount: number;
  currency: string;
  expectedCash: number;
  idempotentReplay: boolean;
};

type RegisterRpcRow = {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
};

type CapabilityRpcRow = {
  can_open_shift: boolean;
  can_record_cash_movement: boolean;
  can_record_expense: boolean;
  can_close_shift: boolean;
  can_review_shift: boolean;
};

export async function loadCashRegisters(
  tenantId: string,
  branchId: string,
): Promise<CashRegister[]> {
  if (!tenantId || !branchId) return [];
  const { data, error } = await supabase.rpc('get_sellertray_accessible_registers', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });
  if (error) throw error;
  return ((data ?? []) as RegisterRpcRow[]).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    isDefault: row.is_default === true,
  }));
}

export async function loadCashShiftCapabilities(
  tenantId: string,
  branchId: string,
): Promise<CashShiftCapabilities> {
  if (!tenantId || !branchId) return noCapabilities();
  const { data, error } = await supabase.rpc('get_sellertray_cash_capabilities', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });
  if (error) throw error;
  const row = ((data ?? []) as CapabilityRpcRow[])[0];
  return {
    canOpenShift: row?.can_open_shift === true,
    canRecordCashMovement: row?.can_record_cash_movement === true,
    canRecordExpense: row?.can_record_expense === true,
    canCloseShift: row?.can_close_shift === true,
    canReviewShift: row?.can_review_shift === true,
  };
}

export async function loadCashWriteAccess(tenantId: string): Promise<boolean> {
  if (!tenantId) return false;
  const { data, error } = await supabase.rpc('orderdesk_subscription_can_write', {
    p_tenant_id: tenantId,
  });
  if (error) throw error;
  return data === true;
}

export async function loadActiveCashShift(
  tenantId: string,
  branchId: string,
): Promise<CashShift | null> {
  if (!tenantId || !branchId) return null;
  const { data, error } = await supabase.rpc('get_sellertray_active_cash_shift', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });
  if (error) throw error;
  if (data === null) return null;
  return parseCashShift(data);
}

export async function loadCashShift(
  tenantId: string,
  shiftId: string,
): Promise<CashShift | null> {
  if (!tenantId || !shiftId) return null;
  const { data, error } = await supabase.rpc('get_sellertray_cash_shift', {
    p_tenant_id: tenantId,
    p_shift_id: shiftId,
  });
  if (error) throw error;
  if (data === null) return null;
  return parseCashShift(data);
}

export async function openCashShift(input: {
  tenantId: string;
  branchId: string;
  registerId: string;
  openingCash: number;
}): Promise<CashShiftActionResult> {
  if (!input.tenantId || !input.branchId || !input.registerId) {
    throw new Error('Business, branch and register are required.');
  }
  if (!Number.isFinite(input.openingCash) || input.openingCash < 0) {
    throw new Error('Opening cash cannot be negative.');
  }
  return invokeShift<CashShiftActionResult>({
    action: 'open',
    tenantId: input.tenantId,
    branchId: input.branchId,
    registerId: input.registerId,
    openingCash: input.openingCash,
  }, 'Unable to open this cashier shift.');
}

export async function recordCashMovement(input: {
  tenantId: string;
  shiftId: string;
  movementType: CashMovementType;
  amount: number;
  reference: string;
  reason: string;
  expenseCategory?: string | null;
}): Promise<CashMovementResult> {
  if (!input.tenantId || !input.shiftId) throw new Error('Business and cashier shift are required.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Amount must be greater than zero.');
  if (!input.reference.trim()) throw new Error('Reference is required.');
  if (!input.reason.trim()) throw new Error('Reason is required.');
  if (input.movementType === 'expense' && !input.expenseCategory?.trim()) {
    throw new Error('Expense category is required.');
  }

  return invokeShift<CashMovementResult>({
    action: 'movement',
    tenantId: input.tenantId,
    shiftId: input.shiftId,
    movementType: input.movementType,
    amount: input.amount,
    reference: input.reference.trim(),
    reason: input.reason.trim(),
    expenseCategory: input.movementType === 'expense' ? input.expenseCategory?.trim() : null,
  }, 'Unable to record this cash activity.');
}

export async function closeCashShift(input: {
  tenantId: string;
  shiftId: string;
  declaredCash: number;
  note?: string | null;
}): Promise<CashShiftActionResult> {
  if (!input.tenantId || !input.shiftId) throw new Error('Business and cashier shift are required.');
  if (!Number.isFinite(input.declaredCash) || input.declaredCash < 0) {
    throw new Error('Declared cash cannot be negative.');
  }
  return invokeShift<CashShiftActionResult>({
    action: 'close',
    tenantId: input.tenantId,
    shiftId: input.shiftId,
    declaredCash: input.declaredCash,
    note: input.note?.trim() || null,
  }, 'Unable to close this cashier shift.');
}

export async function reviewCashShift(input: {
  tenantId: string;
  shiftId: string;
  decision: ShiftReviewDecision;
  note?: string | null;
}): Promise<CashShiftActionResult> {
  if (!input.tenantId || !input.shiftId) throw new Error('Business and cashier shift are required.');
  if (input.decision === 'follow_up' && !input.note?.trim()) {
    throw new Error('Enter a note for a shift that needs follow-up.');
  }
  return invokeShift<CashShiftActionResult>({
    action: 'review',
    tenantId: input.tenantId,
    shiftId: input.shiftId,
    decision: input.decision,
    note: input.note?.trim() || null,
  }, 'Unable to review this cashier shift.');
}

async function invokeShift<T extends CashShiftActionResult | CashMovementResult>(
  body: Record<string, unknown>,
  fallback: string,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('cash-shift', { body });
  if (error) throw new Error(await functionErrorMessage(error, fallback));
  if (!data || typeof data !== 'object' || typeof (data as Record<string, unknown>).shiftId !== 'string') {
    throw new Error('SellerTray returned an invalid cashier result.');
  }
  return data as T;
}

function parseCashShift(value: unknown): CashShift {
  if (!value || typeof value !== 'object') throw new Error('SellerTray returned an invalid cashier shift.');
  const row = value as Record<string, unknown>;
  if (typeof row.shiftId !== 'string'
      || typeof row.branchId !== 'string'
      || typeof row.registerId !== 'string'
      || typeof row.registerName !== 'string'
      || (row.status !== 'open' && row.status !== 'closed' && row.status !== 'reviewed')
      || typeof row.currency !== 'string'
      || typeof row.openedByUserId !== 'string'
      || typeof row.openedAt !== 'string'
      || !Array.isArray(row.movements)) {
    throw new Error('SellerTray returned an invalid cashier shift.');
  }

  return {
    shiftId: row.shiftId,
    branchId: row.branchId,
    registerId: row.registerId,
    registerName: row.registerName,
    status: row.status,
    currency: row.currency,
    openingCash: toNumber(row.openingCash),
    cashSales: toNumber(row.cashSales),
    cashRefunds: toNumber(row.cashRefunds),
    cashIn: toNumber(row.cashIn),
    cashOut: toNumber(row.cashOut),
    expenses: toNumber(row.expenses),
    expectedCash: toNumber(row.expectedCash),
    declaredCash: nullableNumber(row.declaredCash),
    variance: nullableNumber(row.variance),
    closeNote: typeof row.closeNote === 'string' ? row.closeNote : null,
    reviewDecision: row.reviewDecision === 'accepted' || row.reviewDecision === 'follow_up'
      ? row.reviewDecision
      : null,
    reviewNote: typeof row.reviewNote === 'string' ? row.reviewNote : null,
    openedByUserId: row.openedByUserId,
    openedAt: row.openedAt,
    closedAt: typeof row.closedAt === 'string' ? row.closedAt : null,
    reviewedAt: typeof row.reviewedAt === 'string' ? row.reviewedAt : null,
    movements: row.movements.map(parseMovement),
  };
}

function parseMovement(value: unknown): CashShiftMovement {
  if (!value || typeof value !== 'object') throw new Error('SellerTray returned an invalid cash activity.');
  const row = value as Record<string, unknown>;
  if (typeof row.movementId !== 'string'
      || (row.movementType !== 'cash_in' && row.movementType !== 'cash_out' && row.movementType !== 'expense')
      || typeof row.currency !== 'string'
      || typeof row.reference !== 'string'
      || typeof row.reason !== 'string'
      || typeof row.actorUserId !== 'string'
      || typeof row.createdAt !== 'string') {
    throw new Error('SellerTray returned an invalid cash activity.');
  }
  return {
    movementId: row.movementId,
    movementType: row.movementType,
    amount: toNumber(row.amount),
    currency: row.currency,
    reference: row.reference,
    reason: row.reason,
    expenseCategory: typeof row.expenseCategory === 'string' ? row.expenseCategory : null,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
  };
}

function noCapabilities(): CashShiftCapabilities {
  return {
    canOpenShift: false,
    canRecordCashMovement: false,
    canRecordExpense: false,
    canCloseShift: false,
    canReviewShift: false,
  };
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  let message = error instanceof Error && error.message ? error.message : fallback;
  if (!error || typeof error !== 'object' || !('context' in error)) return message;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('clone' in context)) return message;
  try {
    const payload = await (context as Response).clone().json() as { error?: string };
    if (payload?.error) message = payload.error;
  } catch {
    // Keep the SDK message.
  }
  return message;
}