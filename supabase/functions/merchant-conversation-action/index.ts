import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action = 'take_over' | 'return_to_ai' | 'assign' | 'resolve' | 'reply';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 65_536;
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

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

  const tenantId = cleanUuid(body.tenantId);
  const customerId = cleanUuid(body.customerId);
  const action = cleanAction(body.action);
  if (!tenantId || !customerId || !action) {
    return json({ error: 'Business, customer and action are required' }, 400);
  }

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  const { data: customer, error: customerError } = await admin
    .from('customers')
    .select('id,tenant_id,wa_id,phone,display_name')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle();

  if (customerError) return json({ error: customerError.message }, 400);
  if (!customer) return json({ error: 'Customer not found' }, 404);

  if (action !== 'reply') {
    const assignedUserId = action === 'assign' ? cleanUuid(body.assignedUserId) : null;
    if (action === 'assign' && !assignedUserId) {
      return json({ error: 'Choose a team member to assign this conversation' }, 400);
    }

    const { data, error } = await admin.rpc('sellertray_apply_conversation_service_action', {
      p_tenant_id: tenantId,
      p_customer_id: customerId,
      p_action: action,
      p_actor_user_id: userId,
      p_assigned_user_id: assignedUserId,
      p_note: cleanText(body.note, 500),
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, conversation: data });
  }

  const message = cleanText(body.message, 1500);
  if (!message) return json({ error: 'Reply message is required' }, 400);

  const toWaId = typeof customer.wa_id === 'string' ? customer.wa_id.trim() : '';
  if (!toWaId || toWaId.startsWith('manual:')) {
    return json({ error: 'This customer does not have a WhatsApp destination' }, 400);
  }

  const { data: lastInbound, error: inboundError } = await admin
    .from('inbound_messages')
    .select('id,received_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inboundError) return json({ error: inboundError.message }, 400);
  if (!lastInbound) return json({ error: 'No WhatsApp conversation was found for this customer' }, 409);

  const receivedAt = new Date(lastInbound.received_at).getTime();
  if (!Number.isFinite(receivedAt) || Date.now() - receivedAt >= WHATSAPP_WINDOW_MS) {
    return json({
      error: 'The WhatsApp 24-hour reply window has closed. Use an approved template before sending a new free-form message.',
      code: 'WHATSAPP_TEMPLATE_REQUIRED',
    }, 409);
  }

  const { data: connection } = await admin
    .from('tenant_whatsapp_connections')
    .select('phone_number_id')
    .eq('tenant_id', tenantId)
    .eq('connection_status', 'connected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let phoneNumberId = connection?.phone_number_id ?? null;
  if (!phoneNumberId) {
    const { data: tenant } = await admin
      .from('tenants')
      .select('whatsapp_phone_number_id')
      .eq('id', tenantId)
      .maybeSingle();
    phoneNumberId = tenant?.whatsapp_phone_number_id ?? null;
  }
  if (!phoneNumberId) return json({ error: 'WhatsApp is not connected for this business' }, 409);

  const windowExpiresAt = new Date(receivedAt + WHATSAPP_WINDOW_MS).toISOString();
  const { error: queueError } = await admin.from('outbound_notifications').insert({
    tenant_id: tenantId,
    customer_id: customerId,
    source_inbound_message_id: lastInbound.id,
    event_key: 'merchant_conversation_reply',
    delivery_status: 'pending',
    from_phone_number_id: phoneNumberId,
    to_wa_id: toWaId,
    message_body: message,
    conversation_window_expires_at: windowExpiresAt,
  });
  if (queueError) return json({ error: queueError.message }, 400);

  try {
    await admin.rpc('sellertray_kick_notification_worker');
  } catch (error) {
    console.warn('SellerTray notification worker kick failed; conversation reply remains queued.', error);
  }

  const { data: conversation, error: stateError } = await admin.rpc(
    'sellertray_apply_conversation_service_action',
    {
      p_tenant_id: tenantId,
      p_customer_id: customerId,
      p_action: 'waiting_customer',
      p_actor_user_id: userId,
      p_assigned_user_id: null,
      p_note: 'Merchant reply queued',
    },
  );
  if (stateError) {
    console.warn('SellerTray conversation state update failed after reply queue.', stateError.message);
  }

  const requestedBy = String(membership.role) === 'staff' ? 'staff' : 'merchant';
  const actionKey = 'merchant-conversation:' + customerId + ':reply:' + crypto.randomUUID();
  const { error: auditError } = await admin.from('commercial_action_ledger').insert({
    tenant_id: tenantId,
    action_key: actionKey,
    channel: 'merchant_app',
    customer_id: customerId,
    action_type: 'merchant_conversation_reply_queued',
    risk_class: 'low',
    requested_by: requestedBy,
    actor_user_id: userId,
    policy_result: 'allowed',
    action_status: 'applied',
    before_state: {},
    after_state: { conversation_state: 'waiting_customer' },
    metadata: { reply_length: message.length },
    applied_at: new Date().toISOString(),
  });
  if (auditError) console.warn('SellerTray conversation reply audit write failed', auditError.message);

  return json({ ok: true, status: 'queued', conversation }, 202);
});

function cleanAction(value: unknown): Action | null {
  return value === 'take_over' ||
    value === 'return_to_ai' ||
    value === 'assign' ||
    value === 'resolve' ||
    value === 'reply'
    ? value
    : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null;
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
