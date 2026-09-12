type JsonRecord = Record<string, unknown>;
type AdminAction =
  | 'overview'
  | 'audit'
  | 'ai_parser_readiness'
  | 'ai_parser_probe'
  | 'set_subscription_status'
  | 'extend_trial_days'
  | 'set_whatsapp_status'
  | 'set_support_note';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const OPENAI_API_KEY_CONFIGURED = Boolean(Deno.env.get('OPENAI_API_KEY')?.trim());
const ORDER_PARSER_TOKEN_CONFIGURED = Boolean(Deno.env.get('ORDER_PARSER_TOKEN')?.trim());
const OPENAI_PARSER_MODEL = Deno.env.get('OPENAI_PARSER_MODEL')?.trim() || 'gpt-5.6-luna';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(withObservability('platform-admin', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Server configuration error' }, 500);

  const authorization = request.headers.get('authorization') ?? '';
  const identity = await verifiedIdentity(authorization);
  if (!identity) return json({ error: 'Authentication required' }, 401);
  if (identity.aal !== 'aal2') {
    return json({ error: 'MFA verification is required for ProcessEdge administrator access' }, 403);
  }
  const userId = identity.userId;

  const bodyRead = await readRequestTextLimited(request, 65_536);
  if (!bodyRead.ok) {
    return json({ error: 'Payload too large' }, 413);
  }

  let body: JsonRecord;
  try {
    body = JSON.parse(bodyRead.text) as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported platform admin action' }, 400);

  try {
    if (action === 'overview') {
      const overview = await rpc<JsonRecord>('platform_admin_overview', {
        p_actor_user_id: userId,
      });
      return json({ overview });
    }

    if (action === 'ai_parser_readiness') {
      const overview = await rpc<JsonRecord>('platform_admin_overview', {
        p_actor_user_id: userId,
      });
      return json({ readiness: buildAiParserReadiness(overview) });
    }

    if (action === 'ai_parser_probe') {
      return json({ probe: await runAiParserProbe() });
    }

    if (action === 'audit') {
      const tenantId = body.tenantId === null || body.tenantId === undefined
        ? null
        : cleanUuid(body.tenantId);
      if (body.tenantId && !tenantId) return json({ error: 'Invalid tenantId' }, 400);
      const requestedLimit = Number(body.limit ?? 50);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
        : 50;
      const audit = await rpc<JsonRecord>('platform_admin_audit_log', {
        p_actor_user_id: userId,
        p_tenant_id: tenantId,
        p_limit: limit,
      });
      return json({ audit });
    }

    const tenantId = cleanUuid(body.tenantId);
    if (!tenantId) return json({ error: 'tenantId is required' }, 400);

    let value: string | null = null;
    if (action === 'set_subscription_status') {
      value = cleanEnum(body.value, ['trial', 'active', 'past_due', 'grace', 'suspended', 'cancelled']);
      if (!value) return json({ error: 'Unsupported subscription status' }, 400);
    } else if (action === 'extend_trial_days') {
      const days = Number(body.value);
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        return json({ error: 'Trial extension must be between 1 and 90 days' }, 400);
      }
      value = String(days);
    } else if (action === 'set_whatsapp_status') {
      value = cleanEnum(body.value, ['not_connected', 'pending', 'connected', 'error']);
      if (!value) return json({ error: 'Unsupported WhatsApp status' }, 400);
    } else {
      if (body.value !== null && body.value !== undefined && typeof body.value !== 'string') {
        return json({ error: 'Support note must be text' }, 400);
      }
      value = typeof body.value === 'string' ? body.value : null;
      if (value && value.length > 4000) return json({ error: 'Support note is too long' }, 400);
    }

    await rpc<unknown>('platform_admin_mutate_tenant', {
      p_actor_user_id: userId,
      p_tenant_id: tenantId,
      p_action: action,
      p_value: value,
    });

    const overview = await rpc<JsonRecord>('platform_admin_overview', {
      p_actor_user_id: userId,
    });
    return json({ ok: true, overview });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Platform admin request failed';
    const status = /administrator access|required for this action|admin role required/i.test(message)
      ? 403
      : /not found/i.test(message)
        ? 404
        : 400;
    return json({ error: message }, status);
  }
}));

async function rpc<T>(name: string, body: JsonRecord): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Platform admin RPC failed with HTTP ${response.status}`;
    try {
      const payload = await response.json() as JsonRecord;
      if (typeof payload.message === 'string' && payload.message) message = payload.message;
      else if (typeof payload.error === 'string' && payload.error) message = payload.error;
    } catch {
      // keep bounded fallback message
    }
    throw new Error(message);
  }

  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

async function verifiedIdentity(
  authorization: string,
): Promise<{ userId: string; aal: 'aal1' | 'aal2' } | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  if (!token) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization },
  });
  if (!response.ok) return null;

  let user: JsonRecord;
  try { user = await response.json() as JsonRecord; }
  catch { return null; }

  const userId = cleanUuid(user.id);
  const aal = getJwtAal(token);
  return userId && aal ? { userId, aal } : null;
}

function getJwtAal(token: string): 'aal1' | 'aal2' | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as JsonRecord;
    return payload.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return null;
  }
}

function cleanAction(value: unknown): AdminAction | null {
  const supported: AdminAction[] = [
    'overview',
    'audit',
    'ai_parser_readiness',
    'ai_parser_probe',
    'set_subscription_status',
    'extend_trial_days',
    'set_whatsapp_status',
    'set_support_note',
  ];
  return typeof value === 'string' && supported.includes(value as AdminAction)
    ? value as AdminAction
    : null;
}

async function runAiParserProbe(): Promise<JsonRecord> {
  const parserToken = Deno.env.get('ORDER_PARSER_TOKEN')?.trim() ?? '';
  if (!parserToken || !SUPABASE_URL) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'SellerTray AI parser server credentials are incomplete.',
    };
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/order-parser`, {
      method: 'POST',
      signal: AbortSignal.timeout(9000),
      headers: {
        authorization: `Bearer ${parserToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Please send 2 SellerTray Test Rice and 3 SellerTray Test Milk.',
        catalogue: [
          { id: 'sellertray-smoke-rice', name: 'SellerTray Test Rice', aliases: ['test rice'] },
          { id: 'sellertray-smoke-milk', name: 'SellerTray Test Milk', aliases: ['test milk'] },
        ],
      }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 'network_error',
      durationMs: Math.max(0, Date.now() - startedAt),
      message: error instanceof Error ? error.name : 'Parser request failed',
    };
  }

  const durationMs = Math.max(0, Date.now() - startedAt);
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const telemetry = {
    outcome: response.headers.get('x-sellertray-ai-outcome'),
    model: response.headers.get('x-sellertray-ai-model'),
    providerStatus: safeIntegerHeader(response.headers, 'x-sellertray-ai-provider-status'),
    inputTokens: safeIntegerHeader(response.headers, 'x-sellertray-ai-input-tokens'),
    cachedInputTokens: safeIntegerHeader(response.headers, 'x-sellertray-ai-cached-input-tokens'),
    outputTokens: safeIntegerHeader(response.headers, 'x-sellertray-ai-output-tokens'),
    reasoningTokens: safeIntegerHeader(response.headers, 'x-sellertray-ai-reasoning-tokens'),
    totalTokens: safeIntegerHeader(response.headers, 'x-sellertray-ai-total-tokens'),
  };

  const parsedItems = isRecord(payload) && Array.isArray(payload.items)
    ? payload.items.filter(isRecord)
    : [];
  const quantityFor = (needle: string): number | null => {
    const match = parsedItems.find((item) =>
      typeof item.name === 'string' && item.name.toLowerCase().includes(needle)
    );
    if (!match) return null;
    const quantity = typeof match.quantity === 'number' ? match.quantity : Number(match.quantity);
    return Number.isFinite(quantity) ? quantity : null;
  };

  const riceQuantity = quantityFor('rice');
  const milkQuantity = quantityFor('milk');
  const structuredOutputValid =
    response.ok &&
    telemetry.outcome === 'success' &&
    riceQuantity === 2 &&
    milkQuantity === 3;

  return {
    ok: structuredOutputValid,
    status: structuredOutputValid
      ? 'passed'
      : response.status === 503
        ? 'not_configured'
        : response.status === 401
          ? 'parser_token_mismatch'
          : response.ok
            ? 'unexpected_output'
            : 'provider_error',
    httpStatus: response.status,
    durationMs,
    configuredModel: OPENAI_PARSER_MODEL,
    structuredOutputValid,
    observed: {
      riceQuantity,
      milkQuantity,
      confidence: isRecord(payload) && typeof payload.confidence === 'number'
        ? Math.max(0, Math.min(1, payload.confidence))
        : null,
    },
    telemetry,
  };
}

function safeIntegerHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function buildAiParserReadiness(overview: JsonRecord): JsonRecord {
  const tenants = Array.isArray(overview.tenants)
    ? overview.tenants.filter(isRecord)
    : [];

  let attempts = 0;
  let successes = 0;
  let nonSuccess = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let totalTokens = 0;
  let meteredExternalOrderUnits = 0;
  let catalogueItemsTotalMax = 0;
  let catalogueItemsSentWeighted = 0;
  let catalogueAliasesSentWeighted = 0;
  let tenantsWithAttempts = 0;
  let latestModel: string | null = null;

  for (const tenant of tenants) {
    const tenantAttempts = nonNegativeNumber(tenant.aiParserAttemptsPeriod);
    const tenantSuccesses = nonNegativeNumber(tenant.aiParserSuccessesPeriod);
    const tenantNonSuccess = nonNegativeNumber(tenant.aiParserNonSuccessPeriod);
    attempts += tenantAttempts;
    successes += tenantSuccesses;
    nonSuccess += tenantNonSuccess;
    inputTokens += nonNegativeNumber(tenant.aiInputTokensPeriod);
    cachedInputTokens += nonNegativeNumber(tenant.aiCachedInputTokensPeriod);
    outputTokens += nonNegativeNumber(tenant.aiOutputTokensPeriod);
    reasoningTokens += nonNegativeNumber(tenant.aiReasoningTokensPeriod);
    totalTokens += nonNegativeNumber(tenant.aiTotalTokensPeriod);
    meteredExternalOrderUnits += nonNegativeNumber(tenant.usageUnitsPeriod);
    catalogueItemsTotalMax = Math.max(
      catalogueItemsTotalMax,
      nonNegativeNumber(tenant.aiCatalogueItemsTotalMax),
    );

    if (tenantAttempts > 0) {
      tenantsWithAttempts += 1;
      catalogueItemsSentWeighted +=
        nonNegativeNumber(tenant.aiCatalogueItemsSentAvg) * tenantAttempts;
      catalogueAliasesSentWeighted +=
        nonNegativeNumber(tenant.aiCatalogueAliasesSentAvg) * tenantAttempts;
      if (!latestModel && typeof tenant.aiParserModel === 'string' && tenant.aiParserModel.trim()) {
        latestModel = tenant.aiParserModel.trim().slice(0, 120);
      }
    }
  }

  const configured = OPENAI_API_KEY_CONFIGURED && ORDER_PARSER_TOKEN_CONFIGURED;
  const hasLiveAttempt = attempts > 0;
  const hasSuccessfulParse = successes > 0;
  const hasMeteredExternalOrder = meteredExternalOrderUnits > 0;

  return {
    configured,
    configuration: {
      openaiApiKeyConfigured: OPENAI_API_KEY_CONFIGURED,
      parserTokenConfigured: ORDER_PARSER_TOKEN_CONFIGURED,
      configuredModel: OPENAI_PARSER_MODEL,
    },
    currentPeriod: {
      tenants: tenants.length,
      tenantsWithAttempts,
      attempts,
      successes,
      nonSuccess,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
      meteredExternalOrderUnits,
      catalogueItemsTotalMax,
      catalogueItemsSentAvg: attempts > 0
        ? Math.round((catalogueItemsSentWeighted / attempts) * 10) / 10
        : 0,
      catalogueAliasesSentAvg: attempts > 0
        ? Math.round((catalogueAliasesSentWeighted / attempts) * 10) / 10
        : 0,
      latestObservedModel: latestModel,
    },
    acceptanceEvidence: {
      hasLiveAttempt,
      hasSuccessfulParse,
      hasMeteredExternalOrder,
      outcomesReconcile: attempts === successes + nonSuccess,
      meteredOrdersDoNotExceedSuccessfulParses: meteredExternalOrderUnits <= successes,
      productionAcceptanceReady:
        configured &&
        hasLiveAttempt &&
        hasSuccessfulParse &&
        hasMeteredExternalOrder &&
        attempts === successes + nonSuccess &&
        meteredExternalOrderUnits <= successes,
    },
    generatedAt: typeof overview.generatedAt === 'string'
      ? overview.generatedAt
      : new Date().toISOString(),
  };
}

function nonNegativeNumber(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanEnum(value: unknown, supported: string[]): string | null {
  return typeof value === 'string' && supported.includes(value) ? value : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

type ObservabilityHandler = (request: Request) => Response | Promise<Response>;

function withObservability(service: string, handler: ObservabilityHandler): ObservabilityHandler {
  return async (request: Request) => {
    const requestId = observabilityRequestId(request);
    const startedAt = Date.now();
    const path = observabilityPath(request.url);

    emitObservability('info', {
      service,
      event: 'request_started',
      request_id: requestId,
      method: request.method,
      path,
    });

    try {
      const response = await handler(request);
      const durationMs = Math.max(0, Date.now() - startedAt);
      const level = response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info';

      emitObservability(level, {
        service,
        event: 'request_finished',
        request_id: requestId,
        method: request.method,
        path,
        status: response.status,
        duration_ms: durationMs,
      });

      const headers = new Headers(response.headers);
      headers.set('x-orderdesk-request-id', requestId);
      if (headers.has('access-control-allow-origin')) {
        const existing = headers.get('access-control-expose-headers');
        const exposed = new Set(
          (existing ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        );
        exposed.add('x-orderdesk-request-id');
        headers.set('access-control-expose-headers', [...exposed].join(', '));
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      emitObservability('error', {
        service,
        event: 'request_exception',
        request_id: requestId,
        method: request.method,
        path,
        duration_ms: Math.max(0, Date.now() - startedAt),
        error: sanitizeObservabilityError(error),
      });
      throw error;
    }
  };
}

function observabilityRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id')?.trim() ?? '';
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

function observabilityPath(urlValue: string): string {
  try {
    return new URL(urlValue).pathname;
  } catch {
    return '/';
  }
}

function sanitizeObservabilityError(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { name: 'UnknownError', message: 'Unhandled server error' };

  const message = error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|sb_secret)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);

  return {
    name: error.name || 'Error',
    message: message || 'Unhandled server error',
  };
}

function emitObservability(
  level: 'info' | 'warn' | 'error',
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...fields,
  });

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { ok: false };
    }
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
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be released after cancellation.
    }
  }
}

