type JsonRecord = Record<string, unknown>;

type InsightResult = {
  answer: string;
  highlights: string[];
  dataNotes: string[];
  followUps: string[];
  confidence: 'high' | 'medium' | 'low';
};

type ProviderUsage = {
  model: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

type TelemetryOutcome =
  | 'success'
  | 'provider_error'
  | 'invalid_output'
  | 'network_error'
  | 'rate_limited'
  | 'context_error';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('SELLERTRAY_AI_INSIGHTS_MODEL') ?? 'gpt-6-luna';

const MAX_BODY_BYTES = 16_384;
const MAX_QUESTION_LENGTH = 1200;
const MAX_CONTEXT_CHARS = 120_000;
const RATE_LIMIT_PER_MINUTE = 10;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const outputSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string', minLength: 1, maxLength: 1800 },
    highlights: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', minLength: 1, maxLength: 320 },
    },
    dataNotes: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 320 },
    },
    followUps: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string', minLength: 1, maxLength: 200 },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['answer', 'highlights', 'dataNotes', 'followUps', 'confidence'],
  additionalProperties: false,
} as const;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: 'SellerTray AI server configuration is incomplete' }, 503);
  }
  if (!OPENAI_API_KEY) {
    return json({ error: 'SellerTray AI is not activated yet' }, 503);
  }

  const authorization = request.headers.get('authorization') ?? '';
  const userId = await verifiedUser(authorization);
  if (!userId) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Request is too large' }, 413);

  let body: JsonRecord;
  try {
    const parsed = JSON.parse(bodyRead.text) as unknown;
    if (!isRecord(parsed)) return json({ error: 'Request body must be an object' }, 400);
    body = parsed;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const tenantId = cleanUuid(body.tenantId);
  const question = cleanQuestion(body.question);
  const days = boundedDays(body.days);
  if (!tenantId) return json({ error: 'Business is required' }, 400);
  if (!question) {
    return json({ error: `Ask a question up to ${MAX_QUESTION_LENGTH} characters` }, 400);
  }

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  const withinBudget = await consumeRateLimit(tenantId, userId);
  if (!withinBudget) {
    await recordTelemetry({
      requestId,
      tenantId,
      actorUserId: userId,
      outcome: 'rate_limited',
      providerHttpStatus: null,
      contextDays: days,
      questionLength: question.length,
      usage: null,
      latencyMs: Date.now() - startedAt,
    });
    return json({ error: 'Too many AI questions. Try again shortly.' }, 429);
  }

  let context: unknown;
  try {
    context = await loadGovernedContext(authorization, tenantId, days);
  } catch (error) {
    await recordTelemetry({
      requestId,
      tenantId,
      actorUserId: userId,
      outcome: 'context_error',
      providerHttpStatus: null,
      contextDays: days,
      questionLength: question.length,
      usage: null,
      latencyMs: Date.now() - startedAt,
    });
    const message = safeMessage(error, 'Unable to prepare SellerTray business context.');
    const status = /owner|manager|access|membership|authentication/i.test(message) ? 403 : 400;
    return json({ error: message }, status);
  }

  const contextText = JSON.stringify(context);
  if (contextText.length > MAX_CONTEXT_CHARS) {
    await recordTelemetry({
      requestId,
      tenantId,
      actorUserId: userId,
      outcome: 'context_error',
      providerHttpStatus: null,
      contextDays: days,
      questionLength: question.length,
      usage: null,
      latencyMs: Date.now() - startedAt,
    });
    return json(
      { error: 'There is too much business data for this AI window. Choose a shorter period.' },
      413,
    );
  }

  let providerStatus: number | null = null;
  let usage: ProviderUsage | null = null;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: {
        authorization: `Bearer ${OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        store: false,
        reasoning: { effort: 'none' },
        max_output_tokens: 1200,
        safety_identifier: await stableSafetyIdentifier(userId),
        instructions:
          'You are SellerTray AI, a read-only business analyst for a merchant. ' +
          'Answer only from the supplied SellerTray context. Never invent numbers, products, branches, customers, suppliers or events. ' +
          'If the supplied data cannot answer the question, say so clearly and lower confidence. ' +
          'Amounts are business currency values from SellerTray; do not convert currencies. ' +
          'Top product quantities are gross confirmed sold quantities in each product Stock UOM unless the context says otherwise. ' +
          'You may recommend what the merchant should review or consider, but you cannot execute sales, stock, payment, purchasing, staff, WhatsApp, printer or settings changes. ' +
          'Keep the answer concise, operational and suitable for a small-business Owner or Manager.',
        input: [
          {
            role: 'user',
            content: JSON.stringify({
              question,
              sellerTrayContext: context,
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'sellertray_merchant_insight',
            strict: true,
            schema: outputSchema,
          },
        },
      }),
    });

    providerStatus = response.status;
    const rawText = await response.text();
    let providerPayload: unknown = null;
    try {
      providerPayload = JSON.parse(rawText);
    } catch {
      providerPayload = null;
    }
    usage = extractProviderUsage(providerPayload);

    if (!response.ok) {
      await recordTelemetry({
        requestId,
        tenantId,
        actorUserId: userId,
        outcome: 'provider_error',
        providerHttpStatus: providerStatus,
        contextDays: days,
        questionLength: question.length,
        usage,
        latencyMs: Date.now() - startedAt,
      });
      console.error('SellerTray AI provider error', response.status, safeProviderError(rawText));
      return json({ error: 'SellerTray AI is temporarily unavailable' }, 502);
    }

    const outputText = extractOutputText(providerPayload);
    if (!outputText) {
      await recordTelemetry({
        requestId,
        tenantId,
        actorUserId: userId,
        outcome: 'invalid_output',
        providerHttpStatus: providerStatus,
        contextDays: days,
        questionLength: question.length,
        usage,
        latencyMs: Date.now() - startedAt,
      });
      return json({ error: 'SellerTray AI returned an unreadable response' }, 502);
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(outputText);
    } catch {
      candidate = null;
    }
    const result = validateInsight(candidate);
    if (!result) {
      await recordTelemetry({
        requestId,
        tenantId,
        actorUserId: userId,
        outcome: 'invalid_output',
        providerHttpStatus: providerStatus,
        contextDays: days,
        questionLength: question.length,
        usage,
        latencyMs: Date.now() - startedAt,
      });
      return json({ error: 'SellerTray AI returned an invalid response' }, 502);
    }

    await recordTelemetry({
      requestId,
      tenantId,
      actorUserId: userId,
      outcome: 'success',
      providerHttpStatus: providerStatus,
      contextDays: days,
      questionLength: question.length,
      usage,
      latencyMs: Date.now() - startedAt,
    });

    return json({
      requestId,
      days,
      generatedAt: new Date().toISOString(),
      ...result,
    }, 200);
  } catch (error) {
    await recordTelemetry({
      requestId,
      tenantId,
      actorUserId: userId,
      outcome: 'network_error',
      providerHttpStatus: providerStatus,
      contextDays: days,
      questionLength: question.length,
      usage,
      latencyMs: Date.now() - startedAt,
    });
    console.error('SellerTray AI request failed', safeMessage(error, 'Network error'));
    return json({ error: 'SellerTray AI is temporarily unavailable' }, 502);
  }
});

async function verifiedUser(authorization: string): Promise<string | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  try {
    const payload = await response.json() as JsonRecord;
    return cleanUuid(payload.id);
  } catch {
    return null;
  }
}

async function loadGovernedContext(
  authorization: string,
  tenantId: string,
  days: number,
): Promise<unknown> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/sellertray_ai_insight_context`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_tenant_id: tenantId, p_days: days }),
      signal: AbortSignal.timeout(12_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(safeSupabaseError(raw));
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('SellerTray business context could not be read.');
  }
}

async function consumeRateLimit(tenantId: string, userId: string): Promise<boolean> {
  try {
    const value = await serviceRpc('consume_sellertray_rate_limit', {
      p_scope: 'merchant_ai_insight',
      p_key: `${tenantId}:${userId}`,
      p_limit: RATE_LIMIT_PER_MINUTE,
      p_window_seconds: 60,
    });
    return value === true;
  } catch (error) {
    console.error('SellerTray AI rate-limit check failed', safeMessage(error, 'Rate limit error'));
    return false;
  }
}

async function recordTelemetry(input: {
  requestId: string;
  tenantId: string;
  actorUserId: string;
  outcome: TelemetryOutcome;
  providerHttpStatus: number | null;
  contextDays: number;
  questionLength: number;
  usage: ProviderUsage | null;
  latencyMs: number;
}): Promise<void> {
  try {
    await serviceRpc('record_sellertray_ai_insight_attempt', {
      p_request_id: input.requestId,
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_model: input.usage?.model ?? OPENAI_MODEL,
      p_outcome: input.outcome,
      p_provider_http_status: input.providerHttpStatus,
      p_context_days: input.contextDays,
      p_question_length: input.questionLength,
      p_input_tokens: input.usage?.inputTokens ?? null,
      p_cached_input_tokens: input.usage?.cachedInputTokens ?? null,
      p_output_tokens: input.usage?.outputTokens ?? null,
      p_reasoning_tokens: input.usage?.reasoningTokens ?? null,
      p_total_tokens: input.usage?.totalTokens ?? null,
      p_latency_ms: Math.max(0, Math.round(input.latencyMs)),
    });
  } catch (error) {
    console.error('SellerTray AI telemetry write failed', safeMessage(error, 'Telemetry error'));
  }
}

async function serviceRpc(name: string, body: JsonRecord): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(safeSupabaseError(raw));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function validateInsight(value: unknown): InsightResult | null {
  if (!isRecord(value)) return null;
  const answer = cleanString(value.answer, 1800);
  const confidence = value.confidence;
  if (!answer || (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low')) {
    return null;
  }

  const highlights = cleanStringArray(value.highlights, 5, 320);
  const dataNotes = cleanStringArray(value.dataNotes, 4, 320);
  const followUps = cleanStringArray(value.followUps, 3, 200);
  if (!highlights || !dataNotes || !followUps) return null;

  return { answer, highlights, dataNotes, followUps, confidence };
}

function extractOutputText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.output_text === 'string' && value.output_text.trim()) return value.output_text;
  const output = Array.isArray(value.output) ? value.output : [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if (content.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
        return content.text;
      }
      if (content.type === 'refusal') return null;
    }
  }
  return null;
}

function extractProviderUsage(value: unknown): ProviderUsage | null {
  if (!isRecord(value)) return null;
  const usage = isRecord(value.usage) ? value.usage : null;
  if (!usage) return null;
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : null;
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : null;
  return {
    model: cleanString(value.model, 120) ?? OPENAI_MODEL,
    inputTokens: nonNegativeInteger(usage.input_tokens),
    cachedInputTokens: inputDetails ? nonNegativeInteger(inputDetails.cached_tokens) : null,
    outputTokens: nonNegativeInteger(usage.output_tokens),
    reasoningTokens: outputDetails ? nonNegativeInteger(outputDetails.reasoning_tokens) : null,
    totalTokens: nonNegativeInteger(usage.total_tokens),
  };
}

async function stableSafetyIdentifier(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sellertray:${userId}`));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 64);
}

function boundedDays(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(365, Math.trunc(parsed)));
}

function cleanQuestion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean || clean.length > MAX_QUESTION_LENGTH) return null;
  return clean;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= maxLength ? clean : null;
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const items: string[] = [];
  for (const item of value) {
    const clean = cleanString(item, maxLength);
    if (!clean) return null;
    items.push(clean);
  }
  return items;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeProviderError(raw: string): string {
  try {
    const value = JSON.parse(raw) as unknown;
    if (isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string') {
      return value.error.message.replace(/\s+/g, ' ').slice(0, 300);
    }
  } catch {
    // Use sanitized raw text below.
  }
  return raw.replace(/\s+/g, ' ').slice(0, 300) || 'Unknown provider error';
}

function safeSupabaseError(raw: string): string {
  try {
    const value = JSON.parse(raw) as unknown;
    if (isRecord(value)) {
      const message = typeof value.message === 'string'
        ? value.message
        : typeof value.error === 'string'
          ? value.error
          : null;
      if (message) return message.replace(/\s+/g, ' ').slice(0, 300);
    }
  } catch {
    // Fall through.
  }
  return 'SellerTray business context request failed.';
}

function safeMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const clean = error.message.replace(/\s+/g, ' ').slice(0, 300);
  return clean || fallback;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) return { ok: false };
  }
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}