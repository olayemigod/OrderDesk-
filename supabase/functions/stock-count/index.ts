import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type StockCountAction = 'start' | 'capture' | 'submit' | 'apply' | 'cancel';

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
    return json({ error: 'Business and stock count action are required' }, 400);
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

  if (action === 'start') {
    const branchId = cleanUuid(body.branchId);
    const reference = cleanText(body.reference, 160);
    const reason = cleanText(body.reason, 500);
    if (!branchId || !reference || !reason) {
      return json({ error: 'Branch, reference and reason are required to start a stock count' }, 400);
    }
    rpcName = 'start_sellertray_stock_count';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_reference: reference,
      p_reason: reason,
      p_actor_user_id: userId,
    };
  } else if (action === 'capture') {
    const countId = cleanUuid(body.countId);
    const productId = cleanUuid(body.productId);
    const uomId = cleanUuid(body.uomId);
    const quantity = cleanNonNegativeNumber(body.quantity);
    if (!countId || !productId || !uomId || quantity === null) {
      return json({ error: 'Stock count, product, unit and quantity are required' }, 400);
    }
    rpcName = 'capture_sellertray_stock_count_item';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_stock_count_id: countId,
      p_catalog_item_id: productId,
      p_uom_id: uomId,
      p_quantity: quantity,
      p_actor_user_id: userId,
    };
  } else if (action === 'cancel') {
    const countId = cleanUuid(body.countId);
    const reason = cleanText(body.reason, 500);
    if (!countId || !reason) {
      return json({ error: 'Stock count and cancellation reason are required' }, 400);
    }
    rpcName = 'cancel_sellertray_stock_count';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_stock_count_id: countId,
      p_reason: reason,
      p_actor_user_id: userId,
    };
  } else {
    const countId = cleanUuid(body.countId);
    if (!countId) return json({ error: 'Stock count is required' }, 400);
    rpcName = action === 'submit'
      ? 'submit_sellertray_stock_count'
      : 'apply_sellertray_stock_count';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_stock_count_id: countId,
      p_actor_user_id: userId,
    };
  }

  const { data: result, error } = await admin.rpc(rpcName, rpcArgs);
  if (error || !isStockCountResult(result)) {
    const message = error?.message ?? 'SellerTray could not complete this stock count action';
    const status = /permission|access|role|read-only|authentication/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /already|finish|cancel|count every|cannot|changed|unavailable|fractional|different facts/i.test(message)
          ? 409
          : 400;
    return json({ error: message }, status);
  }

  return json({ ok: true, ...result });
});

function cleanAction(value: unknown): StockCountAction | null {
  return value === 'start' || value === 'capture' || value === 'submit'
    || value === 'apply' || value === 'cancel'
    ? value
    : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function cleanNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}

function isStockCountResult(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as JsonRecord;
  return typeof row.countId === 'string'
    && (row.status === 'counting' || row.status === 'review'
      || row.status === 'applied' || row.status === 'cancelled');
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