import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action = 'start_delivery' | 'complete_fulfillment';
type FulfillmentMethod = 'customer_pickup' | 'merchant_delivery' | 'third_party_delivery';

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

Deno.serve(withObservability('order-fulfillment', async (request) => {
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
  const orderId = cleanUuid(body.orderId);
  const method = cleanMethod(body.method);
  const provider = cleanOptionalText(body.provider, 120);
  const reference = cleanOptionalText(body.reference, 120);
  const note = cleanOptionalText(body.note, 300);

  if (!action || !orderId || !method) {
    return json({ error: 'action, orderId and method are required' }, 400);
  }

  // Resolve only the immutable tenant key here. The database command below is
  // the single authority for membership, capability, Branch, payment policy,
  // state transition, audit and idempotent fulfillment behavior.
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('tenant_id')
    .eq('id', orderId)
    .maybeSingle();

  if (orderError) return json({ error: 'Unable to load order' }, 400);
  if (!order?.tenant_id) return json({ error: 'Order not found' }, 404);

  const { data, error } = await admin.rpc('apply_sellertray_order_fulfillment', {
    p_tenant_id: String(order.tenant_id),
    p_order_id: orderId,
    p_actor_user_id: userId,
    p_action: action,
    p_method: method,
    p_provider: provider,
    p_reference: reference,
    p_note: note,
  });

  if (error) {
    const message = error.message || 'SellerTray could not update fulfillment.';
    const status = error.code === '42501'
      ? 403
      : error.code === 'P0002'
        ? 404
        : error.code === '23514'
          ? 409
          : 400;
    return json({ error: message }, status);
  }

  if (!data || typeof data !== 'object') {
    return json({ error: 'SellerTray returned an invalid fulfillment result.' }, 500);
  }

  return json(data as JsonRecord, 200);
}));

function cleanAction(value: unknown): Action | null {
  return value === 'start_delivery' || value === 'complete_fulfillment' ? value : null;
}

function cleanMethod(value: unknown): FulfillmentMethod | null {
  return value === 'customer_pickup' || value === 'merchant_delivery' || value === 'third_party_delivery'
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

function cleanOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, maxLength) : null;
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) return { ok: false };
  }
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
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
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

type ObservabilityHandler = (request: Request) => Response | Promise<Response>;

function withObservability(service: string, handler: ObservabilityHandler): ObservabilityHandler {
  return async (request: Request) => {
    const requestId = request.headers.get('x-request-id')?.trim() || crypto.randomUUID();
    const startedAt = Date.now();
    try {
      const response = await handler(request);
      console.info(JSON.stringify({
        ts: new Date().toISOString(),
        level: response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info',
        service,
        event: 'request_finished',
        request_id: requestId,
        status: response.status,
        duration_ms: Math.max(0, Date.now() - startedAt),
      }));
      const headers = new Headers(response.headers);
      headers.set('x-orderdesk-request-id', requestId);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        service,
        event: 'request_exception',
        request_id: requestId,
        duration_ms: Math.max(0, Date.now() - startedAt),
        error: error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 300) : 'Unhandled server error',
      }));
      throw error;
    }
  };
}
