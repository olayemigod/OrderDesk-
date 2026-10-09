import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type PrinterAction = 'save_printer' | 'request_print' | 'update_print';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 16_384;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
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
  try {
    body = JSON.parse(bodyRead.text) as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = cleanAction(body.action);
  const tenantId = cleanUuid(body.tenantId);
  if (!action || !tenantId) return json({ error: 'Business and printer action are required' }, 400);

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  let rpcName: string;
  let rpcArgs: JsonRecord;

  if (action === 'save_printer') {
    const printerId = body.printerId === null || body.printerId === undefined ? null : cleanUuid(body.printerId);
    const branchId = cleanUuid(body.branchId);
    const registerId = cleanUuid(body.registerId);
    const displayName = cleanText(body.displayName, 120);
    const hardwareIdentifier = cleanText(body.hardwareIdentifier, 160);
    const paperWidthMm = body.paperWidthMm === 58 || body.paperWidthMm === 80 ? body.paperWidthMm : null;
    const isDefault = typeof body.isDefault === 'boolean' ? body.isDefault : null;
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : null;
    if ((body.printerId !== null && body.printerId !== undefined && !printerId)
        || !branchId || !registerId || !displayName || !hardwareIdentifier
        || !paperWidthMm || isDefault === null || isActive === null) {
      return json({ error: 'Branch, register, printer name, Bluetooth identity and paper width are required' }, 400);
    }
    rpcName = 'save_sellertray_printer';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_printer_id: printerId,
      p_branch_id: branchId,
      p_register_id: registerId,
      p_display_name: displayName,
      p_hardware_identifier: hardwareIdentifier,
      p_paper_width_mm: paperWidthMm,
      p_is_default: isDefault,
      p_is_active: isActive,
      p_actor_user_id: userId,
    };
  } else if (action === 'request_print') {
    const printerId = cleanUuid(body.printerId);
    const jobType = body.jobType === 'receipt' || body.jobType === 'test' ? body.jobType : null;
    const orderId = body.orderId === null || body.orderId === undefined ? null : cleanUuid(body.orderId);
    const requestKey = cleanText(body.requestKey, 128);
    if (!printerId || !jobType || !requestKey
        || (jobType === 'receipt' && !orderId)
        || (jobType === 'test' && orderId !== null)) {
      return json({ error: 'Printer, print type and request key are required' }, 400);
    }
    rpcName = 'request_sellertray_print_job';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_printer_id: printerId,
      p_job_type: jobType,
      p_order_id: orderId,
      p_request_key: requestKey,
      p_actor_user_id: userId,
    };
  } else {
    const jobId = cleanUuid(body.jobId);
    const status = body.status === 'printing' || body.status === 'printed' || body.status === 'failed'
      ? body.status
      : null;
    const failureCode = cleanText(body.failureCode, 80);
    const failureMessage = cleanText(body.failureMessage, 500);
    if (!jobId || !status || (status === 'failed' && !failureMessage)) {
      return json({ error: 'Print job and valid print status are required' }, 400);
    }
    rpcName = 'transition_sellertray_print_job';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_job_id: jobId,
      p_status: status,
      p_failure_code: status === 'failed' ? failureCode : null,
      p_failure_message: status === 'failed' ? failureMessage : null,
      p_actor_user_id: userId,
    };
  }

  const { data: result, error } = await admin.rpc(rpcName, rpcArgs);
  if (error || !result || typeof result !== 'object') {
    const message = error?.message ?? 'SellerTray could not complete this printer action';
    const status = /permission|access|role|read-only|authentication/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : /already|different facts|unavailable|issued payment receipt|same branch|immutable|must start/i.test(message)
          ? 409
          : 400;
    return json({ error: message }, status);
  }

  return json({ ok: true, action, ...result });
});

function cleanAction(value: unknown): PrinterAction | null {
  return value === 'save_printer' || value === 'request_print' || value === 'update_print'
    ? value
    : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
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
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
}

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}