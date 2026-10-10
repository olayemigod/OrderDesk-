import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type J = Record<string, unknown>;

type MetaPhone = {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const META_APP_ID = Deno.env.get('META_APP_ID')?.trim() ?? '';
const META_APP_SECRET = Deno.env.get('META_APP_SECRET')?.trim() ?? '';
const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION')?.trim() || 'v26.0';
const META_EMBEDDED_SIGNUP_REDIRECT_URI = Deno.env.get('META_EMBEDDED_SIGNUP_REDIRECT_URI')?.trim() ?? '';
const WHATSAPP_ENCRYPTION_KEY = Deno.env.get('SELLERTRAY_WHATSAPP_ENCRYPTION_KEY')?.trim() ?? '';
const enc = new TextEncoder();

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
  if (!admin || !META_APP_ID || !META_APP_SECRET || !WHATSAPP_ENCRYPTION_KEY) {
    return reply({ error: 'SellerTray Meta coexistence onboarding is not fully configured' }, 503);
  }

  const requestId = safeRequestId(request.headers.get('x-request-id'));
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return reply({ error: 'Authentication required' }, 401, requestId);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const userId = authData.user?.id ?? null;
  if (authError || !userId) return reply({ error: 'Authentication required' }, 401, requestId);

  const raw = await readRequestTextLimited(request, 65_536);
  if (raw === null) return reply({ error: 'Payload too large' }, 413, requestId);

  let body: J;
  try {
    body = JSON.parse(raw) as J;
  } catch {
    return reply({ error: 'Invalid JSON' }, 400, requestId);
  }

  const tenantId = uuid(body.tenantId);
  const authorizationCode = secret(body.authorizationCode, 4096);
  const wabaId = metaId(body.wabaId);
  const metaBusinessId = optionalMetaId(body.metaBusinessId);

  if (!tenantId || !authorizationCode || !wabaId) {
    return reply({ error: 'tenantId, authorizationCode and wabaId are required' }, 400, requestId);
  }

  try {
    const { data: membership, error: membershipError } = await admin
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (membership?.role !== 'owner') {
      return reply({ error: 'Only the business Owner can connect WhatsApp' }, 403, requestId);
    }

    const accessToken = await exchangeAuthorizationCode(authorizationCode);
    const tokenInfo = await inspectAccessToken(accessToken);
    const phone = await resolveSingleAuthorizedPhone(accessToken, wabaId);
    await subscribeAppToWaba(accessToken, wabaId);

    const encrypted = await encrypt({ accessToken });
    const fingerprint = await fingerprintOf(accessToken);

    const { error: upsertError } = await admin.rpc('upsert_sellertray_whatsapp_connection', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
      p_meta_business_id: metaBusinessId,
      p_waba_id: wabaId,
      p_phone_number_id: phone.id,
      p_display_phone_number: phone.displayPhoneNumber,
      p_verified_name: phone.verifiedName,
      p_onboarding_method: 'coexistence',
      p_credential_mode: 'business_integration_system_user',
      p_webhook_subscription_status: 'subscribed',
      p_credentials_ciphertext: encrypted.ciphertext,
      p_credentials_iv: encrypted.iv,
      p_credential_fingerprint: fingerprint,
      p_encryption_key_version: 1,
      p_credential_expires_at: tokenInfo.expiresAt,
    });
    if (upsertError) throw upsertError;

    const { error: scopesError } = await admin.rpc('set_sellertray_whatsapp_granted_scopes', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
      p_scopes: tokenInfo.scopes,
    });
    if (scopesError) throw scopesError;

    console.info(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'whatsapp-coexistence-connect',
      event: 'coexistence_signup_completed',
      request_id: requestId,
      tenant_id: tenantId,
      waba_id: wabaId,
      phone_number_id: phone.id,
      credential_fingerprint: fingerprint,
    }));

    return await loadConnectionStatus(authorization, tenantId, requestId);
  } catch (error) {
    const message = sanitizeError(error);
    const status = /Only the business Owner|membership|read-only/i.test(message)
      ? 403
      : /already connected|unique|more than one authorized WhatsApp phone number|exactly one/i.test(message)
        ? 409
        : /not found|not accessible|did not return/i.test(message)
          ? 404
          : /not fully configured|encryption key/i.test(message)
            ? 503
            : 400;

    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'whatsapp-coexistence-connect',
      event: 'request_failed',
      request_id: requestId,
      tenant_id: tenantId,
      error: message,
    }));
    return reply({ error: message }, status, requestId);
  }
});

async function exchangeAuthorizationCode(code: string): Promise<string> {
  const url = new URL(
    'https://graph.facebook.com/' + encodeURIComponent(META_GRAPH_API_VERSION) + '/oauth/access_token',
  );
  url.searchParams.set('client_id', META_APP_ID);
  url.searchParams.set('client_secret', META_APP_SECRET);
  url.searchParams.set('code', code);
  if (META_EMBEDDED_SIGNUP_REDIRECT_URI) {
    url.searchParams.set('redirect_uri', META_EMBEDDED_SIGNUP_REDIRECT_URI);
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(metaError(payload, 'Meta authorization-code exchange failed'));
  const accessToken = isRecord(payload) && typeof payload.access_token === 'string'
    ? payload.access_token.trim()
    : '';
  if (!accessToken) throw new Error('Meta authorization-code exchange returned no access token');
  return accessToken;
}

async function inspectAccessToken(
  accessToken: string,
): Promise<{ expiresAt: string | null; scopes: string[] }> {
  const url = new URL(
    'https://graph.facebook.com/' + encodeURIComponent(META_GRAPH_API_VERSION) + '/debug_token',
  );
  url.searchParams.set('input_token', accessToken);

  const response = await fetch(url, {
    headers: { authorization: 'Bearer ' + META_APP_ID + '|' + META_APP_SECRET },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await safeJson(response);
  if (!response.ok || !isRecord(payload) || !isRecord(payload.data)) {
    throw new Error(metaError(payload, 'Unable to validate the Meta business integration token'));
  }

  const data = payload.data;
  if (data.is_valid !== true) throw new Error('Meta business integration token is not valid');
  if (String(data.app_id ?? '') !== META_APP_ID) {
    throw new Error('Meta business integration token was issued for a different application');
  }

  const scopes = Array.isArray(data.scopes)
    ? data.scopes.filter((value): value is string => typeof value === 'string')
    : [];
  for (const required of ['whatsapp_business_management', 'whatsapp_business_messaging']) {
    if (!scopes.includes(required)) {
      throw new Error('Meta business integration token is missing required WhatsApp permissions');
    }
  }

  const expiresAtSeconds = typeof data.expires_at === 'number'
    ? data.expires_at
    : Number(data.expires_at ?? 0);
  const expiresAt = Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
    ? new Date(expiresAtSeconds * 1000).toISOString()
    : null;

  return {
    expiresAt,
    scopes: [...new Set(scopes.map((scope) => scope.trim().toLocaleLowerCase()).filter(Boolean))].sort(),
  };
}

async function resolveSingleAuthorizedPhone(accessToken: string, wabaId: string): Promise<MetaPhone> {
  const url = new URL(
    'https://graph.facebook.com/' + encodeURIComponent(META_GRAPH_API_VERSION) +
      '/' + encodeURIComponent(wabaId) + '/phone_numbers',
  );
  url.searchParams.set('fields', 'id,display_phone_number,verified_name,status');
  url.searchParams.set('limit', '100');

  const response = await fetch(url, {
    headers: { authorization: 'Bearer ' + accessToken },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(metaError(payload, 'Unable to read the authorized WABA phone numbers'));
  }

  const phones = isRecord(payload) && Array.isArray(payload.data)
    ? payload.data.filter(isRecord).flatMap((row) => {
        const id = typeof row.id === 'string' && /^[0-9]{5,40}$/.test(row.id) ? row.id : null;
        if (!id) return [];
        return [{
          id,
          displayPhoneNumber: typeof row.display_phone_number === 'string' ? row.display_phone_number : null,
          verifiedName: typeof row.verified_name === 'string' ? row.verified_name : null,
        } satisfies MetaPhone];
      })
    : [];

  if (phones.length === 0) {
    throw new Error('Meta did not return an authorized WhatsApp phone number for this WABA');
  }
  if (phones.length !== 1) {
    throw new Error('Meta returned more than one authorized WhatsApp phone number. Reconnect and select the exact number so SellerTray cannot guess.');
  }
  return phones[0];
}

async function subscribeAppToWaba(accessToken: string, wabaId: string): Promise<void> {
  const response = await fetch(
    'https://graph.facebook.com/' + encodeURIComponent(META_GRAPH_API_VERSION) +
      '/' + encodeURIComponent(wabaId) + '/subscribed_apps',
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + accessToken },
      signal: AbortSignal.timeout(12000),
    },
  );
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(metaError(payload, 'Unable to subscribe SellerTray to the merchant WABA'));
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error('Meta did not confirm the SellerTray WABA webhook subscription');
  }
}

async function encrypt(value: J): Promise<{ ciphertext: string; iv: string }> {
  const keyBytes = fromBase64(WHATSAPP_ENCRYPTION_KEY);
  if (keyBytes.byteLength !== 32) throw new Error('SellerTray WhatsApp encryption key is invalid');
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return { ciphertext: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) };
}

async function fingerprintOf(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)));
  return Array.from(digest.slice(0, 6), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function loadConnectionStatus(
  authorization: string,
  tenantId: string,
  requestId: string,
): Promise<Response> {
  const response = await fetch(SUPABASE_URL + '/functions/v1/whatsapp-connection', {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization,
      'content-type': 'application/json',
      'x-request-id': requestId,
    },
    body: JSON.stringify({ action: 'status', tenantId }),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await safeJson(response);
  if (!response.ok || !isRecord(payload)) {
    throw new Error('WhatsApp connected, but SellerTray could not refresh the connection readiness.');
  }
  return reply(payload, 200, requestId);
}

async function safeJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return { error: { message: raw.replace(/\s+/g, ' ').slice(0, 300) } };
  }
}

function metaError(payload: unknown, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
    return payload.error.message.replace(/\s+/g, ' ').slice(0, 300);
  }
  return fallback;
}

function uuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function metaId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9]{5,40}$/.test(clean) ? clean : null;
}

function optionalMetaId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return metaId(value);
}

function secret(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : null;
}

function isRecord(value: unknown): value is J {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'WhatsApp coexistence connection failed';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 400);
}

function safeRequestId(value: string | null): string {
  const clean = value?.trim() ?? '';
  return /^[A-Za-z0-9._:-]{1,128}$/.test(clean) ? clean : crypto.randomUUID();
}

function fromBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function readRequestTextLimited(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';

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
        return null;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
}

function reply(payload: J, status = 200, requestId?: string): Response {
  const headers = new Headers({
    ...cors,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  if (requestId) headers.set('x-sellertray-request-id', requestId);
  return new Response(JSON.stringify(payload), { status, headers });
}
