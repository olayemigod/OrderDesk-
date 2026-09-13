type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Server configuration error' }, 500);

  const auth = req.headers.get('authorization') || '';
  const userId = await verifiedUser(auth);
  if (!userId) return json({ error: 'Authentication required' }, 401);

  let body: J;
  try { body = await req.json() as J; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const rawAction = typeof body.action === 'string' ? body.action : '';
  const action = ['confirm_offline','verify_gateway','record_offline','send_options'].includes(rawAction)
    ? rawAction
    : null;
  const tenantId = uuid(body.tenantId);
  const paymentId = uuid(body.paymentId);
  const orderId = uuid(body.orderId);
  const paymentMethodId = uuid(body.paymentMethodId);

  if (!action || !tenantId) {
    return json({ error: 'action and tenantId are required' }, 400);
  }
  if ((action === 'confirm_offline' || action === 'verify_gateway') && !paymentId) {
    return json({ error: 'paymentId is required' }, 400);
  }
  if ((action === 'record_offline' || action === 'send_options') && !orderId) {
    return json({ error: 'orderId is required' }, 400);
  }
  if (action === 'record_offline' && !paymentMethodId) {
    return json({ error: 'paymentMethodId is required' }, 400);
  }

  try {
    const member = await isMember(tenantId, userId);
    if (!member) return json({ error: 'SellerTray tenant membership required' }, 403);

    const userAllowed = await consumeRateLimit('merchant_payment_user', userId, 30, 60);
    const tenantAllowed = userAllowed
      ? await consumeRateLimit('merchant_payment_tenant', tenantId, 90, 60)
      : false;
    if (!userAllowed || !tenantAllowed) {
      return json({ error: 'Too many payment operations. Try again shortly.' }, 429);
    }

    if (action === 'send_options') {
      const canWrite = await rpc<boolean>('orderdesk_subscription_can_write', {
        p_tenant_id: tenantId,
      });
      if (!canWrite) return json({ error: 'SellerTray subscription is read-only' }, 403);
      const queued = await queueMerchantPaymentOptions(tenantId, orderId!);
      return json({ ok: true, orderId, ...queued });
    }

    if (action === 'record_offline') {
      const canWrite = await rpc<boolean>('orderdesk_subscription_can_write', {
        p_tenant_id: tenantId,
      });
      if (!canWrite) return json({ error: 'SellerTray subscription is read-only' }, 403);

      const method = await loadPaymentMethod(tenantId, paymentMethodId!);
      if (!method || method.is_enabled !== true) {
        return json({ error: 'Payment method is not enabled' }, 409);
      }
      if (!['bank_transfer','cash_on_delivery','pay_on_pickup'].includes(String(method.method_type))) {
        return json({ error: 'Only offline payment methods can be recorded manually' }, 409);
      }

      const newPaymentId = await rpc<string>('create_sellertray_order_payment_for_method', {
        p_tenant_id: tenantId,
        p_order_id: orderId,
        p_payment_method_id: paymentMethodId,
        p_status: 'initiated',
        p_provider_reference: null,
        p_idempotency_key: 'merchant-record:' + userId + ':' + crypto.randomUUID(),
        p_customer_claimed_at: null,
      });
      await rpc('confirm_sellertray_offline_payment', {
        p_payment_id: newPaymentId,
        p_actor_user_id: userId,
        p_note: optional(body.note, 500),
      });
      return json({ ok: true, orderId, paymentId: newPaymentId, status: 'confirmed' });
    }

    const payment = await loadPayment(tenantId, paymentId!);
    if (!payment) return json({ error: 'Payment not found' }, 404);

    if (action === 'confirm_offline') {
      await rpc('confirm_sellertray_offline_payment', {
        p_payment_id: paymentId,
        p_actor_user_id: userId,
        p_note: optional(body.note, 500),
      });
      return json({ ok: true, paymentId, status: 'confirmed' });
    }

    if (payment.provider !== 'paystack' && payment.provider !== 'flutterwave') {
      return json({ error: 'Only gateway payments can be provider-verified' }, 409);
    }

    const runtime = await callRuntime(paymentId);
    return json({
      ok: true,
      paymentId,
      status: runtime.status || payment.status,
      providerStatus: runtime.providerStatus || null,
    });
  } catch (error) {
    const message = error instanceof Error ? sanitize(error.message) : 'Payment operation failed';
    const status = /membership|required|Only offline|not awaiting|read-only/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : 400;
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'merchant-payment-operations',
      event: 'request_failed',
      payment_id: paymentId,
      error: message,
    }));
    return json({ error: message }, status);
  }
});

async function verifiedUser(auth: string): Promise<string | null> {
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    signal: AbortSignal.timeout(8000),
    headers: { apikey: SERVICE_KEY, authorization: auth },
  });
  if (!r.ok) return null;
  try {
    const user = await r.json() as J;
    return typeof user.id === 'string' && user.id ? user.id : null;
  } catch {
    return null;
  }
}

async function isMember(tenantId: string, userId: string): Promise<boolean> {
  const rows = await rest<Array<{ role: string }>>(
    '/rest/v1/tenant_members?select=role&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&user_id=eq.' + encodeURIComponent(userId) + '&limit=1',
  );
  return Boolean(rows[0]?.role);
}

async function loadPaymentMethod(tenantId: string, paymentMethodId: string): Promise<J | null> {
  const rows = await rest<J[]>(
    '/rest/v1/merchant_payment_methods?select=id,tenant_id,method_type,display_name,is_enabled' +
    '&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&id=eq.' + encodeURIComponent(paymentMethodId) + '&limit=1',
  );
  return rows[0] || null;
}

async function queueMerchantPaymentOptions(
  tenantId: string,
  orderId: string,
): Promise<{ deliveryStatus: string; message: string }> {
  const orders = await rest<Array<{
    id: string;
    customer_id: string;
    public_order_id: string;
    payment_status: string;
    source: string;
  }>>(
    '/rest/v1/orders?select=id,customer_id,public_order_id,payment_status,source' +
    '&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&id=eq.' + encodeURIComponent(orderId) + '&limit=1',
  );
  const order = orders[0];
  if (!order) throw new Error('Order not found');
  if (order.payment_status === 'paid') throw new Error('SellerTray order is already paid');
  if (order.source !== 'whatsapp') throw new Error('Payment options can only be sent to a WhatsApp customer');

  const [tenants, customers, invoices, methods, inbound] = await Promise.all([
    rest<Array<{ name: string; whatsapp_phone_number_id: string | null }>>(
      '/rest/v1/tenants?select=name,whatsapp_phone_number_id&id=eq.' + encodeURIComponent(tenantId) + '&limit=1',
    ),
    rest<Array<{ wa_id: string | null }>>(
      '/rest/v1/customers?select=wa_id&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&id=eq.' + encodeURIComponent(order.customer_id) + '&limit=1',
    ),
    rest<Array<{ document_reference: string; amount: number | string; currency: string }>>(
      '/rest/v1/order_financial_documents?select=document_reference,amount,currency' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&order_id=eq.' + encodeURIComponent(orderId) +
      '&document_type=eq.invoice&status=eq.issued&limit=1',
    ),
    rest<Array<{ display_name: string }>>(
      '/rest/v1/merchant_payment_methods?select=display_name' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&is_enabled=eq.true&order=is_default.desc,sort_order.asc,created_at.asc',
    ),
    rest<Array<{ received_at: string }>>(
      '/rest/v1/inbound_messages?select=received_at' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&customer_id=eq.' + encodeURIComponent(order.customer_id) +
      '&order=received_at.desc&limit=1',
    ),
  ]);

  const tenant = tenants[0];
  const customer = customers[0];
  const invoice = invoices[0];
  if (!tenant?.whatsapp_phone_number_id || !customer?.wa_id || customer.wa_id.startsWith('manual:')) {
    throw new Error('Customer does not have an active WhatsApp destination');
  }
  if (!invoice) throw new Error('SellerTray order has no payable invoice');
  if (methods.length === 0) throw new Error('No customer payment method is enabled');

  const methodNames = methods.map((method) => method.display_name).join(', ');
  const message = [
    'Payment options — ' + tenant.name,
    'Order Ref: ' + order.public_order_id,
    'Invoice: ' + invoice.document_reference,
    'Total: ' + formatMoney(Number(invoice.amount) || 0, invoice.currency),
    'Available: ' + methodNames,
    '',
    'Reply PAY ' + order.public_order_id + ' to choose how to pay.',
  ].join('\n');

  const lastInboundAt = inbound[0]?.received_at ? new Date(inbound[0].received_at).getTime() : 0;
  const windowExpiresAt = lastInboundAt ? new Date(lastInboundAt + 86_400_000) : null;
  const deliveryStatus = windowExpiresAt && windowExpiresAt.getTime() > Date.now()
    ? 'pending'
    : 'template_required';

  await rest('/rest/v1/outbound_notifications', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      tenant_id: tenantId,
      order_id: orderId,
      customer_id: order.customer_id,
      event_key: 'payment_options',
      delivery_status: deliveryStatus,
      from_phone_number_id: tenant.whatsapp_phone_number_id,
      to_wa_id: customer.wa_id,
      message_body: message.slice(0, 2000),
      conversation_window_expires_at: windowExpiresAt?.toISOString() ?? null,
    }),
  });

  return {
    deliveryStatus,
    message: deliveryStatus === 'pending'
      ? 'Payment options queued to the customer on WhatsApp.'
      : 'Payment options require an approved WhatsApp template because the 24-hour customer-service window is closed.',
  };
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: /^[A-Z]{3}$/.test(currency) ? currency : 'NGN',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return currency + ' ' + value.toFixed(2);
  }
}

async function loadPayment(tenantId: string, paymentId: string): Promise<J | null> {
  const rows = await rest<J[]>(
    '/rest/v1/order_payments?select=id,tenant_id,provider,method_type,status' +
    '&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&id=eq.' + encodeURIComponent(paymentId) + '&limit=1',
  );
  return rows[0] || null;
}

async function callRuntime(paymentId: string): Promise<J> {
  const r = await fetch(SUPABASE_URL + '/functions/v1/payment-runtime', {
    method: 'POST',
    signal: AbortSignal.timeout(12000),
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: 'verify', paymentId }),
  });
  let payload: J = {};
  try { payload = await r.json() as J; } catch {}
  if (!r.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Provider verification failed');
  }
  return payload;
}

async function consumeRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  return rpc<boolean>('consume_sellertray_rate_limit', {
    p_scope: scope,
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
}

async function rpc<T = unknown>(name: string, body: J): Promise<T> {
  return rest<T>('/rest/v1/rpc/' + encodeURIComponent(name), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(SUPABASE_URL + path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10000),
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error('SellerTray data request failed with HTTP ' + r.status + ': ' + (await r.text()).slice(0, 240));
  const raw = await r.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

function uuid(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const x = v.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x) ? x : null;
}
function optional(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const x = v.trim();
  return x ? x.slice(0, max) : null;
}
function sanitize(v: string): string {
  return v.replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ').slice(0, 300);
}
function json(payload: J, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
