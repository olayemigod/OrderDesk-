import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type PosAction = 'void' | 'return' | 'delete_draft';
type ReturnItem = { orderItemId: string; quantity: number };
type RefundSource = 'cash' | 'bank';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 32_768;

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

  const tenantId = cleanUuid(body.tenantId);
  const orderId = cleanUuid(body.orderId);
  const action = cleanAction(body.action);
  const reason = cleanText(body.reason, 500);

  if (!tenantId || !orderId || !action || !reason) {
    return json({ error: 'Business, sale, action and reason are required' }, 400);
  }

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  const commandId = action === 'void' ? null : cleanCommandId(body.commandId);
  if (action !== 'void' && !commandId) {
    return json({ error: 'Retry identity is required for this action' }, 400);
  }

  let rpc: string;
  let rpcArgs: JsonRecord;

  if (action === 'void') {
    rpc = 'void_sellertray_pos_draft';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_actor_user_id: userId,
      p_reason: reason,
    };
  } else if (action === 'delete_draft') {
    rpc = 'delete_sellertray_pos_draft';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_actor_user_id: userId,
      p_reason: reason,
      p_command_id: commandId,
    };
  } else {
    const items = cleanReturnItems(body.items);
    if (!items) return json({ error: 'Choose at least one valid item quantity to return' }, 400);
    const refundSource = cleanRefundSource(body.refundSource);
    const refundPaymentMethodId = body.refundPaymentMethodId == null
      ? null
      : cleanUuid(body.refundPaymentMethodId);
    if (body.refundPaymentMethodId != null && !refundPaymentMethodId) {
      return json({ error: 'Choose a valid Business bank account for this refund' }, 400);
    }
    if (refundSource === 'cash' && refundPaymentMethodId) {
      return json({ error: 'Cash refund does not use a Business bank account' }, 400);
    }
    if (refundSource === 'bank' && !refundPaymentMethodId) {
      return json({ error: 'Choose a Business bank account for this refund' }, 400);
    }
    rpc = 'return_sellertray_pos_sale';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_actor_user_id: userId,
      p_reason: reason,
      p_items: items,
      p_command_id: commandId,
      p_refund_source: refundSource,
      p_refund_payment_method_id: refundPaymentMethodId,
    };
  }

  const { data: result, error } = await admin.rpc(rpc, rpcArgs);

  if (error || !isResult(action, result)) {
    const message = error?.message ?? `Unable to ${actionLabel(action)} this sale`;
    const status = /membership|access|role|read-only|permission|only the business owner or manager/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /cannot|only|already|incomplete|does not match|open a cashier shift|drawer|exceeds|remaining|choose cash|choose a business bank/i.test(message)
          ? 409
          : 400;
    return json({ error: message }, status);
  }

  return json({ ok: true, action, ...result });
});

function cleanAction(value: unknown): PosAction | null {
  return value === 'void' || value === 'return' || value === 'delete_draft' ? value : null;
}

function cleanRefundSource(value: unknown): RefundSource | null {
  return value === 'cash' || value === 'bank' ? value : null;
}

function cleanReturnItems(value: unknown): ReturnItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const seen = new Set<string>();
  const items: ReturnItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const row = entry as JsonRecord;
    const orderItemId = cleanUuid(row.orderItemId);
    const quantity = typeof row.quantity === 'number' ? row.quantity : Number(row.quantity);
    if (!orderItemId || !Number.isFinite(quantity) || quantity <= 0 || seen.has(orderItemId)) return null;
    seen.add(orderItemId);
    items.push({ orderItemId, quantity });
  }
  return items;
}

function cleanCommandId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (clean.length < 8 || clean.length > 160) return null;
  return /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(clean) ? clean : null;
}

function isResult(action: PosAction, value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as JsonRecord;
  if (typeof row.orderId !== 'string' || typeof row.idempotentReplay !== 'boolean') return false;
  if (action === 'void') return row.status === 'cancelled';
  if (action === 'delete_draft') return row.deleted === true && typeof row.deletedAt === 'string';
  const refundedAmount = numberOrNull(row.refundedAmount);
  return (row.returnStatus === 'partial' || row.returnStatus === 'returned')
    && typeof row.returnId === 'string'
    && (row.refundId === null || typeof row.refundId === 'string')
    && refundedAmount !== null
    && typeof numberOrNull(row.returnedValue) === 'number'
    && typeof numberOrNull(row.receivableReductionAmount) === 'number'
    && typeof numberOrNull(row.outstandingAfter) === 'number';
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function actionLabel(action: PosAction): string {
  if (action === 'delete_draft') return 'delete';
  return action;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
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
