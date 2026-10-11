import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;

type CheckoutResult = {
  orderId: string;
  paymentId: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  inventoryMovementCount: number;
  idempotentReplay: boolean;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 8_192;

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
  const paymentMethod = body.paymentMethod === undefined ? 'cash' : cleanText(body.paymentMethod, 32);

  if (!tenantId || !orderId) return json({ error: 'Business and sale are required' }, 400);
  if (paymentMethod !== 'cash') return json({ error: 'Only cash checkout is available in this SellerTray POS slice' }, 400);

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  const { data: result, error: checkoutError } = await admin.rpc('complete_sellertray_pos_cash_sale', {
    p_tenant_id: tenantId,
    p_order_id: orderId,
    p_actor_user_id: userId,
  });

  if (checkoutError || !isCheckoutResult(result)) {
    const message = checkoutError?.message ?? 'Unable to complete this sale';
    const status = /membership|access|role|read-only/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /insufficient stock/i.test(message)
          ? 409
          : 400;
    return json({ error: message }, status);
  }

  await writeCompletionAudit({
    tenantId,
    orderId,
    userId,
    role: String(membership.role),
    result,
  });

  return json({ ok: true, ...result });
});

async function writeCompletionAudit(input: {
  tenantId: string;
  orderId: string;
  userId: string;
  role: string;
  result: CheckoutResult;
}): Promise<void> {
  if (!admin) return;

  const { data: order } = await admin
    .from('orders')
    .select('customer_id,branch_id,public_order_id,total_amount,currency,status,payment_status,amount_paid,fulfillment_status,fulfillment_method')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.orderId)
    .maybeSingle();

  if (!order) return;

  const { error } = await admin
    .from('commercial_action_ledger')
    .upsert({
      tenant_id: input.tenantId,
      action_key: 'pos-cash-complete:' + input.orderId,
      channel: 'merchant_app',
      customer_id: order.customer_id,
      target_order_id: input.orderId,
      action_type: 'pos_cash_sale_completed',
      risk_class: 'high',
      requested_by: input.role === 'staff' ? 'staff' : 'merchant',
      actor_user_id: input.userId,
      policy_result: 'allowed',
      action_status: 'applied',
      financial_impact: numberOrNull(order.amount_paid ?? order.total_amount),
      currency: typeof order.currency === 'string' ? order.currency : null,
      before_state: { status: 'draft', payment_status: 'unpaid' },
      after_state: {
        public_order_id: order.public_order_id,
        status: order.status,
        payment_status: order.payment_status,
        amount_paid: order.amount_paid,
        fulfillment_status: order.fulfillment_status,
        fulfillment_method: order.fulfillment_method,
        branch_id: order.branch_id,
      },
      metadata: {
        payment_method: 'cash',
        payment_id: input.result.paymentId,
        inventory_movement_count: input.result.inventoryMovementCount,
        idempotent_replay: input.result.idempotentReplay,
      },
      applied_at: new Date().toISOString(),
    }, {
      onConflict: 'tenant_id,action_key',
      ignoreDuplicates: true,
    });

  if (error) console.warn('SellerTray POS completion audit write failed', error.message);
}

function isCheckoutResult(value: unknown): value is CheckoutResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as JsonRecord;
  return typeof row.orderId === 'string'
    && typeof row.paymentId === 'string'
    && row.status === 'completed'
    && row.paymentStatus === 'paid'
    && row.fulfillmentStatus === 'collected'
    && typeof row.inventoryMovementCount === 'number'
    && typeof row.idempotentReplay === 'boolean';
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

function numberOrNull(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
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
