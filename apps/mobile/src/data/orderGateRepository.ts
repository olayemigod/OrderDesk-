import { supabase } from '../lib/supabase';

export type GateDecision = {
  allowed: boolean;
  reason: string | null;
  paymentMethod: string | null;
};

export type OrderGateStatus = {
  orderId: string;
  paymentStatus: string;
  processing: GateDecision;
  ready: GateDecision;
  dispatch: GateDecision;
  complete: GateDecision;
};

export async function loadOrderGateStatus(orderId: string): Promise<OrderGateStatus> {
  const { data, error } = await supabase.rpc('sellertray_order_gate_status', {
    p_order_id: orderId,
  });

  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SellerTray returned an invalid order gate status.');
  }

  const row = data as Record<string, unknown>;
  return {
    orderId: typeof row.orderId === 'string' ? row.orderId : orderId,
    paymentStatus: typeof row.paymentStatus === 'string' ? row.paymentStatus : 'unpaid',
    processing: parseDecision(row.processing),
    ready: parseDecision(row.ready),
    dispatch: parseDecision(row.dispatch),
    complete: parseDecision(row.complete),
  };
}

function parseDecision(value: unknown): GateDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { allowed: false, reason: 'SellerTray could not verify this operational gate.', paymentMethod: null };
  }
  const row = value as Record<string, unknown>;
  return {
    allowed: row.allowed === true,
    reason: typeof row.reason === 'string' && row.reason.trim() ? row.reason : null,
    paymentMethod: typeof row.paymentMethod === 'string' && row.paymentMethod.trim() ? row.paymentMethod : null,
  };
}
