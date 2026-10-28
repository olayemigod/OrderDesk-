import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action =
  | 'merchant_list'
  | 'merchant_accept'
  | 'admin_overview'
  | 'admin_onboarding'
  | 'admin_publish_subscription_price'
  | 'admin_publish_setup_price'
  | 'admin_publish_subscription_override'
  | 'admin_publish_setup_override'
  | 'admin_create_initial_purchase'
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
const INSTALLMENT_STRUCTURES = new Set([
  'two_installment_70_30',
  'three_installment_60_20_20',
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
      await authorizeMerchantAgreementRead(tenantId, userId);
      await reconcileTenantInstallmentsBestEffort(tenantId, 'merchant agreement center');
      return json({ ok: true, center: await loadMerchantCenter(tenantId, userId) });
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
      await reconcileTenantInstallmentsBestEffort(tenantId, 'agreement acceptance');
      return json({ ok: true, acceptanceId, center: await loadMerchantCenter(tenantId, userId) });
    }

    if (action === 'admin_overview') {
      const tenantId = optionalUuid(body.tenantId);
      if (body.tenantId !== null && body.tenantId !== undefined && body.tenantId !== '' && !tenantId) return json({ error: 'A valid business is required' }, 400);
      await authorizeAdminAgreementRead(tenantId, userId);
      if (tenantId) await reconcileTenantInstallmentsBestEffort(tenantId, 'admin commercial overview');
      return json({ ok: true, overview: await loadAdminOverview(tenantId, userId) });
    }

    if (action === 'admin_onboarding') {
      const tenantId = cleanUuid(body.tenantId);
      if (!tenantId) return json({ error: 'Business is required' }, 400);
      const onboarding = await rpc<JsonRecord>('get_sellertray_commercial_onboarding_admin', {
        p_actor_user_id: userId,
        p_tenant_id: tenantId,
      });
      return json({ ok: true, onboarding });
    }

    if (action === 'admin_publish_subscription_price') {
      const tenantId = optionalUuid(body.tenantId);
      const planCode = cleanText(body.planCode, 64);
      const currency = cleanCurrency(body.currency);
      const monthlyGrossAmount = cleanPositiveAmount(body.monthlyGrossAmount);
      const taxRatePercent = cleanOptionalPercent(body.taxRatePercent);
      const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
      const reason = cleanReason(body.reason);
      if (!planCode || !currency || monthlyGrossAmount === null || !effectiveFrom || !reason || taxRatePercent === undefined) {
        return json({ error: 'Plan, currency, positive monthly price, effective time and reason are required' }, 400);
      }
      const result = await rpc<JsonRecord>('publish_sellertray_subscription_price_pair_admin', {
        p_plan_code: planCode,
        p_currency: currency,
        p_monthly_gross_amount: monthlyGrossAmount,
        p_tax_rate_percent: taxRatePercent,
        p_effective_from: effectiveFrom,
        p_reason: reason,
        p_actor_user_id: userId,
      });
      return json({ ok: true, result, ...(tenantId ? { onboarding: await loadAdminOnboarding(tenantId, userId) } : {}) }, 201);
    }

    if (action === 'admin_publish_setup_price') {
      const tenantId = optionalUuid(body.tenantId);
      const currency = cleanCurrency(body.currency);
      const grossAmount = cleanPositiveAmount(body.grossAmount);
      const taxRatePercent = cleanOptionalPercent(body.taxRatePercent);
      const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
      const reason = cleanReason(body.reason);
      if (!currency || grossAmount === null || !effectiveFrom || !reason || taxRatePercent === undefined) {
        return json({ error: 'Currency, positive Branch setup price, effective time and reason are required' }, 400);
      }
      const priceVersionId = await rpc<string>('publish_sellertray_branch_setup_price_admin', {
        p_currency: currency,
        p_gross_amount: grossAmount,
        p_tax_rate_percent: taxRatePercent,
        p_effective_from: effectiveFrom,
        p_reason: reason,
        p_actor_user_id: userId,
      });
      return json({ ok: true, priceVersionId, ...(tenantId ? { onboarding: await loadAdminOnboarding(tenantId, userId) } : {}) }, 201);
    }

    if (action === 'admin_publish_subscription_override') {
      if (jwtAal(token) !== 'aal2') return json({ error: 'MFA/AAL2 required for merchant-specific pricing' }, 403);
      const tenantId = cleanUuid(body.tenantId);
      const planCode = cleanText(body.planCode, 64);
      const currency = cleanCurrency(body.currency);
      const monthlyGrossAmount = cleanPositiveAmount(body.monthlyGrossAmount);
      const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
      const effectiveUntil = cleanOptionalIsoTimestamp(body.effectiveUntil);
      const reason = cleanReason(body.reason);
      if (!tenantId || !planCode || !currency || monthlyGrossAmount === null || !effectiveFrom || effectiveUntil === undefined || !reason) {
        return json({ error: 'Business, plan, currency, positive monthly override, effective time and reason are required' }, 400);
      }
      const result = await rpc<JsonRecord>('publish_sellertray_merchant_subscription_price_override_admin', {
        p_tenant_id: tenantId,
        p_plan_code: planCode,
        p_currency: currency,
        p_monthly_gross_amount: monthlyGrossAmount,
        p_effective_from: effectiveFrom,
        p_effective_until: effectiveUntil,
        p_reason: reason,
        p_actor_user_id: userId,
      });
      return json({ ok: true, result, onboarding: await loadAdminOnboarding(tenantId, userId) }, 201);
    }

    if (action === 'admin_publish_setup_override') {
      if (jwtAal(token) !== 'aal2') return json({ error: 'MFA/AAL2 required for merchant-specific pricing' }, 403);
      const tenantId = cleanUuid(body.tenantId);
      const currency = cleanCurrency(body.currency);
      const grossAmount = cleanPositiveAmount(body.grossAmount);
      const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
      const effectiveUntil = cleanOptionalIsoTimestamp(body.effectiveUntil);
      const reason = cleanReason(body.reason);
      if (!tenantId || !currency || grossAmount === null || !effectiveFrom || effectiveUntil === undefined || !reason) {
        return json({ error: 'Business, currency, positive setup override, effective time and reason are required' }, 400);
      }
      const priceVersionId = await rpc<string>('publish_sellertray_merchant_branch_setup_price_override_admin', {
        p_tenant_id: tenantId,
        p_currency: currency,
        p_gross_amount: grossAmount,
        p_effective_from: effectiveFrom,
        p_effective_until: effectiveUntil,
        p_reason: reason,
        p_actor_user_id: userId,
      });
      return json({ ok: true, priceVersionId, onboarding: await loadAdminOnboarding(tenantId, userId) }, 201);
    }

    if (action === 'admin_create_initial_purchase') {
      const tenantId = cleanUuid(body.tenantId);
      const planCode = cleanText(body.planCode, 64);
      const currency = cleanCurrency(body.currency);
      const branchIds = cleanUuidArray(body.branchIds);
      const structureCode = cleanInstallmentStructure(body.structureCode);
      const orderReference = cleanText(body.orderReference, 128);
      const reason = cleanReason(body.reason);
      if (!tenantId || !planCode || !currency || !branchIds?.length || !structureCode || !orderReference || !reason) {
        return json({ error: 'Business, plan, currency, Branches, installment structure, order reference and reason are required' }, 400);
      }
      const purchase = await rpc<JsonRecord>('create_sellertray_initial_installment_purchase_admin', {
        p_tenant_id: tenantId,
        p_plan_code: planCode,
        p_currency: currency,
        p_branch_ids: branchIds,
        p_structure_code: structureCode,
        p_order_reference: orderReference,
        p_reason: reason,
        p_actor_user_id: userId,
      });
      return json({ ok: true, purchase, onboarding: await loadAdminOnboarding(tenantId, userId) }, 201);
    }

    if (action === 'admin_publish_template') {
      const family = cleanFamily(body.family);
      const versionCode = cleanText(body.versionCode, 64);
      const title = cleanText(body.title, 200);
      const contentBody = cleanRawText(body.contentBody, 200_000);
      const effectiveFrom = cleanIsoTimestamp(body.effectiveFrom);
      const reason = cleanReason(body.reason);
      if (!family || !versionCode || !title || !contentBody || !effectiveFrom || !reason) {
        return json({ error: 'Agreement family, version, title, content, effective time and reason are required' }, 400);
      }
      const templateId = await rpc<string>('publish_sellertray_commercial_agreement_template_admin', {
        p_agreement_family: family,
        p_version_code: versionCode,
        p_title: title,
        p_content_body: contentBody,
        p_effective_from: effectiveFrom,
        p_reason: reason,
        p_actor_user_id: userId,
      });
      return json({ ok: true, templateId, overview: await loadAdminOverview(null, userId) }, 201);
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
      await reconcileTenantInstallmentsBestEffort(tenantId, 'setup readiness');
      return json({ ok: true, readinessId, overview: await loadAdminOverview(tenantId, userId) });
    }

    const tenantId = cleanUuid(body.tenantId);
    const commercialOrderId = cleanUuid(body.commercialOrderId);
    const templateVersionId = cleanUuid(body.templateVersionId);
    const installmentObligationId = optionalUuid(body.installmentObligationId);
    const supersedesAgreementId = optionalUuid(body.supersedesAgreementId);
    const reference = cleanText(body.reference, 128);
    const renderedContent = cleanRawText(body.renderedContent, 300_000);
    const reason = cleanReason(body.reason);
    if (!tenantId || !commercialOrderId || !templateVersionId || !reference || !renderedContent || !reason) {
      return json({ error: 'Business, commercial order, template, reference, agreement content and reason are required' }, 400);
    }
    if (body.installmentObligationId && !installmentObligationId) return json({ error: 'A valid installment obligation is required' }, 400);
    if (body.supersedesAgreementId && !supersedesAgreementId) return json({ error: 'A valid replacement agreement is required' }, 400);

    const agreementId = await rpc<string>('issue_sellertray_commercial_agreement_admin', {
      p_tenant_id: tenantId,
      p_commercial_order_id: commercialOrderId,
      p_installment_obligation_id: installmentObligationId,
      p_template_version_id: templateVersionId,
      p_agreement_reference: reference,
      p_rendered_content: renderedContent,
      p_supersedes_agreement_id: supersedesAgreementId,
      p_reason: reason,
      p_actor_user_id: userId,
    });
    return json({ ok: true, agreementId, overview: await loadAdminOverview(tenantId, userId) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Commercial agreement request failed';
    return json({ error: message }, statusForError(message));
  }
});

async function authorizeMerchantAgreementRead(tenantId: string, userId: string): Promise<void> {
  await rpc<JsonRecord>('get_sellertray_commercial_agreement_center', { p_tenant_id: tenantId, p_actor_user_id: userId });
}

async function authorizeAdminAgreementRead(tenantId: string | null, userId: string): Promise<void> {
  await rpc<JsonRecord>('get_sellertray_commercial_agreement_admin', { p_actor_user_id: userId, p_tenant_id: tenantId });
}

async function loadAdminOnboarding(tenantId: string, userId: string): Promise<JsonRecord> {
  return await rpc<JsonRecord>('get_sellertray_commercial_onboarding_admin', { p_actor_user_id: userId, p_tenant_id: tenantId });
}

async function loadMerchantCenter(tenantId: string, userId: string): Promise<JsonRecord> {
  const [center, installmentBilling] = await Promise.all([
    rpc<JsonRecord>('get_sellertray_commercial_agreement_center', { p_tenant_id: tenantId, p_actor_user_id: userId }),
    rpc<JsonRecord[]>('get_sellertray_installment_billing_states_for_tenant', { p_tenant_id: tenantId, p_actor_user_id: userId }),
  ]);
  return { ...center, installmentBilling };
}

async function loadAdminOverview(tenantId: string | null, userId: string): Promise<JsonRecord> {
  const [overview, installmentBilling, branchSetup] = await Promise.all([
    rpc<JsonRecord>('get_sellertray_commercial_agreement_admin', { p_actor_user_id: userId, p_tenant_id: tenantId }),
    tenantId ? rpc<JsonRecord[]>('get_sellertray_installment_billing_states_for_admin', { p_tenant_id: tenantId, p_actor_user_id: userId }) : Promise.resolve([] as JsonRecord[]),
    tenantId ? rpc<JsonRecord[]>('get_sellertray_commercial_branch_setup_states_for_admin', { p_tenant_id: tenantId, p_actor_user_id: userId }) : Promise.resolve([] as JsonRecord[]),
  ]);
  return { ...overview, installmentBilling, branchSetup };
}

async function reconcileTenantInstallmentsBestEffort(tenantId: string, source: string): Promise<void> {
  try {
    const results = await rpc<JsonRecord[]>('reconcile_sellertray_installment_entitlements_for_tenant', { p_tenant_id: tenantId });
    const failures = Array.isArray(results) ? results.filter((row) => row?.ok !== true) : [];
    if (failures.length) {
      console.error(`SellerTray installment reconciliation after ${source} requires review`, {
        tenantId,
        failures: failures.map((row) => ({
          installmentObligationId: typeof row.installmentObligationId === 'string' ? row.installmentObligationId : null,
          errorCode: typeof row.errorCode === 'string' ? row.errorCode : null,
          error: typeof row.error === 'string' ? row.error.slice(0, 300) : 'Installment reconciliation failed',
        })),
      });
    }
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
    || value === 'admin_onboarding'
    || value === 'admin_publish_subscription_price'
    || value === 'admin_publish_setup_price'
    || value === 'admin_publish_subscription_override'
    || value === 'admin_publish_setup_override'
    || value === 'admin_create_initial_purchase'
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
function optionalUuid(value: unknown): string | null { return value === null || value === undefined || value === '' ? null : cleanUuid(value); }
function cleanUuidArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return null;
  const clean = value.map(cleanUuid);
  if (clean.some((item) => !item)) return null;
  const ids = clean as string[];
  return new Set(ids).size === ids.length ? ids : null;
}
function cleanFamily(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return AGREEMENT_FAMILIES.has(clean) ? clean : null;
}
function cleanInstallmentStructure(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return INSTALLMENT_STRUCTURES.has(clean) ? clean : null;
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
function cleanOptionalPercent(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : undefined;
}
function cleanReason(value: unknown): string | null {
  const reason = cleanText(value, 1000);
  return reason && reason.length >= 6 ? reason : null;
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
function cleanOptionalIsoTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const clean = cleanIsoTimestamp(value);
  return clean ?? undefined;
}
function jwtAal(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(base64)) as JsonRecord;
    return typeof decoded.aal === 'string' ? decoded.aal : null;
  } catch { return null; }
}
function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function statusForError(message: string): number {
  if (/access|required|authori[sz]ed|owner|manager|platform admin|read-only|mfa|aal2|capability/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  if (/already|replaced|supersed|different facts|different contractual|conflict|cannot be duplicated/i.test(message)) return 409;
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
