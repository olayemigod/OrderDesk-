type JsonRecord = Record<string, unknown>;

type MerchantMessageType = 'update' | 'service' | 'information' | 'promotion';
type Severity = 'info' | 'attention' | 'urgent';
type MerchantRole = 'owner' | 'manager' | 'staff';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 32_768;

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
    return json({ error: 'MFA verification is required for ProcessEdge administrator messaging' }, 403);
  }

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try {
    body = JSON.parse(bodyRead.text) as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const messageType = cleanEnum<MerchantMessageType>(body.messageType, ['update', 'service', 'information', 'promotion']);
  const severity = cleanEnum<Severity>(body.severity, ['info', 'attention', 'urgent']);
  const title = cleanText(body.title, 160);
  const messageBody = cleanText(body.body, 1000);
  const actionLabel = optionalText(body.actionLabel, 60);
  const actionUrl = optionalText(body.actionUrl, 1000);
  const expiresAt = optionalIsoDate(body.expiresAt);
  const tenantIds = optionalUuidArray(body.tenantIds);
  const audienceRoles = optionalEnumArray<MerchantRole>(body.audienceRoles, ['owner', 'manager', 'staff']);
  const requestId = body.requestId === undefined || body.requestId === null
    ? null
    : cleanUuid(body.requestId);

  if (!messageType || !severity || !title || !messageBody) {
    return json({ error: 'messageType, severity, title and body are required' }, 400);
  }
  if (body.requestId !== undefined && body.requestId !== null && !requestId) {
    return json({ error: 'requestId must be a valid UUID' }, 400);
  }
  if (body.tenantIds !== undefined && body.tenantIds !== null && tenantIds === null) {
    return json({ error: 'tenantIds must be a non-empty array of valid tenant IDs' }, 400);
  }
  if (body.audienceRoles !== undefined && body.audienceRoles !== null && audienceRoles === null) {
    return json({ error: 'audienceRoles must contain owner, manager or staff' }, 400);
  }
  if ((actionLabel === null) !== (actionUrl === null)) {
    return json({ error: 'actionLabel and actionUrl must be supplied together' }, 400);
  }
  if (body.expiresAt !== undefined && body.expiresAt !== null && !expiresAt) {
    return json({ error: 'expiresAt must be a valid future timestamp' }, 400);
  }
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return json({ error: 'expiresAt must be in the future' }, 400);
  }

  try {
    const result = await rpc<JsonRecord>('platform_admin_publish_merchant_message', {
      p_actor_user_id: identity.userId,
      p_message_type: messageType,
      p_severity: severity,
      p_title: title,
      p_body: messageBody,
      p_target_tenant_ids: tenantIds,
      p_audience_roles: audienceRoles,
      p_action_label: actionLabel,
      p_action_url: actionUrl,
      p_expires_at: expiresAt,
      p_request_id: requestId,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    const message = sanitize(error instanceof Error ? error.message : 'Unable to publish merchant message');
    const status = /administrator|permission|MFA|required/i.test(message) ? 403 : 400;
    return json({ error: message }, status);
  }
});

async function verifiedIdentity(
  authorization: string,
): Promise<{ userId: string; aal: 'aal1' | 'aal2' } | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  if (!token) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    signal: AbortSignal.timeout(8000),
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

async function rpc<T>(name: string, payload: JsonRecord): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  if (!response.ok) {
    let message = `SellerTray admin message request failed with HTTP ${response.status}`;
    try {
      const parsed = raw ? JSON.parse(raw) as JsonRecord : {};
      if (typeof parsed.message === 'string') message = parsed.message;
      else if (typeof parsed.error === 'string') message = parsed.error;
    } catch {
      // Keep bounded fallback.
    }
    throw new Error(message);
  }

  return (raw ? JSON.parse(raw) : {}) as T;
}

function cleanEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : null;
}

function optionalEnumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) return null;
  const clean = Array.from(new Set(value.filter((entry): entry is T =>
    typeof entry === 'string' && allowed.includes(entry as T),
  )));
  return clean.length === value.length ? clean : null;
}

function optionalUuidArray(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) return null;
  const clean = Array.from(new Set(value.map(cleanUuid).filter((entry): entry is string => Boolean(entry))));
  return clean.length === value.length ? clean : null;
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
  return clean && clean.length <= max ? clean : null;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return cleanText(value, max);
}

function optionalIsoDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
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
  const chunks: string[] = [];
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
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { ok: true, text: chunks.join('') };
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
}

function sanitize(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 400);
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
