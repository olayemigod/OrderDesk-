import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type J = Record<string, unknown>;

type ChangeRequestRow = {
  id: string;
  tenant_id: string;
  order_id: string | null;
  customer_id: string;
  request_kind: 'add_items' | 'remove_items' | 'change_items' | 'cancel_order' | 'other';
  request_text: string;
  parsed_items: unknown;
  status: 'pending' | 'reviewed' | 'resolved' | 'rejected';
};

type OrderRow = {
  id: string;
  tenant_id: string;
  status: 'draft' | 'needs_review' | 'accepted' | 'rejected' | 'processing' | 'ready' | 'completed' | 'cancelled';
};

type ParsedChangeItem = {
  catalog_item_id: string | null;
  item_name: string;
  original_item_name: string | null;
  quantity: number;
  unit_price: number | null;
  match_source: string;
  match_confidence: number | null;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 32_768;

const cors = {
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
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!admin) return reply({ error: 'Server configuration error' }, 500);

  const userId = await authenticatedUserId(request);
  if (!userId) return reply({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return reply({ error: 'Payload too large' }, 413);

  let body: J;
  try {
    body = JSON.parse(bodyRead.text) as J;
  } catch {
    return reply({ error: 'Invalid JSON' }, 400);
  }

  const requestId = uuid(body.requestId);
  const action = text(body.action);
  if (!requestId || !action) {
    return reply({ error: 'requestId and action are required' }, 400);
  }
  if (!['apply', 'resolve', 'reject'].includes(action)) {
    return reply({ error: 'Unsupported action' }, 400);
  }

  const { data: changeRequest, error: requestError } = await admin
    .from('customer_order_change_requests')
    .select('id,tenant_id,order_id,customer_id,request_kind,request_text,parsed_items,status')
    .eq('id', requestId)
    .maybeSingle();

  if (requestError) return reply({ error: requestError.message }, 400);
  if (!changeRequest) return reply({ error: 'Order change request not found' }, 404);

  const row = changeRequest as ChangeRequestRow;

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', row.tenant_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) return reply({ error: membershipError.message }, 400);
  if (!membership) return reply({ error: 'You do not have access to this business' }, 403);

  const { data: access, error: accessError } = await admin.rpc('get_orderdesk_subscription_access', {
    p_tenant_id: row.tenant_id,
  });
  if (accessError) return reply({ error: accessError.message }, 400);
  const accessMode = access && typeof access === 'object' && 'accessMode' in access
    ? String((access as J).accessMode ?? '')
    : '';
  if (accessMode !== 'full') {
    return reply({ error: 'SellerTray subscription is read-only' }, 403);
  }

  if (row.status !== 'pending' && row.status !== 'reviewed') {
    return reply({ error: 'This customer request has already been resolved' }, 409);
  }

  try {
    if (action === 'reject') {
      await finishRequest(row, userId, 'rejected');
      await markLinkedMerchantNotificationRead(row.id);
      return reply({ ok: true, status: 'rejected' });
    }

    if (action === 'resolve') {
      await finishRequest(row, userId, 'resolved');
      await markLinkedMerchantNotificationRead(row.id);
      return reply({ ok: true, status: 'resolved' });
    }

    if (!row.order_id) {
      return reply({ error: 'SellerTray could not resolve the affected order. Review manually.' }, 409);
    }

    const order = await loadOrder(row.tenant_id, row.order_id);
    if (!order) return reply({ error: 'Affected order not found' }, 404);

    if (row.request_kind === 'add_items') {
      if (!['draft', 'needs_review'].includes(order.status)) {
        return reply({
          error: 'This order has already progressed. Open the order, review the requested additions manually, then mark the request handled.',
        }, 409);
      }

      const items = parseItems(row.parsed_items);
      if (!items.length) {
        return reply({
          error: 'No reliable item suggestion was extracted. Open the order, add the requested item manually, then mark the request handled.',
        }, 409);
      }

      const { error: insertError } = await admin.from('order_items').insert(
        items.map((item) => ({
          tenant_id: row.tenant_id,
          order_id: row.order_id,
          catalog_item_id: item.catalog_item_id,
          item_name: item.item_name,
          original_item_name: item.original_item_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          match_source: item.match_source,
          match_confidence: item.match_confidence,
        })),
      );
      if (insertError) throw insertError;

      await finishRequest(row, userId, 'resolved');
      await markLinkedMerchantNotificationRead(row.id);
      return reply({ ok: true, status: 'resolved', applied: 'add_items', itemCount: items.length });
    }

    if (row.request_kind === 'cancel_order') {
      let nextStatus: 'rejected' | 'cancelled';
      if (order.status === 'draft' || order.status === 'needs_review') {
        nextStatus = 'rejected';
      } else if (['accepted', 'processing', 'ready'].includes(order.status)) {
        nextStatus = 'cancelled';
      } else {
        return reply({ error: `Order is already ${order.status}; cancellation cannot be applied.` }, 409);
      }

      const { error: orderError } = await admin
        .from('orders')
        .update({
          status: nextStatus,
          status_reason: 'Customer requested cancellation via WhatsApp',
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', row.tenant_id)
        .eq('id', row.order_id);
      if (orderError) throw orderError;

      await finishRequest(row, userId, 'resolved');
      await markLinkedMerchantNotificationRead(row.id);
      return reply({ ok: true, status: 'resolved', applied: 'cancel_order', orderStatus: nextStatus });
    }

    return reply({
      error: 'For remove/change requests, edit the order first and then choose Mark handled.',
    }, 409);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to resolve customer request';
    return reply({ error: message.replace(/\s+/g, ' ').slice(0, 400) }, 400);
  }
});

async function authenticatedUserId(request: Request): Promise<string | null> {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token || !admin) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user?.id) return null;
  return data.user.id;
}

async function loadOrder(tenantId: string, orderId: string): Promise<OrderRow | null> {
  if (!admin) return null;
  const { data, error } = await admin
    .from('orders')
    .select('id,tenant_id,status')
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data as OrderRow | null;
}

function parseItems(value: unknown): ParsedChangeItem[] {
  if (!Array.isArray(value)) return [];
  const items: ParsedChangeItem[] = [];

  for (const raw of value.slice(0, 50)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as J;
    const itemName = text(row.item_name);
    const quantity = number(row.quantity);
    if (!itemName || quantity === null || quantity <= 0 || quantity > 9999) continue;

    const unitPrice = nullableNumber(row.unit_price);
    const matchConfidence = nullableNumber(row.match_confidence);
    const catalogItemId = uuid(row.catalog_item_id);
    const originalItemName = text(row.original_item_name);
    const matchSource = text(row.match_source) || 'unmatched';

    items.push({
      catalog_item_id: catalogItemId,
      item_name: itemName.slice(0, 200),
      original_item_name: originalItemName?.slice(0, 200) ?? null,
      quantity,
      unit_price: unitPrice !== null && unitPrice >= 0 ? unitPrice : null,
      match_source: ['catalogue_name','catalogue_alias','normalized_name','normalized_alias','whatsapp_catalog','unmatched'].includes(matchSource)
        ? matchSource
        : 'unmatched',
      match_confidence: matchConfidence === null ? null : Math.min(1, Math.max(0, matchConfidence)),
    });
  }
  return items;
}

async function finishRequest(
  row: ChangeRequestRow,
  userId: string,
  status: 'resolved' | 'rejected',
): Promise<void> {
  if (!admin) throw new Error('Server configuration error');
  const now = new Date().toISOString();
  const { error } = await admin
    .from('customer_order_change_requests')
    .update({
      status,
      resolved_by_user_id: userId,
      resolved_at: now,
      updated_at: now,
    })
    .eq('id', row.id)
    .eq('tenant_id', row.tenant_id)
    .in('status', ['pending', 'reviewed']);
  if (error) throw error;
}

async function markLinkedMerchantNotificationRead(changeRequestId: string): Promise<void> {
  if (!admin) return;
  const now = new Date().toISOString();
  await admin
    .from('merchant_notifications')
    .update({ is_read: true, read_at: now, updated_at: now })
    .eq('change_request_id', changeRequestId)
    .eq('is_read', false);
}

function uuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return number(value);
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
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      parts.push(decoder.decode(result.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}
function reply(payload: J, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
