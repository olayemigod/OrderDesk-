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

export type MatchSource =
  | 'legacy'
  | 'catalogue_name'
  | 'catalogue_alias'
  | 'normalized_name'
  | 'normalized_alias'
  | 'unmatched'
  | 'manual';

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
  | 'order_rejected'
  | 'order_cancelled';

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
  name: string;
  originalName: string | null;
  quantity: number;
  unitPrice: number | null;
  matchSource: MatchSource;
  matchConfidence: number | null;
};

export type MerchantOrder = {
  id: string;
  customerName: string;
  customerPhone: string;
  receivedAt: string;
  status: OrderStatus;
  statusReason: string | null;
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
