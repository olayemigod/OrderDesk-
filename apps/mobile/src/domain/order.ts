export type OrderStatus =
  | 'draft'
  | 'needs_review'
  | 'accepted'
  | 'rejected'
  | 'processing'
  | 'ready'
  | 'completed'
  | 'cancelled';

export type ParserSource = 'legacy' | 'external' | 'fallback' | 'manual';

export type FulfillmentMethod =
  | 'customer_pickup'
  | 'merchant_delivery'
  | 'third_party_delivery';

export type FulfillmentStatus =
  | 'unassigned'
  | 'out_for_delivery'
  | 'delivered'
  | 'collected';

export type PaymentStatus =
  | 'unpaid'
  | 'pending'
  | 'verification_required'
  | 'paid'
  | 'payment_issue';

export type MatchSource =
  | 'legacy'
  | 'catalogue_name'
  | 'catalogue_alias'
  | 'normalized_name'
  | 'normalized_alias'
  | 'unmatched'
  | 'manual'
  | 'merchant_match'
  | 'one_off';

export type OrderStatusEvent = {
  id: string;
  eventType: 'created' | 'transition' | 'snapshot';
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorKind: 'system' | 'merchant';
  reason: string | null;
  createdAt: string;
};

export type NotificationEventKey =
  | 'order_received'
  | 'order_accepted'
  | 'order_ready'
  | 'order_out_for_delivery'
  | 'order_rejected'
  | 'order_cancelled'
  | 'order_status_reply'
  | 'order_receipt'
  | 'payment_options'
  | 'payment_instructions'
  | 'payment_claim_received'
  | 'payment_confirmed'
  | 'payment_status_reply'
  | 'financial_document';

export type NotificationDeliveryStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'template_required'
  | 'skipped';

export type OrderNotification = {
  id: string;
  eventKey: NotificationEventKey;
  deliveryStatus: NotificationDeliveryStatus;
  messageBody: string;
  createdAt: string;
  sentAt: string | null;
};

export type OrderItem = {
  id: string;
  catalogItemId: string | null;
  name: string;
  originalName: string | null;
  quantity: number;
  unitPrice: number | null;
  matchSource: MatchSource;
  matchConfidence: number | null;
};

export type MerchantOrder = {
  id: string;
  customerId: string;
  publicOrderId: string;
  customerName: string;
  customerPhone: string;
  receivedAt: string;
  status: OrderStatus;
  statusReason: string | null;
  fulfillmentMethod: FulfillmentMethod | null;
  fulfillmentStatus: FulfillmentStatus;
  deliveryProvider: string | null;
  deliveryReference: string | null;
  deliveryContactName: string | null;
  deliveryContactPhone: string | null;
  estimatedDeliveryAt: string | null;
  deliveryNote: string | null;
  dispatchedAt: string | null;
  fulfilledAt: string | null;
  fulfillmentConfirmedBy: 'merchant' | 'customer_whatsapp' | null;
  customerConfirmedAt: string | null;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  paymentConfirmedAt: string | null;
  source: 'whatsapp' | 'manual';
  customerMessage: string;
  confidence: number | null;
  parserSource: ParserSource;
  parserVersion: string | null;
  reviewReasons: string[];
  statusHistory: OrderStatusEvent[];
  notifications: OrderNotification[];
  items: OrderItem[];
};

export function orderTotal(order: MerchantOrder): number | null {
  if (order.items.some((item) => item.unitPrice === null)) {
    return null;
  }

  return order.items.reduce(
    (sum, item) => sum + item.quantity * (item.unitPrice ?? 0),
    0,
  );
}
