import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type Action = 'start_delivery' | 'complete_fulfillment';
type FulfillmentMethod = 'customer_pickup' | 'merchant_delivery' | 'third_party_delivery';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 32_768;

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

Deno.serve(withObservability('order-fulfillment', async (request) => {
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
  const orderId = cleanUuid(body.orderId);
  const method = cleanMethod(body.method);
  const provider = cleanOptionalText(body.provider, 120);
  const reference = cleanOptionalText(body.reference, 120);
  const contactName = cleanOptionalText(body.contactName, 120);
  const contactPhone = cleanOptionalText(body.contactPhone, 50);
  const estimatedDeliveryAt = cleanOptionalTimestamp(body.estimatedDeliveryAt);
  const note = cleanOptionalText(body.note, 300);

  if (!action || !orderId || !method) {
    return json({ error: 'action, orderId and method are required' }, 400);
  }

  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id,tenant_id,customer_id,public_order_id,status,payment_status,amount_paid,total_amount,currency,fulfillment_method,fulfillment_status,delivery_provider,delivery_reference,delivery_contact_name,delivery_contact_phone,estimated_delivery_at,delivery_note,dispatched_at,fulfilled_at,fulfillment_confirmed_by')
    .eq('id', orderId)
    .maybeSingle();

  if (orderError) return json({ error: 'Unable to load order' }, 400);
  if (!order) return json({ error: 'Order not found' }, 404);

  const tenantId = String(order.tenant_id);

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return json({ error: 'Unable to verify business access' }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  const { data: canWrite, error: accessError } = await admin.rpc('orderdesk_subscription_can_write', {
    p_tenant_id: tenantId,
  });
  if (accessError) return json({ error: 'Unable to verify subscription access' }, 400);
  if (canWrite !== true) {
    return json({ error: 'SellerTray subscription is read-only. Renew or reactivate the business to make changes.' }, 403);
  }

  if (action === 'start_delivery') {
    if (method === 'customer_pickup') {
      return json({ error: 'Customer pickup does not require a delivery start' }, 400);
    }
    if (order.status !== 'ready') {
      return json({ error: 'Only a ready order can start delivery' }, 409);
    }

    if (order.fulfillment_status === 'out_for_delivery') {
      if (order.fulfillment_method !== method) {
        return json({ error: 'Delivery has already started with a different fulfillment method' }, 409);
      }
      return json({ orderId, status: 'ready', fulfillmentStatus: 'out_for_delivery', alreadyStarted: true }, 200);
    }

    if (order.fulfillment_status !== 'unassigned') {
      return json({ error: 'This order fulfillment state cannot start delivery' }, 409);
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from('orders')
      .update({
        fulfillment_method: method,
        fulfillment_status: 'out_for_delivery',
        delivery_provider: provider,
        delivery_reference: reference,
        delivery_contact_name: contactName,
        delivery_contact_phone: contactPhone,
        estimated_delivery_at: estimatedDeliveryAt,
        delivery_note: note,
        dispatched_at: now,
        fulfilled_at: null,
        updated_at: now,
      })
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .eq('status', 'ready')
      .eq('fulfillment_status', 'unassigned')
      .select('id,tenant_id,customer_id,public_order_id,status,payment_status,amount_paid,total_amount,currency,fulfillment_method,fulfillment_status,delivery_provider,delivery_reference,delivery_contact_name,delivery_contact_phone,estimated_delivery_at,delivery_note,dispatched_at,fulfilled_at,fulfillment_confirmed_by')
      .maybeSingle();

    if (updateError) return json({ error: updateError.message }, 400);
    if (!updated) return json({ error: 'Order fulfillment changed before delivery could start. Refresh and try again.' }, 409);

    await recordFulfillmentCommercialAction({
      tenantId,
      userId,
      role: String(membership.role),
      orderBefore: order,
      orderAfter: updated,
      action: 'start_delivery',
      provider,
      reference,
      contactName,
      contactPhone,
      estimatedDeliveryAt,
      note,
    });

    return json({ orderId, status: updated.status, fulfillmentStatus: updated.fulfillment_status }, 200);
  }

  if (order.status === 'completed') {
    return json({ orderId, status: 'completed', fulfillmentStatus: order.fulfillment_status, alreadyCompleted: true }, 200);
  }
  if (order.status !== 'ready') {
    return json({ error: 'Only a ready order can be completed' }, 409);
  }

  const now = new Date().toISOString();

  if (method === 'customer_pickup') {
    if (order.fulfillment_status !== 'unassigned') {
      return json({ error: 'An order already in delivery cannot be completed as customer pickup' }, 409);
    }

    const { data: updated, error: updateError } = await admin
      .from('orders')
      .update({
        status: 'completed',
        status_reason: null,
        fulfillment_method: 'customer_pickup',
        fulfillment_status: 'collected',
        fulfillment_confirmed_by: 'merchant',
        customer_confirmed_at: null,
        customer_confirmation_message_id: null,
        delivery_provider: null,
        delivery_reference: null,
        delivery_contact_name: null,
        delivery_contact_phone: null,
        estimated_delivery_at: null,
        delivery_note: note,
        fulfilled_at: now,
        updated_at: now,
      })
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .eq('status', 'ready')
      .eq('fulfillment_status', 'unassigned')
      .select('id,tenant_id,customer_id,public_order_id,status,payment_status,amount_paid,total_amount,currency,fulfillment_method,fulfillment_status,delivery_provider,delivery_reference,delivery_contact_name,delivery_contact_phone,estimated_delivery_at,delivery_note,dispatched_at,fulfilled_at,fulfillment_confirmed_by')
      .maybeSingle();

    if (updateError) return json({ error: updateError.message }, 400);
    if (!updated) return json({ error: 'Order fulfillment changed before pickup could be completed. Refresh and try again.' }, 409);

    await recordFulfillmentCommercialAction({
      tenantId,
      userId,
      role: String(membership.role),
      orderBefore: order,
      orderAfter: updated,
      action: 'complete_fulfillment',
      provider: null,
      reference: null,
      contactName: null,
      contactPhone: null,
      estimatedDeliveryAt: null,
      note,
    });

    return json({ orderId, status: updated.status, fulfillmentStatus: updated.fulfillment_status }, 200);
  }

  if (order.fulfillment_status !== 'out_for_delivery') {
    return json({ error: 'Start delivery before marking this order delivered' }, 409);
  }
  if (order.fulfillment_method !== method) {
    return json({ error: 'Fulfillment method does not match the active delivery' }, 409);
  }

  const { data: updated, error: updateError } = await admin
    .from('orders')
    .update({
      status: 'completed',
      status_reason: null,
      fulfillment_status: 'delivered',
      fulfillment_confirmed_by: 'merchant',
      customer_confirmed_at: null,
      customer_confirmation_message_id: null,
      fulfilled_at: now,
      updated_at: now,
    })
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .eq('status', 'ready')
    .eq('fulfillment_status', 'out_for_delivery')
    .eq('fulfillment_method', method)
    .select('id,tenant_id,customer_id,public_order_id,status,payment_status,amount_paid,total_amount,currency,fulfillment_method,fulfillment_status,delivery_provider,delivery_reference,delivery_contact_name,delivery_contact_phone,estimated_delivery_at,delivery_note,dispatched_at,fulfilled_at,fulfillment_confirmed_by')
    .maybeSingle();

  if (updateError) return json({ error: updateError.message }, 400);
  if (!updated) return json({ error: 'Order fulfillment changed before delivery could be completed. Refresh and try again.' }, 409);

  await recordFulfillmentCommercialAction({
    tenantId,
    userId,
    role: String(membership.role),
    orderBefore: order,
    orderAfter: updated,
    action: 'complete_fulfillment',
    provider: updated.delivery_provider ?? provider,
    reference: updated.delivery_reference ?? reference,
    contactName: updated.delivery_contact_name ?? contactName,
    contactPhone: updated.delivery_contact_phone ?? contactPhone,
    estimatedDeliveryAt: updated.estimated_delivery_at ?? estimatedDeliveryAt,
    note: updated.delivery_note ?? note,
  });

  return json({ orderId, status: updated.status, fulfillmentStatus: updated.fulfillment_status }, 200);
}));

async function recordFulfillmentCommercialAction(input: {
  tenantId: string;
  userId: string;
  role: string;
  orderBefore: Record<string, unknown>;
  orderAfter: Record<string, unknown>;
  action: Action;
  provider: string | null;
  reference: string | null;
  contactName: string | null;
  contactPhone: string | null;
  estimatedDeliveryAt: string | null;
  note: string | null;
}): Promise<void> {
  if (!admin) return;

  const requestedBy = input.role === 'staff' ? 'staff' : 'merchant';
  const status = String(input.orderAfter.fulfillment_status ?? '');
  const actionType = input.action === 'start_delivery'
    ? 'delivery_started'
    : status === 'collected'
      ? 'pickup_completed'
      : 'delivery_completed';
  const riskClass = input.action === 'start_delivery' ? 'medium' : 'high';
  const appliedAt = new Date().toISOString();
  const actionKey =
    'fulfillment:' +
    String(input.orderAfter.id ?? '') + ':' +
    actionType + ':' +
    String(input.orderAfter.dispatched_at ?? input.orderAfter.fulfilled_at ?? appliedAt);

  const beforeState = fulfillmentState(input.orderBefore);
  const afterState = fulfillmentState(input.orderAfter);

  const { error } = await admin
    .from('commercial_action_ledger')
    .upsert({
      tenant_id: input.tenantId,
      action_key: actionKey,
      channel: 'merchant_app',
      customer_id: input.orderAfter.customer_id ?? null,
      target_order_id: input.orderAfter.id ?? null,
      action_type: actionType,
      risk_class: riskClass,
      requested_by: requestedBy,
      actor_user_id: input.userId,
      policy_result: 'allowed',
      action_status: 'applied',
      financial_impact: null,
      currency: input.orderAfter.currency ?? null,
      before_state: beforeState,
      after_state: afterState,
      metadata: {
        public_order_id: input.orderAfter.public_order_id ?? null,
        delivery_provider: input.provider,
        delivery_reference: input.reference,
        delivery_contact_name: input.contactName,
        delivery_contact_phone: input.contactPhone,
        estimated_delivery_at: input.estimatedDeliveryAt,
        note: input.note,
      },
      applied_at: appliedAt,
    }, {
      onConflict: 'tenant_id,action_key',
      ignoreDuplicates: true,
    });

  if (error) {
    console.warn('SellerTray fulfillment audit write failed', error.message);
  }
}

function fulfillmentState(order: Record<string, unknown>): Record<string, unknown> {
  return {
    status: order.status ?? null,
    payment_status: order.payment_status ?? null,
    amount_paid: order.amount_paid ?? null,
    total_amount: order.total_amount ?? null,
    fulfillment_method: order.fulfillment_method ?? null,
    fulfillment_status: order.fulfillment_status ?? null,
    delivery_provider: order.delivery_provider ?? null,
    delivery_reference: order.delivery_reference ?? null,
    delivery_contact_name: order.delivery_contact_name ?? null,
    delivery_contact_phone: order.delivery_contact_phone ?? null,
    estimated_delivery_at: order.estimated_delivery_at ?? null,
    dispatched_at: order.dispatched_at ?? null,
    fulfilled_at: order.fulfilled_at ?? null,
    fulfillment_confirmed_by: order.fulfillment_confirmed_by ?? null,
  };
}

function cleanAction(value: unknown): Action | null {
  return value === 'start_delivery' || value === 'complete_fulfillment' ? value : null;
}

function cleanMethod(value: unknown): FulfillmentMethod | null {
  return value === 'customer_pickup' || value === 'merchant_delivery' || value === 'third_party_delivery'
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

function cleanOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, maxLength) : null;
}

function cleanOptionalTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) return { ok: false };
  }
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
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
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

type ObservabilityHandler = (request: Request) => Response | Promise<Response>;

function withObservability(service: string, handler: ObservabilityHandler): ObservabilityHandler {
  return async (request: Request) => {
    const requestId = request.headers.get('x-request-id')?.trim() || crypto.randomUUID();
    const startedAt = Date.now();
    try {
      const response = await handler(request);
      console.info(JSON.stringify({
        ts: new Date().toISOString(),
        level: response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info',
        service,
        event: 'request_finished',
        request_id: requestId,
        status: response.status,
        duration_ms: Math.max(0, Date.now() - startedAt),
      }));
      const headers = new Headers(response.headers);
      headers.set('x-orderdesk-request-id', requestId);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        service,
        event: 'request_exception',
        request_id: requestId,
        duration_ms: Math.max(0, Date.now() - startedAt),
        error: error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 300) : 'Unhandled server error',
      }));
      throw error;
    }
  };
}
