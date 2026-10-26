import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action = 'merchant_list' | 'merchant_confirm_package' | 'admin_issue_order_form';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 400_000;
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
    if (action === 'merchant_list') {
      const tenantId = cleanUuid(body.tenantId);
      if (!tenantId) return json({ error: 'Business is required' }, 400);
      await authorizeMerchantRead(tenantId, userId);
      await reconcileTenantInstallmentsBestEffort(tenantId, 'Master Agreement center');
      return json({ ok: true, center: await loadMerchantCenter(tenantId, userId) });
    }

    if (action === 'merchant_confirm_package') {
      const tenantId = cleanUuid(body.tenantId);
      const orderFormId = cleanUuid(body.orderFormId);
      const commandId = cleanUuid(body.commandId);
      const legalName = cleanText(body.legalName, 200);
      if (!tenantId || !orderFormId || !commandId) return json({ error: 'Business, Order Form and confirmation command are required' }, 400);
      if (!legalName) return json({ error: 'Enter the authorised representative legal name' }, 400);
      if (body.authorityConfirmed !== true) return json({ error: 'Confirm your authority before continuing' }, 400);

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
      await reconcileTenantInstallmentsBestEffort(tenantId, 'Order Form confirmation');
      return json({ ok: true, result, center: await loadMerchantCenter(tenantId, userId) });
    }

    const tenantId = cleanUuid(body.tenantId);
    const commercialOrderId = cleanUuid(body.commercialOrderId);
    const installmentObligationId = optionalUuid(body.installmentObligationId);
    const templateVersionId = cleanUuid(body.templateVersionId);
    const supersedesOrderFormId = optionalUuid(body.supersedesOrderFormId);
    const reference = cleanText(body.reference, 128);
    const renderedContent = cleanRawText(body.renderedContent, 300_000);
    const reason = cleanText(body.reason, 1000);
    if (!tenantId || !commercialOrderId || !templateVersionId || !reference || !renderedContent || !reason || reason.length < 6) {
      return json({ error: 'Business, commercial order, template, reference, Order Form content and issuance reason are required' }, 400);
    }
    if (body.installmentObligationId && !installmentObligationId) return json({ error: 'A valid installment obligation is required' }, 400);
    if (body.supersedesOrderFormId && !supersedesOrderFormId) return json({ error: 'A valid replacement Order Form is required' }, 400);

    const orderFormId = await rpc<string>('issue_sellertray_commercial_order_form_admin', {
      p_tenant_id: tenantId,
      p_commercial_order_id: commercialOrderId,
      p_installment_obligation_id: installmentObligationId,
      p_template_version_id: templateVersionId,
      p_order_form_reference: reference,
      p_rendered_content: renderedContent,
      p_supersedes_order_form_id: supersedesOrderFormId,
      p_reason: reason,
      p_actor_user_id: userId,
    });
    return json({ ok: true, orderFormId }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Master Agreement request failed';
    return json({ error: message }, statusForError(message));
  }
});

async function authorizeMerchantRead(tenantId: string, userId: string): Promise<void> {
  await rpc<JsonRecord>('get_sellertray_master_agreement_center', { p_tenant_id: tenantId, p_actor_user_id: userId });
}

async function loadMerchantCenter(tenantId: string, userId: string): Promise<JsonRecord> {
  const [center, installmentBilling] = await Promise.all([
    rpc<JsonRecord>('get_sellertray_master_agreement_center', { p_tenant_id: tenantId, p_actor_user_id: userId }),
    rpc<JsonRecord[]>('get_sellertray_installment_billing_states_for_tenant', { p_tenant_id: tenantId, p_actor_user_id: userId }),
  ]);
  return { ...center, installmentBilling };
}

async function reconcileTenantInstallmentsBestEffort(tenantId: string, source: string): Promise<void> {
  try {
    const results = await rpc<JsonRecord[]>('reconcile_sellertray_installment_entitlements_for_tenant', { p_tenant_id: tenantId });
    const failures = Array.isArray(results) ? results.filter((row) => row?.ok !== true) : [];
    if (failures.length) console.error(`SellerTray installment reconciliation after ${source} requires review`, { tenantId, failures });
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
  if (error) throw new Error(error.message ?? 'Master Agreement RPC failed');
  return data as T;
}

function cleanAction(value: unknown): Action | null {
  return value === 'merchant_list' || value === 'merchant_confirm_package' || value === 'admin_issue_order_form' ? value : null;
}
function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}
function optionalUuid(value: unknown): string | null { return value === null || value === undefined || value === '' ? null : cleanUuid(value); }
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= max ? clean : null;
}
function cleanRawText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}
async function readRequestTextLimited(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, text: '' };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); return { ok: false }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}
function statusForError(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes('not authorised') || lower.includes('access required')) return 403;
  if (lower.includes('not found')) return 404;
  if (lower.includes('required') || lower.includes('invalid') || lower.includes('replaced') || lower.includes('different facts')) return 400;
  return 500;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
