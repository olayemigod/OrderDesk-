type JsonRecord = Record<string, unknown>;
type Action = 'center' | 'save_service_area' | 'save_worker' | 'assign_branch_area' | 'schedule' | 'reschedule' | 'transition' | 'resolve_request' | 'retry_activation';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 65_536;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Server configuration error' }, 500);

  const identity = await verifiedIdentity(request.headers.get('authorization') ?? '');
  if (!identity) return json({ error: 'Authentication required' }, 401);
  if (identity.aal !== 'aal2') return json({ error: 'MFA verification is required for ProcessEdge administrator access' }, 403);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);
  let body: JsonRecord;
  try { body = JSON.parse(bodyRead.text) as JsonRecord; }
  catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!isRecord(body)) return json({ error: 'A setup request object is required' }, 400);

  const action = cleanAction(body.action);
  const tenantId = cleanUuid(body.tenantId);
  if (!action || !tenantId) return json({ error: 'Supported action and Business are required' }, 400);

  try {
    if (action === 'center') return json({ center: await center(identity.userId, tenantId) });

    if (action === 'save_service_area') {
      const code = cleanText(body.code, 64);
      const name = cleanText(body.name, 160);
      const reason = cleanReason(body.reason);
      const serviceAreaId = optionalUuid(body.serviceAreaId);
      if (!code || !name || !reason || (body.serviceAreaId && !serviceAreaId)) return json({ error: 'Service area code, name and reason are required' }, 400);
      const id = await rpc<string>('platform_admin_upsert_setup_service_area', {
        p_actor_user_id: identity.userId, p_tenant_id: tenantId, p_service_area_id: serviceAreaId,
        p_code: code, p_name: name, p_active: body.active !== false, p_reason: reason,
      });
      return json({ ok: true, id, center: await center(identity.userId, tenantId) }, 201);
    }

    if (action === 'save_worker') {
      const workerId = optionalUuid(body.workerId);
      const code = cleanText(body.workerCode, 64);
      const name = cleanText(body.displayName, 160);
      const reason = cleanReason(body.reason);
      const capacity = cleanInteger(body.maxConcurrentSetups, 1, 20);
      const buffer = cleanInteger(body.travelBufferMinutes, 0, 480);
      const serviceAreaIds = cleanUuidArray(body.serviceAreaIds);
      if ((body.workerId && !workerId) || !code || !name || !reason || capacity === null || buffer === null || serviceAreaIds === null) {
        return json({ error: 'Worker identity, capacity, travel buffer, coverage and reason are required' }, 400);
      }
      const id = await rpc<string>('platform_admin_upsert_setup_worker', {
        p_actor_user_id: identity.userId, p_tenant_id: tenantId, p_worker_id: workerId,
        p_worker_code: code, p_display_name: name, p_active: body.active !== false,
        p_max_concurrent_setups: capacity, p_travel_buffer_minutes: buffer,
        p_service_area_ids: serviceAreaIds, p_reason: reason,
      });
      return json({ ok: true, id, center: await center(identity.userId, tenantId) }, 201);
    }

    if (action === 'assign_branch_area') {
      const branchId = cleanUuid(body.branchId);
      const serviceAreaId = cleanUuid(body.serviceAreaId);
      const reason = cleanReason(body.reason);
      if (!branchId || !serviceAreaId || !reason) return json({ error: 'Branch, service area and reason are required' }, 400);
      await rpc('platform_admin_assign_branch_setup_service_area', {
        p_actor_user_id: identity.userId, p_tenant_id: tenantId, p_branch_id: branchId,
        p_service_area_id: serviceAreaId, p_reason: reason,
      });
      return json({ ok: true, center: await center(identity.userId, tenantId) });
    }

    if (action === 'schedule') {
      const commercialOrderId = cleanUuid(body.commercialOrderId);
      const branchId = cleanUuid(body.branchId);
      const workerId = cleanUuid(body.workerId);
      const serviceAreaId = cleanUuid(body.serviceAreaId);
      const start = cleanTimestamp(body.scheduledStartAt);
      const end = cleanTimestamp(body.scheduledEndAt);
      const commandId = cleanUuid(body.commandId);
      const reason = cleanReason(body.reason);
      const merchantNote = cleanOptionalText(body.merchantNote, 2000);
      const internalNote = cleanOptionalText(body.internalNote, 4000);
      if (!commercialOrderId || !branchId || !workerId || !serviceAreaId || !start || !end || !commandId || !reason || merchantNote === undefined || internalNote === undefined) {
        return json({ error: 'Setup subject, worker, service area, appointment window, command and reason are required' }, 400);
      }
      const id = await rpc<string>('platform_admin_schedule_branch_setup', {
        p_actor_user_id: identity.userId, p_tenant_id: tenantId, p_commercial_order_id: commercialOrderId,
        p_branch_id: branchId, p_worker_id: workerId, p_service_area_id: serviceAreaId,
        p_scheduled_start_at: start, p_scheduled_end_at: end, p_merchant_note: merchantNote,
        p_internal_note: internalNote, p_command_id: commandId, p_reason: reason,
      });
      return json({ ok: true, id, center: await center(identity.userId, tenantId) }, 201);
    }

    if (action === 'reschedule') {
      const appointmentId = cleanUuid(body.appointmentId);
      const workerId = cleanUuid(body.workerId);
      const serviceAreaId = cleanUuid(body.serviceAreaId);
      const start = cleanTimestamp(body.scheduledStartAt);
      const end = cleanTimestamp(body.scheduledEndAt);
      const requestId = optionalUuid(body.rescheduleRequestId);
      const commandId = cleanUuid(body.commandId);
      const reason = cleanReason(body.reason);
      const merchantNote = cleanOptionalText(body.merchantNote, 2000);
      const internalNote = cleanOptionalText(body.internalNote, 4000);
      if (!appointmentId || !workerId || !serviceAreaId || !start || !end || !commandId || !reason || merchantNote === undefined || internalNote === undefined || (body.rescheduleRequestId && !requestId)) {
        return json({ error: 'Appointment, worker, service area, appointment window, command and reason are required' }, 400);
      }
      const id = await rpc<string>('platform_admin_reschedule_branch_setup', {
        p_actor_user_id: identity.userId, p_tenant_id: tenantId, p_appointment_id: appointmentId,
        p_worker_id: workerId, p_service_area_id: serviceAreaId, p_scheduled_start_at: start,
        p_scheduled_end_at: end, p_merchant_note: merchantNote, p_internal_note: internalNote,
        p_reschedule_request_id: requestId, p_command_id: commandId, p_reason: reason,
      });
      return json({ ok: true, id, center: await center(identity.userId, tenantId) });
    }

    if (action === 'retry_activation') {
      const obligationId = cleanUuid(body.installmentObligationId);
      const reason = cleanReason(body.reason);
      if (!obligationId || !reason) return json({ error: 'Purchase obligation and recovery reason are required' }, 400);
      const result = await rpc<JsonRecord>('platform_admin_retry_setup_activation', {
        p_actor_user_id: identity.userId, p_tenant_id: tenantId, p_installment_obligation_id: obligationId, p_reason: reason,
      });
      return json({ ok: true, result, center: await center(identity.userId, tenantId) });
    }

    if (action === 'transition') {
      const appointmentId = cleanUuid(body.appointmentId);
      const status = cleanEnum(body.status, ['in_progress', 'completed', 'cancelled', 'no_show']);
      const commandId = cleanUuid(body.commandId);
      const reason = cleanReason(body.reason);
      const evidence = isRecord(body.evidence) ? body.evidence : {};
      if (!appointmentId || !status || !commandId || !reason) return json({ error: 'Appointment, status, command and reason are required' }, 400);
      const result = await rpc<JsonRecord>('platform_admin_transition_branch_setup', {
        p_actor_user_id: identity.userId, p_tenant_id: tenantId, p_appointment_id: appointmentId,
        p_target_status: status, p_command_id: commandId, p_reason: reason, p_evidence: evidence,
      });
      return json({ ok: true, result, center: await center(identity.userId, tenantId) });
    }

    const requestId = cleanUuid(body.requestId);
    const decision = cleanEnum(body.decision, ['declined', 'withdrawn']);
    const reason = cleanReason(body.reason);
    if (!requestId || !decision || !reason) return json({ error: 'Request, decision and reason are required' }, 400);
    await rpc('platform_admin_resolve_setup_reschedule_request', {
      p_actor_user_id: identity.userId, p_tenant_id: tenantId, p_request_id: requestId,
      p_decision: decision, p_reason: reason,
    });
    return json({ ok: true, center: await center(identity.userId, tenantId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Setup scheduling request failed';
    const status = /capability|required|authori[sz]ed|mfa/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
    return json({ error: message }, status);
  }
});

async function center(userId: string, tenantId: string): Promise<JsonRecord> {
  return await rpc<JsonRecord>('platform_admin_setup_scheduling_center', { p_actor_user_id: userId, p_tenant_id: tenantId });
}

async function rpc<T = unknown>(name: string, body: JsonRecord): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `Setup scheduling RPC failed with HTTP ${response.status}`;
    try {
      const payload = await response.json() as JsonRecord;
      if (typeof payload.message === 'string' && payload.message) message = payload.message;
      else if (typeof payload.error === 'string' && payload.error) message = payload.error;
    } catch { /* bounded fallback */ }
    throw new Error(message);
  }
  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

async function verifiedIdentity(authorization: string): Promise<{ userId: string; aal: 'aal1' | 'aal2' } | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, authorization } });
  if (!response.ok) return null;
  let user: JsonRecord;
  try { user = await response.json() as JsonRecord; } catch { return null; }
  const userId = cleanUuid(user.id);
  const aal = getJwtAal(token);
  return userId && aal ? { userId, aal } : null;
}

function getJwtAal(token: string): 'aal1' | 'aal2' | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as JsonRecord;
    return payload.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch { return null; }
}

function cleanAction(value: unknown): Action | null {
  const allowed: Action[] = ['center','save_service_area','save_worker','assign_branch_area','schedule','reschedule','transition','resolve_request','retry_activation'];
  return typeof value === 'string' && allowed.includes(value as Action) ? value as Action : null;
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
function cleanOptionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length <= max ? clean || null : undefined;
}
function cleanReason(value: unknown): string | null {
  const clean = cleanText(value, 1000);
  return clean && clean.length >= 6 ? clean : null;
}
function cleanInteger(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
function cleanUuidArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map(cleanUuid);
  return ids.every(Boolean) ? [...new Set(ids as string[])] : null;
}
function cleanTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function cleanEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : null;
}
function isRecord(value: unknown): value is JsonRecord { return !!value && typeof value === 'object' && !Array.isArray(value); }
async function readRequestTextLimited(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader(); const decoder = new TextDecoder(); const parts: string[] = []; let total = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) { await reader.cancel(); return { ok: false }; } parts.push(decoder.decode(value, { stream: true })); }
    parts.push(decoder.decode()); return { ok: true, text: parts.join('') };
  } finally { try { reader.releaseLock(); } catch { /* already released */ } }
}
function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
