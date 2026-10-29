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

  const { data, error } = await supabase.rpc('collect_sellertray_customer_receivable', {
    p_tenant_id: input.tenantId,
    p_order_id: input.orderId,
    p_payment_method_id: input.paymentMethodId,
    p_amount: Number(input.amount.toFixed(2)),
    p_command_id: input.commandId ?? createPosClientReference(),
  });
  if (error) throw error;
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
