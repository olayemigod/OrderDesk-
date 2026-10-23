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

export type PosPaymentTerms = 'immediate' | 'partial' | 'pay_later';

export type ReturnStatus = 'none' | 'partial' | 'returned';

export type OrderSource = 'whatsapp' | 'manual' | 'pos';

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
  selectedUom: string;
  conversionFactor: number;
  stockQuantity: number;
  unitPrice: number | null;
  matchSource: MatchSource;
  matchConfidence: number | null;
};

export type MerchantOrder = {
  id: string;
  branchId: string;
  branchName: string;
  posOperatorUserId: string | null;
  posOperatorName: string | null;
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
  deliveryNote: string | null;
  dispatchedAt: string | null;
  fulfilledAt: string | null;
  fulfillmentConfirmedBy: 'merchant' | 'customer_whatsapp' | null;
  customerConfirmedAt: string | null;
  paymentStatus: PaymentStatus;
  paymentTerms: PosPaymentTerms | null;
  amountPaid: number;
  paymentConfirmedAt: string | null;
  subtotalAmount?: number | null;
  taxApplied?: boolean | null;
  taxRatePercent?: number | null;
  taxAmount?: number | null;
  taxDisplayBreakdown?: boolean | null;
  grossAmount?: number | null;
  cashReturnSupported?: boolean;
  returnStatus: ReturnStatus;
  returnedAmount: number;
  returnedAt: string | null;
  source: OrderSource;
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
  if (typeof order.grossAmount === 'number' && Number.isFinite(order.grossAmount)) {
    return order.grossAmount;
  }

  // Compatibility fallback for older records that were loaded without the
  // authoritative transaction total. New order reads populate grossAmount from
  // orders.total_amount for every lifecycle state, including Partial/Pay later.
  if (order.status === 'completed' && order.paymentStatus === 'paid' && Number.isFinite(order.amountPaid)) {
    return order.amountPaid;
  }

  if (order.items.some((item) => item.unitPrice === null)) {
    return null;
  }

  return order.items.reduce(
    (sum, item) => sum + item.quantity * (item.unitPrice ?? 0),
    0,
  );
}

export function orderOutstanding(order: MerchantOrder): number | null {
  const total = orderTotal(order);
  if (total === null) return null;
  return Math.max(0, Number((total - order.returnedAmount - order.amountPaid).toFixed(2)));
}

export function orderPaymentLabel(order: MerchantOrder): string {
  if (order.paymentStatus === 'paid') return 'Paid';
  if (order.paymentStatus === 'payment_issue') return 'Payment issue';
  if (order.amountPaid > 0.005 && (orderOutstanding(order) ?? 0) > 0.005) return 'Partial';
  if (order.paymentStatus === 'verification_required') return 'Verification required';
  if (order.paymentStatus === 'pending') return 'Pending';
  if (order.paymentTerms === 'pay_later' && (orderOutstanding(order) ?? 0) > 0.005) return 'Pay later';
  return 'Unpaid';
}
