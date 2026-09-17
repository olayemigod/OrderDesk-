import { supabase } from '../lib/supabase';

export type ConversationWorkState =
  | 'ai_handling'
  | 'needs_merchant'
  | 'merchant_handling'
  | 'waiting_customer'
  | 'resolved';

export type ConversationSummary = {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  customerWaId: string;
  workState: ConversationWorkState;
  assignedUserId: string | null;
  assignedUserEmail: string | null;
  lastStateReason: string | null;
  lastInboundMessageId: string | null;
  lastInboundText: string | null;
  lastInboundAt: string | null;
  lastOutboundText: string | null;
  lastOutboundAt: string | null;
  latestOrderId: string | null;
  latestOrderPublicId: string | null;
  latestOrderStatus: string | null;
  latestOrderPaymentStatus: string | null;
  lastActivityAt: string | null;
};

export type ConversationMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  actor: 'customer' | 'merchant' | 'sellertray';
  text: string;
  messageType: string;
  deliveryStatus: string | null;
  eventKey: string | null;
  occurredAt: string;
};

export async function loadConversations(
  tenantId: string,
  limit = 200,
): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc('sellertray_list_conversations', {
    p_tenant_id: tenantId,
    p_limit: limit,
  });
  if (error) throw error;
  if (!Array.isArray(data)) return [];

  return data.flatMap((value) => {
    if (!isRecord(value)) return [];
    const customerId = stringValue(value.customer_id);
    const customerName = stringValue(value.customer_name);
    const customerWaId = stringValue(value.customer_wa_id);
    const workState = parseWorkState(value.work_state);
    if (!customerId || !customerName || !customerWaId || !workState) return [];

    return [{
      customerId,
      customerName,
      customerPhone: nullableString(value.customer_phone),
      customerWaId,
      workState,
      assignedUserId: nullableString(value.assigned_user_id),
      assignedUserEmail: nullableString(value.assigned_user_email),
      lastStateReason: nullableString(value.last_state_reason),
      lastInboundMessageId: nullableString(value.last_inbound_message_id),
      lastInboundText: nullableString(value.last_inbound_text),
      lastInboundAt: nullableString(value.last_inbound_at),
      lastOutboundText: nullableString(value.last_outbound_text),
      lastOutboundAt: nullableString(value.last_outbound_at),
      latestOrderId: nullableString(value.latest_order_id),
      latestOrderPublicId: nullableString(value.latest_order_public_id),
      latestOrderStatus: nullableString(value.latest_order_status),
      latestOrderPaymentStatus: nullableString(value.latest_order_payment_status),
      lastActivityAt: nullableString(value.last_activity_at),
    } satisfies ConversationSummary];
  });
}

export async function loadConversationMessages(
  tenantId: string,
  customerId: string,
  limit = 100,
): Promise<ConversationMessage[]> {
  const { data, error } = await supabase.rpc('sellertray_list_conversation_messages', {
    p_tenant_id: tenantId,
    p_customer_id: customerId,
    p_limit: limit,
  });
  if (error) throw error;
  if (!Array.isArray(data)) return [];

  return data.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = stringValue(value.message_id);
    const direction = value.direction === 'inbound' || value.direction === 'outbound'
      ? value.direction
      : null;
    const actor = value.actor === 'customer' || value.actor === 'merchant' || value.actor === 'sellertray'
      ? value.actor
      : null;
    const text = stringValue(value.message_text);
    const occurredAt = stringValue(value.occurred_at);
    if (!id || !direction || !actor || !text || !occurredAt) return [];

    return [{
      id,
      direction,
      actor,
      text,
      messageType: stringValue(value.message_type) || 'message',
      deliveryStatus: nullableString(value.delivery_status),
      eventKey: nullableString(value.event_key),
      occurredAt,
    } satisfies ConversationMessage];
  });
}

export async function takeOverConversation(
  tenantId: string,
  customerId: string,
): Promise<void> {
  await invokeConversationAction({
    action: 'take_over',
    tenantId,
    customerId,
  });
}

export async function returnConversationToAi(
  tenantId: string,
  customerId: string,
): Promise<void> {
  await invokeConversationAction({
    action: 'return_to_ai',
    tenantId,
    customerId,
  });
}

export async function assignConversation(
  tenantId: string,
  customerId: string,
  assignedUserId: string,
): Promise<void> {
  await invokeConversationAction({
    action: 'assign',
    tenantId,
    customerId,
    assignedUserId,
  });
}

export async function resolveConversation(
  tenantId: string,
  customerId: string,
): Promise<void> {
  await invokeConversationAction({
    action: 'resolve',
    tenantId,
    customerId,
  });
}

export async function replyToConversation(
  tenantId: string,
  customerId: string,
  message: string,
): Promise<void> {
  await invokeConversationAction({
    action: 'reply',
    tenantId,
    customerId,
    message,
  });
}

async function invokeConversationAction(body: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.functions.invoke('merchant-conversation-action', {
    body,
  });
  if (!error) return;

  let message = error.message || 'SellerTray could not update this conversation.';
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

function parseWorkState(value: unknown): ConversationWorkState | null {
  return value === 'ai_handling' ||
    value === 'needs_merchant' ||
    value === 'merchant_handling' ||
    value === 'waiting_customer' ||
    value === 'resolved'
    ? value
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
