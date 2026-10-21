import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action =
  | 'merchant_list'
  | 'merchant_accept'
  | 'admin_overview'
  | 'admin_publish_template'
  | 'admin_issue'
  | 'admin_mark_setup_ready';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 400_000;
const AGREEMENT_FAMILIES = new Set([
  'terms_of_service',
  'subscription_order',
  'installment_agreement',
  'money_back_guarantee_terms',
  'branch_setup_equipment_acknowledgement',
  'privacy_data_terms',
]);
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
  if (!action) return json({ error: 'Unsupported commercial agreement action' }, 400);

  try {
    if (action === 'merchant_list') {
      const tenantId = cleanUuid(body.tenantId);
      if (!tenantId) return json({ error: 'Business is required' }, 400);
      const [center, installmentBilling] = await Promise.all([
        rpc<JsonRecord>('get_sellertray_commercial_agreement_center', {
          p_tenant_id: tenantId,
          p_actor_user_id: userId,
        }),
        rpc<JsonRecord[]>('get_sellertray_installment_billing_states_for_tenant', {
          p_tenant_id: tenantId,
          p_actor_user_id: userId,
        }),
      ]);
      return json({ ok: true, center: { ...center, installmentBilling } });
    }

    if (action === 'merchant_accept') {
      const tenantId = cleanUuid(body.tenantId);
      const agreementId = cleanUuid(body.agreementId);
      const commandId = cleanUuid(body.commandId);
      const legalName = cleanText(body.legalName, 200);
      if (!tenantId || !agreementId || !commandId) return json({ error: 'Business, agreement and acceptance command are required' }, 400);
      if (!legalName) return json({ error: 'Enter the authorised representative legal name' }, 400);
      if (body.authorityConfirmed !== true) return json({ error: 'Confirm your authority and agreement acceptance before continuing' }, 400);

      const userAgent = cleanText(request.headers.get('user-agent'), 512);
      const acceptanceId = await rpc<string>('accept_sellertray_commercial_agreement', {
        p_tenant_id: tenantId,
        p_agreement_id: agreementId,
        p_accepted_legal_name: legalName,
        p_request_evidence: {
          channel: 'merchant_web',
          authority_confirmed: true,
          ...(userAgent ? { user_agent: userAgent } : {}),
        },
        p_command_id: commandId,
        p_actor_user_id: userId,
      });

      // Acceptance is already an immutable committed fact. Reconciliation runs
      // separately so an unrelated runtime-subscription conflict cannot roll it back.
      await reconcileTenantInstallmentsBestEffort(tenantId, 'agreement acceptance');

      const [center, installmentBilling] = await Promise.all([
        rpc<JsonRecord>('get_sellertray_commercial_agreement_center', {
          p_tenant_id: tenantId,
          p_actor_user_id: userId,
        }),
        rpc<JsonRecord[]>('get_sellertray_installment_billing_states_for_tenant', {
          p_tenant_id: tenantId,
          p_actor_user_id: userId,
        }),
      ]);
      return json({ ok: true, acceptanceId, center: { ...center, installmentBilling } });
    }

    if (action === 'admin_overview') {
      const tenantId = body.tenantId === null || body.tenantId === undefined || body.tenantId === '' ? null : cleanUuid(body.tenantId);
      if (body.tenantId !== null && body.tenantId !== undefined && body.tenantId !== '' && !tenantId) return json({ error: 'A valid business is required' }, 400);
      const overview = await rpc<JsonRecord>('get_sellertray_commercial_agreement_admin', {
        p_actor_user_id: userId,
        p_tenant_id: tenantId,
      });
      const installmentBilling = tenantId
        ? await rpc<JsonRecord[]>('get_sellertray_installment_billing_states_for_admin', {
            p_tenant_id: tenantId,
            p_actor_user_id: userId,
          })
        : [];
      return json({ ok: true, overview: { ...overview, installmentBilling } });
    }

    if (action === 'admin_publish_template') {
      const family = cleanFamily(body.family);
      const versionCode = cleanText(body.versionCode, 64);
      const title = cleanText(body.title, 200);
      const contentBody = cleanRawText(body.contentBody, 200_000);
      const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
      if (!family || !versionCode || !title || !contentBody || !effectiveFrom) {
        return json({ error: 'Agreement family, version, title, content and effective time are required' }, 400);
      }
      const templateId = await rpc<string>('publish_sellertray_commercial_agreement_template_version', {
        p_agreement_family: family,
        p_version_code: versionCode,
        p_title: title,
        p_content_body: contentBody,
        p_effective_from: effectiveFrom,
        p_actor_user_id: userId,
      });
      const overview = await rpc<JsonRecord>('get_sellertray_commercial_agreement_admin', {
        p_actor_user_id: userId,
        p_tenant_id: null,
      });
      return json({ ok: true, templateId, overview }, 201);
    }

    if (action === 'admin_mark_setup_ready') {
      const tenantId = cleanUuid(body.tenantId);
      const commercialOrderId = cleanUuid(body.commercialOrderId);
      const branchId = cleanUuid(body.branchId);
      const commandId = cleanUuid(body.commandId);
      const reason = cleanText(body.reason, 1000);
      const readyAt = cleanIsoTimestamp(body.readyAt);
      const evidence = isRecord(body.evidence) ? body.evidence : {};
      if (!tenantId || !commercialOrderId || !branchId || !commandId || !reason || !readyAt) {
        return json({ error: 'Business, commercial order, Branch, command, reason and setup time are required' }, 400);
      }

      const readinessId = await rpc<string>('mark_sellertray_commercial_branch_setup_ready', {
        p_tenant_id: tenantId,
        p_commercial_order_id: commercialOrderId,
        p_branch_id: branchId,
        p_command_id: commandId,
        p_evidence: evidence,
        p_reason: reason,
        p_ready_at: readyAt,
        p_actor_user_id: userId,
      });

      // Setup readiness is also an independent immutable fact. Never make its
      // persistence contingent on successful runtime entitlement reconciliation.
      await reconcileTenantInstallmentsBestEffort(tenantId, 'setup readiness');

      const [overview, installmentBilling] = await Promise.all([
        rpc<JsonRecord>('get_sellertray_commercial_agreement_admin', {
          p_actor_user_id: userId,
          p_tenant_id: tenantId,
        }),
        rpc<JsonRecord[]>('get_sellertray_installment_billing_states_for_admin', {
          p_tenant_id: tenantId,
          p_actor_user_id: userId,
        }),
      ]);
      return json({ ok: true, readinessId, overview: { ...overview, installmentBilling } });
    }

    const tenantId = cleanUuid(body.tenantId);
    const commercialOrderId = cleanUuid(body.commercialOrderId);
    const templateVersionId = cleanUuid(body.templateVersionId);
    const installmentObligationId = body.installmentObligationId === null || body.installmentObligationId === undefined || body.installmentObligationId === ''
      ? null
      : cleanUuid(body.installmentObligationId);
    const supersedesAgreementId = body.supersedesAgreementId === null || body.supersedesAgreementId === undefined || body.supersedesAgreementId === ''
      ? null
      : cleanUuid(body.supersedesAgreementId);
    const reference = cleanText(body.reference, 128);
    const renderedContent = cleanRawText(body.renderedContent, 300_000);
    if (!tenantId || !commercialOrderId || !templateVersionId || !reference || !renderedContent) {
      return json({ error: 'Business, commercial order, template, reference and agreement content are required' }, 400);
    }
    if (body.installmentObligationId && !installmentObligationId) return json({ error: 'A valid installment obligation is required' }, 400);
    if (body.supersedesAgreementId && !supersedesAgreementId) return json({ error: 'A valid replacement agreement is required' }, 400);

    const agreementId = await rpc<string>('issue_sellertray_commercial_agreement', {
      p_tenant_id: tenantId,
      p_commercial_order_id: commercialOrderId,
      p_installment_obligation_id: installmentObligationId,
      p_template_version_id: templateVersionId,
      p_agreement_reference: reference,
      p_rendered_content: renderedContent,
      p_supersedes_agreement_id: supersedesAgreementId,
      p_actor_user_id: userId,
    });
    const [overview, installmentBilling] = await Promise.all([
      rpc<JsonRecord>('get_sellertray_commercial_agreement_admin', {
        p_actor_user_id: userId,
        p_tenant_id: tenantId,
      }),
      rpc<JsonRecord[]>('get_sellertray_installment_billing_states_for_admin', {
        p_tenant_id: tenantId,
        p_actor_user_id: userId,
      }),
    ]);
    return json({ ok: true, agreementId, overview: { ...overview, installmentBilling } }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Commercial agreement request failed';
    return json({ error: message }, statusForError(message));
  }
});

async function reconcileTenantInstallmentsBestEffort(tenantId: string, source: string): Promise<void> {
  try {
    await rpc<JsonRecord[]>('reconcile_sellertray_installment_entitlements_for_tenant', {
      p_tenant_id: tenantId,
    });
  } catch (error) {
    console.error(`SellerTray installment reconciliation after ${source} requires review`, {
      tenantId,
      error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown reconciliation error',
    });
  }
}

async function rpc<T>(name: string, args: JsonRecord): Promise<T> {
  if (!admin) throw new Error('Server configuration error');
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message ?? 'Commercial agreement RPC failed');
  return data as T;
}

function cleanAction(value: unknown): Action | null {
  return value === 'merchant_list'
    || value === 'merchant_accept'
    || value === 'admin_overview'
    || value === 'admin_publish_template'
    || value === 'admin_issue'
    || value === 'admin_mark_setup_ready'
    ? value
    : null;
}
function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}
function cleanFamily(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return AGREEMENT_FAMILIES.has(clean) ? clean : null;
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
function cleanIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  const parsed = Date.parse(clean);
  return clean && Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function statusForError(message: string): number {
  if (/access|required|authori[sz]ed|owner|manager|platform administrator|read-only/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  if (/already|replaced|supersed|different facts|different contractual|conflict/i.test(message)) return 409;
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
