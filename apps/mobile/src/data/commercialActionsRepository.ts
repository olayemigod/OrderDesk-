import { supabase } from '../lib/supabase';

export type CommercialAction = {
  id: string;
  createdAt: string;
  actionType: string;
  riskClass: 'low' | 'medium' | 'high';
  requestedBy: string;
  interpretationSource: string | null;
  interpretationConfidence: number | null;
  policyResult: string;
  actionStatus: string;
  customerName: string;
  orderRef: string | null;
  channel: string;
  metadata: Record<string, unknown>;
};

export async function loadCommercialActions(
  tenantId: string,
  limit = 100,
): Promise<CommercialAction[]> {
  const { data, error } = await supabase.rpc('sellertray_list_commercial_actions', {
    p_tenant_id: tenantId,
    p_limit: limit,
  });
  if (error) throw error;
  if (!Array.isArray(data)) return [];

  return data.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (
      typeof row.id !== 'string' ||
      typeof row.created_at !== 'string' ||
      typeof row.action_type !== 'string' ||
      typeof row.risk_class !== 'string' ||
      typeof row.action_status !== 'string'
    ) return [];

    return [{
      id: row.id,
      createdAt: row.created_at,
      actionType: row.action_type,
      riskClass: (['low','medium','high'].includes(row.risk_class) ? row.risk_class : 'low') as CommercialAction['riskClass'],
      requestedBy: typeof row.requested_by === 'string' ? row.requested_by : 'system',
      interpretationSource: typeof row.interpretation_source === 'string' ? row.interpretation_source : null,
      interpretationConfidence: numberOrNull(row.interpretation_confidence),
      policyResult: typeof row.policy_result === 'string' ? row.policy_result : 'pending',
      actionStatus: row.action_status,
      customerName: typeof row.customer_name === 'string' ? row.customer_name : 'Customer',
      orderRef: typeof row.order_ref === 'string' && row.order_ref ? row.order_ref : null,
      channel: typeof row.channel === 'string' ? row.channel : 'whatsapp',
      metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {},
    }];
  });
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
