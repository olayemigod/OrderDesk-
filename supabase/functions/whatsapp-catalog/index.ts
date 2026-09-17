import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION')?.trim() || 'v26.0';
const WHATSAPP_ENCRYPTION_KEY = Deno.env.get('SELLERTRAY_WHATSAPP_ENCRYPTION_KEY')?.trim() ?? '';
const MAX_BODY_BYTES = 65_536;

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

  const action = cleanText(body.action, 50);
  const tenantId = cleanUuid(body.tenantId);
  if (!action || !tenantId) return reply({ error: 'action and tenantId are required' }, 400, requestId);

  try {
    const membership = await loadMembership(tenantId, userId);
    if (!membership) return reply({ error: 'You do not have access to this business' }, 403, requestId);

    if (action === 'status') {
      const [
        { data: settings, error: settingsError },
        { data: mapped, error: mappedError },
        { data: connection, error: connectionError },
        { data: managementProbe, error: probeError },
      ] = await Promise.all([
        admin
          .from('tenant_whatsapp_catalog_settings')
          .select('tenant_id,catalog_id,catalog_name,sync_mode,is_enabled,last_sync_at,last_sync_status,last_sync_error,updated_at')
          .eq('tenant_id', tenantId)
          .maybeSingle(),
        admin
          .from('catalog_items')
          .select('id,name,sku,price_ngn,is_active,whatsapp_catalog_id,whatsapp_product_retailer_id,whatsapp_mapping_source,whatsapp_last_synced_at')
          .eq('tenant_id', tenantId)
          .not('whatsapp_product_retailer_id', 'is', null)
          .order('name', { ascending: true })
          .limit(500),
        admin
          .from('tenant_whatsapp_connections')
          .select('connection_status,credential_mode,meta_business_id,waba_id,phone_number_id,onboarding_method,granted_scopes,last_verified_at')
          .eq('tenant_id', tenantId)
          .maybeSingle(),
        admin
          .from('whatsapp_management_probe_events')
          .select('succeeded,evidence,error_message,created_at')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (settingsError) throw settingsError;
      if (mappedError) throw mappedError;
      if (connectionError) throw connectionError;
      if (probeError) throw probeError;

      const connected = connection?.connection_status === 'connected';
      const tenantCredentialReady =
        connection?.credential_mode === 'business_integration_system_user';
      const grantedScopes = Array.isArray(connection?.granted_scopes)
        ? connection.granted_scopes.filter((value): value is string => typeof value === 'string')
        : [];
      const businessManagementScopeReady = grantedScopes.includes('business_management');
      const catalogManagementScopeReady = grantedScopes.includes('catalog_management');
      const catalogueScopesReady = businessManagementScopeReady && catalogManagementScopeReady;
      const managementApiReady = managementProbe?.succeeded === true;
      const catalogConfigured = Boolean(settings?.catalog_id);
      const baseReady =
        connected &&
        tenantCredentialReady &&
        catalogueScopesReady &&
        managementApiReady &&
        catalogConfigured;

      let catalogueAssetReady = false;
      let catalogueAssetReason: string | null = null;
      let catalogueAssetEvidence: J | null = null;
      let catalogueAssetCheckedAt: string | null = null;

      if (baseReady && settings?.catalog_id) {
        catalogueAssetCheckedAt = new Date().toISOString();
        try {
          catalogueAssetEvidence = await probeMetaCatalogueAsset(
            tenantId,
            String(settings.catalog_id),
          );
          catalogueAssetReady = true;
        } catch (error) {
          catalogueAssetReason = sanitizeError(error);
        }
      }

      const importReady = baseReady && catalogueAssetReady;
      const importReadiness = {
        connected,
        tenantCredentialReady,
        businessManagementScopeReady,
        catalogManagementScopeReady,
        catalogueScopesReady,
        managementApiReady,
        catalogConfigured,
        catalogueAssetReady,
        importReady,
        reason: !connected
          ? 'Connect this business to WhatsApp first.'
          : !tenantCredentialReady
            ? 'Automatic catalogue import requires a tenant-owned Meta business integration credential.'
            : !catalogueScopesReady
              ? 'This Meta connection did not grant business_management and catalog_management. Reconnect after SellerTray catalogue permissions are available in Meta.'
              : !managementApiReady
                ? 'WhatsApp Business management access has not been verified for this tenant.'
                : !catalogConfigured
                  ? 'Configure the merchant Meta catalogue ID first.'
                  : !catalogueAssetReady
                    ? catalogueAssetReason ?? 'Meta did not verify access to this catalogue asset.'
                    : 'Meta catalogue access is verified for this SellerTray business.',
        grantedScopes,
        managementEvidence: managementProbe?.evidence ?? null,
        managementCheckedAt: managementProbe?.created_at ?? null,
        catalogueAssetEvidence,
        catalogueAssetCheckedAt,
      };

      return reply({
        role: membership.role,
        settings: settings ?? null,
        mappedItems: mapped ?? [],
        importReadiness,
      }, 200, requestId);
    }

    if (!['owner', 'manager'].includes(membership.role)) {
      return reply({ error: 'Only the business Owner or Manager can manage the WhatsApp catalogue' }, 403, requestId);
    }

    const allowed = await consumeRateLimit(tenantId, userId);
    if (!allowed) return reply({ error: 'Too many catalogue actions. Try again shortly.' }, 429, requestId);

    if (action === 'configure') {
      const catalogId = cleanText(body.catalogId, 160);
      const catalogName = cleanText(body.catalogName, 160);
      const syncMode = body.syncMode === 'import_from_meta' ? 'import_from_meta' : 'manual_mapping';
      if (!catalogId) return reply({ error: 'catalogId is required' }, 400, requestId);

      // import_from_meta is recorded as merchant intent but not auto-executed yet.
      // SellerTray will not read a Meta catalogue until tenant-specific asset authorization is verified.
      const { data: result, error } = await admin.rpc('upsert_sellertray_whatsapp_catalog_settings', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
        p_catalog_id: catalogId,
        p_catalog_name: catalogName,
        p_sync_mode: syncMode,
        p_is_enabled: body.isEnabled !== false,
      });
      if (error) throw error;

      return reply({
        tenantId: result,
        syncMode,
        importReady: false,
        note: syncMode === 'import_from_meta'
          ? 'Meta catalogue import requires verified tenant asset authorization before execution.'
          : null,
      }, 200, requestId);
    }

    if (action === 'map_item') {
      const catalogItemId = cleanUuid(body.catalogItemId);
      const catalogId = cleanText(body.catalogId, 160);
      const retailerId = cleanText(body.productRetailerId, 160);
      if (!catalogItemId || !catalogId || !retailerId) {
        return reply({ error: 'catalogItemId, catalogId and productRetailerId are required' }, 400, requestId);
      }

      const { data: settings, error: settingsError } = await admin
        .from('tenant_whatsapp_catalog_settings')
        .select('catalog_id,is_enabled')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (settingsError) throw settingsError;
      if (!settings) return reply({ error: 'Configure the WhatsApp catalogue first' }, 409, requestId);
      if (settings.catalog_id !== catalogId) {
        return reply({ error: 'The item mapping catalogId must match the configured WhatsApp catalogue' }, 409, requestId);
      }

      const { data: itemId, error } = await admin.rpc('set_sellertray_whatsapp_catalog_item_mapping', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
        p_catalog_item_id: catalogItemId,
        p_catalog_id: catalogId,
        p_product_retailer_id: retailerId,
        p_mapping_source: 'manual',
      });
      if (error) throw error;

      return reply({ catalogItemId: itemId }, 200, requestId);
    }

    if (action === 'unmap_item') {
      const catalogItemId = cleanUuid(body.catalogItemId);
      if (!catalogItemId) return reply({ error: 'catalogItemId is required' }, 400, requestId);

      const { data: itemId, error } = await admin.rpc('clear_sellertray_whatsapp_catalog_item_mapping', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
        p_catalog_item_id: catalogItemId,
      });
      if (error) throw error;

      return reply({ catalogItemId: itemId }, 200, requestId);
    }

    return reply({ error: 'Unsupported WhatsApp catalogue action' }, 400, requestId);
  } catch (error) {
    const message = sanitizeError(error);
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'whatsapp-catalog',
      event: 'request_failed',
      request_id: requestId,
      tenant_id: tenantId,
      action,
      error: message,
    }));

    const status = /Only the business Owner|do not have access/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /match|configure|unique|duplicate|already/i.test(message)
          ? 409
          : 400;
    return reply({ error: message }, status, requestId);
  }
});

async function loadMembership(tenantId: string, userId: string): Promise<{ role: string } | null> {
  const { data, error } = await admin!
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.role ? { role: String(data.role) } : null;
}

type RuntimeWhatsAppCredential = {
  credential_mode: 'platform_system_user' | 'business_integration_system_user';
  credentials_ciphertext: string | null;
  credentials_iv: string | null;
  encryption_key_version: number | null;
  credential_expires_at: string | null;
};

async function probeMetaCatalogueAsset(
  tenantId: string,
  catalogId: string,
): Promise<J> {
  if (!WHATSAPP_ENCRYPTION_KEY) {
    throw new Error('SellerTray WhatsApp credential decryption is not configured.');
  }

  const { data, error } = await admin!.rpc(
    'get_sellertray_whatsapp_runtime_credential_by_tenant',
    { p_tenant_id: tenantId },
  );
  if (error) throw error;

  const credential = Array.isArray(data)
    ? data[0] as RuntimeWhatsAppCredential | undefined
    : undefined;

  if (!credential || credential.credential_mode !== 'business_integration_system_user') {
    throw new Error('Tenant-owned Meta catalogue credential is unavailable.');
  }
  if (!credential.credentials_ciphertext || !credential.credentials_iv) {
    throw new Error('Tenant-owned Meta catalogue credential is unavailable.');
  }
  if (credential.credential_expires_at) {
    const expiresAt = new Date(credential.credential_expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      throw new Error('Tenant-owned Meta credential has expired. Reconnect WhatsApp.');
    }
  }

  const payload = await decryptCredential(
    credential.credentials_ciphertext,
    credential.credentials_iv,
  );
  const accessToken = typeof payload.accessToken === 'string'
    ? payload.accessToken.trim()
    : '';
  if (!accessToken) {
    throw new Error('Tenant-owned Meta catalogue credential is invalid.');
  }

  const catalogUrl = new URL(
    'https://graph.facebook.com/' +
      encodeURIComponent(META_GRAPH_API_VERSION) +
      '/' + encodeURIComponent(catalogId),
  );
  catalogUrl.searchParams.set('fields', 'id,name,vertical');

  const catalogResponse = await fetch(catalogUrl, {
    headers: { authorization: 'Bearer ' + accessToken },
    signal: AbortSignal.timeout(12000),
  });
  const catalogPayload = await safeJson(catalogResponse);
  if (!catalogResponse.ok) {
    throw new Error(metaError(catalogPayload, 'Meta rejected access to this product catalogue.'));
  }
  if (!isRecord(catalogPayload) || String(catalogPayload.id ?? '') !== catalogId) {
    throw new Error('Meta did not return the configured catalogue.');
  }

  const productsUrl = new URL(
    'https://graph.facebook.com/' +
      encodeURIComponent(META_GRAPH_API_VERSION) +
      '/' + encodeURIComponent(catalogId) +
      '/products',
  );
  productsUrl.searchParams.set('fields', 'id,retailer_id,name');
  productsUrl.searchParams.set('limit', '1');

  const productsResponse = await fetch(productsUrl, {
    headers: { authorization: 'Bearer ' + accessToken },
    signal: AbortSignal.timeout(12000),
  });
  const productsPayload = await safeJson(productsResponse);
  if (!productsResponse.ok) {
    throw new Error(metaError(productsPayload, 'Meta rejected product read access for this catalogue.'));
  }

  const products = isRecord(productsPayload) && Array.isArray(productsPayload.data)
    ? productsPayload.data
    : [];

  return {
    evidence: 'catalogue_and_products_read',
    catalogId,
    catalogName: typeof catalogPayload.name === 'string' ? catalogPayload.name : null,
    vertical: typeof catalogPayload.vertical === 'string' ? catalogPayload.vertical : null,
    sampleProductCount: products.length,
  };
}

async function decryptCredential(ciphertext: string, ivValue: string): Promise<J> {
  const keyBytes = fromBase64(WHATSAPP_ENCRYPTION_KEY);
  if (keyBytes.byteLength !== 32) {
    throw new Error('SellerTray WhatsApp credential decryption is not configured.');
  }
  const iv = fromBase64(ivValue);
  if (iv.byteLength !== 12) {
    throw new Error('SellerTray WhatsApp credential IV is invalid.');
  }

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
    throw new Error('SellerTray merchant Meta credential could not be decrypted.');
  }

  try {
    const value = JSON.parse(new TextDecoder().decode(plain)) as unknown;
    if (!isRecord(value)) throw new Error('invalid');
    return value;
  } catch {
    throw new Error('SellerTray merchant Meta credential payload is invalid.');
  }
}

function fromBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function metaError(payload: unknown, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error)) {
    const message = typeof payload.error.message === 'string'
      ? payload.error.message.replace(/\s+/g, ' ').slice(0, 300)
      : '';
    const code = typeof payload.error.code === 'number'
      ? payload.error.code
      : null;
    return message
      ? fallback + (code === null ? ': ' : ' (' + code + '): ') + message
      : fallback;
  }
  return fallback;
}

function isRecord(value: unknown): value is J {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function consumeRateLimit(tenantId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin!.rpc('consume_sellertray_rate_limit', {
    p_scope: 'whatsapp_catalog',
    p_key: tenantId + ':' + userId,
    p_limit: 60,
    p_window_seconds: 60,
  });
  if (error) throw error;
  return data === true;
}

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
  const raw = error instanceof Error ? error.message : 'WhatsApp catalogue request failed';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 400);
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
