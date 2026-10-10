import { supabase } from '../lib/supabase';

export type AiBriefSourceKey =
  | 'summary'
  | 'branchPerformance'
  | 'salesTrend'
  | 'channels'
  | 'paymentMethods'
  | 'topCustomers';

export type AiBriefItem = {
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
  sourceKeys: AiBriefSourceKey[];
};

export type AiBriefResult = {
  requestId: string;
  mode: 'ai' | 'deterministic';
  periodDays: 7 | 30 | 90;
  generatedAt: string;
  brief: {
    headline: string;
    summary: string;
    attention: AiBriefItem[];
    opportunities: AiBriefItem[];
    answer: string;
  };
  sources: Array<{ key: AiBriefSourceKey; label: string }>;
  budget: {
    dailyLimit: number;
    providerCallsToday: number;
    remainingProviderCalls: number;
  };
  provider: { name: string; model: string | null } | null;
  fallbackReason: string | null;
};

export async function generateAiBrief(input: {
  tenantId: string;
  days: 7 | 30 | 90;
  question?: string | null;
}): Promise<AiBriefResult> {
  if (!input.tenantId) throw new Error('Business is required.');
  const question = input.question?.trim() || null;
  if (question && question.length > 500) throw new Error('Keep the AI question within 500 characters.');

  const { data, error } = await supabase.functions.invoke('ai-brief', {
    body: {
      tenantId: input.tenantId,
      days: input.days,
      question,
    },
  });
  if (error) throw await normalizeFunctionError(error, 'Unable to generate the AI Brief.');
  return parseResult(data);
}

function parseResult(value: unknown): AiBriefResult {
  const row = object(value);
  const briefRow = object(row.brief);
  const mode = row.mode === 'ai' ? 'ai' : row.mode === 'deterministic' ? 'deterministic' : null;
  const periodDays = row.periodDays === 7 || row.periodDays === 90 ? row.periodDays : 30;
  if (!mode || typeof row.requestId !== 'string' || typeof row.generatedAt !== 'string') {
    throw new Error('SellerTray returned an invalid AI Brief.');
  }

  return {
    requestId: row.requestId,
    mode,
    periodDays,
    generatedAt: row.generatedAt,
    brief: {
      headline: stringValue(briefRow.headline),
      summary: stringValue(briefRow.summary),
      attention: parseItems(briefRow.attention),
      opportunities: parseItems(briefRow.opportunities),
      answer: typeof briefRow.answer === 'string' ? briefRow.answer : '',
    },
    sources: Array.isArray(row.sources)
      ? row.sources.flatMap((candidate) => {
          const source = object(candidate);
          const key = sourceKey(source.key);
          return key && typeof source.label === 'string' ? [{ key, label: source.label }] : [];
        })
      : [],
    budget: {
      dailyLimit: numberValue(object(row.budget).dailyLimit),
      providerCallsToday: numberValue(object(row.budget).providerCallsToday),
      remainingProviderCalls: numberValue(object(row.budget).remainingProviderCalls),
    },
    provider: row.provider && typeof row.provider === 'object' && !Array.isArray(row.provider)
      ? {
          name: stringValue(object(row.provider).name),
          model: typeof object(row.provider).model === 'string' ? String(object(row.provider).model) : null,
        }
      : null,
    fallbackReason: typeof row.fallbackReason === 'string' ? row.fallbackReason : null,
  };
}

function parseItems(value: unknown): AiBriefItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const row = object(candidate);
    const priority = row.priority === 'high' || row.priority === 'medium' || row.priority === 'low'
      ? row.priority
      : null;
    const sourceKeys = Array.isArray(row.sourceKeys)
      ? row.sourceKeys.map(sourceKey).filter((key): key is AiBriefSourceKey => Boolean(key))
      : [];
    if (!priority || typeof row.title !== 'string' || typeof row.detail !== 'string' || !sourceKeys.length) return [];
    return [{ title: row.title, detail: row.detail, priority, sourceKeys }];
  });
}

function sourceKey(value: unknown): AiBriefSourceKey | null {
  return value === 'summary'
    || value === 'branchPerformance'
    || value === 'salesTrend'
    || value === 'channels'
    || value === 'paymentMethods'
    || value === 'topCustomers'
    ? value
    : null;
}

async function normalizeFunctionError(error: unknown, fallback: string): Promise<Error> {
  const candidate = error as { message?: unknown; context?: unknown } | null;
  let message = typeof candidate?.message === 'string' && candidate.message ? candidate.message : fallback;
  const context = candidate?.context;
  if (context && typeof context === 'object' && 'clone' in context) {
    try {
      const response = (context as Response).clone();
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === 'string' && payload.error) message = payload.error;
    } catch {
      // Keep the SDK error message.
    }
  }
  return new Error(message);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
