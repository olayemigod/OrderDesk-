type ParsedItem = {
  name: string;
  quantity: number;
};

type ParsedPayload = {
  items: ParsedItem[];
  confidence: number;
};

type ParserSource = 'external' | 'fallback';

type ParsedOrder = ParsedPayload & {
  source: ParserSource;
  version: string;
};

type CatalogueRow = {
  id: string;
  name: string;
  price_ngn: number | string | null;
  catalog_item_aliases: Array<{ alias: string }> | null;
};

type MatchSource =
  | 'catalogue_name'
  | 'catalogue_alias'
  | 'normalized_name'
  | 'normalized_alias'
  | 'unmatched';

type CatalogueMatch = {
  item: CatalogueRow;
  source: Exclude<MatchSource, 'unmatched'>;
  confidence: number;
};

type EnrichedItem = ParsedItem & {
  originalName: string;
  catalogItemId: string | null;
  canonicalName: string;
  unitPrice: number | null;
  matchSource: MatchSource;
  matchConfidence: number;
};

type SubscriptionAccess = {
  accessMode?: string;
  effectiveStatus?: string;
};

type JsonRecord = Record<string, unknown>;

const encoder = new TextEncoder();
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const META_VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? '';
const META_APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const configuredParserUrl = Deno.env.get('ORDER_PARSER_URL')?.trim() ?? '';
const ORDER_PARSER_URL = configuredParserUrl || (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/order-parser` : '');
const ORDER_PARSER_TOKEN = Deno.env.get('ORDER_PARSER_TOKEN') ?? '';

Deno.serve(withObservability('whatsapp-webhook', async (request) => {
  if (request.method === 'GET') {
    return verifyWebhookSubscription(request);
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !META_APP_SECRET) {
    console.error('SellerTray webhook is missing required server secrets.');
    return new Response('Server configuration error', { status: 500 });
  }

  const bodyRead = await readRequestTextLimited(request, 1_048_576);
  if (!bodyRead.ok) {
    return new Response('Payload too large', { status: 413 });
  }
  const rawBody = bodyRead.text;
  const signature = request.headers.get('x-hub-signature-256') ?? '';

  if (!(await verifyMetaSignature(rawBody, signature, META_APP_SECRET))) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: JsonRecord;
  try {
    payload = JSON.parse(rawBody) as JsonRecord;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  try {
    const events = extractInboundMessages(payload);
    for (const event of events) {
      await ingestMessage(event);
    }
  } catch (error) {
    console.error('WhatsApp ingestion failed', error);
    return new Response('Webhook processing failed', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}));

function verifyWebhookSubscription(request: Request): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') ?? '';

  if (mode === 'subscribe' && META_VERIFY_TOKEN && token === META_VERIFY_TOKEN) {
    return new Response(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }

  return new Response('Forbidden', { status: 403 });
}

async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader.startsWith('sha256=')) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = `sha256=${toHex(new Uint8Array(digest))}`;

  return constantTimeEqual(expected, signatureHeader);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function extractInboundMessages(payload: JsonRecord) {
  const results: Array<{
    phoneNumberId: string;
    providerMessageId: string;
    waId: string;
    customerName: string | null;
    messageType: string;
    text: string | null;
    rawMessage: JsonRecord;
  }> = [];

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      const metadata = isRecord(value.metadata) ? value.metadata : {};
      const phoneNumberId = asString(metadata.phone_number_id);
      if (!phoneNumberId) continue;

      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const contact = contacts.find(isRecord);
      const contactName = contact && isRecord(contact.profile)
        ? asString(contact.profile.name)
        : null;

      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const message of messages) {
        if (!isRecord(message)) continue;

        const providerMessageId = asString(message.id);
        const waId = asString(message.from);
        const messageType = asString(message.type) ?? 'unknown';
        const text = messageType === 'text' && isRecord(message.text)
          ? asString(message.text.body)
          : null;

        if (!providerMessageId || !waId) continue;
        results.push({
          phoneNumberId,
          providerMessageId,
          waId,
          customerName: contactName,
          messageType,
          text,
          rawMessage: message,
        });
      }
    }
  }

  return results;
}

async function ingestMessage(event: ReturnType<typeof extractInboundMessages>[number]) {
  const tenants = await rest<Array<{ id: string; currency: string | null }>>(
    `/rest/v1/tenants?select=id,currency&whatsapp_phone_number_id=eq.${encodeURIComponent(event.phoneNumberId)}&limit=1`,
  );
  const tenant = tenants[0];
  const tenantId = tenant?.id;

  if (!tenantId) {
    console.warn('No SellerTray tenant mapped to WhatsApp phone number', event.phoneNumberId);
    return;
  }

  const customerPayload: JsonRecord = {
    tenant_id: tenantId,
    wa_id: event.waId,
    phone: event.waId,
  };
  if (event.customerName) customerPayload.display_name = event.customerName;

  const customers = await rest<Array<{ id: string }>>(
    '/rest/v1/customers?on_conflict=tenant_id,wa_id&select=id',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(customerPayload),
    },
  );
  const customerId = customers[0]?.id;
  if (!customerId) throw new Error('Customer upsert returned no row.');

  const storedMessages = await rest<Array<{ id: string }>>(
    '/rest/v1/inbound_messages?on_conflict=provider_message_id&select=id',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        tenant_id: tenantId,
        customer_id: customerId,
        provider_message_id: event.providerMessageId,
        message_type: event.messageType,
        text_body: event.text,
        raw_payload: event.rawMessage,
      }),
    },
  );

  const sourceMessageId = storedMessages[0]?.id;
  if (!sourceMessageId) {
    return; // Meta retry: already ingested, so do not duplicate an order.
  }

  if (!event.text) {
    return; // Media/status handling is intentionally outside the current MVP slice.
  }

  const subscription = await getSubscriptionAccess(tenantId);
  if (subscription.accessMode !== 'full') {
    console.warn(
      'WhatsApp order creation skipped because tenant subscription is read-only',
      tenantId,
      subscription.effectiveStatus ?? 'unknown',
    );
    return;
  }

  const catalogue = await loadCatalogue(tenantId);
  const parsed = await parseOrder(event.text, catalogue);
  const enrichedItems = enrichFromCatalogue(parsed.items, catalogue);
  const reviewReasons = buildReviewReasons(parsed, enrichedItems);

  const createdOrders = await rest<Array<{ id: string }>>('/rest/v1/orders?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      tenant_id: tenantId,
      customer_id: customerId,
      source_message_id: sourceMessageId,
      status: 'needs_review',
      source: 'whatsapp',
      customer_note: event.text,
      parser_confidence: parsed.confidence,
      parser_source: parsed.source,
      parser_version: parsed.version,
      review_reasons: reviewReasons,
      currency: tenant.currency || 'NGN',
    }),
  });

  const orderId = createdOrders[0]?.id;
  if (!orderId) throw new Error('Order insert returned no row.');

  if (enrichedItems.length > 0) {
    await rest('/rest/v1/order_items', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(
        enrichedItems.map((item) => ({
          tenant_id: tenantId,
          order_id: orderId,
          catalog_item_id: item.catalogItemId,
          item_name: item.canonicalName,
          original_item_name: item.originalName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          match_source: item.matchSource,
          match_confidence: item.matchConfidence,
        })),
      ),
    });
  }
}

async function getSubscriptionAccess(tenantId: string): Promise<SubscriptionAccess> {
  const access = await rest<SubscriptionAccess>('/rest/v1/rpc/get_orderdesk_subscription_access', {
    method: 'POST',
    body: JSON.stringify({ p_tenant_id: tenantId }),
  });
  return access ?? {};
}

async function loadCatalogue(tenantId: string): Promise<CatalogueRow[]> {
  return rest<CatalogueRow[]>(
    `/rest/v1/catalog_items?select=id,name,price_ngn,catalog_item_aliases(alias)&tenant_id=eq.${encodeURIComponent(tenantId)}&is_active=eq.true`,
  );
}

function enrichFromCatalogue(parsedItems: ParsedItem[], catalogue: CatalogueRow[]): EnrichedItem[] {
  return parsedItems.map((item) => {
    const match = findCatalogueMatch(item.name, catalogue);
    if (!match) {
      return {
        ...item,
        originalName: item.name,
        catalogItemId: null,
        canonicalName: item.name,
        unitPrice: null,
        matchSource: 'unmatched',
        matchConfidence: 0,
      };
    }

    return {
      ...item,
      originalName: item.name,
      catalogItemId: match.item.id,
      canonicalName: match.item.name,
      unitPrice: toNumber(match.item.price_ngn),
      matchSource: match.source,
      matchConfidence: match.confidence,
    };
  });
}

function findCatalogueMatch(parsedName: string, catalogue: CatalogueRow[]): CatalogueMatch | null {
  const normalizedParsed = normalizePhrase(parsedName);

  for (const item of catalogue) {
    if (normalizedParsed === normalizePhrase(item.name)) {
      return { item, source: 'catalogue_name', confidence: 1 };
    }
  }

  for (const item of catalogue) {
    for (const alias of item.catalog_item_aliases ?? []) {
      if (normalizedParsed === normalizePhrase(alias.alias)) {
        return { item, source: 'catalogue_alias', confidence: 0.99 };
      }
    }
  }

  const variants = phraseVariants(parsedName);
  variants.delete(normalizedParsed);

  for (const item of catalogue) {
    if (variants.has(normalizePhrase(item.name))) {
      return { item, source: 'normalized_name', confidence: 0.95 };
    }
  }

  for (const item of catalogue) {
    for (const alias of item.catalog_item_aliases ?? []) {
      if (variants.has(normalizePhrase(alias.alias))) {
        return { item, source: 'normalized_alias', confidence: 0.94 };
      }
    }
  }

  return null;
}

function phraseVariants(value: string): Set<string> {
  const normalized = normalizePhrase(value);
  const variants = new Set<string>([normalized]);
  const words = normalized.split(' ');

  if (words.length >= 3 && words[1] === 'of' && words[0].endsWith('s') && words[0].length > 2) {
    variants.add([words[0].slice(0, -1), ...words.slice(1)].join(' '));
  }

  return variants;
}

function normalizePhrase(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildReviewReasons(parsed: ParsedOrder, items: EnrichedItem[]): string[] {
  const reasons = new Set<string>();

  if (parsed.items.length === 0) reasons.add('no_items');
  if (parsed.source === 'fallback') reasons.add('fallback_parser');
  if (parsed.confidence < 0.7) reasons.add('low_parser_confidence');
  if (items.some((item) => item.matchSource === 'unmatched')) reasons.add('unmatched_catalogue_item');
  if (items.some((item) => item.unitPrice === null)) reasons.add('missing_price');

  return Array.from(reasons);
}

async function parseOrder(text: string, catalogue: CatalogueRow[]): Promise<ParsedOrder> {
  if (ORDER_PARSER_URL && ORDER_PARSER_TOKEN) {
    try {
      const response = await fetch(ORDER_PARSER_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ORDER_PARSER_TOKEN}`,
        },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          text,
          catalogue: catalogue.map((item) => ({
            id: item.id,
            name: item.name,
            aliases: (item.catalog_item_aliases ?? []).map((alias) => alias.alias),
          })),
        }),
      });

      if (response.ok) {
        const candidate = await response.json();
        const validated = validateParsedOrder(candidate);
        if (validated) {
          return {
            ...validated,
            source: 'external',
            version: 'external-v2-catalogue',
          };
        }
        console.warn('External order parser returned an invalid structured payload; using fallback parser.');
      } else {
        console.warn(`External order parser returned HTTP ${response.status}; using fallback parser.`);
      }
    } catch (error) {
      console.warn('External order parser unavailable; using fallback parser.', error);
    }
  }

  return fallbackParseOrder(text);
}

function fallbackParseOrder(text: string): ParsedOrder {
  const segments = text
    .split(/\n|,|\band\b/gi)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(please|same address|deliver|delivery|thanks|thank you)\b/i.test(part));

  const items: ParsedItem[] = [];
  for (const segment of segments) {
    const match = segment.match(/^(?:i\s+(?:need|want)\s+)?(\d+(?:\.\d+)?)\s*(?:x|×)?\s+(.+)$/i);
    if (!match) continue;
    const quantity = Number(match[1]);
    const name = match[2]?.replace(/[.!]+$/, '').trim();
    if (!name || !Number.isFinite(quantity) || quantity <= 0) continue;
    items.push({ name, quantity });
  }

  return {
    items,
    confidence: items.length > 0 ? 0.4 : 0.1,
    source: 'fallback',
    version: 'fallback-v1',
  };
}

function validateParsedOrder(value: unknown): ParsedPayload | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;

  const items: ParsedItem[] = [];
  for (const rawItem of value.items) {
    if (!isRecord(rawItem)) return null;
    const name = asString(rawItem.name);
    const quantity = typeof rawItem.quantity === 'number' ? rawItem.quantity : Number(rawItem.quantity);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) return null;
    items.push({ name, quantity });
  }

  const rawConfidence = typeof value.confidence === 'number' ? value.confidence : Number(value.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(1, Math.max(0, rawConfidence))
    : 0.5;

  return { items, confidence };
}

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase REST ${response.status}: ${detail}`);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

