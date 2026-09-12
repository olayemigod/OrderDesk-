import {
  confirmOfflinePayment,
  verifyGatewayPayment,
  type OrderPaymentAttempt,
} from './orderPaymentsRepository';
import { supabase } from '../lib/supabase';

export type PaymentReconciliationItem = OrderPaymentAttempt & {
  orderId: string;
  publicOrderId: string;
  customerName: string;
  customerPhone: string | null;
};

type PaymentRow = {
  id: string;
  order_id: string;
  method_type: OrderPaymentAttempt['methodType'];
  provider: string;
  status: OrderPaymentAttempt['status'];
  exception_state: OrderPaymentAttempt['exceptionState'];
  exception_reason: string | null;
  exception_updated_at: string | null;
  amount: number | string;
  currency: string;
  provider_reference: string | null;
  provider_transaction_id: string | null;
  checkout_url: string | null;
  customer_claimed_at: string | null;
  confirmed_at: string | null;
  confirmation_source: string | null;
  failure_reason: string | null;
  created_at: string;
};

type OrderRow = {
  id: string;
  public_order_id: string;
  customer_id: string;
};

type CustomerRow = {
  id: string;
  display_name: string | null;
  phone: string | null;
  wa_id: string;
};

export async function loadPaymentReconciliation(
  tenantId: string,
  limit = 50,
): Promise<PaymentReconciliationItem[]> {
  const { data: paymentData, error: paymentError } = await supabase
    .from('order_payments')
    .select(
      'id,order_id,method_type,provider,status,exception_state,exception_reason,exception_updated_at,amount,currency,provider_reference,provider_transaction_id,checkout_url,customer_claimed_at,confirmed_at,confirmation_source,failure_reason,created_at',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));

  if (paymentError) throw paymentError;

  const paymentRows = (paymentData ?? []) as PaymentRow[];
  if (paymentRows.length === 0) return [];

  const orderIds = Array.from(new Set(paymentRows.map((row) => row.order_id)));
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('id,public_order_id,customer_id')
    .eq('tenant_id', tenantId)
    .in('id', orderIds);

  if (orderError) throw orderError;

  const orderRows = (orderData ?? []) as OrderRow[];
  const customerIds = Array.from(new Set(orderRows.map((row) => row.customer_id)));

  let customerRows: CustomerRow[] = [];
  if (customerIds.length > 0) {
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select('id,display_name,phone,wa_id')
      .eq('tenant_id', tenantId)
      .in('id', customerIds);

    if (customerError) throw customerError;
    customerRows = (customerData ?? []) as CustomerRow[];
  }

  const orders = new Map(orderRows.map((row) => [row.id, row]));
  const customers = new Map(customerRows.map((row) => [row.id, row]));

  return paymentRows.flatMap((row) => {
    const order = orders.get(row.order_id);
    if (!order) return [];
    const customer = customers.get(order.customer_id);
    return [{
      id: row.id,
      orderId: row.order_id,
      publicOrderId: order.public_order_id,
      customerName: customer?.display_name?.trim() || customer?.phone || customer?.wa_id || 'Customer',
      customerPhone: customer?.phone || customer?.wa_id || null,
      methodType: row.method_type,
      provider: row.provider,
      status: row.status,
      exceptionState: row.exception_state,
      exceptionReason: row.exception_reason,
      exceptionUpdatedAt: row.exception_updated_at,
      amount: toNumber(row.amount),
      currency: row.currency,
      providerReference: row.provider_reference,
      providerTransactionId: row.provider_transaction_id,
      checkoutUrl: row.checkout_url,
      customerClaimedAt: row.customer_claimed_at,
      confirmedAt: row.confirmed_at,
      confirmationSource: row.confirmation_source,
      failureReason: row.failure_reason,
      createdAt: row.created_at,
    } satisfies PaymentReconciliationItem];
  });
}

export async function confirmReconciliationPayment(
  tenantId: string,
  paymentId: string,
): Promise<void> {
  await confirmOfflinePayment(tenantId, paymentId, 'Confirmed from payment reconciliation');
}

export async function verifyReconciliationGateway(
  tenantId: string,
  paymentId: string,
): Promise<void> {
  await verifyGatewayPayment(tenantId, paymentId);
}

function toNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
