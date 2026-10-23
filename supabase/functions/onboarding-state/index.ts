import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;

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
  const userId = cleanUuid(authData.user?.id);
  if (authError || !userId) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try { body = bodyRead.text ? JSON.parse(bodyRead.text) as JsonRecord : {}; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const tenantId = cleanUuid(body.tenantId);
  if (!tenantId) return json({ error: 'Business is required' }, 400);

  try {
    const { data, error } = await admin.rpc('get_sellertray_onboarding_state', {
      p_actor_user_id: userId,
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    if (!isRecord(data)) throw new Error('SellerTray onboarding state is unavailable');

    // SellerTray Admin is an AAL2-only portal. Merchant reads use their normal
    // authenticated SellerTray session and remain tenant-member scoped by SQL.
    if (data.actorKind === 'platform_admin' && getJwtAal(token) !== 'aal2') {
      return json({ error: 'MFA verification is required for ProcessEdge administrator access' }, 403);
    }

    return json({ ok: true, state: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load SellerTray onboarding state';
    const status = /access required|administrator access|mfa verification/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : 400;
    return json({ error: message }, status);
  }
});

async function readRequestTextLimited(request: Request,maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return { ok: false };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false };
  return { ok: true, text };
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate) ? candidate : null;
}

function getJwtAal(token: string): 'aal1' | 'aal2' | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as JsonRecord;
    return payload.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch { return null; }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function json(payload: unknown,status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
  });
}
