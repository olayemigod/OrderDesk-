import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type LifecycleAction = 'pause' | 'resume' | 'deactivate' | 'void';

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
  if (jwtAal(token) !== 'aal2') return json({ error: 'MFA/AAL2 required for commercial pricing lifecycle controls' }, 403);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const userId = authData.user?.id ?? null;
  if (authError || !userId) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try { body = JSON.parse(bodyRead.text) as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const priceVersionId = cleanUuid(body.priceVersionId);
  const action = cleanAction(body.action);
  const reason = cleanReason(body.reason);
  const commandId = cleanUuid(body.commandId);
  if (!priceVersionId || !action || !reason || !commandId) {
    return json({ error: 'Price version, lifecycle action, command and reason are required' }, 400);
  }

  try {
    const { data, error } = await admin.rpc('control_sellertray_commercial_price_version_admin', {
      p_price_version_id: priceVersionId,
      p_action: action,
      p_reason: reason,
      p_command_id: commandId,
      p_actor_user_id: userId,
    });
    if (error) throw new Error(error.message ?? 'Commercial price lifecycle control failed');
    return json({ ok: true, result: data as unknown as JsonRecord });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Commercial price lifecycle control failed';
    return json({ error: message }, statusForError(message));
  }
});

function cleanAction(value: unknown): LifecycleAction | null {
  return value === 'pause' || value === 'resume' || value === 'deactivate' || value === 'void' ? value : null;
}
function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
}
function cleanReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length >= 6 && clean.length <= 1000 ? clean : null;
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
function statusForError(message: string): number {
  if (/access|required|authori[sz]ed|platform admin|capability|mfa|aal2/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  if (/already|terminal|paused|active|void|effective|snapshotted|referenced|conflict|different facts/i.test(message)) return 409;
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
