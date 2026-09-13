import { supabase } from '../lib/supabase';

export type ReportSummary = {
  days: number;
  orders: {
    total: number;
    completed: number;
    unsuccessful: number;
    whatsapp: number;
    manual: number;
    orderValue: number;
    averageOrderValue: number;
  };
  payments: {
    paidOrders: number;
    awaitingPayment: number;
    paidValue: number;
    verificationRequired: number;
    failed: number;
    exceptions: number;
    methods: Record<string, number>;
  };
  fulfillment: {
    outForDelivery: number;
    delivered: number;
    collected: number;
    awaitingFulfillment: number;
  };
  topItems: Array<{ name: string; quantity: number; value: number }>;
};

export async function loadReportSummary(tenantId: string, days: number): Promise<ReportSummary> {
  const { data, error } = await supabase.rpc('sellertray_report_summary', {
    p_tenant_id: tenantId,
    p_days: days,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SellerTray returned an invalid report summary.');
  }
  const row = data as Record<string, unknown>;
  return {
    days: numberValue(row.days),
    orders: parseOrders(row.orders),
    payments: parsePayments(row.payments),
    fulfillment: parseFulfillment(row.fulfillment),
    topItems: parseTopItems(row.topItems),
  };
}

function parseOrders(value: unknown): ReportSummary['orders'] {
  const row = record(value);
  return {
    total: numberValue(row.total),
    completed: numberValue(row.completed),
    unsuccessful: numberValue(row.unsuccessful),
    whatsapp: numberValue(row.whatsapp),
    manual: numberValue(row.manual),
    orderValue: numberValue(row.orderValue),
    averageOrderValue: numberValue(row.averageOrderValue),
  };
}

function parsePayments(value: unknown): ReportSummary['payments'] {
  const row = record(value);
  const methodsRow = record(row.methods);
  return {
    paidOrders: numberValue(row.paidOrders),
    awaitingPayment: numberValue(row.awaitingPayment),
    paidValue: numberValue(row.paidValue),
    verificationRequired: numberValue(row.verificationRequired),
    failed: numberValue(row.failed),
    exceptions: numberValue(row.exceptions),
    methods: Object.fromEntries(Object.entries(methodsRow).map(([key, value]) => [key, numberValue(value)])),
  };
}

function parseFulfillment(value: unknown): ReportSummary['fulfillment'] {
  const row = record(value);
  return {
    outForDelivery: numberValue(row.outForDelivery),
    delivered: numberValue(row.delivered),
    collected: numberValue(row.collected),
    awaitingFulfillment: numberValue(row.awaitingFulfillment),
  };
}

function parseTopItems(value: unknown): ReportSummary['topItems'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    return typeof row.name === 'string' && row.name.trim()
      ? [{ name: row.name, quantity: numberValue(row.quantity), value: numberValue(row.value) }]
      : [];
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
