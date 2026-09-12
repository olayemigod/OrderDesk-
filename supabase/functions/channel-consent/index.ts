import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 32768;

const cors = {
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
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!admin) return reply({ error: 'Server configuration error' }, 500);

  const requestId = safeRequestId(request.headers.get('x-request-id'));
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return reply({ error: 'Authentication required' }, 401, requestId);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const userId = authData.user?.id ?? null;
  if (authError || !userId) return reply({ error: 'Authentication required' }, 401, requestId);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return reply({ error: 'Payload too large' }, 413, requestId);

  let body: J;
  try {
    body = JSON.parse(bodyRead.text) as J;
  } catch {
    return reply({ error: 'Invalid JSON' }, 400, requestId);
  }

  const action = cleanText(body.action, 40);
  const tenantId = cleanUuid(body.tenantId);
  if (!action || !tenantId) return reply({ error: 'action and tenantId are required' }, 400, requestId);

  try {
    const { data: membership, error: membershipError } = await admin
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipError) throw membershipError;
    if (!membership) return reply({ error: 'You do not have access to this business' }, 403, requestId);

    if (action === 'status') {
      const { data: policies, error: policiesError } = await admin
        .from('legal_policy_versions')
        .select('policy_key,version,effective_at,summary')
        .eq('is_current', true)
        .in('policy_key', ['terms','privacy','whatsapp_data_processing']);

      if (policiesError) throw policiesError;

      const { data: consent, error: consentError } = await admin
        .from('tenant_channel_consents')
        .select('id,policy_version,document_versions,scopes,accepted_by_user_id,accepted_via,accepted_at')
        .eq('tenant_id', tenantId)
        .eq('channel', 'whatsapp')
        .is('revoked_at', null)
        .maybeSingle();

      if (consentError) throw consentError;

      const current = Object.fromEntries((policies ?? []).map((row) => [row.policy_key, row.version]));
      let termsPrivacyAccepted = false;
      if (typeof current.terms === 'string' && typeof current.privacy === 'string') {
        const { data: acceptance, error: acceptanceError } = await admin
          .from('user_legal_acceptances')
          .select('id')
          .eq('user_id', userId)
          .eq('terms_version', current.terms)
          .eq('privacy_version', current.privacy)
          .limit(1)
          .maybeSingle();

        if (acceptanceError) throw acceptanceError;
        termsPrivacyAccepted = Boolean(acceptance);
      }

      const currentWhatsappVersion = typeof current.whatsapp_data_processing === 'string'
        ? current.whatsapp_data_processing
        : null;
      const consentActive = Boolean(
        consent &&
        currentWhatsappVersion &&
        consent.policy_version === currentWhatsappVersion
      );

      return reply({
        role: membership.role,
        policies: policies ?? [],
        termsPrivacyAccepted,
        consentActive,
        consent,
      }, 200, requestId);
    }

    if (membership.role !== 'owner') {
      return reply({ error: 'Only the business Owner can change WhatsApp data-processing consent' }, 403, requestId);
    }

    if (action === 'accept') {
      const { data: consentId, error } = await admin.rpc('accept_sellertray_whatsapp_consent', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
        p_accepted_via: cleanText(body.acceptedVia, 80) ?? 'sellertray_mobile',
      });
      if (error) throw error;
      return reply({ consentId, consentActive: true }, 200, requestId);
    }

    if (action === 'revoke') {
      const { error } = await admin.rpc('revoke_sellertray_whatsapp_consent', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
        p_reason: cleanText(body.reason, 500),
      });
      if (error) throw error;
      return reply({ ok: true, consentActive: false }, 200, requestId);
    }

    return reply({ error: 'Unsupported consent action' }, 400, requestId);
  } catch (error) {
    const message = sanitizeError(error);
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'channel-consent',
      event: 'request_failed',
      request_id: requestId,
      tenant_id: tenantId,
      action,
      error: message,
    }));

    const status = /Only the business Owner|must be accepted first/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : 400;
    return reply({ error: message }, status, requestId);
  }
});

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}

function safeRequestId(value: string | null): string {
  const clean = value?.trim() ?? '';
  return /^[A-Za-z0-9._:-]{1,128}$/.test(clean) ? clean : crypto.randomUUID();
}

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Consent request failed';
  return raw.replace(/\s+/g, ' ').slice(0, 400);
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
  const parts: string[] = [];
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
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
}

function reply(payload: J, status = 200, requestId?: string): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(requestId ? { 'x-orderdesk-request-id': requestId } : {}),
    },
  });
}
