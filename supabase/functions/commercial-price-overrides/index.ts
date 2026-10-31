import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action = 'admin_publish_subscription_override' | 'admin_publish_setup_override';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 32_000;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const admin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  : null;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!admin) return json({ error: 'Server configuration error' }, 500);

  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json({ error: 'Authentication required' }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const actorUserId = authData.user?.id ?? null;
  if (authError || !actorUserId) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);
  let body: JsonRecord;
  try { body = JSON.parse(bodyRead.text) as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported commercial price override action' }, 400);

  const tenantId = cleanUuid(body.tenantId);
  const currency = cleanCurrency(body.currency);
  const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
  const effectiveUntil = cleanIsoTimestamp(body.effectiveUntil);
  const reason = cleanReason(body.reason);
  if (!tenantId || !currency || !effectiveFrom || !effectiveUntil || !reason) {
    return json({ error: 'Business, currency, effective window and reason are required' }, 400);
  }
  if (new Date(effectiveUntil) <= new Date(effectiveFrom)) {
    return json({ error: 'Commercial override expiry must be after its effective time' }, 400);
  }

  try {
    if (action === 'admin_publish_subscription_override') {
      const planCode = cleanText(body.planCode, 64);
      const monthlyGrossAmount = cleanPositiveAmount(body.monthlyGrossAmount);
      if (!planCode || monthlyGrossAmount === null) {
        return json({ error: 'Plan and positive monthly Business override are required' }, 400);
      }
      const result = await rpc<JsonRecord>('publish_sellertray_merchant_subscription_price_override_admin', {
        p_tenant_id: tenantId,
        p_plan_code: planCode,
        p_currency: currency,
        p_monthly_gross_amount: monthlyGrossAmount,
        p_effective_from: effectiveFrom,
        p_effective_until: effectiveUntil,
        p_reason: reason,
        p_actor_user_id: actorUserId,
      });
      return json({ ok: true, result }, 201);
    }

    const grossAmount = cleanPositiveAmount(body.grossAmount);
    if (grossAmount === null) return json({ error: 'Positive Branch setup Business override is required' }, 400);
    const priceVersionId = await rpc<string>('publish_sellertray_merchant_branch_setup_price_override_admin', {
      p_tenant_id: tenantId,
      p_currency: currency,
      p_gross_amount: grossAmount,
      p_effective_from: effectiveFrom,
      p_effective_until: effectiveUntil,
      p_reason: reason,
      p_actor_user_id: actorUserId,
    });
    return json({ ok: true, priceVersionId }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Commercial price override request failed';
    return json({ error: message }, statusForError(message));
  }
});

async function rpc<T>(name: string, args: JsonRecord): Promise<T> {
  if (!admin) throw new Error('Server configuration error');
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message ?? 'Commercial price override RPC failed');
  return data as T;
}

function cleanAction(value: unknown): Action | null {
  return value === 'admin_publish_subscription_override' || value === 'admin_publish_setup_override' ? value : null;
}
function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}
function cleanCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(clean) ? clean : null;
}
function cleanPositiveAmount(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric > 0 && numeric <= 1_000_000_000 ? Math.round(numeric * 100) / 100 : null;
}
function cleanReason(value: unknown): string | null {
  const valueText = cleanText(value, 1000);
  return valueText && valueText.length >= 6 ? valueText : null;
}
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= max ? clean : null;
}
function cleanIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  const parsed = Date.parse(clean);
  return clean && Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function statusForError(message: string): number {
  if (/access|required|authori[sz]ed|capability|platform admin|read-only/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  if (/already|conflict/i.test(message)) return 409;
  return 400;
}
async function readRequestTextLimited(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
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
      if (total > maxBytes) { await reader.cancel(); return { ok: false }; }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
