import type { RealtimeChannel } from '@supabase/supabase-js';

import type { MerchantOrder, OrderStatus } from '../domain/order';
import { supabase } from '../lib/supabase';

type OrderRow = {
  id: string;
  status: OrderStatus;
  source: 'whatsapp' | 'manual';
  parser_confidence: number | string | null;
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
    quantity: number | string;
    unit_price: number | string | null;
  }> | null;
};

export type OrderItemInput = {
  name: string;
  quantity: number;
  unitPrice: number | null;
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

function mapOrder(row: OrderRow): MerchantOrder {
  const customer = one(row.customers);
  const sourceMessage = one(row.inbound_messages);

  return {
    id: row.id,
    customerName: customer?.display_name || customer?.phone || customer?.wa_id || 'WhatsApp customer',
    customerPhone: customer?.phone || customer?.wa_id || '',
    receivedAt: row.created_at,
    status: row.status,
    source: row.source,
    customerMessage: sourceMessage?.text_body || '',
    confidence: toNumber(row.parser_confidence),
    items: (row.order_items ?? []).map((item) => ({
      id: item.id,
      name: item.item_name,
      quantity: toNumber(item.quantity) ?? 1,
      unitPrice: toNumber(item.unit_price),
    })),
  };
}

export async function loadOrders(): Promise<MerchantOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,
      status,
      source,
      parser_confidence,
      created_at,
      customers(display_name, phone, wa_id),
      inbound_messages(text_body),
      order_items(id, item_name, quantity, unit_price)
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as unknown as OrderRow[]).map(mapOrder);
}

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ status, updated_at: new Date().toISOString() })
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

export function subscribeToOrderChanges(onChange: () => void): RealtimeChannel {
  return supabase
    .channel('merchant-orders')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_items' },
      onChange,
    )
    .subscribe();
}

export async function unsubscribeFromOrderChanges(channel: RealtimeChannel): Promise<void> {
  await supabase.removeChannel(channel);
}
