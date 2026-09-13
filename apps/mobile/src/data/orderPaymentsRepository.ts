import { supabase } from '../lib/supabase';

export type OrderFinancialDocument = {
  id: string;
  documentType: 'invoice' | 'receipt';
  documentReference: string;
  currency: string;
  amount: number;
  status: 'issued' | 'void';
  paymentId: string | null;
  issuedAt: string;
};

export type OrderPaymentAttempt = {
  id: string;
  methodType: 'bank_transfer' | 'paystack' | 'flutterwave' | 'cash_on_delivery' | 'pay_on_pickup';
  provider: string;
  status: 'initiated' | 'pending_verification' | 'confirmed' | 'failed' | 'cancelled' | 'expired';
  exceptionState: 'none' | 'refund_pending' | 'refunded' | 'disputed' | 'chargeback' | 'reversed' | 'duplicate_payment';
  exceptionReason: string | null;
  exceptionUpdatedAt: string | null;
  amount: number;
  currency: string;
  providerReference: string | null;
  providerTransactionId: string | null;
  checkoutUrl: string | null;
  customerClaimedAt: string | null;
  confirmedAt: string | null;
  confirmationSource: string | null;
  failureReason: string | null;
  createdAt: string;
};

type FinancialRow = {
  id: string;
  document_type: OrderFinancialDocument['documentType'];
  document_reference: string;
  currency: string;
  amount: number | string;
  status: OrderFinancialDocument['status'];
  payment_id: string | null;
  issued_at: string;
};

type PaymentRow = {
  id: string;
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

export async function loadOrderFinancials(
  tenantId: string,
  orderId: string,
): Promise<{ documents: OrderFinancialDocument[]; payments: OrderPaymentAttempt[] }> {
  const [documentsResult, paymentsResult] = await Promise.all([
    supabase
      .from('order_financial_documents')
      .select('id,document_type,document_reference,currency,amount,status,payment_id,issued_at')
      .eq('tenant_id', tenantId)
      .eq('order_id', orderId)
      .order('issued_at', { ascending: true }),
    supabase
      .from('order_payments')
      .select('id,method_type,provider,status,exception_state,exception_reason,exception_updated_at,amount,currency,provider_reference,provider_transaction_id,checkout_url,customer_claimed_at,confirmed_at,confirmation_source,failure_reason,created_at')
      .eq('tenant_id', tenantId)
      .eq('order_id', orderId)
      .order('created_at', { ascending: false }),
  ]);

  if (documentsResult.error) throw documentsResult.error;
  if (paymentsResult.error) throw paymentsResult.error;

  return {
    documents: ((documentsResult.data ?? []) as FinancialRow[]).map((row) => ({
      id: row.id,
      documentType: row.document_type,
      documentReference: row.document_reference,
      currency: row.currency,
      amount: toNumber(row.amount),
      status: row.status,
      paymentId: row.payment_id,
      issuedAt: row.issued_at,
    })),
    payments: ((paymentsResult.data ?? []) as PaymentRow[]).map((row) => ({
      id: row.id,
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
    })),
  };
}

export async function confirmOfflinePayment(
  tenantId: string,
  paymentId: string,
  note?: string | null,
): Promise<void> {
  await invokeOperation({
    action: 'confirm_offline',
    tenantId,
    paymentId,
    note: note?.trim() || null,
  });
}

export async function verifyGatewayPayment(
  tenantId: string,
  paymentId: string,
): Promise<void> {
  await invokeOperation({
    action: 'verify_gateway',
    tenantId,
    paymentId,
  });
}

async function invokeOperation(body: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.functions.invoke('merchant-payment-operations', { body });
  if (!error) return;

  let message = error.message || 'SellerTray payment operation failed.';
  if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
    try {
      const payload = await (error.context as Response).clone().json() as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // Keep SDK message.
    }
  }
  throw new Error(message);
}

function toNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}


export async function recordOfflineOrderPayment(
  tenantId: string,
  orderId: string,
  paymentMethodId: string,
  note?: string | null,
): Promise<void> {
  await invokeMerchantPaymentOperation({
    action: 'record_offline',
    tenantId,
    orderId,
    paymentMethodId,
    note: note?.trim() || null,
  });
}

export async function sendMerchantPaymentOptions(
  tenantId: string,
  orderId: string,
): Promise<{ deliveryStatus: string; message: string }> {
  const data = await invokeMerchantPaymentOperation({
    action: 'send_options',
    tenantId,
    orderId,
  });
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return {
    deliveryStatus: typeof row.deliveryStatus === 'string' ? row.deliveryStatus : 'unknown',
    message: typeof row.message === 'string' ? row.message : 'Payment options queued.',
  };
}

async function invokeMerchantPaymentOperation(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('merchant-payment-operations', { body });
  if (error) {
    let message = error.message || 'SellerTray payment operation failed.';
    if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
      try {
        const payload = await (error.context as Response).clone().json() as { error?: string };
        if (payload?.error) message = payload.error;
      } catch {
        // Keep the SDK error.
      }
    }
    throw new Error(message);
  }
  return data;
}
