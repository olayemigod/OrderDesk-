import { supabase } from '../lib/supabase';

export type WhatsAppBranchRoute = {
  branchId: string;
  connectionStatus: 'pending' | 'connected' | 'error' | 'disconnected' | 'not_connected';
};

type WhatsAppBranchRouteRow = {
  branch_id: string;
  connection_status: WhatsAppBranchRoute['connectionStatus'];
};

export async function loadWhatsAppBranchRoute(tenantId: string): Promise<WhatsAppBranchRoute | null> {
  if (!tenantId) return null;
  const { data, error } = await supabase
    .from('tenant_whatsapp_connections')
    .select('branch_id,connection_status')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  const row = data as WhatsAppBranchRouteRow | null;
  if (!row?.branch_id) return null;
  return {
    branchId: row.branch_id,
    connectionStatus: row.connection_status,
  };
}

export async function setWhatsAppBranchRoute(
  tenantId: string,
  branchId: string,
): Promise<WhatsAppBranchRoute> {
  if (!tenantId || !branchId) throw new Error('Business and Branch are required.');
  const { data, error } = await supabase.rpc('set_sellertray_whatsapp_branch', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });
  if (error) throw error;
  const row = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const routedBranchId = typeof row.branchId === 'string' ? row.branchId : branchId;
  const rawStatus = typeof row.connectionStatus === 'string' ? row.connectionStatus : 'connected';
  return {
    branchId: routedBranchId,
    connectionStatus: normalizeStatus(rawStatus),
  };
}

function normalizeStatus(value: string): WhatsAppBranchRoute['connectionStatus'] {
  return value === 'pending' || value === 'connected' || value === 'error' || value === 'disconnected' || value === 'not_connected'
    ? value
    : 'error';
}
