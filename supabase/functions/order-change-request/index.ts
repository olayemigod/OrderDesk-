import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 32_768;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin =
  SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      })
    : null;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (request.method !== 'POST') {
    return reply({ error: 'Method not allowed' }, 405);
  }

  if (!admin) {
    return reply({ error: 'Server configuration error' }, 500);
  }

  const userId = await authenticatedUserId(request);
  if (!userId) {
    return reply({ error: 'Authentication required' }, 401);
  }

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) {
    return reply({ error: 'Payload too large' }, 413);
  }

  let body: J;
  try {
    body = JSON.parse(bodyRead.text) as J;
  } catch {
    return reply({ error: 'Invalid JSON' }, 400);
  }

  const requestId = uuid(body.requestId);
  const action = text(body.action)?.toLowerCase() ?? null;

  if (!requestId || !action) {
    return reply(
      { error: 'requestId and action are required' },
      400,
    );
  }

  if (!['apply', 'resolve', 'reject'].includes(action)) {
    return reply({ error: 'Unsupported action' }, 400);
  }

  try {
    const { data, error } = await admin.rpc(
      'resolve_sellertray_customer_order_change',
      {
        p_request_id: requestId,
        p_actor_user_id: userId,
        p_action: action,
      },
    );

    if (error) {
      return rpcErrorReply(error.message);
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return reply(
        { error: 'SellerTray could not complete this order request' },
        500,
      );
    }

    return reply(data as J);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to resolve customer request';

    return reply(
      { error: sanitizeMessage(message) },
      400,
    );
  }
});

async function authenticatedUserId(
  request: Request,
): Promise<string | null> {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';

  if (!token || !admin) {
    return null;
  }

  const { data, error } = await admin.auth.getUser(token);

  if (error || !data.user?.id) {
    return null;
  }

  return data.user.id;
}

function rpcErrorReply(message: string): Response {
  const clean = sanitizeMessage(message);
  const lower = clean.toLowerCase();

  if (
    lower.includes('permission') ||
    lower.includes('access to this order branch') ||
    lower.includes('subscription is read-only')
  ) {
    return reply({ error: clean }, 403);
  }

  if (
    lower.includes('not found') ||
    lower.includes('unavailable')
  ) {
    return reply({ error: clean }, 404);
  }

  if (
    lower.includes('can no longer') ||
    lower.includes('review') ||
    lower.includes('open the order')
  ) {
    return reply({ error: clean }, 409);
  }

  return reply({ error: clean }, 400);
}

function uuid(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const clean = value.trim();

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    clean,
  )
    ? clean
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null;
}

function sanitizeMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 400);
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<
  { ok: true; text: string } | { ok: false }
> {
  const declared = Number(
    request.headers.get('content-length') ?? 0,
  );

  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false };
  }

  if (!request.body) {
    return { ok: true, text: '' };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      total += result.value.byteLength;

      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }

      parts.push(
        decoder.decode(result.value, { stream: true }),
      );
    }

    parts.push(decoder.decode());

    return {
      ok: true,
      text: parts.join(''),
    };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader may already have been released after cancellation.
    }
  }
}

function reply(
  payload: J,
  status = 200,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
