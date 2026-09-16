type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const META_APP_ID = Deno.env.get('META_APP_ID')?.trim() ?? '';
const META_APP_SECRET = Deno.env.get('META_APP_SECRET')?.trim() ?? '';
const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN')?.trim() ?? '';
const META_GRAPH_API_VERSION =
  Deno.env.get('META_GRAPH_API_VERSION')?.trim() || 'v26.0';
const META_EMBEDDED_SIGNUP_REDIRECT_URI = Deno.env.get('META_EMBEDDED_SIGNUP_REDIRECT_URI')?.trim() ?? '';
const WHATSAPP_ENCRYPTION_KEY = Deno.env.get('SELLERTRAY_WHATSAPP_ENCRYPTION_KEY')?.trim() ?? '';
const enc = new TextEncoder();

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply({ error: 'Server configuration error' }, 500);

  const requestId = safeRequestId(request.headers.get('x-request-id'));
  const userId = await verifiedUser(request.headers.get('authorization') ?? '');
  if (!userId) return reply({ error: 'Authentication required' }, 401, requestId);

  const raw = await readRequestTextLimited(request, 65_536);
  if (raw === null) return reply({ error: 'Payload too large' }, 413, requestId);

  let body: J;
  try { body = JSON.parse(raw) as J; }
  catch { return reply({ error: 'Invalid JSON' }, 400, requestId); }

  const action = text(body.action);
  const tenantId = uuid(body.tenantId);
  if (!action || !tenantId) return reply({ error: 'action and tenantId are required' }, 400, requestId);

  try {
    const role = await tenantRole(tenantId, userId);
    if (!role) return reply({ error: 'SellerTray business membership required' }, 403, requestId);

    if (action === 'status') {
      return reply(await connectionStatusPayload(tenantId), 200, requestId);
    }

    if (role !== 'owner') {
      return reply({ error: 'Only the business Owner can connect or disconnect WhatsApp' }, 403, requestId);
    }

    if (action === 'disconnect') {
      await rpc('disconnect_sellertray_whatsapp_connection', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
      });
      return reply({ ok: true, ...(await connectionStatusPayload(tenantId)) }, 200, requestId);
    }

    if (action !== 'complete_embedded_signup') {
      return reply({ error: 'Unsupported WhatsApp connection action' }, 400, requestId);
    }

    if (!META_APP_ID || !META_APP_SECRET || !META_GRAPH_API_VERSION || !WHATSAPP_ENCRYPTION_KEY) {
      return reply({ error: 'SellerTray merchant WhatsApp onboarding is not fully configured yet' }, 503, requestId);
    }

    const authorizationCode = secret(body.authorizationCode, 4096);
    const wabaId = metaId(body.wabaId);
    const phoneNumberId = metaId(body.phoneNumberId);
    const metaBusinessId = optionalMetaId(body.metaBusinessId);
    const onboardingMethod = body.onboardingMethod === 'coexistence' ? 'coexistence' : 'embedded_signup';

    if (!authorizationCode || !wabaId || !phoneNumberId) {
      return reply({ error: 'authorizationCode, wabaId and phoneNumberId are required' }, 400, requestId);
    }

    const accessToken = await exchangeAuthorizationCode(authorizationCode);
    const tokenInfo = await inspectAccessToken(accessToken);
    const phone = await verifyPhoneBelongsToWaba(accessToken, wabaId, phoneNumberId);
    await subscribeAppToWaba(accessToken, wabaId);

    const encrypted = await encrypt({ accessToken });
    const fingerprint = await fingerprintOf(accessToken);

    const connection = await rpc<J>('upsert_sellertray_whatsapp_connection', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
      p_meta_business_id: metaBusinessId,
      p_waba_id: wabaId,
      p_phone_number_id: phoneNumberId,
      p_display_phone_number: phone.displayPhoneNumber,
      p_verified_name: phone.verifiedName,
      p_onboarding_method: onboardingMethod,
      p_credential_mode: 'business_integration_system_user',
      p_webhook_subscription_status: 'subscribed',
      p_credentials_ciphertext: encrypted.ciphertext,
      p_credentials_iv: encrypted.iv,
      p_credential_fingerprint: fingerprint,
      p_encryption_key_version: 1,
      p_credential_expires_at: tokenInfo.expiresAt,
    });

    console.info(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'whatsapp-connection',
      event: 'embedded_signup_completed',
      request_id: requestId,
      tenant_id: tenantId,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      credential_fingerprint: fingerprint,
    }));

    return reply({ ok: true, connection, readiness: await messagingReadiness(connection) }, 200, requestId);
  } catch (error) {
    const message = sanitizeError(error);
    const status = /already connected|unique/i.test(message)
      ? 409
      : /Only the business Owner|read-only|membership/i.test(message)
        ? 403
        : /not found|not accessible|does not belong/i.test(message)
          ? 404
          : /not fully configured|encryption key/i.test(message)
            ? 503
            : 400;

    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'whatsapp-connection',
      event: 'request_failed',
      request_id: requestId,
      tenant_id: tenantId,
      error: message,
    }));
    return reply({ error: message }, status, requestId);
  }
});

async function verifiedUser(authorization: string): Promise<string | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  try {
    const payload = await response.json() as J;
    return typeof payload.id === 'string' && payload.id ? payload.id : null;
  } catch {
    return null;
  }
}

async function tenantRole(tenantId: string, userId: string): Promise<string | null> {
  const rows = await rest<Array<{ role: string }>>(
    '/rest/v1/tenant_members?select=role' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&user_id=eq.' + encodeURIComponent(userId) +
      '&limit=1',
  );
  const role = rows[0]?.role ?? null;
  return role === 'owner' || role === 'manager' || role === 'staff' ? role : null;
}

async function loadSafeConnection(tenantId: string): Promise<J | null> {
  const rows = await rest<J[]>(
    '/rest/v1/tenant_whatsapp_connections?' +
      'select=id,tenant_id,meta_business_id,waba_id,phone_number_id,display_phone_number,verified_name,' +
      'connection_status,onboarding_method,credential_mode,webhook_subscription_status,connected_at,' +
      'last_verified_at,disconnected_at,last_error_code,last_error_message,created_at,updated_at' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&limit=1',
  );
  return rows[0] ?? null;
}

async function connectionStatusPayload(tenantId: string): Promise<J> {
  const connection = await loadSafeConnection(tenantId);
  const readiness = await messagingReadiness(connection);
  const managementReadiness = await whatsappManagementReadiness(connection);
  return {
    connection,
    readiness,
    managementReadiness,
  };
}

type RuntimeWhatsAppCredential = {
  credential_mode: 'platform_system_user' | 'business_integration_system_user';
  credentials_ciphertext: string | null;
  credentials_iv: string | null;
  encryption_key_version: number | null;
  credential_expires_at: string | null;
};

async function messagingReadiness(connection: J | null): Promise<J> {
  const connected = connection?.connection_status === 'connected';
  const webhookReady = connection?.webhook_subscription_status === 'subscribed';
  const phoneNumberId = typeof connection?.phone_number_id === 'string'
    ? connection.phone_number_id
    : '';
  const tenantId = typeof connection?.tenant_id === 'string'
    ? connection.tenant_id
    : '';
  const inboundReady = Boolean(connected && webhookReady && phoneNumberId);

  if (!connected) {
    return {
      inboundReady: false,
      outboundReady: false,
      messagingReady: false,
      webhookReady: false,
      credentialReady: false,
      reason: 'WhatsApp connection is not active.',
    };
  }

  if (!webhookReady || !phoneNumberId) {
    return {
      inboundReady: false,
      outboundReady: false,
      messagingReady: false,
      webhookReady: false,
      credentialReady: false,
      reason: 'WhatsApp webhook subscription is not ready.',
    };
  }

  try {
    const accessToken = await runtimeAccessToken(connection, phoneNumberId);
    await verifyPhoneMessagingAccess(accessToken, phoneNumberId);
    return {
      inboundReady,
      outboundReady: true,
      messagingReady: inboundReady,
      webhookReady: true,
      credentialReady: true,
      reason: null,
      checkedAt: new Date().toISOString(),
      readinessEvidence: 'credential_probe',
    };
  } catch (error) {
    const lastOutboundSuccessAt = tenantId
      ? await latestSuccessfulOutbound(tenantId, phoneNumberId)
      : null;

    if (lastOutboundSuccessAt) {
      return {
        inboundReady,
        outboundReady: true,
        messagingReady: inboundReady,
        webhookReady: true,
        credentialReady: true,
        reason: null,
        checkedAt: new Date().toISOString(),
        lastOutboundSuccessAt,
        readinessEvidence: 'live_delivery',
      };
    }

    return {
      inboundReady,
      outboundReady: false,
      messagingReady: false,
      webhookReady: true,
      credentialReady: false,
      reason: sanitizeReadinessError(error),
      checkedAt: new Date().toISOString(),
      readinessEvidence: 'credential_probe_failed',
    };
  }
}

async function whatsappManagementReadiness(connection: J | null): Promise<J> {
  const connected = connection?.connection_status === 'connected';
  const phoneNumberId = typeof connection?.phone_number_id === 'string'
    ? connection.phone_number_id
    : '';
  const wabaId = typeof connection?.waba_id === 'string'
    ? connection.waba_id
    : '';
  const tenantId = typeof connection?.tenant_id === 'string'
    ? connection.tenant_id
    : '';

  if (!connected || !phoneNumberId || !wabaId) {
    return {
      managementApiReady: false,
      reason: 'Connected WABA and phone number are required for management API verification.',
    };
  }

  try {
    const accessToken = await runtimeAccessToken(connection as J, phoneNumberId);
    const phoneCount = await verifyWabaManagementAccess(accessToken, wabaId, phoneNumberId);

    console.info(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'whatsapp-connection',
      event: 'whatsapp_business_management_probe_succeeded',
      tenant_id: tenantId,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      phone_count: phoneCount,
    }));

    await recordManagementProbe({
      tenantId,
      wabaId,
      phoneNumberId,
      succeeded: true,
      evidence: 'waba_phone_numbers_read',
      errorMessage: null,
      phoneCount,
    });

    return {
      managementApiReady: true,
      reason: null,
      checkedAt: new Date().toISOString(),
      evidence: 'waba_phone_numbers_read',
      phoneCount,
    };
  } catch (error) {
    const reason = sanitizeReadinessError(error);
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'whatsapp-connection',
      event: 'whatsapp_business_management_probe_failed',
      tenant_id: tenantId,
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      error: reason,
    }));

    await recordManagementProbe({
      tenantId,
      wabaId,
      phoneNumberId,
      succeeded: false,
      evidence: 'waba_phone_numbers_read_failed',
      errorMessage: reason,
      phoneCount: null,
    });

    return {
      managementApiReady: false,
      reason,
      checkedAt: new Date().toISOString(),
      evidence: 'waba_phone_numbers_read_failed',
    };
  }
}

async function verifyWabaManagementAccess(
  accessToken: string,
  wabaId: string,
  expectedPhoneNumberId: string,
): Promise<number> {
  if (!META_GRAPH_API_VERSION) {
    throw new Error('Meta Graph API version is not configured.');
  }

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
    throw new Error(
      metaError(payload, 'Meta rejected the WhatsApp Business management credential.'),
    );
  }

  const data = isRecord(payload) && Array.isArray(payload.data)
    ? payload.data.filter(isRecord)
    : [];

  if (!data.some((value) => value.id === expectedPhoneNumberId)) {
    throw new Error(
      'Meta management API did not return the connected WhatsApp phone number for this WABA.',
    );
  }

  return data.length;
}

async function recordManagementProbe(input: {
  tenantId: string;
  wabaId: string;
  phoneNumberId: string;
  succeeded: boolean;
  evidence: string;
  errorMessage: string | null;
  phoneCount: number | null;
}): Promise<void> {
  try {
    const response = await fetch(
      SUPABASE_URL + '/rest/v1/whatsapp_management_probe_events',
      {
        method: 'POST',
        headers: {
          apikey: SERVICE_ROLE_KEY,
          authorization: 'Bearer ' + SERVICE_ROLE_KEY,
          'content-type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          tenant_id: input.tenantId,
          waba_id: input.wabaId,
          phone_number_id: input.phoneNumberId,
          succeeded: input.succeeded,
          evidence: input.evidence,
          error_message: input.errorMessage,
          phone_count: input.phoneCount,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        service: 'whatsapp-connection',
        event: 'management_probe_evidence_persist_failed',
        tenant_id: input.tenantId,
        status: response.status,
      }));
    }
  } catch {
    // Probe evidence persistence must never break merchant connection status.
  }
}

async function latestSuccessfulOutbound(tenantId: string, phoneNumberId: string): Promise<string | null> {
  try {
    const rows = await rest<Array<{ sent_at: string | null }>>(
      '/rest/v1/outbound_notifications?select=sent_at' +
        '&tenant_id=eq.' + encodeURIComponent(tenantId) +
        '&from_phone_number_id=eq.' + encodeURIComponent(phoneNumberId) +
        '&delivery_status=eq.sent' +
        '&sent_at=not.is.null' +
        '&order=sent_at.desc' +
        '&limit=1',
    );
    const sentAt = rows[0]?.sent_at ?? null;
    return typeof sentAt === 'string' && sentAt ? sentAt : null;
  } catch {
    return null;
  }
}

async function runtimeAccessToken(connection: J, phoneNumberId: string): Promise<string> {
  const mode = connection.credential_mode;
  if (mode === 'platform_system_user') {
    if (!META_ACCESS_TOKEN) {
      throw new Error('Outbound WhatsApp credential is not configured.');
    }
    return META_ACCESS_TOKEN;
  }

  if (mode !== 'business_integration_system_user') {
    throw new Error('WhatsApp credential mode is not supported.');
  }

  const rows = await rpc<RuntimeWhatsAppCredential[]>(
    'get_sellertray_whatsapp_runtime_credential_by_phone',
    { p_phone_number_id: phoneNumberId },
  );
  const credential = rows[0] ?? null;
  if (!credential?.credentials_ciphertext || !credential.credentials_iv) {
    throw new Error('Merchant WhatsApp credential is unavailable.');
  }
  if (credential.credential_expires_at) {
    const expiresAt = new Date(credential.credential_expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      throw new Error('Merchant WhatsApp credential has expired.');
    }
  }

  const payload = await decryptCredential(
    credential.credentials_ciphertext,
    credential.credentials_iv,
  );
  const accessToken = typeof payload.accessToken === 'string'
    ? payload.accessToken.trim()
    : '';
  if (!accessToken) throw new Error('Merchant WhatsApp credential is invalid.');
  return accessToken;
}

async function verifyPhoneMessagingAccess(accessToken: string, phoneNumberId: string): Promise<void> {
  if (!META_GRAPH_API_VERSION) {
    throw new Error('Meta Graph API version is not configured.');
  }

  const url = new URL(
    'https://graph.facebook.com/' + encodeURIComponent(META_GRAPH_API_VERSION) +
      '/' + encodeURIComponent(phoneNumberId),
  );
  url.searchParams.set('fields', 'id,display_phone_number');

  const response = await fetch(url, {
    headers: { authorization: 'Bearer ' + accessToken },
    signal: AbortSignal.timeout(10000),
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(metaError(payload, 'Meta rejected the WhatsApp messaging credential.'));
  }
  if (!isRecord(payload) || payload.id !== phoneNumberId) {
    throw new Error('Meta did not confirm access to the connected WhatsApp number.');
  }
}

async function decryptCredential(ciphertext: string, ivValue: string): Promise<J> {
  const keyBytes = fromBase64(WHATSAPP_ENCRYPTION_KEY);
  if (keyBytes.byteLength !== 32) {
    throw new Error('WhatsApp credential decryption is not configured.');
  }
  const iv = fromBase64(ivValue);
  if (iv.byteLength !== 12) throw new Error('WhatsApp credential IV is invalid.');

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      fromBase64(ciphertext),
    );
  } catch {
    throw new Error('Merchant WhatsApp credential could not be decrypted.');
  }

  try {
    const value = JSON.parse(new TextDecoder().decode(plain)) as unknown;
    if (!isRecord(value)) throw new Error('invalid');
    return value;
  } catch {
    throw new Error('Merchant WhatsApp credential payload is invalid.');
  }
}

function sanitizeReadinessError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : 'Outbound WhatsApp messaging is not ready.';
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

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

  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(12000),
  });
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
): Promise<{ expiresAt: string | null }> {
  const url = new URL(
    'https://graph.facebook.com/' + encodeURIComponent(META_GRAPH_API_VERSION) + '/debug_token',
  );
  url.searchParams.set('input_token', accessToken);

  const response = await fetch(url, {
    headers: {
      authorization: 'Bearer ' + META_APP_ID + '|' + META_APP_SECRET,
    },
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

  return { expiresAt };
}

async function verifyPhoneBelongsToWaba(
  accessToken: string,
  wabaId: string,
  phoneNumberId: string,
): Promise<{ displayPhoneNumber: string | null; verifiedName: string | null }> {
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
  if (!response.ok) throw new Error(metaError(payload, 'Unable to verify the selected WhatsApp phone number'));

  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const phone = data.find((value) => isRecord(value) && value.id === phoneNumberId);
  if (!isRecord(phone)) {
    throw new Error('The selected WhatsApp Phone Number ID does not belong to the shared WABA');
  }

  return {
    displayPhoneNumber: typeof phone.display_phone_number === 'string' ? phone.display_phone_number : null,
    verifiedName: typeof phone.verified_name === 'string' ? phone.verified_name : null,
  };
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

async function rpc<T = unknown>(name: string, body: J): Promise<T> {
  const response = await fetch(
    SUPABASE_URL + '/rest/v1/rpc/' + encodeURIComponent(name),
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: 'Bearer ' + SERVICE_ROLE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    let payload: J = {};
    try { payload = JSON.parse(raw) as J; } catch {}
    const message = typeof payload.message === 'string'
      ? payload.message
      : typeof payload.error === 'string'
        ? payload.error
        : 'SellerTray WhatsApp connection RPC failed';
    throw new Error(message);
  }
  return (raw ? JSON.parse(raw) : null) as T;
}

async function rest<T = unknown>(path: string): Promise<T> {
  const response = await fetch(SUPABASE_URL + path, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    },
    signal: AbortSignal.timeout(10000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error('SellerTray WhatsApp connection lookup failed');
  return (raw ? JSON.parse(raw) : null) as T;
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

async function safeJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; }
  catch { return { error: { message: raw.replace(/\s+/g, ' ').slice(0, 300) } }; }
}

function metaError(payload: unknown, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
    return payload.error.message.replace(/\s+/g, ' ').slice(0, 300);
  }
  return fallback;
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
function uuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function secret(value: unknown, max: number): string | null {
  const clean = text(value);
  return clean && clean.length <= max ? clean : null;
}
function safeRequestId(value: string | null): string {
  const clean = value?.trim() ?? '';
  return /^[A-Za-z0-9._:-]{1,128}$/.test(clean) ? clean : crypto.randomUUID();
}
function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'WhatsApp connection request failed';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/(?:access_token|client_secret|authorizationCode)\s*[=:]\s*[^\s,}]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 400);
}
function fromBase64(value: string): Uint8Array {
  try { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
  catch { return new Uint8Array(); }
}
function toBase64(value: Uint8Array): string {
  let raw = '';
  for (const byte of value) raw += String.fromCharCode(byte);
  return btoa(raw);
}
function isRecord(value: unknown): value is J {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
async function readRequestTextLimited(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      parts.push(decoder.decode(result.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    try { reader.releaseLock(); } catch {}
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
