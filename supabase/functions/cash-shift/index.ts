import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type CashShiftAction = 'open' | 'movement' | 'correct' | 'close' | 'review';

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
  if (!action || !tenantId) {
    return json({ error: 'Business and cashier action are required' }, 400);
  }

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
  let responseShiftId: string | null = null;

  if (action === 'open') {
    const branchId = cleanUuid(body.branchId);
    const registerId = cleanUuid(body.registerId);
    const openingCash = cleanNonNegativeNumber(body.openingCash);
    if (!branchId || !registerId || openingCash === null) {
      return json({ error: 'Branch, register and opening cash are required' }, 400);
    }
    rpcName = 'open_sellertray_cash_shift';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_register_id: registerId,
      p_opening_cash: openingCash,
      p_actor_user_id: userId,
    };
  } else if (action === 'movement') {
    const shiftId = cleanUuid(body.shiftId);
    const movementType = cleanMovementType(body.movementType);
    const amount = cleanPositiveNumber(body.amount);
    const reference = cleanText(body.reference, 160);
    const reason = cleanText(body.reason, 500);
    const expenseCategoryId = body.expenseCategoryId == null ? null : cleanUuid(body.expenseCategoryId);
    const commandId = cleanCommandId(body.commandId);
    if (!shiftId || !movementType || amount === null || !reference || !reason || !commandId) {
      return json({ error: 'Shift, cash activity, amount, reference and reason are required' }, 400);
    }
    if (movementType === 'expense' && !expenseCategoryId) {
      return json({ error: 'Expense Category is required' }, 400);
    }
    if (movementType !== 'expense' && expenseCategoryId) {
      return json({ error: 'Expense Category applies only to Expense cash activity' }, 400);
    }
    rpcName = 'record_sellertray_shift_cash_movement';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_shift_id: shiftId,
      p_movement_type: movementType,
      p_amount: amount,
      p_reference: reference,
      p_reason: reason,
      p_expense_category_id: movementType === 'expense' ? expenseCategoryId : null,
      p_command_id: commandId,
      p_actor_user_id: userId,
    };
  } else if (action === 'correct') {
    const shiftId = cleanUuid(body.shiftId);
    const movementId = cleanUuid(body.movementId);
    const correctionKind = body.correctionKind === 'replace' || body.correctionKind === 'remove'
      ? body.correctionKind
      : null;
    const correctionReason = cleanText(body.correctionReason, 500);
    const commandId = cleanCommandId(body.commandId);
    if (!shiftId || !movementId || !correctionKind || !correctionReason || !commandId) {
      return json({ error: 'Shift, cash activity, correction action, reason and retry identity are required' }, 400);
    }

    const replacementType = correctionKind === 'replace' ? cleanMovementType(body.replacementType) : null;
    const replacementAmount = correctionKind === 'replace' ? cleanPositiveNumber(body.replacementAmount) : null;
    const replacementReference = correctionKind === 'replace' ? cleanText(body.replacementReference, 160) : null;
    const replacementReason = correctionKind === 'replace' ? cleanText(body.replacementReason, 500) : null;
    const replacementExpenseCategoryId = correctionKind === 'replace' && body.replacementExpenseCategoryId != null
      ? cleanUuid(body.replacementExpenseCategoryId)
      : null;
    if (correctionKind === 'replace'
      && (!replacementType || replacementAmount === null || !replacementReference || !replacementReason)) {
      return json({ error: 'Replacement cash activity, amount, reference and reason are required' }, 400);
    }
    if (replacementType === 'expense' && !replacementExpenseCategoryId) {
      return json({ error: 'Expense Category is required' }, 400);
    }
    if (replacementType !== 'expense' && replacementExpenseCategoryId) {
      return json({ error: 'Replacement Expense Category applies only to an Expense replacement' }, 400);
    }

    responseShiftId = shiftId;
    rpcName = 'correct_sellertray_shift_cash_movement';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_shift_id: shiftId,
      p_movement_id: movementId,
      p_correction_kind: correctionKind,
      p_correction_reason: correctionReason,
      p_command_id: commandId,
      p_replacement_type: replacementType,
      p_replacement_amount: replacementAmount,
      p_replacement_reference: replacementReference,
      p_replacement_reason: replacementReason,
      p_replacement_expense_category_id: replacementType === 'expense' ? replacementExpenseCategoryId : null,
      p_actor_user_id: userId,
    };
  } else if (action === 'close') {
    const shiftId = cleanUuid(body.shiftId);
    const declaredCash = cleanNonNegativeNumber(body.declaredCash);
    const note = cleanText(body.note, 500);
    if (!shiftId || declaredCash === null) {
      return json({ error: 'Shift and declared cash are required' }, 400);
    }
    rpcName = 'close_sellertray_cash_shift';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_shift_id: shiftId,
      p_declared_cash: declaredCash,
      p_note: note,
      p_actor_user_id: userId,
    };
  } else {
    const shiftId = cleanUuid(body.shiftId);
    const decision = body.decision === 'accepted' || body.decision === 'follow_up'
      ? body.decision
      : null;
    const note = cleanText(body.note, 500);
    if (!shiftId || !decision) {
      return json({ error: 'Shift and review decision are required' }, 400);
    }
    if (decision === 'follow_up' && !note) {
      return json({ error: 'Enter a note for a shift that needs follow-up' }, 400);
    }
    rpcName = 'review_sellertray_cash_shift';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_shift_id: shiftId,
      p_decision: decision,
      p_note: note,
      p_actor_user_id: userId,
    };
  }

  const { data: result, error } = await admin.rpc(rpcName, rpcArgs);
  if (error || !isResult(action, result)) {
    const message = error?.message ?? 'SellerTray could not complete this cashier action';
    const status = /permission|access|role|read-only|authentication/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /already|open shift|cannot|close|variance|different facts|unavailable|invalid|corrected|choose/i.test(message)
          ? 409
          : 400;
    return json({ error: message }, status);
  }

  return json({ ok: true, action, ...(responseShiftId ? { shiftId: responseShiftId } : {}), ...result });
});

function cleanAction(value: unknown): CashShiftAction | null {
  return value === 'open' || value === 'movement' || value === 'correct' || value === 'close' || value === 'review'
    ? value
    : null;
}

function cleanMovementType(value: unknown): 'cash_in' | 'cash_out' | 'expense' | null {
  return value === 'cash_in' || value === 'cash_out' || value === 'expense' ? value : null;
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

function cleanNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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

function isResult(action: CashShiftAction, value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as JsonRecord;
  if (action === 'movement') {
    return typeof row.movementId === 'string'
      && typeof row.shiftId === 'string'
      && (row.movementType === 'cash_in' || row.movementType === 'cash_out' || row.movementType === 'expense');
  }
  if (action === 'correct') {
    return typeof row.correctionId === 'string'
      && typeof row.movementId === 'string'
      && (row.correctionKind === 'replace' || row.correctionKind === 'remove');
  }
  if (typeof row.shiftId !== 'string') return false;
  if (action === 'open') return row.status === 'open';
  if (action === 'close') return row.status === 'closed' || row.status === 'reviewed';
  return row.status === 'reviewed';
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
