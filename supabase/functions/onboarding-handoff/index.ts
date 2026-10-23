import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MERCHANT_WEB_URL = Deno.env.get('SELLERTRAY_MERCHANT_WEB_URL') ?? '';
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!admin || !MERCHANT_WEB_URL) return json({ error: 'SellerTray onboarding handoff is not configured' }, 503);

  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json({ error: 'Authentication required' }, 401);

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData.user;
  if (userError || !user?.id || !user.email) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: Record<string, unknown>;
  try { body = JSON.parse(bodyRead.text) as Record<string, unknown>; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const tenantId = cleanUuid(body.tenantId);
  if (!tenantId) return json({ error: 'Business is required' }, 400);

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) return json({ error: 'Unable to verify SellerTray Business access' }, 400);
  if (!membership || !['owner', 'manager'].includes(String(membership.role))) {
    return json({ error: 'Only the Business Owner or authorised Manager can continue commercial setup' }, 403);
  }

  let merchantBase: URL;
  try {
    merchantBase = new URL(MERCHANT_WEB_URL);
  } catch {
    return json({ error: 'SellerTray onboarding handoff is not configured' }, 503);
  }
  if (merchantBase.protocol !== 'https:' || merchantBase.username || merchantBase.password) {
    return json({ error: 'SellerTray onboarding handoff is not configured' }, 503);
  }

  const redirect = new URL(merchantBase.toString());
  redirect.searchParams.set('business', tenantId);
  redirect.searchParams.set('onboarding', '1');

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
    options: { redirectTo: redirect.toString() },
  });

  const actionLink = linkData.properties?.action_link;
  if (linkError || !actionLink) {
    console.error(JSON.stringify({
      service: 'onboarding-handoff',
      event: 'magic_link_generation_failed',
      user_id: user.id,
      tenant_id: tenantId,
      error: linkError?.message ?? 'missing_action_link',
    }));
    return json({ error: 'Unable to prepare secure Merchant Web access' }, 500);
  }

  return json({ url: actionLink });
});

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(clean)
    ? clean
    : null;
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
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
