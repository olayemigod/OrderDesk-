import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type J = Record<string, unknown>;
type ImportAction = 'preview' | 'commit';
type Operation = 'create' | 'update' | 'link' | 'preserve_manual' | 'error';

type RuntimeWhatsAppCredential = {
  credential_mode: 'platform_system_user' | 'business_integration_system_user';
  credentials_ciphertext: string | null;
  credentials_iv: string | null;
  encryption_key_version: number | null;
  credential_expires_at: string | null;
};

type MetaImportRow = {
  metaProductId: string | null;
  retailerId: string;
  name: string;
  price: number;
  currency: string;
  category: string | null;
  imageUrl: string | null;
  availability: string | null;
  isActive: boolean;
  operation: Operation;
  existingItemId: string | null;
  errors: string[];
};

type MetaSnapshot = {
  catalogId: string;
  catalogName: string | null;
  vertical: string | null;
  rows: MetaImportRow[];
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION')?.trim() || 'v26.0';
const WHATSAPP_ENCRYPTION_KEY = Deno.env.get('SELLERTRAY_WHATSAPP_ENCRYPTION_KEY')?.trim() ?? '';
const MAX_BODY_BYTES = 32_768;
const MAX_PRODUCTS = 500;

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
  if (request.method === 'OPTIONS') return reply({ ok: true });
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

  const tenantId = cleanUuid(body.tenantId);
  const action: ImportAction | null = body.action === 'preview'
    ? 'preview'
    : body.action === 'commit'
      ? 'commit'
      : null;
  const expectedFingerprint = cleanText(body.previewFingerprint, 128);

  if (!tenantId || !action) {
    return reply({ error: 'Business and import action are required' }, 400, requestId);
  }
  if (action === 'commit' && !expectedFingerprint) {
    return reply({ error: 'Preview this Meta catalogue before importing it' }, 409, requestId);
  }

  try {
    const [{ data: membership, error: membershipError }, { data: rateAllowed, error: rateError }] = await Promise.all([
      admin
        .from('tenant_members')
        .select('role')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .maybeSingle(),
      admin.rpc('consume_sellertray_rate_limit', {
        p_scope: 'meta_catalogue_import',
        p_key: tenantId + ':' + userId,
        p_limit: 12,
        p_window_seconds: 60,
      }),
    ]);

    if (membershipError) throw membershipError;
    if (!membership || !['owner', 'manager'].includes(String(membership.role))) {
      return reply({ error: 'Only the business Owner or Manager can import a Meta catalogue' }, 403, requestId);
    }
    if (rateError) throw rateError;
    if (rateAllowed !== true) {
      return reply({ error: 'Too many Meta catalogue import attempts. Try again shortly.' }, 429, requestId);
    }

    const context = await loadImportContext(tenantId);
    const accessToken = await runtimeMetaAccessToken(tenantId);
    const snapshot = await fetchMetaSnapshot(accessToken, context.catalogId, context.currency);
    const rows = await buildPreview(tenantId, snapshot.rows, context.catalogId);
    const fingerprint = await previewFingerprint(rows);
    const summary = summarize(rows);

    if (action === 'preview') {
      return reply({
        ok: summary.error === 0,
        catalog: {
          id: snapshot.catalogId,
          name: snapshot.catalogName,
          vertical: snapshot.vertical,
          currency: context.currency,
        },
        summary,
        fingerprint,
        rows,
      }, 200, requestId);
    }

    if (fingerprint !== expectedFingerprint) {
      return reply({
        error: 'The Meta catalogue or SellerTray catalogue changed after preview. Preview again before importing.',
        summary,
        fingerprint,
        rows,
      }, 409, requestId);
    }

    if (summary.error > 0) {
      return reply({
        error: 'Resolve Meta catalogue import conflicts before committing',
        summary,
        fingerprint,
        rows,
      }, 409, requestId);
    }

    const payload = rows.map((row) => ({
      retailerId: row.retailerId,
      name: row.name,
      price: row.price,
      currency: row.currency,
      category: row.category,
      imageUrl: row.imageUrl,
      isActive: row.isActive,
    }));

    const { data: result, error: applyError } = await admin.rpc('apply_sellertray_meta_catalogue_import', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
      p_catalog_id: context.catalogId,
      p_rows: payload,
    });
    if (applyError) throw applyError;

    console.info(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'meta-catalogue-import',
      event: 'meta_catalogue_import_committed',
      request_id: requestId,
      tenant_id: tenantId,
      catalog_id: context.catalogId,
      summary,
    }));

    return reply({ ok: true, catalog: { id: snapshot.catalogId, name: snapshot.catalogName }, summary, result }, 200, requestId);
  } catch (error) {
    const message = sanitizeError(error);
    if (action === 'commit') await recordSyncFailure(tenantId, message);

    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'meta-catalogue-import',
      event: 'request_failed',
      request_id: requestId,
      tenant_id: tenantId,
      action,
      error: message,
    }));

    const status = /Only the business Owner|read-only|do not have access/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /scope|permission|catalogue|catalog|currency|match|duplicate|conflict|preview/i.test(message)
          ? 409
          : 400;
    return reply({ error: message }, status, requestId);
  }
});

async function loadImportContext(tenantId: string): Promise<{ catalogId: string; currency: string }> {
  const [settingsResult, tenantResult, connectionResult, probeResult] = await Promise.all([
    admin!
      .from('tenant_whatsapp_catalog_settings')
      .select('catalog_id,is_enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    admin!
      .from('tenants')
      .select('currency')
      .eq('id', tenantId)
      .maybeSingle(),
    admin!
      .from('tenant_whatsapp_connections')
      .select('connection_status,credential_mode,granted_scopes')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    admin!
      .from('whatsapp_management_probe_events')
      .select('succeeded')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (settingsResult.error) throw settingsResult.error;
  if (tenantResult.error) throw tenantResult.error;
  if (connectionResult.error) throw connectionResult.error;
  if (probeResult.error) throw probeResult.error;

  const settings = settingsResult.data;
  const tenant = tenantResult.data;
  const connection = connectionResult.data;
  const probe = probeResult.data;

  if (!settings?.catalog_id || settings.is_enabled !== true) {
    throw new Error('Configure and enable the Meta catalogue before importing.');
  }
  if (!tenant?.currency) throw new Error('SellerTray business currency is not configured.');
  if (connection?.connection_status !== 'connected') {
    throw new Error('Connect this business to WhatsApp before importing its Meta catalogue.');
  }
  if (connection.credential_mode !== 'business_integration_system_user') {
    throw new Error('Meta catalogue import requires a tenant-owned business integration credential.');
  }

  const scopes = Array.isArray(connection.granted_scopes)
    ? connection.granted_scopes.filter((value): value is string => typeof value === 'string')
    : [];
  for (const required of ['business_management', 'catalog_management']) {
    if (!scopes.includes(required)) {
      throw new Error('Meta catalogue import is missing the ' + required + ' permission. Reconnect after SellerTray catalogue permissions are approved.');
    }
  }
  if (probe?.succeeded !== true) {
    throw new Error('WhatsApp Business management access must be verified before Meta catalogue import.');
  }

  return {
    catalogId: String(settings.catalog_id),
    currency: String(tenant.currency).trim().toUpperCase(),
  };
}

async function runtimeMetaAccessToken(tenantId: string): Promise<string> {
  if (!WHATSAPP_ENCRYPTION_KEY) {
    throw new Error('SellerTray merchant Meta credential decryption is not configured.');
  }

  const { data, error } = await admin!.rpc('get_sellertray_whatsapp_runtime_credential_by_tenant', {
    p_tenant_id: tenantId,
  });
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

  const payload = await decryptCredential(credential.credentials_ciphertext, credential.credentials_iv);
  const accessToken = typeof payload.accessToken === 'string' ? payload.accessToken.trim() : '';
  if (!accessToken) throw new Error('Tenant-owned Meta catalogue credential is invalid.');
  return accessToken;
}

async function fetchMetaSnapshot(
  accessToken: string,
  catalogId: string,
  tenantCurrency: string,
): Promise<MetaSnapshot> {
  const catalogUrl = graphUrl('/' + encodeURIComponent(catalogId));
  catalogUrl.searchParams.set('fields', 'id,name,vertical');

  const catalogResponse = await metaFetch(catalogUrl, accessToken);
  const catalogPayload = await safeJson(catalogResponse);
  if (!catalogResponse.ok) {
    throw new Error(metaError(catalogPayload, 'Meta rejected access to this product catalogue.'));
  }
  if (!isRecord(catalogPayload) || String(catalogPayload.id ?? '') !== catalogId) {
    throw new Error('Meta did not return the configured catalogue.');
  }

  const rawProducts: J[] = [];
  let after: string | null = null;

  while (true) {
    const productsUrl = graphUrl('/' + encodeURIComponent(catalogId) + '/products');
    productsUrl.searchParams.set(
      'fields',
      'id,retailer_id,name,price,currency,image_url,category,product_type,availability,visibility',
    );
    productsUrl.searchParams.set('limit', '100');
    if (after) productsUrl.searchParams.set('after', after);

    const response = await metaFetch(productsUrl, accessToken);
    const payload = await safeJson(response);
    if (!response.ok) {
      throw new Error(metaError(payload, 'Meta rejected product read access for this catalogue.'));
    }
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new Error('Meta returned an invalid product catalogue response.');
    }

    for (const value of payload.data) {
      if (isRecord(value)) rawProducts.push(value);
      if (rawProducts.length > MAX_PRODUCTS) {
        throw new Error('This Meta catalogue contains more than 500 products. SellerTray currently imports up to 500 products at a time.');
      }
    }

    const paging = isRecord(payload.paging) ? payload.paging : null;
    const cursors = paging && isRecord(paging.cursors) ? paging.cursors : null;
    const next = paging && typeof paging.next === 'string' && paging.next ? paging.next : null;
    const nextAfter = cursors && typeof cursors.after === 'string' ? cursors.after : null;
    if (!next || !nextAfter) break;
    after = nextAfter;
  }

  if (rawProducts.length === 0) {
    throw new Error('The configured Meta catalogue has no products to import.');
  }

  const rows = rawProducts.map((product) => normalizeMetaProduct(product, tenantCurrency));
  return {
    catalogId,
    catalogName: typeof catalogPayload.name === 'string' ? catalogPayload.name : null,
    vertical: typeof catalogPayload.vertical === 'string' ? catalogPayload.vertical : null,
    rows,
  };
}

function normalizeMetaProduct(product: J, tenantCurrency: string): MetaImportRow {
  const errors: string[] = [];
  const metaProductId = cleanText(product.id, 160);
  const retailerId = cleanText(product.retailer_id, 160) ?? '';
  const name = cleanText(product.name, 240) ?? '';
  const currency = (cleanText(product.currency, 10) ?? '').toUpperCase();
  const category = cleanText(product.category, 120) ?? cleanText(product.product_type, 120);
  const imageUrl = cleanText(product.image_url, 1000);
  const availability = cleanText(product.availability, 80)?.toLowerCase() ?? null;
  const priceResult = parseMetaPrice(product.price, currency);

  if (!retailerId) errors.push('Meta product is missing retailer_id.');
  if (!name) errors.push('Meta product is missing a product name.');
  if (!currency || !/^[A-Z]{3}$/.test(currency)) errors.push('Meta product has an invalid currency.');
  if (currency && currency !== tenantCurrency) {
    errors.push('Meta currency ' + currency + ' does not match SellerTray business currency ' + tenantCurrency + '.');
  }
  if (priceResult.error) errors.push(priceResult.error);

  const inactiveAvailability = new Set(['out of stock', 'out_of_stock', 'discontinued']);
  const isActive = availability ? !inactiveAvailability.has(availability) : true;

  return {
    metaProductId,
    retailerId,
    name,
    price: priceResult.value,
    currency,
    category,
    imageUrl,
    availability,
    isActive,
    operation: errors.length ? 'error' : 'create',
    existingItemId: null,
    errors,
  };
}

async function buildPreview(
  tenantId: string,
  sourceRows: MetaImportRow[],
  catalogId: string,
): Promise<MetaImportRow[]> {
  const { data, error } = await admin!
    .from('catalog_items')
    .select('id,name,sku,whatsapp_catalog_id,whatsapp_product_retailer_id,whatsapp_mapping_source')
    .eq('tenant_id', tenantId)
    .limit(5000);
  if (error) throw error;

  const items = data ?? [];
  const duplicateRetailers = new Set<string>();
  const seenRetailers = new Set<string>();
  for (const row of sourceRows) {
    const key = normalizeKey(row.retailerId);
    if (!key) continue;
    if (seenRetailers.has(key)) duplicateRetailers.add(key);
    seenRetailers.add(key);
  }

  return sourceRows
    .map((source) => {
      const row: MetaImportRow = {
        ...source,
        errors: [...source.errors],
        operation: source.errors.length ? 'error' : 'create',
        existingItemId: null,
      };
      const retailerKey = normalizeKey(row.retailerId);
      const nameKey = normalizeKey(row.name);

      if (retailerKey && duplicateRetailers.has(retailerKey)) {
        row.errors.push('Meta returned the retailer ID more than once.');
      }

      const mappedMatches = retailerKey
        ? items.filter((item) =>
            String(item.whatsapp_catalog_id ?? '') === catalogId &&
            normalizeKey(item.whatsapp_product_retailer_id) === retailerKey
          )
        : [];
      if (mappedMatches.length > 1) {
        row.errors.push('Retailer ID maps to more than one SellerTray product.');
      }

      const mapped = mappedMatches[0] ?? null;
      if (mapped) {
        row.existingItemId = String(mapped.id);
        row.operation = String(mapped.whatsapp_mapping_source) === 'manual' ? 'preserve_manual' : 'update';
      } else {
        const skuMatches = retailerKey
          ? items.filter((item) => normalizeKey(item.sku) === retailerKey)
          : [];
        if (skuMatches.length > 1) {
          row.errors.push('Retailer ID matches more than one SellerTray SKU.');
        }
        const skuMatch = skuMatches[0] ?? null;

        if (skuMatch) {
          const existingCatalogId = cleanText(skuMatch.whatsapp_catalog_id, 160);
          const existingRetailerId = cleanText(skuMatch.whatsapp_product_retailer_id, 160);
          if (
            existingRetailerId &&
            (existingCatalogId !== catalogId || normalizeKey(existingRetailerId) !== retailerKey)
          ) {
            row.errors.push('Matching SellerTray SKU is already mapped to another Meta product.');
          } else {
            row.existingItemId = String(skuMatch.id);
            row.operation = 'link';
          }
        } else if (nameKey) {
          const nameMatches = items.filter((item) => normalizeKey(item.name) === nameKey);
          if (nameMatches.length > 0) {
            row.errors.push('A SellerTray product already has this name. Map it manually or align its SKU with the Meta retailer ID.');
          }
        }
      }

      row.errors = unique(row.errors);
      if (row.errors.length) row.operation = 'error';
      return row;
    })
    .sort((left, right) => left.retailerId.localeCompare(right.retailerId));
}

function summarize(rows: MetaImportRow[]) {
  const count = (operation: Operation) => rows.filter((row) => row.operation === operation).length;
  return {
    total: rows.length,
    create: count('create'),
    update: count('update'),
    link: count('link'),
    preserveManual: count('preserve_manual'),
    inactive: rows.filter((row) => !row.isActive && row.operation !== 'error').length,
    error: count('error'),
  };
}

async function previewFingerprint(rows: MetaImportRow[]): Promise<string> {
  const canonical = rows.map((row) => ({
    retailerId: row.retailerId,
    name: row.name,
    price: row.price,
    currency: row.currency,
    category: row.category,
    imageUrl: row.imageUrl,
    availability: row.availability,
    isActive: row.isActive,
    operation: row.operation,
    existingItemId: row.existingItemId,
    errors: row.errors,
  }));
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical)),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function parseMetaPrice(value: unknown, currency: string): { value: number; error: string | null } {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { value: NaN, error: 'Meta product is missing a price.' };
  }

  const raw = String(value).trim();
  if (!raw) return { value: NaN, error: 'Meta product is missing a price.' };

  const explicit = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z]{3})$/);
  if (explicit) {
    const embeddedCurrency = explicit[2].toUpperCase();
    const amount = Number(explicit[1]);
    if (currency && embeddedCurrency !== currency) {
      return { value: NaN, error: 'Meta product price currency conflicts with its currency field.' };
    }
    return Number.isFinite(amount) && amount >= 0
      ? { value: roundMoney(amount), error: null }
      : { value: NaN, error: 'Meta product has an invalid price.' };
  }

  if (!/^\d+$/.test(raw)) {
    return { value: NaN, error: 'Meta product price format is ambiguous. Review this product in Meta before importing.' };
  }

  const minor = Number(raw);
  if (!Number.isSafeInteger(minor) || minor < 0) {
    return { value: NaN, error: 'Meta product has an invalid price.' };
  }
  const divisor = 10 ** currencyExponent(currency);
  return { value: roundMoney(minor / divisor), error: null };
}

function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  const zero = new Set(['BIF','CLP','DJF','GNF','JPY','KMF','KRW','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF']);
  const three = new Set(['BHD','IQD','JOD','KWD','LYD','OMR','TND']);
  const four = new Set(['CLF','UYW']);
  if (zero.has(code)) return 0;
  if (three.has(code)) return 3;
  if (four.has(code)) return 4;
  return 2;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function graphUrl(path: string): URL {
  return new URL('https://graph.facebook.com/' + encodeURIComponent(META_GRAPH_API_VERSION) + path);
}

async function metaFetch(url: URL, accessToken: string): Promise<Response> {
  return fetch(url, {
    headers: { authorization: 'Bearer ' + accessToken },
    signal: AbortSignal.timeout(15000),
  });
}

async function recordSyncFailure(tenantId: string, message: string): Promise<void> {
  try {
    await admin!
      .from('tenant_whatsapp_catalog_settings')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'error',
        last_sync_error: message.slice(0, 400),
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);
  } catch {
    // Failure telemetry must not hide the original import error.
  }
}

async function decryptCredential(ciphertext: string, ivValue: string): Promise<J> {
  const keyBytes = fromBase64(WHATSAPP_ENCRYPTION_KEY);
  if (keyBytes.byteLength !== 32) {
    throw new Error('SellerTray merchant Meta credential decryption is not configured.');
  }
  const iv = fromBase64(ivValue);
  if (iv.byteLength !== 12) throw new Error('SellerTray merchant Meta credential IV is invalid.');

  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64(ciphertext));
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
    const code = typeof payload.error.code === 'number' ? payload.error.code : null;
    return message
      ? fallback + (code === null ? ': ' : ' (' + code + '): ') + message
      : fallback;
  }
  return fallback;
}

function isRecord(value: unknown): value is J {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const clean = String(value).trim().replace(/\s+/g, ' ');
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
  const raw = error instanceof Error ? error.message : 'Meta catalogue import failed';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
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
