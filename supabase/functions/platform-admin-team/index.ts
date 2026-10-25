type JsonRecord = Record<string, unknown>;

type AdminTeamAction = 'transfer_ownership';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Server configuration error' }, 500);

  const authorization = request.headers.get('authorization') ?? '';
  const identity = await verifiedIdentity(authorization);
  if (!identity) return json({ error: 'Authentication required' }, 401);
  if (identity.aal !== 'aal2') {
    return json({ error: 'MFA verification is required for ProcessEdge administrator access' }, 403);
  }

  let body: JsonRecord;
  try {
    body = await request.json() as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported platform team action' }, 400);

  const tenantId = cleanUuid(body.tenantId);
  const targetEmail = cleanEmail(body.targetEmail);
  const commandId = cleanUuid(body.commandId);
  const reason = cleanReason(body.reason);

  if (!tenantId) return json({ error: 'A valid Business is required' }, 400);
  if (!targetEmail) return json({ error: 'A valid target email is required' }, 400);
  if (!commandId) return json({ error: 'A command ID is required' }, 400);
  if (!reason) return json({ error: 'A reason is required' }, 400);

  try {
    const result = await rpc<JsonRecord>('platform_admin_transfer_tenant_ownership', {
      p_actor_user_id: identity.userId,
      p_tenant_id: tenantId,
      p_target_email: targetEmail,
      p_reason: reason,
      p_command_id: commandId,
    });
    return json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Platform team request failed';
    const status = /platform admin|administrator|authority/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /already|conflict/i.test(message)
          ? 409
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
    let message = `Platform team RPC failed with HTTP ${response.status}`;
    try {
      const payload = await response.json() as JsonRecord;
      if (typeof payload.message === 'string' && payload.message) message = payload.message;
      else if (typeof payload.error === 'string' && payload.error) message = payload.error;
    } catch {
      // Keep bounded fallback message.
    }
    throw new Error(message);
  }

  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

async function verifiedIdentity(
  authorization: string,
): Promise<{ userId: string; aal: 'aal1' | 'aal2' } | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  if (!token) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization },
  });
  if (!response.ok) return null;

  let user: JsonRecord;
  try {
    user = await response.json() as JsonRecord;
  } catch {
    return null;
  }

  const userId = cleanUuid(user.id);
  const aal = getJwtAal(token);
  return userId && aal ? { userId, aal } : null;
}

function getJwtAal(token: string): 'aal1' | 'aal2' | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as JsonRecord;
    return payload.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return null;
  }
}

function cleanAction(value: unknown): AdminTeamAction | null {
  return value === 'transfer_ownership' ? value : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes('@')) return null;
  return email;
}

function cleanReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 1000 ? reason : null;
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
