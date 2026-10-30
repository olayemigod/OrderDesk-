import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const admin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  : null;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!admin) return json({ error: 'Server configuration error' }, 500);

  const token = bearer(request.headers.get('authorization'));
  if (!token) return json({ error: 'Authentication required' }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const userId = authData.user?.id ?? null;
  if (authError || !userId) return json({ error: 'Authentication required' }, 401);

  let body: JsonRecord;
  try { body = await request.json() as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const tenantId = uuid(body.tenantId);
  const agreementVersionId = uuid(body.agreementVersionId);
  const commandId = uuid(body.commandId);
  const legalName = text(body.legalName, 200);
  if (!tenantId || !agreementVersionId || !commandId || !legalName) {
    return json({ error: 'Business, current Master Agreement, legal name and command are required' }, 400);
  }
  if (body.authorityConfirmed !== true) {
    return json({ error: 'Confirm your authority and Master Agreement acceptance before continuing' }, 400);
  }

  try {
    const center = await rpc<JsonRecord>('get_sellertray_agreement_package_center', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
    });
    const orderForms = Array.isArray(center.orderForms) ? center.orderForms : [];
    const master = record(center.masterAgreement);
    if (orderForms.length !== 0) {
      throw new Error('A purchase-specific Order Form now exists. Review and confirm the exact Agreement Package instead.');
    }
    if (center.masterAcceptanceRequired !== true || master.id !== agreementVersionId) {
      throw new Error('The current Master Agreement does not require pre-purchase acceptance for this Business');
    }

    const onboarding = await rpc<JsonRecord>('get_sellertray_onboarding_state_core', { p_tenant_id: tenantId });
    if (onboarding?.nextAction && record(onboarding.nextAction).code !== 'review_master_agreement') {
      throw new Error('Master Agreement acceptance is not the current onboarding action for this Business');
    }
    if (record(onboarding.nextAction).surface !== 'merchant_web') {
      throw new Error('Master Agreement acceptance is not available on Merchant Web for this Business');
    }

    const userAgent = text(request.headers.get('user-agent'), 512);
    const acceptanceId = await rpc<string>('accept_sellertray_master_agreement', {
      p_tenant_id: tenantId,
      p_agreement_version_id: agreementVersionId,
      p_accepted_legal_name: legalName,
      p_request_evidence: {
        channel: 'merchant_web',
        flow: 'prepurchase_master_acceptance',
        authority_confirmed: true,
        ...(userAgent ? { user_agent: userAgent } : {}),
      },
      p_command_id: commandId,
      p_actor_user_id: userId,
    });

    const nextCenter = await rpc<JsonRecord>('get_sellertray_agreement_package_center', {
      p_tenant_id: tenantId,
      p_actor_user_id: userId,
    });
    const nextOnboarding = await rpc<JsonRecord>('get_sellertray_onboarding_state_core', { p_tenant_id: tenantId });
    if (record(nextOnboarding.nextAction).code !== 'select_plan') {
      throw new Error('Master Agreement acceptance was recorded but SellerTray Billing is not yet the governed next step');
    }

    return json({ ok: true, acceptanceId, center: nextCenter, nextAction: nextOnboarding.nextAction });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Master Agreement acceptance failed';
    return json({ error: message }, /access|required|authori[sz]ed|owner|manager|available/i.test(message) ? 403 : /exists|current|Order Form|next step/i.test(message) ? 409 : 400);
  }
});

async function rpc<T>(name: string, args: JsonRecord): Promise<T> {
  if (!admin) throw new Error('Server configuration error');
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message ?? 'SellerTray agreement RPC failed');
  return data as T;
}
function bearer(value: string | null): string | null { return value?.startsWith('Bearer ') ? value.slice(7) : null; }
function uuid(value: unknown): string | null { const clean = typeof value === 'string' ? value.trim() : ''; return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null; }
function text(value: unknown, max: number): string | null { const clean = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''; return clean && clean.length <= max ? clean : null; }
function record(value: unknown): JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {}; }
function json(payload: JsonRecord, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
