type JsonRecord = Record<string, unknown>;

type CatalogueItem = {
  id: string;
  name: string;
  aliases: string[];
};

type ParserRequest = {
  text: string;
  catalogue: CatalogueItem[];
};

type ParsedItem = {
  name: string;
  quantity: number;
};

type ParsedOrder = {
  items: ParsedItem[];
  confidence: number;
};

type ProviderUsage = {
  model: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

type ParserTelemetryOutcome = 'success' | 'provider_error' | 'invalid_output' | 'network_error';

class ParserProviderError extends Error {
  constructor(
    message: string,
    readonly outcome: Exclude<ParserTelemetryOutcome, 'success' | 'network_error'>,
    readonly providerHttpStatus: number | null,
    readonly usage: ProviderUsage | null,
  ) {
    super(message);
    this.name = 'ParserProviderError';
  }
}

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_PARSER_MODEL = Deno.env.get('OPENAI_PARSER_MODEL') ?? 'gpt-5.6-luna';
const ORDER_PARSER_TOKEN = Deno.env.get('ORDER_PARSER_TOKEN') ?? '';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_CATALOGUE_ITEMS = 500;
const MAX_ALIASES_PER_ITEM = 12;
const MAX_PRODUCT_TEXT_LENGTH = 160;

const outputSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          quantity: { type: 'number', exclusiveMinimum: 0 },
        },
        required: ['name', 'quantity'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['items', 'confidence'],
  additionalProperties: false,
} as const;

Deno.serve(withObservability('order-parser', async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  if (!ORDER_PARSER_TOKEN || !OPENAI_API_KEY) {
    console.error('Order parser is not activated: required server secrets are missing.');
    return json({ error: 'Parser not configured' }, 503);
  }

  const authorization = request.headers.get('authorization') ?? '';
  const expectedAuthorization = `Bearer ${ORDER_PARSER_TOKEN}`;
  if (!constantTimeEqual(authorization, expectedAuthorization)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const bodyRead = await readRequestTextLimited(request, 2_097_152);
  if (!bodyRead.ok) {
    return json({ error: 'Payload too large' }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyRead.text);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const parsedRequest = validateRequest(body);
  if ('error' in parsedRequest) {
    return json({ error: parsedRequest.error }, parsedRequest.status);
  }

  try {
    const result = await extractOrder(parsedRequest.value);
    return json(
      result.parsed,
      200,
      parserTelemetryHeaders('success', 200, result.usage),
    );
  } catch (error) {
    console.error('Order parser provider request failed', error);
    if (error instanceof ParserProviderError) {
      return json(
        { error: 'Parser provider unavailable' },
        502,
        parserTelemetryHeaders(error.outcome, error.providerHttpStatus, error.usage),
      );
    }
    return json(
      { error: 'Parser provider unavailable' },
      502,
      parserTelemetryHeaders('network_error', null, null),
    );
  }
}));

async function extractOrder(input: ParserRequest): Promise<{ parsed: ParsedOrder; usage: ProviderUsage }> {
  const catalogueContext = input.catalogue.map((item) => ({
    name: item.name,
    aliases: item.aliases,
  }));

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(6500),
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_PARSER_MODEL,
      store: false,
      reasoning: { effort: 'none' },
      max_output_tokens: 1200,
      input: [
        {
          role: 'system',
          content:
            'You extract purchase-order line items from short WhatsApp messages for a small merchant. ' +
            'Return only products the customer is actually ordering and their numeric quantities. ' +
            'Use the supplied merchant catalogue names and aliases only to understand abbreviations, packaging, spelling and informal wording. ' +
            'For each item name, preserve the customer wording when it is clear; otherwise use the closest catalogue name. ' +
            'Ignore greetings, delivery instructions, addresses, payment discussion, thanks and non-order chatter. ' +
            'Never invent a product, quantity, catalogue ID or selling price. Selling prices are deliberately outside your output. ' +
            'If no purchase line can be identified safely, return an empty items array. ' +
            'Confidence is your confidence that the extracted item names and quantities faithfully represent the customer order, from 0 to 1.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            message: input.text,
            merchant_catalogue: catalogueContext,
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'orderdesk_order_extraction',
          strict: true,
          schema: outputSchema,
        },
      },
    }),
  });

  const rawText = await response.text();
  let providerPayload: unknown = null;
  try {
    providerPayload = JSON.parse(rawText);
  } catch {
    providerPayload = null;
  }
  const usage = extractProviderUsage(providerPayload);

  if (!response.ok) {
    throw new ParserProviderError(
      `OpenAI Responses API ${response.status}: ${safeProviderError(rawText)}`,
      'provider_error',
      response.status,
      usage,
    );
  }

  if (!providerPayload) {
    throw new ParserProviderError(
      'OpenAI response was not valid JSON.',
      'invalid_output',
      response.status,
      null,
    );
  }

  let outputText: string | null;
  try {
    outputText = extractOutputText(providerPayload);
  } catch (error) {
    throw new ParserProviderError(
      error instanceof Error ? error.message : 'OpenAI response could not be read.',
      'invalid_output',
      response.status,
      usage,
    );
  }
  if (!outputText) {
    throw new ParserProviderError(
      'OpenAI response contained no structured output text.',
      'invalid_output',
      response.status,
      usage,
    );
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(outputText);
  } catch {
    throw new ParserProviderError(
      'Structured output text was not valid JSON.',
      'invalid_output',
      response.status,
      usage,
    );
  }

  const validated = validateParsedOrder(candidate);
  if (!validated) {
    throw new ParserProviderError(
      'Structured parser output failed SellerTray validation.',
      'invalid_output',
      response.status,
      usage,
    );
  }

  return {
    parsed: validated,
    usage: usage ?? {
      model: OPENAI_PARSER_MODEL,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    },
  };

}

function validateRequest(
  value: unknown,
): { value: ParserRequest } | { error: string; status: number } {
  if (!isRecord(value)) return { error: 'Request body must be an object', status: 400 };

  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (!text) return { error: 'text is required', status: 400 };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { error: 'Message is too long for the order parser', status: 413 };
  }

  if (!Array.isArray(value.catalogue)) {
    return { error: 'catalogue must be an array', status: 400 };
  }
  if (value.catalogue.length > MAX_CATALOGUE_ITEMS) {
    return { error: 'Catalogue is too large for the current parser contract', status: 413 };
  }

  const catalogue: CatalogueItem[] = [];
  for (const rawItem of value.catalogue) {
    if (!isRecord(rawItem)) return { error: 'Invalid catalogue item', status: 400 };

    const id = cleanString(rawItem.id, 100);
    const name = cleanString(rawItem.name, MAX_PRODUCT_TEXT_LENGTH);
    if (!id || !name) return { error: 'Catalogue items require id and name', status: 400 };

    const rawAliases = Array.isArray(rawItem.aliases) ? rawItem.aliases : [];
    const aliases = rawAliases
      .slice(0, MAX_ALIASES_PER_ITEM)
      .map((alias) => cleanString(alias, MAX_PRODUCT_TEXT_LENGTH))
      .filter((alias): alias is string => Boolean(alias));

    catalogue.push({ id, name, aliases });
  }

  return { value: { text, catalogue } };
}

function validateParsedOrder(value: unknown): ParsedOrder | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;

  const items: ParsedItem[] = [];
  for (const rawItem of value.items) {
    if (!isRecord(rawItem)) return null;
    const name = cleanString(rawItem.name, 200);
    const quantity = typeof rawItem.quantity === 'number' ? rawItem.quantity : Number(rawItem.quantity);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) return null;
    items.push({ name, quantity });
  }

  const rawConfidence = typeof value.confidence === 'number' ? value.confidence : Number(value.confidence);
  if (!Number.isFinite(rawConfidence)) return null;

  return {
    items,
    confidence: Math.min(1, Math.max(0, rawConfidence)),
  };
}

function extractOutputText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.output_text === 'string' && value.output_text.trim()) {
    return value.output_text;
  }

  const output = Array.isArray(value.output) ? value.output : [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if (content.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
        return content.text;
      }
      if (content.type === 'refusal') {
        throw new Error('OpenAI refused the parser request.');
      }
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
    model: cleanString(value.model, 120) ?? OPENAI_PARSER_MODEL,
    inputTokens: nonNegativeInteger(usage.input_tokens),
    cachedInputTokens: inputDetails ? nonNegativeInteger(inputDetails.cached_tokens) : null,
    outputTokens: nonNegativeInteger(usage.output_tokens),
    reasoningTokens: outputDetails ? nonNegativeInteger(outputDetails.reasoning_tokens) : null,
    totalTokens: nonNegativeInteger(usage.total_tokens),
  };
}

function parserTelemetryHeaders(
  outcome: ParserTelemetryOutcome,
  providerHttpStatus: number | null,
  usage: ProviderUsage | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-sellertray-ai-outcome': outcome,
    'x-sellertray-ai-model': usage?.model ?? OPENAI_PARSER_MODEL,
  };

  if (providerHttpStatus !== null) {
    headers['x-sellertray-ai-provider-status'] = String(providerHttpStatus);
  }
  if (usage?.inputTokens !== null && usage?.inputTokens !== undefined) {
    headers['x-sellertray-ai-input-tokens'] = String(usage.inputTokens);
  }
  if (usage?.cachedInputTokens !== null && usage?.cachedInputTokens !== undefined) {
    headers['x-sellertray-ai-cached-input-tokens'] = String(usage.cachedInputTokens);
  }
  if (usage?.outputTokens !== null && usage?.outputTokens !== undefined) {
    headers['x-sellertray-ai-output-tokens'] = String(usage.outputTokens);
  }
  if (usage?.reasoningTokens !== null && usage?.reasoningTokens !== undefined) {
    headers['x-sellertray-ai-reasoning-tokens'] = String(usage.reasoningTokens);
  }
  if (usage?.totalTokens !== null && usage?.totalTokens !== undefined) {
    headers['x-sellertray-ai-total-tokens'] = String(usage.totalTokens);
  }

  return headers;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function safeProviderError(raw: string): string {
  try {
    const value = JSON.parse(raw) as unknown;
    if (isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string') {
      return value.error.message.slice(0, 300);
    }
  } catch {
    // Fall through to the sanitized raw message.
  }
  return raw.replace(/\s+/g, ' ').slice(0, 300) || 'Unknown provider error';
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean || clean.length > maxLength) return null;
  return clean;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function json(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
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

