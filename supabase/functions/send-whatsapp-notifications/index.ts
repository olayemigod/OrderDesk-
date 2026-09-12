type JsonRecord = Record<string, unknown>;

type ClaimedNotification = {
  id: string;
  delivery_status: string;
  from_phone_number_id: string;
  to_wa_id: string;
  message_body: string;
  attempt_count: number;
  media_type: 'document' | null;
  storage_bucket: string | null;
  storage_path: string | null;
  media_filename: string | null;
  media_mime_type: string | null;
  conversation_window_expires_at: string | null;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WORKER_TOKEN = Deno.env.get('NOTIFICATION_WORKER_TOKEN') ?? '';
const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN') ?? '';
const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION') ?? '';
const META_TEXT_TEMPLATE_NAME = Deno.env.get('META_TEXT_TEMPLATE_NAME')?.trim() ?? '';
const META_DOCUMENT_TEMPLATE_NAME = Deno.env.get('META_DOCUMENT_TEMPLATE_NAME')?.trim() ?? '';
const META_TEMPLATE_LANGUAGE_CODE = Deno.env.get('META_TEMPLATE_LANGUAGE_CODE')?.trim() || 'en_US';

Deno.serve(withObservability('send-whatsapp-notifications', async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !WORKER_TOKEN || !META_ACCESS_TOKEN || !META_GRAPH_API_VERSION) {
    console.error('WhatsApp notification worker is not activated: required server secrets are missing.');
    return json({ error: 'Notification worker not configured' }, 503);
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (!constantTimeEqual(authorization, `Bearer ${WORKER_TOKEN}`)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const claimed = await claimNotifications(20);
  const results: Array<{ id: string; status: string }> = [];

  for (const notification of claimed) {
    const outcome = await deliver(notification);
    results.push({ id: notification.id, status: outcome });
  }

  return json({ claimed: claimed.length, results }, 200);
}));

async function claimNotifications(limit: number): Promise<ClaimedNotification[]> {
  return rest<ClaimedNotification[]>('/rest/v1/rpc/claim_outbound_notifications', {
    method: 'POST',
    body: JSON.stringify({ p_limit: limit }),
  });
}

async function deliver(notification: ClaimedNotification): Promise<string> {
  try {
    const requiresTemplate = !notification.conversation_window_expires_at ||
      new Date(notification.conversation_window_expires_at).getTime() <= Date.now();

    const response = requiresTemplate
      ? await sendTemplateNotification(notification)
      : notification.media_type === 'document'
        ? await sendDocumentNotification(notification)
        : await sendTextNotification(notification);

    const raw = await response.text();
    if (!response.ok) {
      const providerError = parseMetaError(raw);
      if (providerError.code === 131047) {
        await finish(notification.id, {
          delivery_status: 'template_required',
          last_error: providerError.message,
        });
        return 'template_required';
      }

      const retryMinutes = Math.min(30, Math.max(2, notification.attempt_count * 5));
      await finish(notification.id, {
        delivery_status: 'failed',
        last_error: providerError.message,
        available_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
      });
      return 'failed';
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }

    const providerMessageId = extractProviderMessageId(payload);
    await finish(notification.id, {
      delivery_status: 'sent',
      provider_message_id: providerMessageId,
      last_error: null,
      sent_at: new Date().toISOString(),
    });
    return 'sent';
  } catch (error) {
    if (error instanceof TemplateConfigurationError) {
      await finish(notification.id, {
        delivery_status: 'template_required',
        last_error: error.message.slice(0, 500),
        available_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      });
      return 'template_required';
    }

    const retryMinutes = Math.min(30, Math.max(2, notification.attempt_count * 5));
    await finish(notification.id, {
      delivery_status: 'failed',
      last_error: error instanceof Error ? error.message.slice(0, 500) : 'WhatsApp provider request failed',
      available_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
    });
    return 'failed';
  }
}

class TemplateConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateConfigurationError';
  }
}

async function sendTemplateNotification(notification: ClaimedNotification): Promise<Response> {
  const isDocument = notification.media_type === 'document';
  const templateName = isDocument ? META_DOCUMENT_TEMPLATE_NAME : META_TEXT_TEMPLATE_NAME;

  if (!templateName) {
    throw new TemplateConfigurationError(
      isDocument
        ? 'Approved WhatsApp document template is not configured.'
        : 'Approved WhatsApp text template is not configured.',
    );
  }

  const components: JsonRecord[] = [];

  if (isDocument) {
    const bucket = notification.storage_bucket?.trim();
    const storagePath = notification.storage_path?.trim();
    const filename = notification.media_filename?.trim();
    const mimeType = notification.media_mime_type?.trim() || 'application/pdf';

    if (!bucket || !storagePath || !filename) {
      throw new Error('Document notification is missing governed Storage metadata.');
    }
    if (mimeType !== 'application/pdf') {
      throw new Error('SellerTray document delivery currently permits PDF receipts only.');
    }

    const document = await downloadPrivateDocument(bucket, storagePath, mimeType);
    const mediaId = await uploadMetaDocument(notification.from_phone_number_id, document, filename, mimeType);
    components.push({
      type: 'header',
      parameters: [{
        type: 'document',
        document: { id: mediaId, filename },
      }],
    });
  }

  components.push({
    type: 'body',
    parameters: [{
      type: 'text',
      text: notification.message_body.slice(0, 1024),
    }],
  });

  return metaFetch(
    `https://graph.facebook.com/${encodeURIComponent(META_GRAPH_API_VERSION)}/${encodeURIComponent(notification.from_phone_number_id)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${META_ACCESS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: notification.to_wa_id,
        type: 'template',
        template: {
          name: templateName,
          language: { code: META_TEMPLATE_LANGUAGE_CODE },
          components,
        },
      }),
    },
  );
}

async function sendTextNotification(notification: ClaimedNotification): Promise<Response> {
  return metaFetch(
    `https://graph.facebook.com/${encodeURIComponent(META_GRAPH_API_VERSION)}/${encodeURIComponent(notification.from_phone_number_id)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${META_ACCESS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: notification.to_wa_id,
        type: 'text',
        text: { preview_url: false, body: notification.message_body },
      }),
    },
  );
}

async function sendDocumentNotification(notification: ClaimedNotification): Promise<Response> {
  const bucket = notification.storage_bucket?.trim();
  const storagePath = notification.storage_path?.trim();
  const filename = notification.media_filename?.trim();
  const mimeType = notification.media_mime_type?.trim() || 'application/pdf';

  if (!bucket || !storagePath || !filename) {
    throw new Error('Document notification is missing governed Storage metadata.');
  }
  if (mimeType !== 'application/pdf') {
    throw new Error('SellerTray document delivery currently permits PDF receipts only.');
  }

  const document = await downloadPrivateDocument(bucket, storagePath, mimeType);
  const mediaId = await uploadMetaDocument(notification.from_phone_number_id, document, filename, mimeType);

  return metaFetch(
    `https://graph.facebook.com/${encodeURIComponent(META_GRAPH_API_VERSION)}/${encodeURIComponent(notification.from_phone_number_id)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${META_ACCESS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: notification.to_wa_id,
        type: 'document',
        document: {
          id: mediaId,
          filename,
          caption: notification.message_body.slice(0, 1024),
        },
      }),
    },
  );
}

async function downloadPrivateDocument(
  bucket: string,
  storagePath: string,
  mimeType: string,
): Promise<Blob> {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${encodedBucket}/${encodedPath}`,
    {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`Receipt Storage download failed (${response.status}): ${detail}`);
  }

  const bytes = await response.arrayBuffer();
  return new Blob([bytes], { type: mimeType });
}

async function uploadMetaDocument(
  phoneNumberId: string,
  document: Blob,
  filename: string,
  mimeType: string,
): Promise<string> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', document, filename);

  const response = await metaFetch(
    `https://graph.facebook.com/${encodeURIComponent(META_GRAPH_API_VERSION)}/${encodeURIComponent(phoneNumberId)}/media`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${META_ACCESS_TOKEN}`,
      },
      body: form,
    },
  );

  const raw = await response.text();
  if (!response.ok) {
    const providerError = parseMetaError(raw);
    throw new Error(`Meta media upload failed: ${providerError.message}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (!isRecord(payload) || typeof payload.id !== 'string' || !payload.id) {
    throw new Error('Meta media upload returned no media id.');
  }

  return payload.id;
}

async function finish(id: string, patch: JsonRecord): Promise<void> {
  await rest(`/rest/v1/outbound_notifications?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      ...patch,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function metaFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10000),
  });
}

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10000),
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase REST ${response.status}: ${detail.slice(0, 500)}`);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function parseMetaError(raw: string): { code: number | null; message: string } {
  try {
    const value = JSON.parse(raw) as unknown;
    if (isRecord(value) && isRecord(value.error)) {
      const code = typeof value.error.code === 'number' ? value.error.code : null;
      const message = typeof value.error.message === 'string'
        ? value.error.message.replace(/\s+/g, ' ').slice(0, 500)
        : `Meta request failed${code === null ? '' : ` (${code})`}`;
      return { code, message };
    }
  } catch {
    // Fall through to sanitized raw body.
  }

  return { code: null, message: raw.replace(/\s+/g, ' ').slice(0, 500) || 'Meta request failed' };
}

function extractProviderMessageId(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) return null;
  const first = value.messages[0];
  if (!isRecord(first) || typeof first.id !== 'string') return null;
  return first.id;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

type ObservabilityHandler = (request: Request) => Response | Promise<Response>;

function withObservability(service: string, handler: ObservabilityHandler): ObservabilityHandler {
  return async (request: Request) => {
    const requestId = observabilityRequestId(request);
    const startedAt = Date.now();
    const path = observabilityPath(request.url);

    emitObservability('info', {
      service,
      event: 'request_started',
      request_id: requestId,
      method: request.method,
      path,
    });

    try {
      const response = await handler(request);
      const durationMs = Math.max(0, Date.now() - startedAt);
      const level = response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info';

      emitObservability(level, {
        service,
        event: 'request_finished',
        request_id: requestId,
        method: request.method,
        path,
        status: response.status,
        duration_ms: durationMs,
      });

      const headers = new Headers(response.headers);
      headers.set('x-orderdesk-request-id', requestId);
      if (headers.has('access-control-allow-origin')) {
        const existing = headers.get('access-control-expose-headers');
        const exposed = new Set(
          (existing ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        );
        exposed.add('x-orderdesk-request-id');
        headers.set('access-control-expose-headers', [...exposed].join(', '));
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      emitObservability('error', {
        service,
        event: 'request_exception',
        request_id: requestId,
        method: request.method,
        path,
        duration_ms: Math.max(0, Date.now() - startedAt),
        error: sanitizeObservabilityError(error),
      });
      throw error;
    }
  };
}

function observabilityRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id')?.trim() ?? '';
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

function observabilityPath(urlValue: string): string {
  try {
    return new URL(urlValue).pathname;
  } catch {
    return '/';
  }
}

function sanitizeObservabilityError(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { name: 'UnknownError', message: 'Unhandled server error' };

  const message = error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|sb_secret)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);

  return {
    name: error.name || 'Error',
    message: message || 'Unhandled server error',
  };
}

function emitObservability(
  level: 'info' | 'warn' | 'error',
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...fields,
  });

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

