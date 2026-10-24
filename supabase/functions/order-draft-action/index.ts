import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const admin = SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }) : null;

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

  let body: JsonRecord;
  try { body = await request.json() as JsonRecord; } catch { return json({ error: 'Invalid JSON' }, 400); }
  const action = body.action === 'delete' ? 'delete' : null;
  const tenantId = cleanUuid(body.tenantId);
  const orderId = cleanUuid(body.orderId);
  const reason = cleanText(body.reason, 500);
  const commandId = cleanCommand(body.commandId);
  if (!action || !tenantId || !orderId || !reason || !commandId) return json({ error: 'Business, draft, reason and retry identity are required' }, 400);

  const { data: membership, error: membershipError } = await admin.from('tenant_members').select('role').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership || !['owner', 'manager'].includes(String(membership.role))) return json({ error: 'Owner or Manager access is required' }, 403);

  const { data, error } = await admin.rpc('delete_sellertray_pos_draft', { p_tenant_id: tenantId, p_order_id: orderId, p_actor_user_id: userId, p_reason: reason, p_command_id: commandId });
  if (error) return json({ error: error.message }, error.code === '42501' ? 403 : error.code === '23514' ? 409 : 400);
  return json({ ok: true, result: data });
});

function cleanUuid(value: unknown) { if (typeof value !== 'string') return null; const clean = value.trim(); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null; }
function cleanText(value: unknown, max: number) { if (typeof value !== 'string') return null; const clean = value.trim().replace(/\s+/g, ' '); return clean ? clean.slice(0, max) : null; }
function cleanCommand(value: unknown) { if (typeof value !== 'string') return null; const clean = value.trim(); return clean.length >= 8 && clean.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(clean) ? clean : null; }
function json(payload: JsonRecord, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
