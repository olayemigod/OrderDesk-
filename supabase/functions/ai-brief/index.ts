type J = Record<string, unknown>;

type SourceKey =
  | 'summary'
  | 'branchPerformance'
  | 'salesTrend'
  | 'channels'
  | 'paymentMethods'
  | 'topCustomers';

type BriefItem = {
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
  sourceKeys: SourceKey[];
};

type Brief = {
  headline: string;
  summary: string;
  attention: BriefItem[];
  opportunities: BriefItem[];
  answer: string;
};

type ProviderUsage = {
  model: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

type AttemptOutcome =
  | 'success'
  | 'provider_error'
  | 'invalid_output'
  | 'network_error'
  | 'not_configured'
  | 'daily_budget_fallback';

class ProviderError extends Error {
  constructor(
    message: string,
    readonly outcome: Exclude<AttemptOutcome, 'success' | 'not_configured' | 'daily_budget_fallback'>,
    readonly httpStatus: number | null,
    readonly usage: ProviderUsage | null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_KEY;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const AI_MODEL = Deno.env.get('OPENAI_AI_BRIEF_MODEL')?.trim() || 'gpt-5.6-luna';
const DAILY_LIMIT = boundedInteger(Deno.env.get('SELLERTRAY_AI_BRIEF_DAILY_LIMIT'), 1, 100) ?? 30;
const MAX_BODY_BYTES = 32_768;
const MAX_QUESTION = 500;
const MAX_CONTEXT_BYTES = 24_000;
const SOURCE_KEYS: SourceKey[] = ['summary', 'branchPerformance', 'salesTrend', 'channels', 'paymentMethods', 'topCustomers'];

const sourceLabels: Record<SourceKey, string> = {
  summary: 'Business summary',
  branchPerformance: 'Branch performance',
  salesTrend: 'Sales trend',
  channels: 'Sales channels',
  paymentMethods: 'Payment methods',
  topCustomers: 'Top-customer metrics',
};

const outputSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string', minLength: 1, maxLength: 140 },
    summary: { type: 'string', minLength: 1, maxLength: 900 },
    attention: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          detail: { type: 'string', minLength: 1, maxLength: 500 },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          sourceKeys: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: 'string', enum: SOURCE_KEYS },
          },
        },
        required: ['title', 'detail', 'priority', 'sourceKeys'],
        additionalProperties: false,
      },
    },
    opportunities: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          detail: { type: 'string', minLength: 1, maxLength: 500 },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          sourceKeys: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: 'string', enum: SOURCE_KEYS },
          },
        },
        required: ['title', 'detail', 'priority', 'sourceKeys'],
        additionalProperties: false,
      },
    },
    answer: { type: 'string', maxLength: 800 },
  },
  required: ['headline', 'summary', 'attention', 'opportunities', 'answer'],
  additionalProperties: false,
} as const;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return reply({ error: 'Server configuration error' }, 500);

  const authorization = request.headers.get('authorization') ?? '';
  const userId = await verifiedUser(authorization);
  if (!userId) return reply({ error: 'Authentication required' }, 401);

  const raw = await limitedBody(request, MAX_BODY_BYTES);
  if (raw === null) return reply({ error: 'Payload too large' }, 413);

  let body: J;
  try { body = JSON.parse(raw) as J; }
  catch { return reply({ error: 'Invalid JSON' }, 400); }

  const tenantId = uuid(body.tenantId);
  const days = briefDays(body.days);
  const question = optionalText(body.question, MAX_QUESTION);
  const requestId = uuid(body.requestId) ?? crypto.randomUUID();
  if (!tenantId) return reply({ error: 'tenantId is required' }, 400);
  if (body.question !== undefined && body.question !== null && typeof body.question === 'string' && body.question.trim().length > MAX_QUESTION) {
    return reply({ error: 'AI Brief question is too long' }, 413);
  }

  const role = await tenantRole(tenantId, userId);
  if (role !== 'owner' && role !== 'manager') {
    return reply({ error: 'Owner or Manager access is required for AI Brief' }, 403);
  }

  const canWrite = await serviceRpc<boolean>('orderdesk_subscription_can_write', { p_tenant_id: tenantId });
  if (canWrite !== true) {
    return reply({ error: 'SellerTray subscription must be active to generate a new AI Brief' }, 403);
  }

  let report: J;
  try {
    report = await userRpc<J>('sellertray_report_center', {
      p_tenant_id: tenantId,
      p_days: days,
    }, authorization);
  } catch (error) {
    console.error('AI Brief report context failed', error);
    return reply({ error: 'SellerTray could not prepare the business report context' }, 502);
  }

  const context = buildProviderContext(report, days);
  const contextText = JSON.stringify(context);
  const contextBytes = new TextEncoder().encode(contextText).byteLength;
  const fingerprint = await sha256(contextText);
  const providerCallsToday = await countProviderCallsToday(tenantId);
  const budget = {
    dailyLimit: DAILY_LIMIT,
    providerCallsToday,
    remainingProviderCalls: Math.max(0, DAILY_LIMIT - providerCallsToday),
  };

  if (!OPENAI_API_KEY) {
    const fallback = deterministicBrief(context, question);
    await recordAttempt({
      tenantId, userId, requestId, days, questionPresent: Boolean(question), outcome: 'not_configured',
      providerCalled: false, providerStatus: null, usage: null, contextBytes, fingerprint, durationMs: 0,
    });
    return reply(resultPayload(requestId, days, fallback, 'deterministic', budget, 'AI provider is not configured.'), 200);
  }

  if (providerCallsToday >= DAILY_LIMIT) {
    const fallback = deterministicBrief(context, question);
    await recordAttempt({
      tenantId, userId, requestId, days, questionPresent: Boolean(question), outcome: 'daily_budget_fallback',
      providerCalled: false, providerStatus: null, usage: null, contextBytes, fingerprint, durationMs: 0,
    });
    return reply(resultPayload(requestId, days, fallback, 'deterministic', budget, 'Daily AI generation budget reached. Verified metrics are shown instead.'), 200);
  }

  const started = Date.now();
  try {
    const generated = await generateBrief(contextText, question);
    const durationMs = Math.max(0, Date.now() - started);
    await recordAttempt({
      tenantId, userId, requestId, days, questionPresent: Boolean(question), outcome: 'success',
      providerCalled: true, providerStatus: 200, usage: generated.usage, contextBytes, fingerprint, durationMs,
    });
    return reply(resultPayload(
      requestId,
      days,
      generated.brief,
      'ai',
      { ...budget, providerCallsToday: providerCallsToday + 1, remainingProviderCalls: Math.max(0, DAILY_LIMIT - providerCallsToday - 1) },
      null,
      generated.usage.model,
    ), 200);
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - started);
    const providerError = error instanceof ProviderError ? error : null;
    const outcome: AttemptOutcome = providerError?.outcome ?? 'network_error';
    await recordAttempt({
      tenantId, userId, requestId, days, questionPresent: Boolean(question), outcome,
      providerCalled: true, providerStatus: providerError?.httpStatus ?? null,
      usage: providerError?.usage ?? null, contextBytes, fingerprint, durationMs,
    });
    console.error('AI Brief provider failed', error);
    const fallback = deterministicBrief(context, question);
    return reply(resultPayload(
      requestId,
      days,
      fallback,
      'deterministic',
      { ...budget, providerCallsToday: providerCallsToday + 1, remainingProviderCalls: Math.max(0, DAILY_LIMIT - providerCallsToday - 1) },
      'AI generation was unavailable. SellerTray returned a verified metrics fallback.',
    ), 200);
  }
});

async function generateBrief(contextText: string, question: string | null): Promise<{ brief: Brief; usage: ProviderUsage }> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      store: false,
      reasoning: { effort: 'none' },
      max_output_tokens: 1600,
      input: [
        {
          role: 'system',
          content:
            'You are SellerTray AI Brief, a read-only decision-support assistant for a merchant Owner or Manager. ' +
            'Use only the supplied SellerTray report JSON. Never invent orders, customers, prices, payments, stock, branches, forecasts or causes. ' +
            'Do not claim causation from correlation. Do not provide legal, tax or accounting conclusions. ' +
            'Every attention/opportunity item must cite one or more supplied source keys. ' +
            'Prioritize concrete operational attention: payment verification/failures, unusual cash variance, weak completion, channel concentration or meaningful branch differences when supported. ' +
            'Opportunities must be modest and directly supported by the report. If evidence is insufficient, say so. ' +
            'Top-customer data is anonymized by rank; never invent a customer identity. ' +
            'If a merchant question is provided, answer it only from the supplied metrics; otherwise leave answer as an empty string. Keep the brief concise.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            report: JSON.parse(contextText),
            merchant_question: question ?? '',
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'sellertray_ai_brief',
          strict: true,
          schema: outputSchema,
        },
      },
    }),
  });

  const raw = await response.text();
  let payload: unknown = null;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  const usage = extractProviderUsage(payload);

  if (!response.ok) {
    throw new ProviderError(`OpenAI Responses API ${response.status}`, 'provider_error', response.status, usage);
  }
  if (!payload) throw new ProviderError('Provider returned invalid JSON', 'invalid_output', response.status, null);

  const outputText = extractOutputText(payload);
  if (!outputText) throw new ProviderError('Provider returned no structured output', 'invalid_output', response.status, usage);

  let candidate: unknown;
  try { candidate = JSON.parse(outputText); }
  catch { throw new ProviderError('Provider structured output was invalid JSON', 'invalid_output', response.status, usage); }

  const brief = validateBrief(candidate);
  if (!brief) throw new ProviderError('Provider output failed SellerTray validation', 'invalid_output', response.status, usage);
  return { brief, usage: usage ?? emptyUsage() };
}

function buildProviderContext(report: J, days: number): J {
  const full = {
    periodDays: days,
    summary: record(report.summary),
    branchPerformance: arrayRecords(report.branchPerformance).slice(0, 20),
    salesTrend: arrayRecords(report.salesTrend).slice(-30),
    channels: arrayRecords(report.channels).slice(0, 10),
    paymentMethods: arrayRecords(report.paymentMethods).slice(0, 10),
    topCustomers: anonymizeCustomers(arrayRecords(report.topCustomers).slice(0, 10)),
  } satisfies J;
  if (new TextEncoder().encode(JSON.stringify(full)).byteLength <= MAX_CONTEXT_BYTES) return full;

  const reduced = {
    ...full,
    branchPerformance: (full.branchPerformance as J[]).slice(0, 10),
    salesTrend: (full.salesTrend as J[]).slice(-14),
    topCustomers: (full.topCustomers as J[]).slice(0, 5),
  } satisfies J;
  if (new TextEncoder().encode(JSON.stringify(reduced)).byteLength <= MAX_CONTEXT_BYTES) return reduced;

  return {
    periodDays: days,
    summary: full.summary,
    branchPerformance: (full.branchPerformance as J[]).slice(0, 5),
    salesTrend: (full.salesTrend as J[]).slice(-7),
    channels: (full.channels as J[]).slice(0, 5),
    paymentMethods: (full.paymentMethods as J[]).slice(0, 5),
    topCustomers: (full.topCustomers as J[]).slice(0, 3),
  };
}

function anonymizeCustomers(rows: J[]): J[] {
  return rows.map((row, index) => ({
    rank: index + 1,
    orders: finite(row.orders),
    orderValue: finite(row.orderValue),
    paidValue: finite(row.paidValue),
    lastOrderAt: text(row.lastOrderAt),
  }));
}

function deterministicBrief(context: J, question: string | null): Brief {
  const branches = arrayRecords(context.branchPerformance);
  const payments = arrayRecords(context.paymentMethods);
  const channels = arrayRecords(context.channels);
  const customers = arrayRecords(context.topCustomers);
  const orders = branches.reduce((sum, row) => sum + finite(row.orders), 0);
  const orderValue = branches.reduce((sum, row) => sum + finite(row.orderValue), 0);
  const paidValue = branches.reduce((sum, row) => sum + finite(row.paidValue), 0);
  const pendingVerification = payments.reduce((sum, row) => sum + finite(row.pendingVerification), 0);
  const failedPayments = payments.reduce((sum, row) => sum + finite(row.failed), 0);
  const cashVariance = branches.reduce((sum, row) => sum + Math.abs(finite(row.cashVariance)), 0);
  const topBranch = [...branches].sort((a, b) => finite(b.orderValue) - finite(a.orderValue))[0] ?? null;
  const topChannel = [...channels].sort((a, b) => finite(b.orderValue) - finite(a.orderValue))[0] ?? null;
  const attention: BriefItem[] = [];
  const opportunities: BriefItem[] = [];

  if (pendingVerification > 0) attention.push({
    title: 'Payments need verification',
    detail: `${formatCount(pendingVerification)} payment ${pendingVerification === 1 ? 'attempt is' : 'attempts are'} still waiting for verification in this period.`,
    priority: 'high',
    sourceKeys: ['paymentMethods'],
  });
  if (failedPayments > 0) attention.push({
    title: 'Failed payment attempts',
    detail: `${formatCount(failedPayments)} failed payment ${failedPayments === 1 ? 'attempt was' : 'attempts were'} recorded in this period.`,
    priority: pendingVerification > 0 ? 'medium' : 'high',
    sourceKeys: ['paymentMethods'],
  });
  if (cashVariance > 0) attention.push({
    title: 'Cash variance recorded',
    detail: `Closed shifts show ${formatAmount(cashVariance)} of absolute cash variance across Branches in this period.`,
    priority: 'medium',
    sourceKeys: ['branchPerformance'],
  });
  if (!attention.length) attention.push({
    title: 'No flagged payment or cash exception',
    detail: 'The verified report context does not show pending payment verification, failed payment attempts or cash variance in the available period data.',
    priority: 'low',
    sourceKeys: ['paymentMethods', 'branchPerformance'],
  });

  if (topBranch && branches.length > 1) opportunities.push({
    title: 'Compare Branch execution',
    detail: `${text(topBranch.branchName) || 'The leading Branch'} has the highest recorded order value in the selected period. Compare its operating pattern with lower-volume Branches before changing process.`,
    priority: 'medium',
    sourceKeys: ['branchPerformance'],
  });
  if (topChannel && finite(topChannel.orders) > 0) opportunities.push({
    title: 'Review channel concentration',
    detail: `${label(text(topChannel.channel) || 'The leading channel')} is the largest recorded sales channel in this period. Use the channel mix to decide where merchant attention is most valuable.`,
    priority: 'low',
    sourceKeys: ['channels'],
  });
  if (customers.length > 0) opportunities.push({
    title: 'Protect high-value customer activity',
    detail: 'The report contains ranked repeat/high-value customer activity. Review the top-customer list in Report Center for retention follow-up.',
    priority: 'low',
    sourceKeys: ['topCustomers'],
  });

  return {
    headline: orders > 0 ? `${formatCount(orders)} orders in the selected period` : 'No recorded orders in the selected period',
    summary: orders > 0
      ? `SellerTray recorded ${formatCount(orders)} orders with ${formatAmount(orderValue)} in order value and ${formatAmount(paidValue)} recorded as paid across the Branch report data.`
      : 'SellerTray has no recorded order activity in the selected report period.',
    attention: attention.slice(0, 5),
    opportunities: opportunities.slice(0, 4),
    answer: question
      ? 'The AI provider is unavailable for the optional question. The source-backed business summary and attention items remain available above.'
      : '',
  };
}

function validateBrief(value: unknown): Brief | null {
  if (!isRecord(value)) return null;
  const headline = bounded(value.headline, 140);
  const summary = bounded(value.summary, 900);
  const answer = typeof value.answer === 'string' ? value.answer.trim().slice(0, 800) : '';
  const attention = parseItems(value.attention, 5);
  const opportunities = parseItems(value.opportunities, 4);
  if (!headline || !summary || attention === null || opportunities === null) return null;
  return { headline, summary, attention, opportunities, answer };
}

function parseItems(value: unknown, max: number): BriefItem[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: BriefItem[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const title = bounded(raw.title, 120);
    const detail = bounded(raw.detail, 500);
    const priority = raw.priority === 'high' || raw.priority === 'medium' || raw.priority === 'low' ? raw.priority : null;
    const sourceKeys = Array.isArray(raw.sourceKeys)
      ? [...new Set(raw.sourceKeys.filter((key): key is SourceKey => typeof key === 'string' && SOURCE_KEYS.includes(key as SourceKey)))].slice(0, 3)
      : [];
    if (!title || !detail || !priority || !sourceKeys.length) return null;
    out.push({ title, detail, priority, sourceKeys });
  }
  return out;
}

function resultPayload(
  requestId: string,
  days: number,
  brief: Brief,
  mode: 'ai' | 'deterministic',
  budget: { dailyLimit: number; providerCallsToday: number; remainingProviderCalls: number },
  fallbackReason: string | null,
  model: string | null = null,
): J {
  return {
    requestId,
    mode,
    periodDays: days,
    generatedAt: new Date().toISOString(),
    brief,
    sources: SOURCE_KEYS.map((key) => ({ key, label: sourceLabels[key] })),
    budget,
    provider: mode === 'ai' ? { name: 'openai', model } : null,
    fallbackReason,
  };
}

async function verifiedUser(auth: string): Promise<string | null> {
  if (!auth.startsWith('Bearer ')) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, authorization: auth },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  try {
    const value = await response.json() as J;
    return uuid(value.id);
  } catch { return null; }
}

async function tenantRole(tenantId: string, userId: string): Promise<string | null> {
  const rows = await serviceRest<Array<{ role: string }>>(
    `/rest/v1/tenant_members?select=role&tenant_id=eq.${encodeURIComponent(tenantId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  const role = rows[0]?.role ?? null;
  return role === 'owner' || role === 'manager' || role === 'staff' ? role : null;
}

async function countProviderCallsToday(tenantId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await serviceRest<Array<{ id: string }>>(
    `/rest/v1/sellertray_ai_brief_attempts?select=id&tenant_id=eq.${encodeURIComponent(tenantId)}` +
      `&provider_called=eq.true&created_at=gte.${encodeURIComponent(start.toISOString())}&limit=${DAILY_LIMIT + 1}`,
  );
  return rows.length;
}

async function userRpc<T>(name: string, body: J, authorization: string): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: PUBLIC_KEY,
      authorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(await safeError(response));
  const textValue = await response.text();
  return (textValue ? JSON.parse(textValue) : null) as T;
}

async function serviceRpc<T>(name: string, body: J): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(await safeError(response));
  const textValue = await response.text();
  return (textValue ? JSON.parse(textValue) : null) as T;
}

async function serviceRest<T>(path: string): Promise<T> {
  const response = await fetch(SUPABASE_URL + path, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(await safeError(response));
  return await response.json() as T;
}

async function recordAttempt(input: {
  tenantId: string;
  userId: string;
  requestId: string;
  days: number;
  questionPresent: boolean;
  outcome: AttemptOutcome;
  providerCalled: boolean;
  providerStatus: number | null;
  usage: ProviderUsage | null;
  contextBytes: number;
  fingerprint: string;
  durationMs: number;
}): Promise<void> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/sellertray_ai_brief_attempts?on_conflict=tenant_id%2Crequest_id`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
        prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        actor_user_id: input.userId,
        request_id: input.requestId,
        period_days: input.days,
        question_present: input.questionPresent,
        provider: 'openai',
        model: input.usage?.model ?? (input.providerCalled ? AI_MODEL : null),
        outcome: input.outcome,
        provider_called: input.providerCalled,
        provider_http_status: input.providerStatus,
        input_tokens: input.usage?.inputTokens ?? null,
        cached_input_tokens: input.usage?.cachedInputTokens ?? null,
        output_tokens: input.usage?.outputTokens ?? null,
        reasoning_tokens: input.usage?.reasoningTokens ?? null,
        total_tokens: input.usage?.totalTokens ?? null,
        context_bytes: input.contextBytes,
        context_fingerprint: input.fingerprint,
        duration_ms: input.durationMs,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok && response.status !== 409) {
      console.error('AI Brief telemetry write failed', response.status, await response.text());
    }
  } catch (error) {
    console.error('AI Brief telemetry write failed', error);
  }
}

function extractOutputText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.output_text === 'string' && value.output_text.trim()) return value.output_text;
  const output = Array.isArray(value.output) ? value.output : [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === 'string' && content.text.trim()) return content.text;
    }
  }
  return null;
}

function extractProviderUsage(value: unknown): ProviderUsage | null {
  if (!isRecord(value)) return null;
  const usage = record(value.usage);
  const details = record(usage.input_tokens_details);
  const outputDetails = record(usage.output_tokens_details);
  const model = text(value.model) || AI_MODEL;
  return {
    model,
    inputTokens: integerOrNull(usage.input_tokens),
    cachedInputTokens: integerOrNull(details.cached_tokens),
    outputTokens: integerOrNull(usage.output_tokens),
    reasoningTokens: integerOrNull(outputDetails.reasoning_tokens),
    totalTokens: integerOrNull(usage.total_tokens),
  };
}

function emptyUsage(): ProviderUsage {
  return { model: AI_MODEL, inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function limitedBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return null;
  const body = await request.text();
  return new TextEncoder().encode(body).byteLength <= maxBytes ? body : null;
}

async function safeError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as J;
    return text(payload.message) || text(payload.error) || `SellerTray request failed with HTTP ${response.status}`;
  } catch {
    return `SellerTray request failed with HTTP ${response.status}`;
  }
}

function arrayRecords(value: unknown): J[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function record(value: unknown): J { return isRecord(value) ? value : {}; }
function isRecord(value: unknown): value is J { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function label(value: string): string { return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function finite(value: unknown): number { const n = typeof value === 'number' ? value : Number(value); return Number.isFinite(n) ? n : 0; }
function integerOrNull(value: unknown): number | null { const n = typeof value === 'number' ? value : Number(value); return Number.isInteger(n) && n >= 0 ? n : null; }
function optionalText(value: unknown, max: number): string | null { const clean = typeof value === 'string' ? value.trim() : ''; return clean ? clean.slice(0, max) : null; }
function bounded(value: unknown, max: number): string | null { const clean = text(value); return clean && clean.length <= max ? clean : null; }
function boundedInteger(value: unknown, min: number, max: number): number | null { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : null; }
function uuid(value: unknown): string | null { const clean = text(value); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean) ? clean : null; }
function briefDays(value: unknown): 7 | 30 | 90 { return value === 7 || value === 90 ? value : 30; }
function formatCount(value: number): string { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(value); }
function formatAmount(value: number): string { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(value); }

function reply(payload: J, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
