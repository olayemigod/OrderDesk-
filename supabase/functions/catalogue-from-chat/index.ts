import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN') ?? '';
const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION') ?? '';
const CATALOGUE_BUCKET = 'sellertray-catalogue';
const CAPTURE_BUCKET = 'sellertray-chat-captures';
const MAX_BODY_BYTES = 65_536;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

  const role = await ownerManagerRole(tenantId, userId);
  if (!role) return reply({ error: 'Only the business Owner or Manager can manage catalogue chat captures' }, 403, requestId);

  const allowed = await consumeRateLimit(tenantId, userId);
  if (!allowed) return reply({ error: 'Too many catalogue actions. Try again shortly.' }, 429, requestId);

  try {
    if (action === 'list_captures') {
      const { data: rows, error } = await admin
        .from('inbound_message_media')
        .select(`
          id,
          inbound_message_id,
          customer_id,
          media_caption,
          media_mime_type,
          storage_bucket,
          storage_path,
          expires_at,
          created_at,
          customers(display_name,wa_id),
          catalogue_capture_candidates(id,status,suggested_name,suggested_category,suggested_price_ngn,catalog_item_id,created_at)
        `)
        .eq('tenant_id', tenantId)
        .eq('media_type', 'image')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const captures = [];
      for (const row of rows ?? []) {
        const candidate = Array.isArray(row.catalogue_capture_candidates)
          ? row.catalogue_capture_candidates[0] ?? null
          : row.catalogue_capture_candidates ?? null;
        if (candidate?.status === 'converted' || candidate?.status === 'rejected') continue;

        let previewUrl: string | null = null;
        if (row.storage_bucket && row.storage_path) {
          previewUrl = await storagePreviewUrl(row.storage_bucket, row.storage_path);
        }

        const customer = Array.isArray(row.customers) ? row.customers[0] ?? null : row.customers ?? null;
        captures.push({
          mediaId: row.id,
          inboundMessageId: row.inbound_message_id,
          customerId: row.customer_id,
          customerName: customer?.display_name ?? null,
          customerWaId: customer?.wa_id ?? null,
          caption: row.media_caption ?? null,
          mimeType: row.media_mime_type ?? null,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
          previewUrl,
          candidate,
        });
      }

      return reply({ captures }, 200, requestId);
    }

    if (action === 'preview_capture') {
      const inboundMessageId = cleanUuid(body.inboundMessageId);
      if (!inboundMessageId) return reply({ error: 'inboundMessageId is required' }, 400, requestId);

      const { data: media, error: mediaError } = await admin
        .from('inbound_message_media')
        .select('id,provider_media_id,media_mime_type,media_sha256,storage_bucket,storage_path,expires_at')
        .eq('tenant_id', tenantId)
        .eq('inbound_message_id', inboundMessageId)
        .maybeSingle();

      if (mediaError) throw mediaError;
      if (!media) return reply({ error: 'WhatsApp image capture not found' }, 404, requestId);
      if (new Date(media.expires_at).getTime() <= Date.now()) {
        return reply({ error: 'This WhatsApp image capture has expired' }, 410, requestId);
      }

      if (media.storage_bucket && media.storage_path) {
        const previewUrl = await storagePreviewUrl(media.storage_bucket, media.storage_path);
        if (previewUrl) return reply({ previewUrl, staged: true }, 200, requestId);
      }

      if (!META_ACCESS_TOKEN || !META_GRAPH_API_VERSION) {
        return reply({ error: 'WhatsApp media preview is not activated' }, 503, requestId);
      }

      const fetched = await fetchMetaImage(media.provider_media_id, media.media_mime_type, media.media_sha256);
      await ensureCaptureBucket();
      const extension = extensionForMime(fetched.mimeType);
      const storagePath = tenantId + '/' + media.id + '.' + extension;

      const { error: uploadError } = await admin.storage
        .from(CAPTURE_BUCKET)
        .upload(storagePath, fetched.bytes, {
          contentType: fetched.mimeType,
          cacheControl: '3600',
          upsert: true,
        });
      if (uploadError) throw uploadError;

      const { error: updateError } = await admin
        .from('inbound_message_media')
        .update({
          storage_bucket: CAPTURE_BUCKET,
          storage_path: storagePath,
          media_mime_type: fetched.mimeType,
          media_file_size: fetched.bytes.byteLength,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('id', media.id);
      if (updateError) throw updateError;

      const previewUrl = await storagePreviewUrl(CAPTURE_BUCKET, storagePath);
      if (!previewUrl) throw new Error('Unable to create private preview URL');
      return reply({ previewUrl, staged: true }, 200, requestId);
    }

    if (action === 'create_candidate') {
      const inboundMessageId = cleanUuid(body.inboundMessageId);
      if (!inboundMessageId) return reply({ error: 'inboundMessageId is required' }, 400, requestId);

      const { data: media, error: mediaError } = await admin
        .from('inbound_message_media')
        .select('id,tenant_id,inbound_message_id,customer_id,media_type,media_caption,media_mime_type,expires_at')
        .eq('tenant_id', tenantId)
        .eq('inbound_message_id', inboundMessageId)
        .maybeSingle();

      if (mediaError) throw mediaError;
      if (!media || media.media_type !== 'image') {
        return reply({ error: 'This WhatsApp message has no captured product image' }, 404, requestId);
      }
      if (new Date(media.expires_at).getTime() <= Date.now()) {
        return reply({ error: 'This chat image is no longer eligible for catalogue capture' }, 410, requestId);
      }

      const { data: existing, error: existingError } = await admin
        .from('catalogue_capture_candidates')
        .select('id,status,catalog_item_id,suggested_name,created_at')
        .eq('tenant_id', tenantId)
        .eq('inbound_message_id', inboundMessageId)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing) return reply({ candidate: existing, existing: true }, 200, requestId);

      const suggestedName = cleanText(media.media_caption, 160);
      const { data: created, error: createError } = await admin
        .from('catalogue_capture_candidates')
        .insert({
          tenant_id: tenantId,
          inbound_message_id: inboundMessageId,
          source_media_id: media.id,
          customer_id: media.customer_id,
          suggested_name: suggestedName,
          created_by: userId,
        })
        .select('id,status,catalog_item_id,suggested_name,created_at')
        .single();

      if (createError) throw createError;
      return reply({ candidate: created, existing: false }, 201, requestId);
    }

    if (action === 'reject_candidate') {
      const candidateId = cleanUuid(body.candidateId);
      if (!candidateId) return reply({ error: 'candidateId is required' }, 400, requestId);

      const { error } = await admin.rpc('reject_sellertray_catalogue_candidate', {
        p_tenant_id: tenantId,
        p_candidate_id: candidateId,
        p_actor_user_id: userId,
        p_review_note: cleanText(body.reviewNote, 500),
      });
      if (error) throw error;
      return reply({ ok: true }, 200, requestId);
    }

    if (action === 'convert_candidate') {
      const candidateId = cleanUuid(body.candidateId);
      const name = cleanText(body.name, 160);
      const sku = cleanText(body.sku, 80);
      const category = cleanText(body.category, 120);
      const priceNgn = optionalMoney(body.priceNgn);

      if (!candidateId || !name) {
        return reply({ error: 'candidateId and name are required' }, 400, requestId);
      }
      if (body.priceNgn !== undefined && body.priceNgn !== null && priceNgn === null) {
        return reply({ error: 'priceNgn must be a non-negative amount' }, 400, requestId);
      }

      const { data: candidate, error: candidateError } = await admin
        .from('catalogue_capture_candidates')
        .select('id,status,catalog_item_id,source_media_id')
        .eq('tenant_id', tenantId)
        .eq('id', candidateId)
        .maybeSingle();

      if (candidateError) throw candidateError;
      if (!candidate) return reply({ error: 'Catalogue chat candidate not found' }, 404, requestId);
      if (candidate.status === 'converted' && candidate.catalog_item_id) {
        return reply({ catalogItemId: candidate.catalog_item_id, existing: true }, 200, requestId);
      }
      if (candidate.status !== 'pending') {
        return reply({ error: 'Catalogue chat candidate is no longer pending' }, 409, requestId);
      }

      const { data: media, error: mediaError } = await admin
        .from('inbound_message_media')
        .select('id,provider_media_id,media_mime_type,media_sha256,storage_bucket,storage_path,expires_at')
        .eq('tenant_id', tenantId)
        .eq('id', candidate.source_media_id)
        .maybeSingle();

      if (mediaError) throw mediaError;
      if (!media) return reply({ error: 'Source chat image is unavailable' }, 404, requestId);
      if (new Date(media.expires_at).getTime() <= Date.now()) {
        return reply({ error: 'Source chat image has expired; ask the customer to resend it' }, 410, requestId);
      }
      let fetched: { bytes: ArrayBuffer; mimeType: string };
      const previousCaptureBucket = media.storage_bucket;
      const previousCapturePath = media.storage_path;

      if (previousCaptureBucket === CAPTURE_BUCKET && previousCapturePath) {
        const { data: staged, error: stagedError } = await admin.storage
          .from(CAPTURE_BUCKET)
          .download(previousCapturePath);
        if (stagedError || !staged) {
          if (!META_ACCESS_TOKEN || !META_GRAPH_API_VERSION) {
            return reply({ error: 'WhatsApp media capture is not activated' }, 503, requestId);
          }
          fetched = await fetchMetaImage(media.provider_media_id, media.media_mime_type, media.media_sha256);
        } else {
          const bytes = await staged.arrayBuffer();
          if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('WhatsApp catalogue image exceeds the 5 MB limit');
          fetched = { bytes, mimeType: media.media_mime_type || staged.type || 'image/jpeg' };
        }
      } else {
        if (!META_ACCESS_TOKEN || !META_GRAPH_API_VERSION) {
          return reply({ error: 'WhatsApp media capture is not activated' }, 503, requestId);
        }
        fetched = await fetchMetaImage(media.provider_media_id, media.media_mime_type, media.media_sha256);
      }

      await ensureCatalogueBucket();
      const extension = extensionForMime(fetched.mimeType);
      const storagePath = tenantId + '/' + candidateId + '.' + extension;

      const { error: uploadError } = await admin.storage
        .from(CATALOGUE_BUCKET)
        .upload(storagePath, fetched.bytes, {
          contentType: fetched.mimeType,
          cacheControl: '31536000',
          upsert: false,
        });

      if (uploadError && !isAlreadyExists(uploadError)) throw uploadError;

      const { data: publicData } = admin.storage.from(CATALOGUE_BUCKET).getPublicUrl(storagePath);
      const imageUrl = publicData.publicUrl;

      const { data: itemId, error: finalizeError } = await admin.rpc(
        'finalize_sellertray_catalogue_candidate_conversion',
        {
          p_tenant_id: tenantId,
          p_candidate_id: candidateId,
          p_actor_user_id: userId,
          p_name: name,
          p_sku: sku,
          p_category: category,
          p_price_ngn: priceNgn,
          p_image_url: imageUrl,
          p_storage_bucket: CATALOGUE_BUCKET,
          p_storage_path: storagePath,
        },
      );

      if (finalizeError || typeof itemId !== 'string') {
        throw finalizeError ?? new Error('Catalogue conversion returned no item id');
      }

      if (previousCaptureBucket === CAPTURE_BUCKET && previousCapturePath) {
        try {
          await admin.storage.from(CAPTURE_BUCKET).remove([previousCapturePath]);
        } catch {
          // Best-effort cleanup; the media row already points at the public catalogue image.
        }
      }

      return reply({ catalogItemId: itemId, imageUrl, existing: false }, 201, requestId);
    }

    return reply({ error: 'Unsupported catalogue chat action' }, 400, requestId);
  } catch (error) {
    const message = sanitizeError(error);
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'catalogue-from-chat',
      event: 'request_failed',
      request_id: requestId,
      action,
      tenant_id: tenantId,
      error: message,
    }));

    const status = /not found|unavailable/i.test(message)
      ? 404
      : /no longer pending|cannot be rejected|already/i.test(message)
        ? 409
        : 400;
    return reply({ error: message }, status, requestId);
  }
});

async function ownerManagerRole(tenantId: string, userId: string): Promise<string | null> {
  const { data, error } = await admin!
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const role = typeof data?.role === 'string' ? data.role : null;
  return role === 'owner' || role === 'manager' ? role : null;
}

async function consumeRateLimit(tenantId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin!.rpc('consume_sellertray_rate_limit', {
    p_scope: 'catalogue_from_chat',
    p_key: tenantId + ':' + userId,
    p_limit: 30,
    p_window_seconds: 60,
  });
  if (error) throw error;
  return data === true;
}

async function fetchMetaImage(
  mediaId: string,
  fallbackMime: string | null,
  expectedSha: string | null,
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const metadataResponse = await fetch(
    'https://graph.facebook.com/' + encodeURIComponent(META_GRAPH_API_VERSION) + '/' + encodeURIComponent(mediaId),
    {
      headers: { authorization: 'Bearer ' + META_ACCESS_TOKEN },
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!metadataResponse.ok) {
    throw new Error('Unable to retrieve WhatsApp image metadata');
  }

  const metadata = await metadataResponse.json() as J;
  const mediaUrl = typeof metadata.url === 'string' ? metadata.url : null;
  const mimeType = typeof metadata.mime_type === 'string' ? metadata.mime_type : fallbackMime;
  const declaredSize = typeof metadata.file_size === 'number' ? metadata.file_size : Number(metadata.file_size ?? 0);

  if (!mediaUrl || !mimeType || !['image/jpeg', 'image/png'].includes(mimeType)) {
    throw new Error('WhatsApp media is not a supported catalogue image');
  }
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
    throw new Error('WhatsApp catalogue image exceeds the 5 MB limit');
  }

  const fileResponse = await fetch(mediaUrl, {
    headers: { authorization: 'Bearer ' + META_ACCESS_TOKEN },
    signal: AbortSignal.timeout(15000),
  });
  if (!fileResponse.ok) throw new Error('Unable to download WhatsApp catalogue image');

  const bytes = await fileResponse.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('WhatsApp catalogue image exceeds the 5 MB limit');
  }

  if (expectedSha) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    const base64 = btoa(String.fromCharCode(...digest));
    if (expectedSha !== hex && expectedSha !== base64) {
      throw new Error('WhatsApp catalogue image integrity check failed');
    }
  }

  return { bytes, mimeType };
}

async function storagePreviewUrl(bucket: string, path: string): Promise<string | null> {
  if (bucket === CATALOGUE_BUCKET) {
    return admin!.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  const { data, error } = await admin!.storage.from(bucket).createSignedUrl(path, 10 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function ensureCaptureBucket(): Promise<void> {
  const { error } = await admin!.storage.createBucket(CAPTURE_BUCKET, {
    public: false,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    fileSizeLimit: '5MB',
  });
  if (error && !isAlreadyExists(error)) throw error;
}

async function ensureCatalogueBucket(): Promise<void> {
  const { error } = await admin!.storage.createBucket(CATALOGUE_BUCKET, {
    public: true,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    fileSizeLimit: '5MB',
  });
  if (error && !isAlreadyExists(error)) throw error;
}

function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as J;
  const message = typeof e.message === 'string' ? e.message : '';
  const status = Number(e.statusCode ?? e.status ?? 0);
  return status === 409 || /already exists|duplicate/i.test(message);
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function optionalMoney(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999.99) return null;
  return Math.round(amount * 100) / 100;
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
  const raw = error instanceof Error ? error.message : 'Catalogue chat request failed';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|sb_secret|FLWSECK)[-_][A-Za-z0-9_-]+\b/gi, '[redacted]')
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
