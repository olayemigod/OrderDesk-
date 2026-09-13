type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Server configuration error' }, 500);

  const auth = req.headers.get('authorization') || '';
  const userId = await verifiedUser(auth);
  if (!userId) return json({ error: 'Authentication required' }, 401);

  let body: J;
  try { body = await req.json() as J; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const action = body.action === 'confirm_offline' || body.action === 'verify_gateway'
    ? String(body.action)
    : null;
  const tenantId = uuid(body.tenantId);
  const paymentId = uuid(body.paymentId);
  if (!action || !tenantId || !paymentId) {
    return json({ error: 'action, tenantId and paymentId are required' }, 400);
  }

  try {
    const member = await isMember(tenantId, userId);
    if (!member) return json({ error: 'SellerTray tenant membership required' }, 403);

    const userAllowed = await consumeRateLimit('merchant_payment_user', userId, 30, 60);
    const tenantAllowed = userAllowed
      ? await consumeRateLimit('merchant_payment_tenant', tenantId, 90, 60)
      : false;
    if (!userAllowed || !tenantAllowed) {
      return json({ error: 'Too many payment operations. Try again shortly.' }, 429);
    }

    const payment = await loadPayment(tenantId, paymentId);
    if (!payment) return json({ error: 'Payment not found' }, 404);

    if (action === 'confirm_offline') {
      await rpc('confirm_sellertray_offline_payment', {
        p_payment_id: paymentId,
        p_actor_user_id: userId,
        p_note: optional(body.note, 500),
      });
      return json({ ok: true, paymentId, status: 'confirmed' });
    }

    if (payment.provider !== 'paystack' && payment.provider !== 'flutterwave') {
      return json({ error: 'Only gateway payments can be provider-verified' }, 409);
    }

    const runtime = await callRuntime(paymentId);
    return json({
      ok: true,
      paymentId,
      status: runtime.status || payment.status,
      providerStatus: runtime.providerStatus || null,
    });
  } catch (error) {
    const message = error instanceof Error ? sanitize(error.message) : 'Payment operation failed';
    const status = /membership|required|Only offline|not awaiting|read-only/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : 400;
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'merchant-payment-operations',
      event: 'request_failed',
      payment_id: paymentId,
      error: message,
    }));
    return json({ error: message }, status);
  }
});

async function verifiedUser(auth: string): Promise<string | null> {
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    signal: AbortSignal.timeout(8000),
    headers: { apikey: SERVICE_KEY, authorization: auth },
  });
  if (!r.ok) return null;
  try {
    const user = await r.json() as J;
    return typeof user.id === 'string' && user.id ? user.id : null;
  } catch {
    return null;
  }
}

async function isMember(tenantId: string, userId: string): Promise<boolean> {
  const rows = await rest<Array<{ role: string }>>(
    '/rest/v1/tenant_members?select=role&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&user_id=eq.' + encodeURIComponent(userId) + '&limit=1',
  );
  return Boolean(rows[0]?.role);
}

async function loadPayment(tenantId: string, paymentId: string): Promise<J | null> {
  const rows = await rest<J[]>(
    '/rest/v1/order_payments?select=id,tenant_id,provider,method_type,status' +
    '&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&id=eq.' + encodeURIComponent(paymentId) + '&limit=1',
  );
  return rows[0] || null;
}

async function callRuntime(paymentId: string): Promise<J> {
  const r = await fetch(SUPABASE_URL + '/functions/v1/payment-runtime', {
    method: 'POST',
    signal: AbortSignal.timeout(12000),
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: 'verify', paymentId }),
  });
  let payload: J = {};
  try { payload = await r.json() as J; } catch {}
  if (!r.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Provider verification failed');
  }
  return payload;
}

async function consumeRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  return rpc<boolean>('consume_sellertray_rate_limit', {
    p_scope: scope,
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
}

async function rpc<T = unknown>(name: string, body: J): Promise<T> {
  return rest<T>('/rest/v1/rpc/' + encodeURIComponent(name), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(SUPABASE_URL + path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10000),
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error('SellerTray data request failed with HTTP ' + r.status + ': ' + (await r.text()).slice(0, 240));
  const raw = await r.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

function uuid(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const x = v.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x) ? x : null;
}
function optional(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const x = v.trim();
  return x ? x.slice(0, max) : null;
}
function sanitize(v: string): string {
  return v.replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ').slice(0, 300);
}
function json(payload: J, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
