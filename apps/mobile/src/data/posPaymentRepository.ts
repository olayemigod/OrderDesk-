import { supabase } from '../lib/supabase';
import { createPosClientReference, type PosPaymentMethodType } from './commerceRepository';

export type PosPaymentPolicy = {
  allowPriceOverride: boolean;
  canOverridePrice: boolean;
  allowSplitPayments: boolean;
  allowPartialPayments: boolean;
  allowPayLater: boolean;
  manualConfirmationMode: 'branch_operator' | 'payment_manager';
};

export type PosPaymentAllocationInput = {
  paymentMethodId: string | null;
  amount: number;
  confirmNow: boolean;
};

export type PosPaymentAllocationResult = {
  paymentId: string;
  paymentMethodId: string | null;
  methodType: PosPaymentMethodType;
  status: 'initiated' | 'pending_verification' | 'confirmed' | 'failed' | 'cancelled' | 'expired';
  amount: number;
};

export type PosAllocationCheckoutResult = {
  orderId: string;
  status: 'completed' | 'awaiting_payment_confirmation';
  paymentStatus: 'unpaid' | 'pending' | 'verification_required' | 'paid' | 'payment_issue';
  fulfillmentStatus: string;
  amountPaid: number;
  outstandingAmount: number;
  paymentTerms: 'immediate' | 'partial' | 'pay_later';
  payments: PosPaymentAllocationResult[];
  inventoryMovementCount: number;
  idempotentReplay: boolean;
};

export async function loadPosPaymentPolicy(tenantId: string): Promise<PosPaymentPolicy> {
  if (!tenantId) throw new Error('Business is required.');
  const { data, error } = await supabase.rpc('sellertray_get_pos_policy', { p_tenant_id: tenantId });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SellerTray returned an invalid POS policy.');
  }
  const row = data as Record<string, unknown>;
  const mode = row.manualConfirmationMode;
  if (mode !== 'branch_operator' && mode !== 'payment_manager') {
    throw new Error('SellerTray returned an invalid payment confirmation policy.');
  }
  return {
    allowPriceOverride: row.allowPriceOverride === true,
    canOverridePrice: row.canOverridePrice === true,
    allowSplitPayments: row.allowSplitPayments !== false,
    allowPartialPayments: row.allowPartialPayments === true,
    allowPayLater: row.allowPayLater === true,
    manualConfirmationMode: mode,
  };
}

export async function checkoutPosPaymentAllocations(input: {
  tenantId: string;
  orderId: string;
  allocations: PosPaymentAllocationInput[];
  payLater: boolean;
  commandId: string;
}): Promise<PosAllocationCheckoutResult> {
  if (!input.tenantId || !input.orderId) throw new Error('Business and sale are required.');
  if (!input.commandId) throw new Error('Payment command is required.');
  if (input.allocations.some((allocation) => !Number.isFinite(allocation.amount) || allocation.amount <= 0)) {
    throw new Error('Every payment allocation needs a valid amount.');
  }

  const { data, error } = await supabase.functions.invoke('pos-checkout', {
    body: {
      tenantId: input.tenantId,
      orderId: input.orderId,
      commandId: input.commandId,
      payLater: input.payLater,
      allocations: input.allocations,
    },
  });
  if (error) throw new Error(await functionErrorMessage(error, 'Unable to process this payment.'));
  if (!isAllocationCheckoutResult(data)) {
    throw new Error('SellerTray returned an invalid payment allocation result.');
  }
  return data;
}

export function createPosPaymentCommandId(): string {
  return createPosClientReference();
}

function isAllocationCheckoutResult(value: unknown): value is PosAllocationCheckoutResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.orderId !== 'string') return false;
  if (row.status !== 'completed' && row.status !== 'awaiting_payment_confirmation') return false;
  if (!['unpaid', 'pending', 'verification_required', 'paid', 'payment_issue'].includes(String(row.paymentStatus))) return false;
  if (row.paymentTerms !== 'immediate' && row.paymentTerms !== 'partial' && row.paymentTerms !== 'pay_later') return false;
  if (typeof row.fulfillmentStatus !== 'string') return false;
  if (numberOrNull(row.amountPaid) === null || numberOrNull(row.outstandingAmount) === null) return false;
  if (!Array.isArray(row.payments)) return false;
  if (typeof row.inventoryMovementCount !== 'number' || typeof row.idempotentReplay !== 'boolean') return false;
  return row.payments.every((payment) => isAllocationPayment(payment));
}

function isAllocationPayment(value: unknown): value is PosPaymentAllocationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.paymentId === 'string'
    && (row.paymentMethodId === null || row.paymentMethodId === undefined || typeof row.paymentMethodId === 'string')
    && (row.methodType === 'cash' || row.methodType === 'bank_transfer' || row.methodType === 'card_terminal')
    && ['initiated', 'pending_verification', 'confirmed', 'failed', 'cancelled', 'expired'].includes(String(row.status))
    && numberOrNull(row.amount) !== null;
}

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  let message = error instanceof Error && error.message ? error.message : fallback;
  if (!error || typeof error !== 'object' || !('context' in error)) return message;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('clone' in context)) return message;
  try {
    const payload = await (context as Response).clone().json() as { error?: string };
    if (payload?.error) message = payload.error;
  } catch {}
  return message;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
