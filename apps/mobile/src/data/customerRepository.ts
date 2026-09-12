import { supabase } from '../lib/supabase';

export type CustomerOrderSummary = {
  id: string;
  publicOrderId: string;
  status: string;
  totalAmount: number | null;
  createdAt: string;
};

export type MerchantCustomer = {
  id: string;
  tenantId: string;
  whatsappId: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
  orders: CustomerOrderSummary[];
  orderCount: number;
  completedOrderCount: number;
  lifetimeValue: number;
  lastOrderAt: string | null;
};

type CustomerRow = {
  id: string;
  tenant_id: string;
  wa_id: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  orders: Array<{
    id: string;
    public_order_id: string;
    status: string;
    total_amount: number | string | null;
    created_at: string;
  }> | null;
};

export async function loadCustomers(tenantId: string): Promise<MerchantCustomer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select(`
      id,
      tenant_id,
      wa_id,
      display_name,
      phone,
      email,
      created_at,
      orders(id,public_order_id,status,total_amount,created_at)
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;

  return ((data ?? []) as unknown as CustomerRow[]).map((row) => {
    const orders = (row.orders ?? [])
      .map((order) => ({
        id: order.id,
        publicOrderId: order.public_order_id,
        status: order.status,
        totalAmount: numberValue(order.total_amount),
        createdAt: order.created_at,
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    const completed = orders.filter((order) => order.status === 'completed');

    return {
      id: row.id,
      tenantId: row.tenant_id,
      whatsappId: row.wa_id,
      displayName: row.display_name,
      phone: row.phone,
      email: row.email,
      createdAt: row.created_at,
      orders,
      orderCount: orders.length,
      completedOrderCount: completed.length,
      lifetimeValue: completed.reduce((sum, order) => sum + (order.totalAmount ?? 0), 0),
      lastOrderAt: orders[0]?.createdAt ?? null,
    };
  });
}

export async function updateCustomerProfile(
  tenantId: string,
  customerId: string,
  input: { displayName: string | null; email: string | null },
): Promise<void> {
  const displayName = cleanOptional(input.displayName);
  const email = cleanOptional(input.email)?.toLowerCase() ?? null;

  const { error } = await supabase.rpc('update_sellertray_customer_profile', {
    p_tenant_id: tenantId,
    p_customer_id: customerId,
    p_display_name: displayName,
    p_email: email,
  });

  if (error) throw error;
}

function cleanOptional(value: string | null): string | null {
  const clean = value?.trim() ?? '';
  return clean || null;
}

function numberValue(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
