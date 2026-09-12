type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ENCRYPTION_KEY = Deno.env.get('SELLERTRAY_PAYMENT_ENCRYPTION_KEY') || '';
const enc = new TextEncoder();

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return reply({ error: 'Server configuration error' }, 500);

  const requestId = safeRequestId(req.headers.get('x-request-id'));
  const userId = await verifiedUser(req.headers.get('authorization') || '');
  if (!userId) return reply({ error: 'Authentication required' }, 401, requestId);

  const raw = await limitedBody(req, 65536);
  if (raw === null) return reply({ error: 'Payload too large' }, 413, requestId);

  let body: J;
  try { body = JSON.parse(raw) as J; }
  catch { return reply({ error: 'Invalid JSON' }, 400, requestId); }

  const action = text(body.action);
  const tenantId = uuid(body.tenantId);
  if (!action || !tenantId) return reply({ error: 'action and tenantId are required' }, 400, requestId);

  try {
    if (action === 'save_method') {
      const methodType = paymentType(body.methodType);
      const displayName = bounded(body.displayName, 80);
      if (!methodType || !displayName) {
        return reply({ error: 'Valid methodType and displayName are required' }, 400, requestId);
      }

      const method = await rpc<J>('upsert_sellertray_payment_method', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
        p_method_id: uuid(body.methodId),
        p_method_type: methodType,
        p_display_name: displayName,
        p_is_enabled: body.isEnabled === true,
        p_is_default: body.isDefault === true,
        p_sort_order: integer(body.sortOrder, 0, 1000) ?? 100,
        p_mode: body.mode === 'test' ? 'test' : 'live',
        p_bank_name: optional(body.bankName, 120),
        p_bank_account_name: optional(body.bankAccountName, 160),
        p_bank_account_number: optional(body.bankAccountNumber, 80),
        p_bank_code: optional(body.bankCode, 40),
        p_instructions: optional(body.instructions, 500),
      });
      return reply({ method }, 200, requestId);
    }

    const methodId = uuid(body.methodId);
    if (!methodId) return reply({ error: 'methodId is required' }, 400, requestId);

    if (action === 'disconnect_gateway') {
      await rpc('clear_sellertray_gateway_credentials', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
        p_payment_method_id: methodId,
      });
      return reply({ ok: true }, 200, requestId);
    }

    if (action !== 'connect_gateway') {
      return reply({ error: 'Unsupported payment settings action' }, 400, requestId);
    }

    const provider = body.provider === 'paystack' || body.provider === 'flutterwave'
      ? String(body.provider)
      : null;
    if (!provider) return reply({ error: 'provider must be paystack or flutterwave' }, 400, requestId);
    if (!ENCRYPTION_KEY) {
      return reply({ error: 'Gateway credential storage is not activated yet' }, 503, requestId);
    }

    const secretKey = secret(body.secretKey);
    if (!secretKey) return reply({ error: 'A valid gateway secret key is required' }, 400, requestId);

    const credentials: J = { secretKey };
    if (provider === 'flutterwave') {
      const secretHash = secret(body.secretHash);
      if (!secretHash) {
        return reply({ error: 'Flutterwave webhook secret hash is required' }, 400, requestId);
      }
      credentials.secretHash = secretHash;
    }

    const encrypted = await encrypt(credentials);
    const fingerprint = await fingerprintOf(secretKey);
    await rpc('save_sellertray_gateway_credentials', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
      p_payment_method_id: methodId,
      p_provider: provider,
      p_ciphertext: encrypted.ciphertext,
      p_iv: encrypted.iv,
      p_fingerprint: fingerprint,
      p_key_version: 1,
    });

    return reply({ ok: true, provider, fingerprint }, 200, requestId);
  } catch (e) {
    const message = sanitize(e instanceof Error ? e.message : 'Payment settings request failed');
    const status = /only the business Owner|Owner or Manager|read-only|not a member/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /unique|already/i.test(message)
          ? 409
          : 400;
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'payment-settings',
      event: 'request_failed',
      request_id: requestId,
      error: message,
    }));
    return reply({ error: message }, status, requestId);
  }
});

async function verifiedUser(auth: string): Promise<string | null> {
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SERVICE_KEY, authorization: auth },
  });
  if (!r.ok) return null;
  try {
    const user = await r.json() as J;
    return typeof user.id === 'string' && user.id ? user.id : null;
  } catch { return null; }
}

async function rpc<T = unknown>(name: string, body: J): Promise<T> {
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + encodeURIComponent(name), {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let payload: J = {};
    try { payload = await r.json() as J; } catch {}
    const message = typeof payload.message === 'string'
      ? payload.message
      : typeof payload.error === 'string'
        ? payload.error
        : 'Payment settings RPC failed with HTTP ' + r.status;
    throw new Error(message);
  }
  const value = await r.text();
  return (value ? JSON.parse(value) : null) as T;
}

async function encrypt(value: J): Promise<{ ciphertext: string; iv: string }> {
  const keyBytes = fromBase64(ENCRYPTION_KEY);
  if (keyBytes.byteLength !== 32) throw new Error('Gateway credential encryption key is invalid');
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
  return { ciphertext: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) };
}

async function fingerprintOf(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)));
  return Array.from(digest.slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function paymentType(v: unknown): string | null {
  return typeof v === 'string' && [
    'bank_transfer', 'paystack', 'flutterwave', 'cash_on_delivery', 'pay_on_pickup',
  ].includes(v) ? v : null;
}
function uuid(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const x = v.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x) ? x : null;
}
function text(v: unknown): string | null { return typeof v === 'string' && v.trim() ? v.trim() : null; }
function bounded(v: unknown, max: number): string | null {
  const x = text(v);
  return x && x.length <= max ? x : null;
}
function optional(v: unknown, max: number): string | null {
  return v === null || v === undefined || v === '' ? null : bounded(v, max);
}
function secret(v: unknown): string | null {
  const x = text(v);
  return x && x.length >= 12 && x.length <= 512 ? x : null;
}
function integer(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}
function safeRequestId(v: string | null): string {
  const x = v?.trim() || '';
  return /^[A-Za-z0-9._:-]{1,128}$/.test(x) ? x : crypto.randomUUID();
}
function sanitize(v: string): string {
  return v
    .replace(/\b(?:sk|FLWSECK|sb_secret)[-_][A-Za-z0-9_-]+\b/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}
function fromBase64(v: string): Uint8Array {
  try { return Uint8Array.from(atob(v), (c) => c.charCodeAt(0)); }
  catch { return new Uint8Array(); }
}
function toBase64(v: Uint8Array): string {
  let raw = '';
  for (const b of v) raw += String.fromCharCode(b);
  return btoa(raw);
}
async function limitedBody(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > max) { await reader.cancel(); return null; }
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}
function reply(payload: J, status = 200, requestId?: string): Response {
  const headers: Record<string, string> = {
    ...cors,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  if (requestId) headers['x-orderdesk-request-id'] = requestId;
  return new Response(JSON.stringify(payload), { status, headers });
}
