import { supabase } from '../lib/supabase';

export type TodayInsight = {
  orders: number;
  needsReview: number;
  inProgress: number;
  completed: number;
  knownValue: number;
};

export type PeriodInsight = {
  orders: number;
  completed: number;
  closedUnsuccessful: number;
  knownValue: number;
  completionRate: number;
};

export type SevenDayInsight = PeriodInsight & {
  previousOrders: number;
  previousKnownValue: number;
};

export type TopItemInsight = {
  name: string;
  quantity: number;
  value: number;
};

export type BusinessInsights = {
  today: TodayInsight;
  sevenDays: SevenDayInsight;
  thirtyDays: PeriodInsight;
  topItems: TopItemInsight[];
};

export async function loadBusinessInsights(tenantId: string): Promise<BusinessInsights> {
  const { data, error } = await supabase.rpc('get_orderdesk_business_insights', {
    p_tenant_id: tenantId,
  });

  if (error) throw error;
  if (!isRecord(data)) throw new Error('SellerTray returned invalid business insights.');

  return {
    today: parseToday(data.today),
    sevenDays: parseSevenDays(data.sevenDays),
    thirtyDays: parsePeriod(data.thirtyDays),
    topItems: parseTopItems(data.topItems),
  };
}

function parseToday(value: unknown): TodayInsight {
  const row = asRecord(value);
  return {
    orders: numberValue(row.orders),
    needsReview: numberValue(row.needsReview),
    inProgress: numberValue(row.inProgress),
    completed: numberValue(row.completed),
    knownValue: numberValue(row.knownValue),
  };
}

function parseSevenDays(value: unknown): SevenDayInsight {
  const row = asRecord(value);
  return {
    ...parsePeriod(row),
    previousOrders: numberValue(row.previousOrders),
    previousKnownValue: numberValue(row.previousKnownValue),
  };
}

function parsePeriod(value: unknown): PeriodInsight {
  const row = asRecord(value);
  return {
    orders: numberValue(row.orders),
    completed: numberValue(row.completed),
    closedUnsuccessful: numberValue(row.closedUnsuccessful),
    knownValue: numberValue(row.knownValue),
    completionRate: numberValue(row.completionRate),
  };
}

function parseTopItems(value: unknown): TopItemInsight[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.name !== 'string' || !candidate.name.trim()) return [];
    return [{
      name: candidate.name,
      quantity: numberValue(candidate.quantity),
      value: numberValue(candidate.value),
    } satisfies TopItemInsight];
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
