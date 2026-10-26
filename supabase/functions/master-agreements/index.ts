import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action = 'merchant_get' | 'merchant_accept' | 'admin_get' | 'admin_publish';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 250_000;
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
  const userId = authData.user?.id ?? null;
  if (authError || !userId) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try { body = JSON.parse(bodyRead.text) as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported Master Agreement action' }, 400);

  try {
    if (action === 'merchant_get') {
      const tenantId = cleanUuid(body.tenantId);
      if (!tenantId) return json({ error: 'Business is required' }, 400);
      const center = await rpc<JsonRecord>('get_sellertray_master_agreement_center', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
      });
      return json({ ok: true, center });
    }

    if (action === 'merchant_accept') {
      const tenantId = cleanUuid(body.tenantId);
      const agreementVersionId = cleanUuid(body.agreementVersionId);
      const commandId = cleanUuid(body.commandId);
      const legalName = cleanText(body.legalName, 200);
      if (!tenantId || !agreementVersionId || !commandId || !legalName) {
        return json({ error: 'Business, current Master Agreement, legal name and command are required' }, 400);
      }
      if (body.authorityConfirmed !== true) {
        return json({ error: 'Confirm your authority and Master Agreement acceptance before continuing' }, 400);
      }

      const userAgent = cleanText(request.headers.get('user-agent'), 512);
      const acceptanceId = await rpc<string>('accept_sellertray_master_agreement', {
        p_tenant_id: tenantId,
        p_agreement_version_id: agreementVersionId,
        p_accepted_legal_name: legalName,
        p_request_evidence: {
          channel: 'merchant_web',
          authority_confirmed: true,
          ...(userAgent ? { user_agent: userAgent } : {}),
        },
        p_command_id: commandId,
        p_actor_user_id: userId,
      });

      await reconcileTenantInstallmentsBestEffort(tenantId, 'Master Agreement acceptance');
      const center = await rpc<JsonRecord>('get_sellertray_master_agreement_center', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
      });
      return json({ ok: true, acceptanceId, center });
    }

    if (action === 'admin_get') {
      const tenantId = optionalUuid(body.tenantId);
      if (body.tenantId !== null && body.tenantId !== undefined && body.tenantId !== '' && !tenantId) {
        return json({ error: 'A valid Business is required' }, 400);
      }
      const overview = await rpc<JsonRecord>('get_sellertray_master_agreement_admin', {
        p_actor_user_id: userId,
        p_tenant_id: tenantId,
      });
      return json({ ok: true, overview });
    }

    if (jwtAal(token) !== 'aal2') {
      return json({ error: 'MFA verification is required to publish a Master Agreement version' }, 403);
    }

    const versionCode = cleanText(body.versionCode, 64);
    const title = cleanText(body.title, 200);
    const contentBody = cleanRawText(body.contentBody, 200_000);
    const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
    const reason = cleanReason(body.reason);
    if (!versionCode || !title || !contentBody || !effectiveFrom || !reason) {
      return json({ error: 'Version, title, agreement content, effective time and publication reason are required' }, 400);
    }

    const agreementVersionId = await rpc<string>('publish_sellertray_master_agreement_admin', {
      p_version_code: versionCode,
      p_title: title,
      p_content_body: contentBody,
      p_effective_from: effectiveFrom,
      p_reason: reason,
      p_actor_user_id: userId,
    });
    const overview = await rpc<JsonRecord>('get_sellertray_master_agreement_admin', {
      p_actor_user_id: userId,
      p_tenant_id: optionalUuid(body.tenantId),
    });
    return json({ ok: true, agreementVersionId, overview }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Master Agreement request failed';
    return json({ error: message }, statusForError(message));
  }
});

async function reconcileTenantInstallmentsBestEffort(tenantId: string, source: string): Promise<void> {
  try {
    const results = await rpc<JsonRecord[]>('reconcile_sellertray_installment_entitlements_for_tenant', {
      p_tenant_id: tenantId,
    });
    const failures = Array.isArray(results) ? results.filter((row) => row?.ok !== true) : [];
    if (failures.length) console.error(`SellerTray entitlement reconciliation after ${source} requires review`, { tenantId, failures });
  } catch (error) {
    console.error(`SellerTray entitlement reconciliation after ${source} requires review`, {
      tenantId,
      error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown reconciliation error',
    });
  }
}

async function rpc<T>(name: string, args: JsonRecord): Promise<T> {
  if (!admin) throw new Error('Server configuration error');
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message ?? 'Master Agreement RPC failed');
  return data as T;
}

function cleanAction(value: unknown): Action | null {
  return value === 'merchant_get' || value === 'merchant_accept' || value === 'admin_get' || value === 'admin_publish'
    ? value
    : null;
}
function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}
function optionalUuid(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : cleanUuid(value);
}
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= max ? clean : null;
}
function cleanRawText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : null;
}
function cleanReason(value: unknown): string | null {
  const clean = cleanText(value, 1000);
  return clean && clean.length >= 6 ? clean : null;
}
function cleanIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  const parsed = Date.parse(clean);
  return clean && Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function jwtAal(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(normalized)) as JsonRecord;
    return typeof parsed.aal === 'string' ? parsed.aal : null;
  } catch { return null; }
}
function statusForError(message: string): number {
  if (/access|required|authori[sz]ed|owner|manager|capability|mfa/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  if (/already|different|conflict|current/i.test(message)) return 409;
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
