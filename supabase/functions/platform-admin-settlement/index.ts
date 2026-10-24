type JsonRecord = Record<string, unknown>;
type SettlementAction = 'center' | 'record_adjustment' | 'record_direct_payment' | 'publish_installment_policy';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 65_536;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Server configuration error' }, 500);

  const authorization = request.headers.get('authorization') ?? '';
  const identity = await verifiedIdentity(authorization);
  if (!identity) return json({ error: 'Authentication required' }, 401);
  if (identity.aal !== 'aal2') {
    return json({ error: 'MFA verification is required for ProcessEdge administrator access' }, 403);
  }

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try { body = JSON.parse(bodyRead.text) as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const action = cleanAction(body.action);
  const tenantId = cleanUuid(body.tenantId);
  if (!action) return json({ error: 'Unsupported commercial settlement action' }, 400);
  if (!tenantId) return json({ error: 'Business is required' }, 400);

  try {
    if (action === 'center') {
      const center = await rpc<JsonRecord>('platform_admin_commercial_settlement_center', {
        p_actor_user_id: identity.userId,
        p_tenant_id: tenantId,
      });
      return json({ ok: true, center });
    }

    if (action === 'record_adjustment') {
      const commercialOrderId = cleanUuid(body.commercialOrderId);
      const commandId = cleanUuid(body.commandId);
      const amount = cleanPositiveAmount(body.amount);
      const reason = cleanReason(body.reason);
      const evidence = cleanEvidence(body.evidence);
      if (!commercialOrderId || !commandId || amount === null || !reason || evidence === null) {
        return json({ error: 'Order, command, positive amount, reason and valid evidence are required' }, 400);
      }
      const order = await rpc<JsonRecord>('platform_admin_record_commercial_adjustment', {
        p_actor_user_id: identity.userId,
        p_tenant_id: tenantId,
        p_commercial_order_id: commercialOrderId,
        p_command_id: commandId,
        p_amount: amount,
        p_reason: reason,
        p_evidence: evidence,
      });
      return json({ ok: true, order }, 201);
    }

    if (action === 'record_direct_payment') {
      const commercialOrderId = cleanUuid(body.commercialOrderId);
      const commandId = cleanUuid(body.commandId);
      const paymentReference = cleanText(body.paymentReference, 160);
      const paymentMethod = cleanSlug(body.paymentMethod, 32);
      const amount = cleanPositiveAmount(body.amount);
      const paidAt = cleanIsoTimestamp(body.paidAt);
      const reason = cleanReason(body.reason);
      const evidence = cleanEvidence(body.evidence);
      if (!commercialOrderId || !commandId || !paymentReference || !paymentMethod || amount === null || !paidAt || !reason || evidence === null) {
        return json({ error: 'Order, command, payment reference, method, positive amount, payment time, reason and valid evidence are required' }, 400);
      }
      const order = await rpc<JsonRecord>('platform_admin_record_commercial_direct_payment', {
        p_actor_user_id: identity.userId,
        p_tenant_id: tenantId,
        p_commercial_order_id: commercialOrderId,
        p_command_id: commandId,
        p_payment_reference: paymentReference,
        p_payment_method: paymentMethod,
        p_amount: amount,
        p_paid_at: paidAt,
        p_reason: reason,
        p_evidence: evidence,
      });
      return json({ ok: true, order }, 201);
    }

    const commandId = cleanUuid(body.commandId);
    const scopeKind = cleanEnum(body.scopeKind, ['tenant', 'commercial_order'] as const);
    const commercialOrderId = optionalUuid(body.commercialOrderId);
    const billingCycle = cleanOptionalEnum(body.billingCycle, ['monthly', 'yearly'] as const);
    const templateId = optionalUuid(body.templateId);
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : null;
    const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
    const effectiveUntil = cleanOptionalTimestamp(body.effectiveUntil);
    const reason = cleanReason(body.reason);
    if (!commandId || !scopeKind || enabled === null || !effectiveFrom || effectiveUntil === undefined || !reason) {
      return json({ error: 'Command, scope, enabled state, effective time and reason are required' }, 400);
    }
    if (body.commercialOrderId && !commercialOrderId) return json({ error: 'Commercial order is invalid' }, 400);
    if (body.templateId && !templateId) return json({ error: 'Installment template is invalid' }, 400);
    if (body.billingCycle && !billingCycle) return json({ error: 'Billing cycle must be monthly or yearly' }, 400);
    if (scopeKind === 'tenant' && (!billingCycle || commercialOrderId)) {
      return json({ error: 'Business override requires a billing cycle and no commercial order' }, 400);
    }
    if (scopeKind === 'commercial_order' && (!commercialOrderId || billingCycle)) {
      return json({ error: 'Commercial-order override requires an order and no billing cycle' }, 400);
    }
    if (enabled && !templateId) return json({ error: 'Enabled installment override requires a governed template' }, 400);

    const center = await rpc<JsonRecord>('platform_admin_publish_installment_policy_override', {
      p_actor_user_id: identity.userId,
      p_tenant_id: tenantId,
      p_command_id: commandId,
      p_scope_kind: scopeKind,
      p_commercial_order_id: commercialOrderId,
      p_billing_cycle: billingCycle,
      p_enabled: enabled,
      p_template_id: enabled ? templateId : null,
      p_effective_from: effectiveFrom,
      p_effective_until: effectiveUntil,
      p_reason: reason,
    });
    return json({ ok: true, center }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Commercial settlement request failed';
    return json({ error: message }, statusForError(message));
  }
});

async function rpc<T>(name: string, body: JsonRecord): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `Commercial settlement RPC failed with HTTP ${response.status}`;
    try {
      const payload = await response.json() as JsonRecord;
      if (typeof payload.message === 'string' && payload.message) message = payload.message;
      else if (typeof payload.error === 'string' && payload.error) message = payload.error;
    } catch { /* keep bounded fallback */ }
    throw new Error(message);
  }
  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

async function verifiedIdentity(authorization: string): Promise<{ userId: string; aal: 'aal1' | 'aal2' } | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization },
  });
  if (!response.ok) return null;
  let user: JsonRecord;
  try { user = await response.json() as JsonRecord; } catch { return null; }
  const userId = cleanUuid(user.id);
  const aal = getJwtAal(token);
  return userId && aal ? { userId, aal } : null;
}

function getJwtAal(token: string): 'aal1' | 'aal2' | null {
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as JsonRecord;
    return payload.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch { return null; }
}

function cleanAction(value: unknown): SettlementAction | null {
  return value === 'center' || value === 'record_adjustment' || value === 'record_direct_payment' || value === 'publish_installment_policy'
    ? value
    : null;
}
function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}
function optionalUuid(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return cleanUuid(value);
}
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= max ? clean : null;
}
function cleanReason(value: unknown): string | null {
  const clean = cleanText(value, 1000);
  return clean && clean.length >= 6 ? clean : null;
}
function cleanSlug(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return clean.length <= max && /^[a-z][a-z0-9_-]*$/.test(clean) ? clean : null;
}
function cleanPositiveAmount(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null;
}
function cleanIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function cleanOptionalTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const clean = cleanIsoTimestamp(value);
  return clean ?? undefined;
}
function cleanEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : null;
}
function cleanOptionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (value === null || value === undefined || value === '') return null;
  return cleanEnum(value, allowed);
}
function cleanEvidence(value: unknown): JsonRecord | null {
  if (value === null || value === undefined) return {};
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}
function statusForError(message: string): number {
  if (/capability required|administrator access|required|not authorized|not authorised|permission/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  if (/already used|unique|duplicate/i.test(message)) return 409;
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
