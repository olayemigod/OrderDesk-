import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action = 'convert_to_order' | 'dismiss' | 'reply';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 65_536;

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
  const enquiryId = cleanUuid(body.enquiryId);
  const action = cleanAction(body.action);
  if (!tenantId || !enquiryId || !action) {
    return json({ error: 'Business, enquiry and action are required' }, 400);
  }

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  const { data: enquiry, error: enquiryError } = await admin
    .from('customer_enquiries')
    .select('id,tenant_id,customer_id,source_inbound_message_id,status,original_text,matched_catalog_item_id,matched_item_name,converted_order_id,currency,customers!inner(wa_id,display_name,phone)')
    .eq('id', enquiryId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (enquiryError) return json({ error: enquiryError.message }, 400);
  if (!enquiry) return json({ error: 'Enquiry not found' }, 404);

  const requestedBy = String(membership.role) === 'staff' ? 'staff' : 'merchant';

  if (action === 'convert_to_order') {
    const quantity = numberValue(body.quantity);
    if (quantity === null || quantity <= 0 || quantity > 9999) {
      return json({ error: 'Quantity must be between 1 and 9999' }, 400);
    }

    const { data: orderId, error: convertError } = await admin.rpc('create_sellertray_enquiry_order_atomic', {
      p_tenant_id: tenantId,
      p_enquiry_id: enquiryId,
      p_quantity: quantity,
    });

    if (convertError || typeof orderId !== 'string') {
      return json({ error: convertError?.message ?? 'Unable to create order from enquiry' }, 400);
    }

    const { data: order } = await admin
      .from('orders')
      .select('id,public_order_id,status,payment_status,amount_paid,total_amount,currency,fulfillment_status,fulfillment_method')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    await audit({
      tenantId,
      enquiryId,
      customerId: enquiry.customer_id,
      orderId,
      actionType: 'merchant_enquiry_converted_to_order',
      riskClass: 'medium',
      requestedBy,
      actorUserId: userId,
      beforeState: {
        enquiry_status: enquiry.status,
        converted_order_id: enquiry.converted_order_id,
      },
      afterState: {
        enquiry_status: 'converted',
        converted_order_id: orderId,
        public_order_id: order?.public_order_id ?? null,
        status: order?.status ?? 'needs_review',
        payment_status: order?.payment_status ?? 'unpaid',
        total_amount: order?.total_amount ?? null,
      },
      currency: order?.currency ?? enquiry.currency,
      metadata: { quantity, matched_item_name: enquiry.matched_item_name },
    });

    return json({ ok: true, orderId, publicOrderId: order?.public_order_id ?? null }, 201);
  }

  if (action === 'dismiss') {
    if (enquiry.converted_order_id || enquiry.status === 'converted') {
      return json({ error: 'Converted enquiries cannot be dismissed' }, 409);
    }
    if (enquiry.status === 'dismissed') return json({ ok: true, status: 'dismissed' });

    const { error: updateError } = await admin
      .from('customer_enquiries')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', enquiryId)
      .eq('tenant_id', tenantId)
      .in('status', ['open', 'replied'])
      .is('converted_order_id', null);

    if (updateError) return json({ error: updateError.message }, 400);

    await audit({
      tenantId,
      enquiryId,
      customerId: enquiry.customer_id,
      orderId: null,
      actionType: 'merchant_enquiry_dismissed',
      riskClass: 'low',
      requestedBy,
      actorUserId: userId,
      beforeState: { enquiry_status: enquiry.status },
      afterState: { enquiry_status: 'dismissed' },
      currency: enquiry.currency,
      metadata: {},
    });

    return json({ ok: true, status: 'dismissed' });
  }

  const message = cleanText(body.message, 1500);
  if (!message) return json({ error: 'Reply message is required' }, 400);
  if (enquiry.status === 'dismissed' || enquiry.status === 'converted') {
    return json({ error: 'Only active enquiries can be replied to' }, 409);
  }

  const customer = Array.isArray(enquiry.customers) ? enquiry.customers[0] : enquiry.customers;
  const toWaId = customer?.wa_id ?? '';
  if (!toWaId || toWaId.startsWith('manual:')) {
    return json({ error: 'This customer does not have a WhatsApp destination' }, 400);
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

  const now = new Date().toISOString();
  const { error: queueError } = await admin.from('outbound_notifications').insert({
    tenant_id: tenantId,
    customer_id: enquiry.customer_id,
    source_inbound_message_id: enquiry.source_inbound_message_id,
    event_key: 'customer_enquiry_reply',
    delivery_status: 'pending',
    from_phone_number_id: phoneNumberId,
    to_wa_id: toWaId,
    message_body: message,
    conversation_window_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  if (queueError) return json({ error: queueError.message }, 400);

  const { error: enquiryUpdateError } = await admin
    .from('customer_enquiries')
    .update({
      status: 'replied',
      response_text: message,
      replied_at: now,
      updated_at: now,
    })
    .eq('id', enquiryId)
    .eq('tenant_id', tenantId)
    .in('status', ['open', 'replied'])
    .is('converted_order_id', null);

  if (enquiryUpdateError) return json({ error: enquiryUpdateError.message }, 400);

  try {
    await admin.rpc('sellertray_kick_notification_worker');
  } catch (error) {
    console.warn('SellerTray notification worker kick failed; queued reply remains pending.', error);
  }

  await audit({
    tenantId,
    enquiryId,
    customerId: enquiry.customer_id,
    orderId: null,
    actionType: 'merchant_enquiry_reply_queued',
    riskClass: 'low',
    requestedBy,
    actorUserId: userId,
    beforeState: { enquiry_status: enquiry.status },
    afterState: { enquiry_status: 'replied' },
    currency: enquiry.currency,
    metadata: { reply_length: message.length },
  });

  return json({ ok: true, status: 'replied' }, 202);
});

async function audit(input: {
  tenantId: string;
  enquiryId: string;
  customerId: string;
  orderId: string | null;
  actionType: string;
  riskClass: 'low' | 'medium' | 'high';
  requestedBy: string;
  actorUserId: string;
  beforeState: JsonRecord;
  afterState: JsonRecord;
  currency: string | null;
  metadata: JsonRecord;
}) {
  if (!admin) return;
  const actionKey = 'merchant-enquiry:' + input.enquiryId + ':' + input.actionType + ':' + crypto.randomUUID();
  const { error } = await admin.from('commercial_action_ledger').insert({
    tenant_id: input.tenantId,
    action_key: actionKey,
    channel: 'merchant_app',
    customer_id: input.customerId,
    target_order_id: input.orderId,
    action_type: input.actionType,
    risk_class: input.riskClass,
    requested_by: input.requestedBy,
    actor_user_id: input.actorUserId,
    policy_result: 'allowed',
    action_status: 'applied',
    currency: input.currency,
    before_state: input.beforeState,
    after_state: input.afterState,
    metadata: { enquiry_id: input.enquiryId, ...input.metadata },
    applied_at: new Date().toISOString(),
  });
  if (error) console.warn('SellerTray enquiry action audit write failed', error.message);
}

function cleanAction(value: unknown): Action | null {
  return value === 'convert_to_order' || value === 'dismiss' || value === 'reply' ? value : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
