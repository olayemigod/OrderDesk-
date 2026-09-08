export type OrderStatus =
  | 'draft'
  | 'needs_review'
  | 'accepted'
  | 'rejected'
  | 'processing'
  | 'ready'
  | 'completed'
  | 'cancelled';

export type OrderItem = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
};

export type MerchantOrder = {
  id: string;
  customerName: string;
  customerPhone: string;
  receivedAt: string;
  status: OrderStatus;
  source: 'whatsapp';
  customerMessage: string;
  confidence: number | null;
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
