type JsonRecord = Record<string, unknown>;
type PortfolioAction = 'installments' | 'agreements';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 32_768;

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
  const identity = await verifiedIdentity(authorization);
  if (!identity) return json({ error: 'Authentication required' }, 401);
  if (identity.aal !== 'aal2') {
    return json({ error: 'MFA verification is required for ProcessEdge administrator access' }, 403);
  }

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try { body = JSON.parse(bodyRead.text) as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported commercial portfolio action' }, 400);

  const search = cleanOptionalText(body.search, 120);
  if (search === undefined) return json({ error: 'Commercial portfolio search must be text up to 120 characters' }, 400);
  const requestedLimit = Number(body.limit ?? 20);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
    return json({ error: 'Commercial portfolio page size must be between 1 and 50' }, 400);
  }

  const beforeId = body.beforeId === null || body.beforeId === undefined ? null : cleanUuid(body.beforeId);
  if (body.beforeId !== null && body.beforeId !== undefined && !beforeId) {
    return json({ error: 'Invalid commercial portfolio cursor' }, 400);
  }

  try {
    if (action === 'installments') {
      const filter = cleanEnum(body.filter ?? 'open', ['all', 'open', 'awaiting_first_payment', 'in_progress', 'settled']);
      if (!filter) return json({ error: 'Unsupported installment portfolio filter' }, 400);
      const beforeCreatedAt = cleanOptionalTimestamp(body.beforeCreatedAt);
      if (beforeCreatedAt === undefined) return json({ error: 'Invalid installment portfolio cursor' }, 400);
      if ((beforeCreatedAt === null) !== (beforeId === null)) return json({ error: 'Installment portfolio cursor is incomplete' }, 400);

      const portfolio = await rpc<JsonRecord>('platform_admin_commercial_installment_portfolio', {
        p_actor_user_id: identity.userId,
        p_search: search,
        p_filter: filter,
        p_before_created_at: beforeCreatedAt,
        p_before_id: beforeId,
        p_limit: requestedLimit,
      });
      return json({ portfolio });
    }

    const filter = cleanEnum(body.filter ?? 'awaiting_acceptance', ['all', 'awaiting_acceptance', 'accepted', 'replaced']);
    if (!filter) return json({ error: 'Unsupported agreement portfolio filter' }, 400);
    const beforeIssuedAt = cleanOptionalTimestamp(body.beforeIssuedAt);
    if (beforeIssuedAt === undefined) return json({ error: 'Invalid agreement portfolio cursor' }, 400);
    if ((beforeIssuedAt === null) !== (beforeId === null)) return json({ error: 'Agreement portfolio cursor is incomplete' }, 400);

    const portfolio = await rpc<JsonRecord>('platform_admin_commercial_agreement_portfolio', {
      p_actor_user_id: identity.userId,
      p_search: search,
      p_filter: filter,
      p_before_issued_at: beforeIssuedAt,
      p_before_id: beforeId,
      p_limit: requestedLimit,
    });
    return json({ portfolio });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Commercial portfolio request failed';
    const status = /administrator access|required|authori[sz]ed/i.test(message) ? 403 : 400;
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
    let message = `Commercial portfolio RPC failed with HTTP ${response.status}`;
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

async function verifiedIdentity(authorization: string): Promise<{ userId: string; aal: 'aal1' | 'aal2' } | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  if (!token) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization },
  });
  if (!response.ok) return null;

  let user: JsonRecord;
  try { user = await response.json() as JsonRecord; }
  catch { return null; }

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

function cleanAction(value: unknown): PortfolioAction | null {
  return value === 'installments' || value === 'agreements' ? value : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}

function cleanOptionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length <= max ? clean || null : undefined;
}

function cleanOptionalTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function cleanEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : null;
}

async function readRequestTextLimited(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
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
      if (total > maxBytes) { await reader.cancel(); return { ok: false }; }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
