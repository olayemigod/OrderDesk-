import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action =
  | 'merchant_get'
  | 'merchant_confirm_package'
  | 'merchant_accept'
  | 'admin_get'
  | 'admin_publish'
  | 'admin_publish_order_form_template'
  | 'admin_issue_order_form';

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
      const center = await rpc<JsonRecord>('get_sellertray_agreement_package_center', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
      });
      return json({ ok: true, center });
    }

    if (action === 'merchant_accept') {
      return json({
        error: 'Master Agreement acceptance now completes with the exact current Order Form. Refresh Billing & agreements and confirm the purchase package.',
      }, 409);
    }

    if (action === 'merchant_confirm_package') {
      const tenantId = cleanUuid(body.tenantId);
      const orderFormId = cleanUuid(body.orderFormId);
      const commandId = cleanUuid(body.commandId);
      const legalName = cleanText(body.legalName, 200);
      if (!tenantId || !orderFormId || !commandId || !legalName) {
        return json({ error: 'Business, current Order Form, legal name and command are required' }, 400);
      }
      if (body.authorityConfirmed !== true) {
        return json({ error: 'Confirm your authority and purchase approval before continuing' }, 400);
      }

      const userAgent = cleanText(request.headers.get('user-agent'), 512);
      const result = await rpc<JsonRecord>('confirm_sellertray_agreement_package', {
        p_tenant_id: tenantId,
        p_order_form_id: orderFormId,
        p_confirmed_legal_name: legalName,
        p_request_evidence: {
          channel: 'merchant_web',
          authority_confirmed: true,
          ...(userAgent ? { user_agent: userAgent } : {}),
        },
        p_command_id: commandId,
        p_actor_user_id: userId,
      });

      await reconcileTenantInstallmentsBestEffort(tenantId, 'Agreement Package confirmation');
      const center = await rpc<JsonRecord>('get_sellertray_agreement_package_center', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
      });
      return json({ ok: true, result, center });
    }

    if (action === 'admin_get') {
      const tenantId = optionalUuid(body.tenantId);
      if (body.tenantId !== null && body.tenantId !== undefined && body.tenantId !== '' && !tenantId) {
        return json({ error: 'A valid Business is required' }, 400);
      }
      const overview = await rpc<JsonRecord>('get_sellertray_order_forms_admin', {
        p_actor_user_id: userId,
        p_tenant_id: tenantId,
      });
      return json({ ok: true, overview });
    }

    if (jwtAal(token) !== 'aal2') {
      return json({ error: 'MFA verification is required for this legal/commercial administrator action' }, 403);
    }

    if (action === 'admin_issue_order_form') {
      const tenantId = cleanUuid(body.tenantId);
      const commercialOrderId = cleanUuid(body.commercialOrderId);
      const installmentObligationId = optionalUuid(body.installmentObligationId);
      const templateVersionId = cleanUuid(body.templateVersionId);
      const orderFormReference = cleanText(body.orderFormReference, 128);
      const supersedesOrderFormId = optionalUuid(body.supersedesOrderFormId);
      const reason = cleanReason(body.reason);
      if (!tenantId || !commercialOrderId || !templateVersionId || !orderFormReference || !reason) {
        return json({ error: 'Business, commercial order, Order Form template, reference and reason are required' }, 400);
      }
      if (body.installmentObligationId && !installmentObligationId) {
        return json({ error: 'A valid installment obligation is required' }, 400);
      }
      if (body.supersedesOrderFormId && !supersedesOrderFormId) {
        return json({ error: 'A valid superseded Order Form is required' }, 400);
      }

      const orderFormId = await rpc<string>('issue_sellertray_commercial_order_form_admin', {
        p_tenant_id: tenantId,
        p_commercial_order_id: commercialOrderId,
        p_installment_obligation_id: installmentObligationId,
        p_template_version_id: templateVersionId,
        p_order_form_reference: orderFormReference,
        p_supersedes_order_form_id: supersedesOrderFormId,
        p_reason: reason,
        p_actor_user_id: userId,
      });
      const overview = await rpc<JsonRecord>('get_sellertray_order_forms_admin', {
        p_actor_user_id: userId,
        p_tenant_id: tenantId,
      });
      return json({ ok: true, orderFormId, overview }, 201);
    }

    if (action === 'admin_publish_order_form_template') {
      const family = cleanText(body.family, 64);
      const versionCode = cleanText(body.versionCode, 64);
      const title = cleanText(body.title, 200);
      const contentBody = cleanRawText(body.contentBody, 200_000);
      const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
      const reason = cleanReason(body.reason);
      if (!family || !versionCode || !title || !contentBody || !effectiveFrom || !reason) {
        return json({ error: 'Order Form family, version, title, content, effective time and publication reason are required' }, 400);
      }
      const templateVersionId = await rpc<string>('publish_sellertray_order_form_template_admin', {
        p_agreement_family: family,
        p_version_code: versionCode,
        p_title: title,
        p_content_body: contentBody,
        p_effective_from: effectiveFrom,
        p_reason: reason,
        p_actor_user_id: userId,
      });
      const overview = await rpc<JsonRecord>('get_sellertray_order_forms_admin', {
        p_actor_user_id: userId,
        p_tenant_id: optionalUuid(body.tenantId),
      });
      return json({ ok: true, templateVersionId, overview }, 201);
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
    const overview = await rpc<JsonRecord>('get_sellertray_order_forms_admin', {
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
  return value === 'merchant_get'
    || value === 'merchant_confirm_package'
    || value === 'merchant_accept'
    || value === 'admin_get'
    || value === 'admin_publish'
    || value === 'admin_publish_order_form_template'
    || value === 'admin_issue_order_form'
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
  if (/already|different|conflict|current|replaced|superseded/i.test(message)) return 409;
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
