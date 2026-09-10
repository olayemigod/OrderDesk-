type JsonRecord = Record<string, unknown>;

type ClaimedNotification = {
  id: string;
  delivery_status: string;
  from_phone_number_id: string;
  to_wa_id: string;
  message_body: string;
  attempt_count: number;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WORKER_TOKEN = Deno.env.get('NOTIFICATION_WORKER_TOKEN') ?? '';
const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN') ?? '';
const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION') ?? '';

Deno.serve(async (request) => {
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
});

async function claimNotifications(limit: number): Promise<ClaimedNotification[]> {
  return rest<ClaimedNotification[]>('/rest/v1/rpc/claim_outbound_notifications', {
    method: 'POST',
    body: JSON.stringify({ p_limit: limit }),
  });
}

async function deliver(notification: ClaimedNotification): Promise<string> {
  try {
    const response = await fetch(
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
    const retryMinutes = Math.min(30, Math.max(2, notification.attempt_count * 5));
    await finish(notification.id, {
      delivery_status: 'failed',
      last_error: error instanceof Error ? error.message.slice(0, 500) : 'WhatsApp provider request failed',
      available_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
    });
    return 'failed';
  }
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

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
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
