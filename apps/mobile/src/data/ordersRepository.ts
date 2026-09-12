import type { RealtimeChannel } from '@supabase/supabase-js';

import type {
  MatchSource,
  MerchantOrder,
  NotificationDeliveryStatus,
  FulfillmentMethod,
  FulfillmentStatus,
  NotificationEventKey,
  OrderNotification,
  OrderStatus,
  ParserSource,
  PaymentStatus,
} from '../domain/order';
import { supabase } from '../lib/supabase';

type OrderStatusEventRow = {
  id: string;
  event_type: 'created' | 'transition' | 'snapshot';
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_kind: 'system' | 'merchant';
  reason: string | null;
  created_at: string;
};

type OrderNotificationRow = {
  id: string;
  order_id: string;
  event_key: NotificationEventKey;
  delivery_status: NotificationDeliveryStatus;
  message_body: string;
  created_at: string;
  sent_at: string | null;
};

type OrderRow = {
  id: string;
  public_order_id: string;
  status: OrderStatus;
  status_reason: string | null;
  fulfillment_method: FulfillmentMethod | null;
  fulfillment_status: FulfillmentStatus;
  delivery_provider: string | null;
  delivery_reference: string | null;
  delivery_note: string | null;
  dispatched_at: string | null;
  fulfilled_at: string | null;
  fulfillment_confirmed_by: 'merchant' | 'customer_whatsapp' | null;
  customer_confirmed_at: string | null;
  payment_status: PaymentStatus;
  amount_paid: number | string;
  payment_confirmed_at: string | null;
  source: 'whatsapp' | 'manual';
  customer_note: string | null;
  parser_confidence: number | string | null;
  parser_source: ParserSource;
  parser_version: string | null;
  review_reasons: string[] | null;
  created_at: string;
  customers:
    | { display_name: string | null; phone: string | null; wa_id: string }
    | Array<{ display_name: string | null; phone: string | null; wa_id: string }>
    | null;
  inbound_messages:
    | { text_body: string | null }
    | Array<{ text_body: string | null }>
    | null;
  order_items: Array<{
    id: string;
    item_name: string;
    original_item_name: string | null;
    quantity: number | string;
    unit_price: number | string | null;
    match_source: MatchSource;
    match_confidence: number | string | null;
  }> | null;
  order_status_events: OrderStatusEventRow[] | null;
};

export type OrderItemInput = {
  name: string;
  quantity: number;
  unitPrice: number | null;
};

export type ManualOrderLineInput = {
  catalogItemId: string;
  quantity: number;
};

export type ManualOrderInput = {
  tenantId: string;
  customerName: string;
  customerPhone: string;
  note?: string | null;
  items: ManualOrderLineInput[];
};


function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapOrder(row: OrderRow, notifications: OrderNotification[]): MerchantOrder {
  const customer = one(row.customers);
  const sourceMessage = one(row.inbound_messages);

  return {
    id: row.id,
    publicOrderId: row.public_order_id,
    customerName: customer?.display_name || customer?.phone || customer?.wa_id || 'WhatsApp customer',
    customerPhone: customer?.phone || customer?.wa_id || '',
    receivedAt: row.created_at,
    status: row.status,
    statusReason: row.status_reason,
    fulfillmentMethod: row.fulfillment_method,
    fulfillmentStatus: row.fulfillment_status,
    deliveryProvider: row.delivery_provider,
    deliveryReference: row.delivery_reference,
    deliveryNote: row.delivery_note,
    dispatchedAt: row.dispatched_at,
    fulfilledAt: row.fulfilled_at,
    fulfillmentConfirmedBy: row.fulfillment_confirmed_by,
    customerConfirmedAt: row.customer_confirmed_at,
    paymentStatus: row.payment_status,
    amountPaid: toNumber(row.amount_paid) ?? 0,
    paymentConfirmedAt: row.payment_confirmed_at,
    source: row.source,
    customerMessage: sourceMessage?.text_body || row.customer_note || '',
    confidence: toNumber(row.parser_confidence),
    parserSource: row.parser_source,
    parserVersion: row.parser_version,
    reviewReasons: row.review_reasons ?? [],
    statusHistory: (row.order_status_events ?? [])
      .map((event) => ({
        id: event.id,
        eventType: event.event_type,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        actorKind: event.actor_kind,
        reason: event.reason,
        createdAt: event.created_at,
      }))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    notifications: notifications
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    items: (row.order_items ?? []).map((item) => ({
      id: item.id,
      name: item.item_name,
      originalName: item.original_item_name,
      quantity: toNumber(item.quantity) ?? 1,
      unitPrice: toNumber(item.unit_price),
      matchSource: item.match_source,
      matchConfidence: toNumber(item.match_confidence),
    })),
  };
}

export async function loadOrders(tenantId: string): Promise<MerchantOrder[]> {
  if (!tenantId) return [];

  const [ordersResult, notificationsResult] = await Promise.all([
    supabase
      .from('orders')
      .select(`
        id,
        public_order_id,
        status,
        status_reason,
        fulfillment_method,
        fulfillment_status,
        delivery_provider,
        delivery_reference,
        delivery_note,
        dispatched_at,
        fulfilled_at,
        fulfillment_confirmed_by,
        customer_confirmed_at,
        payment_status,
        amount_paid,
        payment_confirmed_at,
        source,
        customer_note,
        parser_confidence,
        parser_source,
        parser_version,
        review_reasons,
        created_at,
        customers(display_name, phone, wa_id),
        inbound_messages(text_body),
        order_items(id, item_name, original_item_name, quantity, unit_price, match_source, match_confidence),
        order_status_events(id, event_type, from_status, to_status, actor_kind, reason, created_at)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('outbound_notifications')
      .select('id, order_id, event_key, delivery_status, message_body, created_at, sent_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
  ]);

  if (ordersResult.error) throw ordersResult.error;
  if (notificationsResult.error) throw notificationsResult.error;

  const notificationsByOrder = new Map<string, OrderNotification[]>();
  for (const row of (notificationsResult.data ?? []) as OrderNotificationRow[]) {
    const notification: OrderNotification = {
      id: row.id,
      eventKey: row.event_key,
      deliveryStatus: row.delivery_status,
      messageBody: row.message_body,
      createdAt: row.created_at,
      sentAt: row.sent_at,
    };
    const bucket = notificationsByOrder.get(row.order_id) ?? [];
    bucket.push(notification);
    notificationsByOrder.set(row.order_id, bucket);
  }

  return ((ordersResult.data ?? []) as unknown as OrderRow[]).map((row) =>
    mapOrder(row, notificationsByOrder.get(row.id) ?? []),
  );
}

export async function createManualOrder(input: ManualOrderInput): Promise<string> {
  const { data, error } = await supabase.functions.invoke('merchant-order', {
    body: {
      tenantId: input.tenantId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      note: input.note ?? null,
      items: input.items,
    },
  });

  if (error) {
    let message = error.message || 'Unable to create order.';
    if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
      try {
        const payload = await (error.context as Response).clone().json() as { error?: string };
        if (payload?.error) message = payload.error;
      } catch {
        // Keep the SDK message.
      }
    }
    throw new Error(message);
  }

  const orderId =
    data && typeof data === 'object' && 'orderId' in data && typeof data.orderId === 'string'
      ? data.orderId
      : null;

  if (!orderId) throw new Error('SellerTray returned an invalid order id.');
  return orderId;
}

export type OrderFulfillmentInput = {
  method: FulfillmentMethod;
  provider?: string | null;
  reference?: string | null;
  note?: string | null;
};

export async function startOrderDelivery(
  orderId: string,
  input: OrderFulfillmentInput,
): Promise<void> {
  if (input.method === 'customer_pickup') {
    throw new Error('Customer pickup does not require a delivery start.');
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('orders')
    .update({
      fulfillment_method: input.method,
      fulfillment_status: 'out_for_delivery',
      delivery_provider: input.provider?.trim() || null,
      delivery_reference: input.reference?.trim() || null,
      delivery_note: input.note?.trim() || null,
      dispatched_at: now,
      fulfilled_at: null,
      updated_at: now,
    })
    .eq('id', orderId)
    .eq('status', 'ready');

  if (error) throw error;
}

export async function completeOrderFulfillment(
  orderId: string,
  input: OrderFulfillmentInput,
): Promise<void> {
  const now = new Date().toISOString();
  const fulfillmentStatus: FulfillmentStatus =
    input.method === 'customer_pickup' ? 'collected' : 'delivered';

  const { error } = await supabase
    .from('orders')
    .update({
      status: 'completed',
      status_reason: null,
      fulfillment_method: input.method,
      fulfillment_status: fulfillmentStatus,
      fulfillment_confirmed_by: 'merchant',
      customer_confirmed_at: null,
      customer_confirmation_message_id: null,
      delivery_provider: input.provider?.trim() || null,
      delivery_reference: input.reference?.trim() || null,
      delivery_note: input.note?.trim() || null,
      fulfilled_at: now,
      updated_at: now,
    })
    .eq('id', orderId)
    .eq('status', 'ready');

  if (error) throw error;
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({
      status,
      status_reason: reason?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (error) throw error;
}

export async function addOrderItem(orderId: string, item: OrderItemInput): Promise<void> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('tenant_id')
    .eq('id', orderId)
    .single();

  if (orderError) throw orderError;
  if (!order?.tenant_id) throw new Error('Unable to resolve the order tenant.');

  const { error } = await supabase.from('order_items').insert({
    tenant_id: order.tenant_id,
    order_id: orderId,
    item_name: item.name.trim(),
    quantity: item.quantity,
    unit_price: item.unitPrice,
  });

  if (error) throw error;
}

export async function updateOrderItem(itemId: string, item: OrderItemInput): Promise<void> {
  const { error } = await supabase
    .from('order_items')
    .update({
      item_name: item.name.trim(),
      quantity: item.quantity,
      unit_price: item.unitPrice,
    })
    .eq('id', itemId);

  if (error) throw error;
}

export async function deleteOrderItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('order_items').delete().eq('id', itemId);
  if (error) throw error;
}

export function subscribeToOrderChanges(tenantId: string, onChange: () => void): RealtimeChannel {
  return supabase
    .channel(`merchant-orders-${tenantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_items', filter: `tenant_id=eq.${tenantId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_status_events', filter: `tenant_id=eq.${tenantId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'outbound_notifications', filter: `tenant_id=eq.${tenantId}` },
      onChange,
    )
    .subscribe();
}

export async function unsubscribeFromOrderChanges(channel: RealtimeChannel): Promise<void> {
  await supabase.removeChannel(channel);
}
