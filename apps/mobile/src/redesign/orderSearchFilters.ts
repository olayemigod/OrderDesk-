import type { MerchantOrder } from '../domain/order';

export type OrderStatusFilter = 'all' | 'draft' | 'needs_review' | 'active' | 'completed' | 'cancelled';
export type OrderPaymentFilter = 'all' | 'unpaid' | 'partially_paid' | 'awaiting_verification' | 'paid';
export type OrderSourceFilter = 'all' | 'pos' | 'whatsapp' | 'manual';
export type OrderPeriodFilter = 'all' | 'today' | 'seven_days' | 'thirty_days';

export type OrderSearchFilters = {
  query: string;
  status: OrderStatusFilter;
  payment: OrderPaymentFilter;
  source: OrderSourceFilter;
  period: OrderPeriodFilter;
};

export const DEFAULT_ORDER_FILTERS: OrderSearchFilters = {
  query: '',
  status: 'all',
  payment: 'all',
  source: 'all',
  period: 'all',
};

export function matchesOrderSearch(order: MerchantOrder, filters: OrderSearchFilters, now = Date.now()): boolean {
  const query = filters.query.trim().toLocaleLowerCase();

  if (query && ![
    order.publicOrderId,
    order.customerName,
    order.customerPhone,
    ...order.items.map((item) => item.name),
  ].join(' ').toLocaleLowerCase().includes(query)) return false;

  if (filters.source !== 'all' && order.source !== filters.source) return false;

  if (filters.status !== 'all') {
    const active = order.status === 'accepted' || order.status === 'processing' || order.status === 'ready';
    if (filters.status === 'active' ? !active : order.status !== filters.status) return false;
  }

  if (filters.payment !== 'all') {
    const total = typeof order.grossAmount === 'number' && Number.isFinite(order.grossAmount)
      ? order.grossAmount
      : order.items.every((item) => item.unitPrice !== null)
        ? order.items.reduce((sum, item) => sum + item.quantity * (item.unitPrice ?? 0), 0)
        : null;
    const partial = order.amountPaid > 0 && order.paymentStatus !== 'paid' && (total === null || order.amountPaid < total);
    const awaitingVerification = order.paymentStatus === 'pending'
      || order.paymentStatus === 'verification_required'
      || order.paymentStatus === 'payment_issue';

    if (filters.payment === 'paid' && order.paymentStatus !== 'paid') return false;
    if (filters.payment === 'unpaid' && !(order.paymentStatus === 'unpaid' && order.amountPaid === 0)) return false;
    if (filters.payment === 'partially_paid' && !partial) return false;
    if (filters.payment === 'awaiting_verification' && !awaitingVerification) return false;
  }

  if (filters.period !== 'all') {
    const received = new Date(order.receivedAt).getTime();
    if (!Number.isFinite(received)) return false;
    const start = filters.period === 'today'
      ? new Date(now).setHours(0, 0, 0, 0)
      : now - (filters.period === 'seven_days' ? 7 : 30) * 24 * 60 * 60 * 1000;
    if (received < start || received > now) return false;
  }

  return true;
}
