type JsonRecord = Record<string, unknown>;
type AdminAction =
  | 'overview'
  | 'audit'
  | 'set_subscription_status'
  | 'extend_trial_days'
  | 'set_whatsapp_status'
  | 'set_support_note';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Server configuration error' }, 500);

  const authorization = request.headers.get('authorization') ?? '';
  const userId = getJwtUserId(authorization);
  if (!userId) return json({ error: 'Authentication required' }, 401);

  let body: JsonRecord;
  try {
    body = await request.json() as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported platform admin action' }, 400);

  try {
    if (action === 'overview') {
      const overview = await rpc<JsonRecord>('platform_admin_overview', {
        p_actor_user_id: userId,
      });
      return json({ overview });
    }

    if (action === 'audit') {
      const tenantId = body.tenantId === null || body.tenantId === undefined
        ? null
        : cleanUuid(body.tenantId);
      if (body.tenantId && !tenantId) return json({ error: 'Invalid tenantId' }, 400);
      const requestedLimit = Number(body.limit ?? 50);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
        : 50;
      const audit = await rpc<JsonRecord>('platform_admin_audit_log', {
        p_actor_user_id: userId,
        p_tenant_id: tenantId,
        p_limit: limit,
      });
      return json({ audit });
    }

    const tenantId = cleanUuid(body.tenantId);
    if (!tenantId) return json({ error: 'tenantId is required' }, 400);

    let value: string | null = null;
    if (action === 'set_subscription_status') {
      value = cleanEnum(body.value, ['trial', 'active', 'past_due', 'grace', 'suspended', 'cancelled']);
      if (!value) return json({ error: 'Unsupported subscription status' }, 400);
    } else if (action === 'extend_trial_days') {
      const days = Number(body.value);
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        return json({ error: 'Trial extension must be between 1 and 90 days' }, 400);
      }
      value = String(days);
    } else if (action === 'set_whatsapp_status') {
      value = cleanEnum(body.value, ['not_connected', 'pending', 'connected', 'error']);
      if (!value) return json({ error: 'Unsupported WhatsApp status' }, 400);
    } else {
      if (body.value !== null && body.value !== undefined && typeof body.value !== 'string') {
        return json({ error: 'Support note must be text' }, 400);
      }
      value = typeof body.value === 'string' ? body.value : null;
      if (value && value.length > 4000) return json({ error: 'Support note is too long' }, 400);
    }

    await rpc<unknown>('platform_admin_mutate_tenant', {
      p_actor_user_id: userId,
      p_tenant_id: tenantId,
      p_action: action,
      p_value: value,
    });

    const overview = await rpc<JsonRecord>('platform_admin_overview', {
      p_actor_user_id: userId,
    });
    return json({ ok: true, overview });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Platform admin request failed';
    const status = /administrator access|required for this action|admin role required/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : 400;
    return json({ error: message }, status);
  }
});

async function rpc<T>(name: string, body: JsonRecord): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Platform admin RPC failed with HTTP ${response.status}`;
    try {
      const payload = await response.json() as JsonRecord;
      if (typeof payload.message === 'string' && payload.message) message = payload.message;
      else if (typeof payload.error === 'string' && payload.error) message = payload.error;
    } catch {
      // keep bounded fallback message
    }
    throw new Error(message);
  }

  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

function getJwtUserId(authorization: string): string | null {
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as JsonRecord;
    return cleanUuid(payload.sub);
  } catch {
    return null;
  }
}

function cleanAction(value: unknown): AdminAction | null {
  const supported: AdminAction[] = [
    'overview',
    'audit',
    'set_subscription_status',
    'extend_trial_days',
    'set_whatsapp_status',
    'set_support_note',
  ];
  return typeof value === 'string' && supported.includes(value as AdminAction)
    ? value as AdminAction
    : null;
}

function cleanEnum(value: unknown, supported: string[]): string | null {
  return typeof value === 'string' && supported.includes(value) ? value : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
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
