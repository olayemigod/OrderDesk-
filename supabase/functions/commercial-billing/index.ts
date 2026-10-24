type JsonRecord = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 16_384;

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
  const userId = await verifiedUserId(authorization);
  if (!userId) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try { body = JSON.parse(bodyRead.text) as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  if (body.action !== 'center') return json({ error: 'Unsupported SellerTray billing action' }, 400);
  const tenantId = cleanUuid(body.tenantId);
  if (!tenantId) return json({ error: 'Business is required' }, 400);

  try {
    const center = await rpc<JsonRecord>('get_sellertray_commercial_billing_center', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
    });
    return json({ ok: true, center });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load SellerTray billing';
    const status = /Owner or Manager|access|required|authori[sz]ed|permission/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
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
    let message = `SellerTray billing RPC failed with HTTP ${response.status}`;
    try {
      const payload = await response.json() as JsonRecord;
      if (typeof payload.message === 'string' && payload.message) message = payload.message;
      else if (typeof payload.error === 'string' && payload.error) message = payload.error;
    } catch { /* keep bounded fallback */ }
    throw new Error(message);
  }
  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

async function verifiedUserId(authorization: string): Promise<string | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization },
  });
  if (!response.ok) return null;
  try {
    const user = await response.json() as JsonRecord;
    return cleanUuid(user.id);
  } catch { return null; }
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
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
