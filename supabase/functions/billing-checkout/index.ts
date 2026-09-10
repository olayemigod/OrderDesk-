type JsonRecord = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(withObservability('billing-checkout', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'Server configuration error' }, 500);
  }
  if (!PAYSTACK_SECRET_KEY) {
    return json({ error: 'Billing provider is not activated yet' }, 503);
  }

  const authorization = request.headers.get('authorization') ?? '';
  const identity = getJwtIdentity(authorization);
  if (!identity.userId || !identity.email) {
    return json({ error: 'Authentication required' }, 401);
  }

  const bodyRead = await readRequestTextLimited(request, 65_536);
  if (!bodyRead.ok) {
    return json({ error: 'Payload too large' }, 413);
  }

  let body: JsonRecord;
  try {
    body = JSON.parse(bodyRead.text) as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const tenantId = cleanUuid(body.tenantId);
  if (!tenantId) return json({ error: 'tenantId is required' }, 400);

  const members = await rest<Array<{ role: string }>>(
    `/rest/v1/tenant_members?select=role&tenant_id=eq.${encodeURIComponent(tenantId)}&user_id=eq.${encodeURIComponent(identity.userId)}&limit=1`,
  );
  if (members[0]?.role !== 'owner') {
    return json({ error: 'Only the business Owner can start or change billing' }, 403);
  }

  const subscriptions = await rest<Array<{ plan_code: string }>>(
    `/rest/v1/tenant_subscriptions?select=plan_code&tenant_id=eq.${encodeURIComponent(tenantId)}&limit=1`,
  );
  const planCode = subscriptions[0]?.plan_code;
  if (!planCode) return json({ error: 'Subscription record not found' }, 404);

  const plans = await rest<Array<{
    code: string;
    name: string;
    currency: string;
    price_amount: number | string | null;
    provider: string | null;
    provider_plan_ref: string | null;
  }>>(
    `/rest/v1/subscription_plans?select=code,name,currency,price_amount,provider,provider_plan_ref&code=eq.${encodeURIComponent(planCode)}&limit=1`,
  );
  const plan = plans[0];
  const priceAmount = toNumber(plan?.price_amount ?? null);

  if (!plan || plan.provider !== 'paystack' || !plan.provider_plan_ref || priceAmount === null || priceAmount <= 0) {
    return json({ error: 'SellerTray Business billing is not activated yet' }, 409);
  }

  const reference = makeReference(tenantId);
  const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: identity.email,
      amount: String(Math.round(priceAmount * 100)),
      currency: plan.currency,
      plan: plan.provider_plan_ref,
      reference,
      metadata: JSON.stringify({
        orderdeskTenantId: tenantId,
        orderdeskPlanCode: plan.code,
        requestedByUserId: identity.userId,
      }),
    }),
  });

  let providerPayload: JsonRecord | null = null;
  try {
    providerPayload = await paystackResponse.json() as JsonRecord;
  } catch {
    providerPayload = null;
  }

  if (!paystackResponse.ok || providerPayload?.status !== true || !isRecord(providerPayload.data)) {
    console.error('Paystack checkout initialization failed', paystackResponse.status);
    return json({ error: 'Unable to start secure checkout' }, 502);
  }

  const authorizationUrl = asString(providerPayload.data.authorization_url);
  const providerReference = asString(providerPayload.data.reference) ?? reference;
  if (!authorizationUrl) return json({ error: 'Billing provider returned no checkout URL' }, 502);

  await rest('/rest/v1/billing_checkout_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      tenant_id: tenantId,
      plan_code: plan.code,
      requested_by_user_id: identity.userId,
      billing_email: identity.email.toLowerCase(),
      provider: 'paystack',
      reference: providerReference,
      authorization_url: authorizationUrl,
      status: 'initialized',
    }),
  });

  return json({ authorizationUrl, reference: providerReference }, 201);
}));

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase REST ${response.status}: ${detail.slice(0, 500)}`);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function getJwtIdentity(authorization: string): { userId: string | null; email: string | null } {
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return { userId: null, email: null };

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as JsonRecord;
    return {
      userId: asString(payload.sub),
      email: asString(payload.email)?.toLowerCase() ?? null,
    };
  } catch {
    return { userId: null, email: null };
  }
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function makeReference(tenantId: string): string {
  const tenant = tenantId.replace(/-/g, '').slice(0, 10);
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `od-${tenant}-${Date.now()}-${random}`;
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
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

type ObservabilityHandler = (request: Request) => Response | Promise<Response>;

function withObservability(service: string, handler: ObservabilityHandler): ObservabilityHandler {
  return async (request: Request) => {
    const requestId = observabilityRequestId(request);
    const startedAt = Date.now();
    const path = observabilityPath(request.url);

    emitObservability('info', {
      service,
      event: 'request_started',
      request_id: requestId,
      method: request.method,
      path,
    });

    try {
      const response = await handler(request);
      const durationMs = Math.max(0, Date.now() - startedAt);
      const level = response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info';

      emitObservability(level, {
        service,
        event: 'request_finished',
        request_id: requestId,
        method: request.method,
        path,
        status: response.status,
        duration_ms: durationMs,
      });

      const headers = new Headers(response.headers);
      headers.set('x-orderdesk-request-id', requestId);
      if (headers.has('access-control-allow-origin')) {
        const existing = headers.get('access-control-expose-headers');
        const exposed = new Set(
          (existing ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        );
        exposed.add('x-orderdesk-request-id');
        headers.set('access-control-expose-headers', [...exposed].join(', '));
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      emitObservability('error', {
        service,
        event: 'request_exception',
        request_id: requestId,
        method: request.method,
        path,
        duration_ms: Math.max(0, Date.now() - startedAt),
        error: sanitizeObservabilityError(error),
      });
      throw error;
    }
  };
}

function observabilityRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id')?.trim() ?? '';
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

function observabilityPath(urlValue: string): string {
  try {
    return new URL(urlValue).pathname;
  } catch {
    return '/';
  }
}

function sanitizeObservabilityError(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { name: 'UnknownError', message: 'Unhandled server error' };

  const message = error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|sb_secret)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);

  return {
    name: error.name || 'Error',
    message: message || 'Unhandled server error',
  };
}

function emitObservability(
  level: 'info' | 'warn' | 'error',
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...fields,
  });

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { ok: false };
    }
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
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be released after cancellation.
    }
  }
}

