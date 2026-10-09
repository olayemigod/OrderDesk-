import { supabase } from '../lib/supabase';

export type PosSaleAction = 'void' | 'return';

export type PosSaleActionResult = {
  action: PosSaleAction;
  orderId: string;
  idempotentReplay: boolean;
  status?: 'cancelled';
  returnId?: string;
  refundId?: string;
  returnStatus?: 'returned';
  refundedAmount?: number;
  currency?: string;
};

export async function applyPosSaleAction(input: {
  tenantId: string;
  orderId: string;
  action: PosSaleAction;
  reason: string;
}): Promise<PosSaleActionResult> {
  const reason = input.reason.trim();
  if (!reason) throw new Error('Enter a reason before continuing.');

  const { data, error } = await supabase.functions.invoke('pos-return', {
    body: {
      tenantId: input.tenantId,
      orderId: input.orderId,
      action: input.action,
      reason,
    },
  });

  if (error) {
    let message = error.message || `Unable to ${input.action} this sale.`;
    if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
      try {
        const payload = await (error.context as Response).clone().json() as { error?: string };
        if (payload?.error) message = payload.error;
      } catch {
        // Keep the SDK message.
      }
    }
    throw new Error(message);
  }

  if (!data || typeof data !== 'object' || data.ok !== true || data.action !== input.action) {
    throw new Error('SellerTray returned an invalid sale action result.');
  }

  const row = data as Record<string, unknown>;
  if (typeof row.orderId !== 'string' || typeof row.idempotentReplay !== 'boolean') {
    throw new Error('SellerTray returned an invalid sale action result.');
  }

  if (input.action === 'void' && row.status !== 'cancelled') {
    throw new Error('SellerTray did not confirm the sale was voided.');
  }
  if (
    input.action === 'return'
    && (row.returnStatus !== 'returned' || typeof row.returnId !== 'string' || typeof row.refundId !== 'string')
  ) {
    throw new Error('SellerTray did not confirm the sale return.');
  }

  return {
    action: input.action,
    orderId: row.orderId,
    idempotentReplay: row.idempotentReplay,
    status: row.status === 'cancelled' ? 'cancelled' : undefined,
    returnId: typeof row.returnId === 'string' ? row.returnId : undefined,
    refundId: typeof row.refundId === 'string' ? row.refundId : undefined,
    returnStatus: row.returnStatus === 'returned' ? 'returned' : undefined,
    refundedAmount: numberOrUndefined(row.refundedAmount),
    currency: typeof row.currency === 'string' ? row.currency : undefined,
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}