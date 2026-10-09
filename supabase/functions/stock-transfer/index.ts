import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type StockTransferAction = 'create' | 'dispatch' | 'receive' | 'cancel';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 49_152;
const MAX_ITEMS = 100;

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
    return json({ error: 'Action and business are required' }, 400);
  }

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  try {
    if (action === 'create') {
      const sourceBranchId = cleanUuid(body.sourceBranchId);
      const destinationBranchId = cleanUuid(body.destinationBranchId);
      const reference = cleanText(body.reference, 160);
      const reason = cleanText(body.reason, 500);
      const items = cleanItems(body.items);

      if (!sourceBranchId || !destinationBranchId || !reference || !reason || !items) {
        return json({ error: 'Source branch, destination branch, reference, reason and items are required' }, 400);
      }
      if (items.length > MAX_ITEMS) {
        return json({ error: `A stock transfer can contain at most ${MAX_ITEMS} products` }, 400);
      }

      const { data, error } = await admin.rpc('create_sellertray_stock_transfer', {
        p_tenant_id: tenantId,
        p_source_branch_id: sourceBranchId,
        p_destination_branch_id: destinationBranchId,
        p_reference: reference,
        p_reason: reason,
        p_items: items,
        p_actor_user_id: userId,
      });
      return rpcResponse(data, error, 'SellerTray could not save this stock transfer');
    }

    const transferId = cleanUuid(body.transferId);
    if (!transferId) return json({ error: 'Stock transfer is required' }, 400);

    if (action === 'dispatch') {
      const { data, error } = await admin.rpc('dispatch_sellertray_stock_transfer', {
        p_tenant_id: tenantId,
        p_stock_transfer_id: transferId,
        p_actor_user_id: userId,
      });
      return rpcResponse(data, error, 'SellerTray could not dispatch this stock transfer');
    }

    if (action === 'receive') {
      const { data, error } = await admin.rpc('receive_sellertray_stock_transfer', {
        p_tenant_id: tenantId,
        p_stock_transfer_id: transferId,
        p_actor_user_id: userId,
      });
      return rpcResponse(data, error, 'SellerTray could not receive this stock transfer');
    }

    const reason = cleanText(body.reason, 500);
    if (!reason) return json({ error: 'Cancellation reason is required' }, 400);
    const { data, error } = await admin.rpc('cancel_sellertray_stock_transfer', {
      p_tenant_id: tenantId,
      p_stock_transfer_id: transferId,
      p_reason: reason,
      p_actor_user_id: userId,
    });
    return rpcResponse(data, error, 'SellerTray could not cancel this stock transfer');
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Stock transfer request failed' }, 400);
  }
});

function rpcResponse(data: unknown, error: { message?: string } | null, fallback: string): Response {
  if (error || !isTransferResult(data)) {
    const message = error?.message ?? fallback;
    const status = /permission|access|role|read-only|authentication/i.test(message)
      ? 403
      : /already used|different facts|not enough|only a|cannot|invalid|unavailable|fractional|different destination|finish or cancel/i.test(message)
        ? 409
        : /not found/i.test(message)
          ? 404
          : 400;
    return json({ error: message }, status);
  }
  return json({ ok: true, ...data });
}

function cleanAction(value: unknown): StockTransferAction | null {
  return value === 'create' || value === 'dispatch' || value === 'receive' || value === 'cancel'
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

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}

function cleanItems(value: unknown): Array<{ catalogItemId: string; uomId: string; quantity: number }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: Array<{ catalogItemId: string; uomId: string; quantity: number }> = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return null;
    const record = row as JsonRecord;
    const catalogItemId = cleanUuid(record.catalogItemId);
    const uomId = cleanUuid(record.uomId);
    const quantity = typeof record.quantity === 'number' ? record.quantity : Number(record.quantity);
    if (!catalogItemId || !uomId || !Number.isFinite(quantity) || quantity <= 0) return null;
    items.push({ catalogItemId, uomId, quantity });
  }
  return items;
}

function isTransferResult(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as JsonRecord;
  return typeof row.transferId === 'string'
    && typeof row.status === 'string'
    && ['draft', 'dispatched', 'received', 'cancelled'].includes(row.status)
    && typeof row.idempotentReplay === 'boolean';
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