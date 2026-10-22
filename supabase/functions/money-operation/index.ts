import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type MoneyAction = 'typed_cash_out' | 'business_expense';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 16_384;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  : null;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!admin) return json({ error: 'Server configuration error' }, 500);

  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json({ error: 'Authentication required' }, 401);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const userId = authData.user?.id ?? null;
  if (authError || !userId) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try {
    body = JSON.parse(bodyRead.text) as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = cleanAction(body.action);
  const tenantId = cleanUuid(body.tenantId);
  if (!action || !tenantId) return json({ error: 'Business and money action are required' }, 400);

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  let rpcName: string;
  let rpcArgs: JsonRecord;

  if (action === 'typed_cash_out') {
    const shiftId = cleanUuid(body.shiftId);
    const cashOutType = body.cashOutType === 'bank_deposit' || body.cashOutType === 'owner_withdrawal'
      ? body.cashOutType
      : null;
    const bankPaymentMethodId = body.bankPaymentMethodId == null ? null : cleanUuid(body.bankPaymentMethodId);
    const amount = cleanPositiveNumber(body.amount);
    const reference = cleanText(body.reference, 160);
    const reason = cleanText(body.reason, 500);
    const commandId = cleanCommandId(body.commandId);
    if (!shiftId || !cashOutType || amount === null || !reference || !reason || !commandId) {
      return json({ error: 'Shift, Cash Out type, amount, reference, reason and retry identity are required' }, 400);
    }
    if (cashOutType === 'bank_deposit' && !bankPaymentMethodId) {
      return json({ error: 'Destination Business bank account is required' }, 400);
    }
    if (cashOutType === 'owner_withdrawal' && bankPaymentMethodId) {
      return json({ error: 'Owner Withdrawal does not use a destination Business bank account' }, 400);
    }
    rpcName = 'record_sellertray_typed_cash_out';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_shift_id: shiftId,
      p_cash_out_type: cashOutType,
      p_bank_payment_method_id: bankPaymentMethodId,
      p_amount: amount,
      p_reference: reference,
      p_reason: reason,
      p_command_id: commandId,
      p_actor_user_id: userId,
    };
  } else {
    const branchId = cleanUuid(body.branchId);
    const fundingSource = body.fundingSource === 'cash' || body.fundingSource === 'bank'
      ? body.fundingSource
      : null;
    const paymentMethodId = body.paymentMethodId == null ? null : cleanUuid(body.paymentMethodId);
    const cashShiftId = body.cashShiftId == null ? null : cleanUuid(body.cashShiftId);
    const expenseCategoryId = body.expenseCategoryId == null ? null : cleanUuid(body.expenseCategoryId);
    let expenseCategory = cleanText(body.expenseCategory, 120);
    const amount = cleanPositiveNumber(body.amount);
    const reference = cleanText(body.reference, 160);
    const reason = cleanText(body.reason, 500);
    const commandId = cleanCommandId(body.commandId);

    if (body.expenseCategoryId != null && !expenseCategoryId) {
      return json({ error: 'Choose a valid Business Expense Category' }, 400);
    }
    if (expenseCategoryId) {
      const { data: category, error: categoryError } = await admin
        .from('sellertray_expense_categories')
        .select('name,is_active')
        .eq('tenant_id', tenantId)
        .eq('id', expenseCategoryId)
        .maybeSingle();
      if (categoryError) return json({ error: categoryError.message }, 400);
      if (!category) return json({ error: 'Selected Expense Category does not belong to this Business' }, 403);
      if (!category.is_active) return json({ error: 'Choose an active Business Expense Category' }, 409);
      expenseCategory = cleanText(category.name, 120);
    }

    if (!branchId || !fundingSource || !expenseCategory || amount === null || !reference || !reason || !commandId) {
      return json({ error: 'Branch, funding source, category, amount, reference, reason and retry identity are required' }, 400);
    }
    if (fundingSource === 'bank' && (!paymentMethodId || cashShiftId)) {
      return json({ error: 'Bank-funded Business Expense requires a Business bank account' }, 400);
    }
    if (fundingSource === 'cash' && (!cashShiftId || paymentMethodId)) {
      return json({ error: 'Cash-funded Business Expense requires an open cash drawer' }, 400);
    }
    rpcName = 'record_sellertray_business_expense';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_funding_source: fundingSource,
      p_payment_method_id: paymentMethodId,
      p_cash_shift_id: cashShiftId,
      p_expense_category: expenseCategory,
      p_amount: amount,
      p_reference: reference,
      p_reason: reason,
      p_command_id: commandId,
      p_actor_user_id: userId,
    };
  }

  const { data: result, error } = await admin.rpc(rpcName, rpcArgs);
  if (error || !isResult(action, result)) {
    const message = error?.message ?? 'SellerTray could not complete this money action';
    const status = /permission|access|role|read-only|authentication|does not belong/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /already|cannot|requires|different facts|choose|invalid|open cash drawer|open shift|inactive expense category/i.test(message)
          ? 409
          : 400;
    return json({ error: message }, status);
  }

  return json({ ok: true, action, ...result });
});

function cleanAction(value: unknown): MoneyAction | null {
  return value === 'typed_cash_out' || value === 'business_expense' ? value : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function cleanCommandId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{7,159}$/.test(clean) ? clean : null;
}

function cleanPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}

function isResult(action: MoneyAction, value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as JsonRecord;
  if (action === 'typed_cash_out') {
    return typeof row.movementId === 'string'
      && typeof row.shiftId === 'string'
      && row.movementType === 'cash_out'
      && (row.cashOutType === 'bank_deposit' || row.cashOutType === 'owner_withdrawal');
  }
  return typeof row.expenseId === 'string'
    && (row.fundingSource === 'cash' || row.fundingSource === 'bank');
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
}

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
