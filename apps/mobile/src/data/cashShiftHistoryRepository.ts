import { supabase } from '../lib/supabase';

export type CashShiftHistoryRow = {
  shiftId: string;
  registerId: string;
  registerName: string;
  status: 'open' | 'closed' | 'reviewed';
  currency: string;
  openingCash: number;
  expectedCash: number | null;
  declaredCash: number | null;
  variance: number | null;
  openedByUserId: string;
  openedAt: string;
  closedAt: string | null;
  reviewDecision: 'accepted' | 'follow_up' | null;
  reviewedAt: string | null;
};

type RpcRow = {
  shift_id: string;
  register_id: string;
  register_name: string;
  status: 'open' | 'closed' | 'reviewed';
  currency: string;
  opening_cash: number | string;
  expected_cash: number | string | null;
  declared_cash: number | string | null;
  variance: number | string | null;
  opened_by_user_id: string;
  opened_at: string;
  closed_at: string | null;
  review_decision: 'accepted' | 'follow_up' | null;
  reviewed_at: string | null;
};

export async function loadCashShiftHistory(
  tenantId: string,
  branchId: string,
  limit = 30,
): Promise<CashShiftHistoryRow[]> {
  if (!tenantId || !branchId) return [];
  const { data, error } = await supabase.rpc('get_sellertray_cash_shift_history', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_limit: Math.min(Math.max(Math.trunc(limit), 1), 100),
  });
  if (error) throw error;
  return ((data ?? []) as RpcRow[]).map((row) => ({
    shiftId: row.shift_id,
    registerId: row.register_id,
    registerName: row.register_name,
    status: row.status,
    currency: row.currency,
    openingCash: toNumber(row.opening_cash) ?? 0,
    expectedCash: toNumber(row.expected_cash),
    declaredCash: toNumber(row.declared_cash),
    variance: toNumber(row.variance),
    openedByUserId: row.opened_by_user_id,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    reviewDecision: row.review_decision,
    reviewedAt: row.reviewed_at,
  }));
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}