import { supabase } from '../lib/supabase';
import { createPosClientReference } from './commerceRepository';

export type CustomerBalanceCollectionResult = {
  orderId: string;
  amount: number;
  methodType: 'cash' | 'bank_transfer' | 'card_terminal';
  status: 'initiated' | 'pending_verification' | 'confirmed' | 'failed' | 'cancelled' | 'expired';
};

export async function collectCustomerBalance(input: {
  tenantId: string;
  orderId: string;
  paymentMethodId: string | null;
  amount: number;
  commandId?: string;
}): Promise<CustomerBalanceCollectionResult> {
  if (!input.tenantId || !input.orderId) throw new Error('Business and sale are required.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Enter a valid payment amount.');

  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.rpc('collect_sellertray_customer_receivable', {
      p_tenant_id: input.tenantId,
      p_order_id: input.orderId,
      p_payment_method_id: input.paymentMethodId,
      p_amount: Number(input.amount.toFixed(2)),
      p_command_id: input.commandId ?? createPosClientReference(),
    });
  } catch (cause) {
    throw new Error(customerCollectionErrorMessage(cause));
  }
  const { data, error } = response;
  if (error) throw new Error(customerCollectionErrorMessage(error));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SellerTray returned an invalid customer payment result.');
  }

  const row = data as Record<string, unknown>;
  const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount);
  const methodType = String(row.methodType ?? '');
  const status = String(row.status ?? '');
  if (typeof row.orderId !== 'string'
      || !Number.isFinite(amount)
      || !['cash', 'bank_transfer', 'card_terminal'].includes(methodType)
      || !['initiated', 'pending_verification', 'confirmed', 'failed', 'cancelled', 'expired'].includes(status)) {
    throw new Error('SellerTray returned an invalid customer payment result.');
  }

  return {
    orderId: row.orderId,
    amount,
    methodType: methodType as CustomerBalanceCollectionResult['methodType'],
    status: status as CustomerBalanceCollectionResult['status'],
  };
}

/** Map structured PostgREST failures to bounded copy; never render SQL details. */
export function customerCollectionErrorMessage(cause: unknown): string {
  const error = cause && typeof cause === 'object' ? cause as Record<string, unknown> : {};
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';
  if (code === '42501') {
    return message === 'SellerTray subscription is read-only'
      ? 'This Business is read-only. Ask the Owner to review SellerTray access.'
      : 'You do not have permission to collect or confirm this Branch payment. Ask an authorised manager.';
  }
  if (code === '23505') return 'This payment request already exists with different details. Refresh the sale before collecting again.';
  if (code === 'P0002') return 'This sale is unavailable. Refresh the sale before collecting again.';
  if (code === '23514') {
    if (message === 'Payment exceeds the outstanding customer balance') return 'The outstanding balance has changed. Refresh the sale and check the amount.';
    if (message === 'Payment exceeds the unreserved customer balance') return 'A payment is already awaiting verification against this balance. Review it before collecting again.';
    if (message === 'Open a cashier shift in this Branch before taking counter cash payments') return 'Open a cashier shift in this Branch before collecting Cash.';
    if (message === 'Payment method is not enabled for this Branch') return 'This payment method is no longer available for this Branch. Refresh payment methods.';
    if (message === 'Only a completed named-customer sale can receive a balance payment') return 'Complete the named-customer sale before collecting its balance.';
  }
  return 'Unable to collect this customer payment. Check your connection and retry the same payment before starting another.';
}
