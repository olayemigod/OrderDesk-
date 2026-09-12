import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { handleCustomerPaymentSelfService } from './payment.ts';

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

type ParserAttemptTelemetry = {
  model: string | null;
  outcome: 'success' | 'provider_error' | 'invalid_output' | 'network_error';
  providerHttpStatus: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
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

type ReceiptCandidateOrder = {
  id: string;
  fulfillment_method: 'merchant_delivery' | 'third_party_delivery' | null;
  fulfillment_status: 'out_for_delivery' | string;
};

type CustomerSupportOrder = {
  id: string;
  customer_id: string;
  public_order_id: string;
  receipt_storage_path: string | null;
  receipt_generated_at: string | null;
  receipt_version: number | string;
  status: string;
  currency: string;
  total_amount: number | string | null;
  created_at: string;
  fulfillment_method: string | null;
  fulfillment_status: string;
  fulfillment_confirmed_by: string | null;
  delivery_provider: string | null;
  delivery_reference: string | null;
  order_items: Array<{
    item_name: string;
    quantity: number | string;
    unit_price: number | string | null;
    line_total: number | string;
  }> | null;
};

type CustomerSupportIntent = 'status' | 'receipt';

type ReceiptAttachment = {
  mediaType: 'document';
  storageBucket: 'receipts';
  storagePath: string;
  filename: string;
  mimeType: 'application/pdf';
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
const AI_CATALOGUE_CONTEXT_LIMIT = 160;
const AI_ALIAS_CONTEXT_LIMIT = 6;

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
  const tenants = await rest<Array<{ id: string; currency: string | null; name: string }>>(
    `/rest/v1/tenants?select=id,currency,name&whatsapp_phone_number_id=eq.${encodeURIComponent(event.phoneNumberId)}&limit=1`,
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

  if (await maybeConfirmCustomerReceipt({
    tenantId,
    customerId,
    customerWaId: event.waId,
    sourceMessageId,
    text: event.text,
  })) {
    return;
  }

  if (await handleCustomerPaymentSelfService({
    tenantId,
    businessName: tenant.name,
    customerId,
    customerWaId: event.waId,
    sourceMessageId,
    fromPhoneNumberId: event.phoneNumberId,
    text: event.text,
  })) {
    return;
  }

  if (await maybeHandleCustomerSelfService({
    tenantId,
    businessName: tenant.name,
    customerName: event.customerName,
    customerId,
    customerWaId: event.waId,
    sourceMessageId,
    fromPhoneNumberId: event.phoneNumberId,
    text: event.text,
  })) {
    return;
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
  const parsed = await parseOrder(event.text, catalogue, tenantId, sourceMessageId);
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

function selectParserCatalogue(
  text: string,
  catalogue: CatalogueRow[],
): {
  items: Array<{ id: string; name: string; aliases: string[] }>;
  totalItems: number;
  aliasesSent: number;
} {
  const normalizedText = normalizePhrase(text);
  const messageTokens = new Set(
    normalizedText.split(' ').filter((token) => token.length >= 2),
  );

  const ranked = catalogue.map((item, index) => ({
    item,
    index,
    score: catalogueContextScore(normalizedText, messageTokens, item),
  }));

  if (ranked.length > AI_CATALOGUE_CONTEXT_LIMIT) {
    ranked.sort((left, right) => right.score - left.score || left.index - right.index);
    ranked.length = AI_CATALOGUE_CONTEXT_LIMIT;
  }

  let aliasesSent = 0;
  const items = ranked.map(({ item }) => {
    const aliases = (item.catalog_item_aliases ?? [])
      .map((alias) => alias.alias)
      .filter(Boolean)
      .slice(0, AI_ALIAS_CONTEXT_LIMIT);
    aliasesSent += aliases.length;
    return { id: item.id, name: item.name, aliases };
  });

  return {
    items,
    totalItems: catalogue.length,
    aliasesSent,
  };
}

function catalogueContextScore(
  normalizedText: string,
  messageTokens: Set<string>,
  item: CatalogueRow,
): number {
  let best = phraseContextScore(normalizedText, messageTokens, item.name);
  for (const alias of item.catalog_item_aliases ?? []) {
    best = Math.max(best, phraseContextScore(normalizedText, messageTokens, alias.alias));
  }
  return best;
}

function phraseContextScore(
  normalizedText: string,
  messageTokens: Set<string>,
  value: string,
): number {
  const phrase = normalizePhrase(value);
  if (!phrase) return 0;
  if (normalizedText.includes(phrase)) return 100 + Math.min(20, phrase.length / 5);

  const phraseTokens = phrase.split(' ').filter(Boolean);
  const tokenMatches = phraseTokens.filter((token) => messageTokens.has(token)).length;
  const tokenScore = phraseTokens.length > 0 ? (tokenMatches / phraseTokens.length) * 30 : 0;
  const bigramScore = diceCoefficient(normalizedText, phrase) * 20;
  return tokenScore + bigramScore;
}

function diceCoefficient(left: string, right: string): number {
  const leftBigrams = stringBigrams(left);
  const rightBigrams = stringBigrams(right);
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0;

  let intersection = 0;
  for (const value of leftBigrams) {
    if (rightBigrams.has(value)) intersection += 1;
  }
  return (2 * intersection) / (leftBigrams.size + rightBigrams.size);
}

function stringBigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, ' ').trim();
  const result = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    result.add(compact.slice(index, index + 2));
  }
  return result;
}

async function parseOrder(
  text: string,
  catalogue: CatalogueRow[],
  tenantId: string,
  sourceMessageId: string,
): Promise<ParsedOrder> {
  if (ORDER_PARSER_URL && ORDER_PARSER_TOKEN) {
    const parserCatalogue = selectParserCatalogue(text, catalogue);
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
          catalogue: parserCatalogue.items,
        }),
      });

      const responseTelemetry = parserAttemptTelemetryFromHeaders(response.headers, response.status);

      if (response.ok) {
        const candidate = await response.json();
        const validated = validateParsedOrder(candidate);
        if (validated) {
          await recordParserAttempt(tenantId, sourceMessageId, parserCatalogue, {
            ...responseTelemetry,
            outcome: 'success',
          });
          return {
            ...validated,
            source: 'external',
            version: 'external-v3-cost-telemetry',
          };
        }

        await recordParserAttempt(tenantId, sourceMessageId, parserCatalogue, {
          ...responseTelemetry,
          outcome: 'invalid_output',
        });
        console.warn('External order parser returned an invalid structured payload; using fallback parser.');
      } else {
        await recordParserAttempt(tenantId, sourceMessageId, responseTelemetry);
        console.warn(`External order parser returned HTTP ${response.status}; using fallback parser.`);
      }
    } catch (error) {
      await recordParserAttempt(tenantId, sourceMessageId, parserCatalogue, {
        model: null,
        outcome: 'network_error',
        providerHttpStatus: null,
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      });
      console.warn('External order parser unavailable; using fallback parser.', error);
    }
  }

  return fallbackParseOrder(text);
}

function parserAttemptTelemetryFromHeaders(
  headers: Headers,
  responseStatus: number,
): ParserAttemptTelemetry {
  const outcomeValue = headers.get('x-sellertray-ai-outcome');
  const outcome: ParserAttemptTelemetry['outcome'] =
    outcomeValue === 'success' ||
      outcomeValue === 'provider_error' ||
      outcomeValue === 'invalid_output' ||
      outcomeValue === 'network_error'
      ? outcomeValue
      : responseStatus >= 200 && responseStatus < 300
        ? 'success'
        : 'provider_error';

  return {
    model: headerString(headers, 'x-sellertray-ai-model'),
    outcome,
    providerHttpStatus: headerNonNegativeInteger(headers, 'x-sellertray-ai-provider-status') ?? responseStatus,
    inputTokens: headerNonNegativeInteger(headers, 'x-sellertray-ai-input-tokens'),
    cachedInputTokens: headerNonNegativeInteger(headers, 'x-sellertray-ai-cached-input-tokens'),
    outputTokens: headerNonNegativeInteger(headers, 'x-sellertray-ai-output-tokens'),
    reasoningTokens: headerNonNegativeInteger(headers, 'x-sellertray-ai-reasoning-tokens'),
    totalTokens: headerNonNegativeInteger(headers, 'x-sellertray-ai-total-tokens'),
  };
}

async function recordParserAttempt(
  tenantId: string,
  sourceMessageId: string,
  parserCatalogue: {
    items: Array<{ id: string; name: string; aliases: string[] }>;
    totalItems: number;
    aliasesSent: number;
  },
  telemetry: ParserAttemptTelemetry,
): Promise<void> {
  try {
    await rest(
      '/rest/v1/ai_parser_attempts?on_conflict=source_message_id,provider',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({
          tenant_id: tenantId,
          source_message_id: sourceMessageId,
          provider: 'openai',
          model: telemetry.model,
          outcome: telemetry.outcome,
          provider_http_status: telemetry.providerHttpStatus,
          input_tokens: telemetry.inputTokens,
          cached_input_tokens: telemetry.cachedInputTokens,
          output_tokens: telemetry.outputTokens,
          reasoning_tokens: telemetry.reasoningTokens,
          total_tokens: telemetry.totalTokens,
          catalogue_items_total: parserCatalogue.totalItems,
          catalogue_items_sent: parserCatalogue.items.length,
          catalogue_aliases_sent: parserCatalogue.aliasesSent,
        }),
      },
    );
  } catch (error) {
    console.warn('SellerTray AI parser telemetry could not be persisted.', error);
  }
}

function headerString(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.trim() ?? '';
  return value ? value.slice(0, 120) : null;
}

function headerNonNegativeInteger(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
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

function detectCustomerSupportIntent(value: string): CustomerSupportIntent | null {
  const normalized = value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const hasOrderId = /\b[A-Z0-9]{3}\/[0-9]{6,}\b/i.test(value);
  const onlyOrderId = /^[A-Z0-9]{3}\/[0-9]{6,}$/i.test(value.trim());

  if (/\breceipt\b/i.test(normalized) || /\bproof of purchase\b/i.test(normalized)) return 'receipt';

  if (onlyOrderId) return 'status';

  if (
    /\b(track|tracking|status)\b/i.test(normalized) ||
    /\bwhere\s+(?:is|are)\s+(?:my\s+)?order\b/i.test(normalized) ||
    /\bwhat(?:'s| is)\s+happening\s+with\s+(?:my\s+)?order\b/i.test(normalized) ||
    /\border\s+(?:id|number|no)\b/i.test(normalized) ||
    /\b(?:last|latest|recent)\s+order\b/i.test(normalized) ||
    (hasOrderId && /\border\b/i.test(normalized))
  ) {
    return 'status';
  }

  return null;
}

function extractPublicOrderId(value: string): string | null {
  const match = value.match(/\b[A-Z0-9]{3}\/[0-9]{6,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

async function resolveCustomerIdsForWhatsApp(
  tenantId: string,
  customerId: string,
  customerWaId: string,
): Promise<string[]> {
  const possibleCustomers = await rest<Array<{ id: string }>>(
    '/rest/v1/customers?select=id' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&or=(wa_id.eq.' + encodeURIComponent(customerWaId) +
      ',phone.eq.' + encodeURIComponent(customerWaId) +
      ',phone.eq.' + encodeURIComponent('+' + customerWaId) +
      ',wa_id.eq.' + encodeURIComponent('manual:' + customerWaId) +
      ',wa_id.eq.' + encodeURIComponent('manual:+' + customerWaId) + ')' +
      '&limit=20',
  );

  return [...new Set([customerId, ...possibleCustomers.map((row) => row.id)])];
}

async function maybeHandleCustomerSelfService({
  tenantId,
  businessName,
  customerName,
  customerId,
  customerWaId,
  sourceMessageId,
  fromPhoneNumberId,
  text,
}: {
  tenantId: string;
  businessName: string;
  customerName: string | null;
  customerId: string;
  customerWaId: string;
  sourceMessageId: string;
  fromPhoneNumberId: string;
  text: string;
}): Promise<boolean> {
  const intent = detectCustomerSupportIntent(text);
  if (!intent) return false;

  const customerIds = await resolveCustomerIdsForWhatsApp(tenantId, customerId, customerWaId);
  const explicitOrderId = extractPublicOrderId(text);
  const selected = await findCustomerSupportOrder({
    tenantId,
    customerIds,
    publicOrderId: explicitOrderId,
    completedOnly: false,
  });

  if (!selected) {
    console.info(JSON.stringify({
      event: 'customer_self_service_no_order',
      tenantId,
      intent,
      explicitOrderId,
    }));
    return true;
  }

  if (intent === 'receipt' && selected.status !== 'completed') {
    await queueCustomerSupportReply({
      tenantId,
      order: selected,
      sourceMessageId,
      fromPhoneNumberId,
      toWaId: customerWaId,
      eventKey: 'order_status_reply',
      messageBody: `Order ${selected.public_order_id} is currently ${humanOrderStatus(selected)}. A receipt is available after the order is completed.`,
    });
    return true;
  }

  let attachment: ReceiptAttachment | null = null;
  let messageBody = renderOrderStatus(businessName, selected);

  if (intent === 'receipt') {
    try {
      attachment = await ensureReceiptPdf({
        tenantId,
        businessName,
        customerName,
        customerWaId,
        order: selected,
      });
      messageBody =
        `Your PDF receipt for order ${selected.public_order_id} is attached. Total: ` +
        formatReceiptMoney(calculateSupportOrderTotal(selected), selected.currency);
    } catch (error) {
      console.error('SellerTray PDF receipt generation failed; sending text fallback.', error);
      messageBody = renderOrderReceipt(businessName, selected);
    }
  }

  await queueCustomerSupportReply({
    tenantId,
    order: selected,
    sourceMessageId,
    fromPhoneNumberId,
    toWaId: customerWaId,
    eventKey: intent === 'receipt' ? 'order_receipt' : 'order_status_reply',
    messageBody,
    attachment,
  });

  return true;
}

async function findCustomerSupportOrder({
  tenantId,
  customerIds,
  publicOrderId,
  completedOnly,
}: {
  tenantId: string;
  customerIds: string[];
  publicOrderId: string | null;
  completedOnly: boolean;
}): Promise<CustomerSupportOrder | null> {
  if (customerIds.length === 0) return null;

  let path =
    '/rest/v1/orders?select=id,customer_id,public_order_id,receipt_storage_path,receipt_generated_at,receipt_version,status,currency,total_amount,created_at,fulfillment_method,fulfillment_status,fulfillment_confirmed_by,delivery_provider,delivery_reference,order_items(item_name,quantity,unit_price,line_total)' +
    '&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&customer_id=in.(' + customerIds.join(',') + ')';

  if (publicOrderId) {
    path += '&public_order_id=eq.' + encodeURIComponent(publicOrderId);
  } else if (completedOnly) {
    path += '&status=eq.completed';
  }

  path += '&order=created_at.desc&limit=1';
  const rows = await rest<CustomerSupportOrder[]>(path);
  return rows[0] ?? null;
}

async function queueCustomerSupportReply({
  tenantId,
  order,
  sourceMessageId,
  fromPhoneNumberId,
  toWaId,
  eventKey,
  messageBody,
  attachment = null,
}: {
  tenantId: string;
  order: CustomerSupportOrder;
  sourceMessageId: string;
  fromPhoneNumberId: string;
  toWaId: string;
  eventKey: 'order_status_reply' | 'order_receipt';
  messageBody: string;
  attachment?: ReceiptAttachment | null;
}): Promise<void> {
  await rest('/rest/v1/outbound_notifications', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      tenant_id: tenantId,
      order_id: order.id,
      customer_id: order.customer_id,
      source_inbound_message_id: sourceMessageId,
      event_key: eventKey,
      delivery_status: 'pending',
      from_phone_number_id: fromPhoneNumberId,
      to_wa_id: toWaId,
      message_body: messageBody.slice(0, 2000),
      media_type: attachment?.mediaType ?? null,
      storage_bucket: attachment?.storageBucket ?? null,
      storage_path: attachment?.storagePath ?? null,
      media_filename: attachment?.filename ?? null,
      media_mime_type: attachment?.mimeType ?? null,
      conversation_window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
}

async function ensureReceiptPdf({
  tenantId,
  businessName,
  customerName,
  customerWaId,
  order,
}: {
  tenantId: string;
  businessName: string;
  customerName: string | null;
  customerWaId: string;
  order: CustomerSupportOrder;
}): Promise<ReceiptAttachment> {
  const version = Math.max(1, Number(order.receipt_version) || 1);
  const filename = `Receipt-${order.public_order_id.replace('/', '-')}.pdf`;
  const storagePath = `${tenantId}/${order.public_order_id.replace('/', '-')}/receipt-v${version}.pdf`;
  const cachedPath = order.receipt_storage_path?.trim();

  if (cachedPath === storagePath) {
    return {
      mediaType: 'document',
      storageBucket: 'receipts',
      storagePath,
      filename,
      mimeType: 'application/pdf',
    };
  }
  const pdfBytes = await buildReceiptPdf({
    businessName,
    customerName,
    customerWaId,
    order,
  });

  if (pdfBytes.byteLength > 2_097_152) {
    throw new Error('Generated receipt exceeds the SellerTray 2 MB receipt limit.');
  }

  await uploadPrivateReceipt(storagePath, pdfBytes);

  const generatedAt = new Date().toISOString();
  await rest(
    '/rest/v1/orders?id=eq.' + encodeURIComponent(order.id) +
      '&tenant_id=eq.' + encodeURIComponent(tenantId),
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        receipt_storage_path: storagePath,
        receipt_generated_at: generatedAt,
        receipt_version: version,
        updated_at: generatedAt,
      }),
    },
  );

  order.receipt_storage_path = storagePath;
  order.receipt_generated_at = generatedAt;

  return {
    mediaType: 'document',
    storageBucket: 'receipts',
    storagePath,
    filename,
    mimeType: 'application/pdf',
  };
}

async function uploadPrivateReceipt(storagePath: string, pdfBytes: Uint8Array): Promise<void> {
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/receipts/${encodedPath}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/pdf',
      'cache-control': '3600',
      'x-upsert': 'true',
    },
    body: pdfBytes,
  });

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`Receipt storage upload failed (${response.status}): ${detail}`);
  }
}

async function buildReceiptPdf({
  businessName,
  customerName,
  customerWaId,
  order,
}: {
  businessName: string;
  customerName: string | null;
  customerWaId: string;
  order: CustomerSupportOrder;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(0 / 255, 86 / 255, 166 / 255);
  const green = rgb(28 / 255, 156 / 255, 93 / 255);
  const dark = rgb(16 / 255, 24 / 255, 40 / 255);
  const muted = rgb(102 / 255, 112 / 255, 133 / 255);
  const line = rgb(234 / 255, 236 / 255, 240 / 255);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 44;
  const bottomMargin = 52;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 48;

  const drawText = (
    value: string,
    x: number,
    size: number,
    font = regular,
    color = dark,
  ) => {
    page.drawText(pdfSafeText(value), { x, y, size, font, color });
  };

  const nextLine = (amount: number) => {
    y -= amount;
  };

  const ensureSpace = (required: number) => {
    if (y - required >= bottomMargin) return;
    drawReceiptFooter(page, regular, muted, pageWidth);
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - 48;
    page.drawText(pdfSafeText(`${businessName} - Receipt ${order.public_order_id}`), {
      x: margin,
      y,
      size: 10,
      font: bold,
      color: blue,
    });
    y -= 28;
  };

  page.drawRectangle({
    x: 0,
    y: pageHeight - 10,
    width: pageWidth,
    height: 10,
    color: blue,
  });

  drawText(businessName, margin, 20, bold, dark);
  nextLine(25);
  drawText('ORDER RECEIPT', margin, 11, bold, blue);
  nextLine(18);
  drawText('SellerTray', margin, 9, bold, green);

  const rightX = 340;
  page.drawText(pdfSafeText('Receipt Ref'), { x: rightX, y: pageHeight - 52, size: 8, font: bold, color: muted });
  page.drawText(pdfSafeText(order.public_order_id), { x: rightX, y: pageHeight - 68, size: 11, font: bold, color: dark });
  page.drawText(pdfSafeText('Order date'), { x: rightX, y: pageHeight - 88, size: 8, font: bold, color: muted });
  page.drawText(pdfSafeText(formatReceiptDate(order.created_at)), { x: rightX, y: pageHeight - 104, size: 10, font: regular, color: dark });

  y = pageHeight - 145;
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1, color: line });
  nextLine(22);

  drawText('CUSTOMER', margin, 8, bold, muted);
  nextLine(15);
  drawText(customerName || 'WhatsApp customer', margin, 11, bold, dark);
  nextLine(16);
  drawText(customerWaId, margin, 9, regular, muted);
  nextLine(28);

  ensureSpace(100);
  drawText('ITEMS', margin, 8, bold, muted);
  nextLine(18);

  const columns = { item: margin, qty: 330, unit: 380, amount: 470 };
  drawText('Description', columns.item, 8, bold, muted);
  page.drawText('Qty', { x: columns.qty, y, size: 8, font: bold, color: muted });
  page.drawText('Unit', { x: columns.unit, y, size: 8, font: bold, color: muted });
  page.drawText('Amount', { x: columns.amount, y, size: 8, font: bold, color: muted });
  nextLine(10);
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.8, color: line });
  nextLine(18);

  const items = order.order_items ?? [];
  for (const item of items.slice(0, 50)) {
    ensureSpace(48);
    const qty = Number(item.quantity) || 0;
    const unit = Number(item.unit_price);
    const lineTotal = Number(item.line_total);
    const descriptionLines = wrapPdfText(pdfSafeText(item.item_name), 43);

    page.drawText(descriptionLines[0] || 'Item', { x: columns.item, y, size: 9, font: regular, color: dark });
    if (descriptionLines[1]) {
      page.drawText(descriptionLines[1], { x: columns.item, y: y - 12, size: 9, font: regular, color: dark });
    }
    page.drawText(String(qty), { x: columns.qty, y, size: 9, font: regular, color: dark });
    page.drawText(
      Number.isFinite(unit) ? formatReceiptMoneyPdf(unit, order.currency) : '-',
      { x: columns.unit, y, size: 8, font: regular, color: dark },
    );
    page.drawText(
      formatReceiptMoneyPdf(Number.isFinite(lineTotal) ? lineTotal : 0, order.currency),
      { x: columns.amount, y, size: 8, font: bold, color: dark },
    );
    nextLine(descriptionLines[1] ? 32 : 22);
  }

  if (items.length > 50) {
    ensureSpace(30);
    drawText(`Additional item lines: ${items.length - 50}`, margin, 9, regular, muted);
    nextLine(20);
  }

  ensureSpace(150);
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1, color: line });
  nextLine(25);

  const total = calculateSupportOrderTotal(order);
  page.drawText('TOTAL', { x: 375, y, size: 10, font: bold, color: dark });
  page.drawText(formatReceiptMoneyPdf(total, order.currency), { x: 450, y, size: 12, font: bold, color: blue });
  nextLine(36);

  drawText('Order status', margin, 8, bold, muted);
  nextLine(14);
  drawText(humanOrderStatus(order), margin, 10, bold, dark);
  nextLine(22);

  const fulfillment = humanFulfillment(order);
  if (fulfillment) {
    drawText('Fulfillment', margin, 8, bold, muted);
    nextLine(14);
    for (const row of wrapPdfText(pdfSafeText(fulfillment), 78)) {
      drawText(row, margin, 9, regular, dark);
      nextLine(13);
    }
    nextLine(8);
  }

  if (order.fulfillment_confirmed_by === 'customer_whatsapp') {
    drawText('Customer confirmed receipt on WhatsApp.', margin, 9, bold, green);
    nextLine(20);
  }

  drawText('Thank you for your order.', margin, 10, bold, dark);
  drawReceiptFooter(page, regular, muted, pageWidth);

  return await pdf.save();
}

function drawReceiptFooter(
  page: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  color: ReturnType<typeof rgb>,
  pageWidth: number,
): void {
  page.drawText('Generated by SellerTray - Smart order management by ProcessEdge Solutions Limited', {
    x: 44,
    y: 26,
    size: 7,
    font,
    color,
  });
  page.drawLine({
    start: { x: 44, y: 38 },
    end: { x: pageWidth - 44, y: 38 },
    thickness: 0.5,
    color: rgb(234 / 255, 236 / 255, 240 / 255),
  });
}

function wrapPdfText(value: string, maxChars: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.slice(0, maxChars);
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function pdfSafeText(value: string): string {
  return value
    .replace(/₦/g, 'NGN ')
    .replace(/×/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .normalize('NFKD')
    .replace(/[^ -~ -ÿ]/g, '?');
}

function formatReceiptMoneyPdf(value: number, currency: string): string {
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'NGN';
  return `${safeCurrency} ${new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function renderOrderStatus(businessName: string, order: CustomerSupportOrder): string {
  const total = calculateSupportOrderTotal(order);
  const lines = [
    `Order status — ${businessName}`,
    `Order Ref: ${order.public_order_id}`,
    `Status: ${humanOrderStatus(order)}`,
    `Order date: ${formatReceiptDate(order.created_at)}`,
    `Total: ${formatReceiptMoney(total, order.currency)}`,
  ];

  if (order.delivery_provider) lines.push(`Delivery by: ${order.delivery_provider}`);
  if (order.delivery_reference) lines.push(`Delivery ref/phone: ${order.delivery_reference}`);

  if (order.fulfillment_status === 'out_for_delivery') {
    lines.push('When it arrives, reply RECEIVED to confirm receipt.');
  } else {
    lines.push(`You can ask "receipt ${order.public_order_id}" when you need the receipt.`);
  }

  return lines.join('\n');
}

function renderOrderReceipt(businessName: string, order: CustomerSupportOrder): string {
  const items = order.order_items ?? [];
  const total = calculateSupportOrderTotal(order);
  const fulfillment = humanFulfillment(order);

  const lines = [
    `🧾 ${businessName}`,
    'ORDER RECEIPT',
    `Order Ref: ${order.public_order_id}`,
    `Date: ${formatReceiptDate(order.created_at)}`,
    '',
    'Items:',
  ];

  if (items.length === 0) {
    lines.push('- Order items unavailable');
  } else {
    const visibleItems = items.slice(0, 20);
    visibleItems.forEach((item, index) => {
      const quantity = Number(item.quantity) || 0;
      const lineTotal = Number(item.line_total);
      lines.push(
        `${index + 1}. ${quantity} × ${item.item_name} — ${formatReceiptMoney(Number.isFinite(lineTotal) ? lineTotal : 0, order.currency)}`,
      );
    });
    if (items.length > visibleItems.length) {
      lines.push(`… plus ${items.length - visibleItems.length} more item line(s)`);
    }
  }

  lines.push('');
  lines.push(`Total: ${formatReceiptMoney(total, order.currency)}`);
  lines.push(`Order status: ${humanOrderStatus(order)}`);
  if (fulfillment) lines.push(`Fulfillment: ${fulfillment}`);
  if (order.fulfillment_confirmed_by === 'customer_whatsapp') {
    lines.push('Receipt of order confirmed by customer on WhatsApp.');
  }
  lines.push('');
  lines.push('Thank you for your order.');

  return lines.join('\n');
}

function calculateSupportOrderTotal(order: CustomerSupportOrder): number {
  const stored = Number(order.total_amount);
  if (Number.isFinite(stored) && stored >= 0) return stored;

  return (order.order_items ?? []).reduce((sum, item) => {
    const lineTotal = Number(item.line_total);
    return sum + (Number.isFinite(lineTotal) ? lineTotal : 0);
  }, 0);
}

function formatReceiptMoney(value: number, currency: string): string {
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'NGN';
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${safeCurrency} ${value.toFixed(2)}`;
  }
}

function formatReceiptDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  }).format(date);
}

function humanOrderStatus(order: CustomerSupportOrder): string {
  if (order.status === 'completed') {
    if (order.fulfillment_status === 'delivered') return 'Delivered / completed';
    if (order.fulfillment_status === 'collected') return 'Collected / completed';
    return 'Completed';
  }
  if (order.fulfillment_status === 'out_for_delivery') return 'Out for delivery';
  if (order.status === 'needs_review') return 'Received — awaiting merchant review';
  if (order.status === 'accepted') return 'Accepted';
  if (order.status === 'processing') return 'Processing';
  if (order.status === 'ready') return 'Ready';
  if (order.status === 'rejected') return 'Rejected';
  if (order.status === 'cancelled') return 'Cancelled';
  return order.status.replace(/_/g, ' ');
}

function humanFulfillment(order: CustomerSupportOrder): string | null {
  if (order.fulfillment_method === 'customer_pickup') return 'Customer pickup';
  if (order.fulfillment_method === 'merchant_delivery') {
    return order.delivery_provider
      ? `Merchant delivery — ${order.delivery_provider}`
      : 'Merchant / own rider';
  }
  if (order.fulfillment_method === 'third_party_delivery') {
    return order.delivery_provider
      ? `Third-party dispatch — ${order.delivery_provider}`
      : 'Third-party dispatch';
  }
  return null;
}

function isReceiptConfirmationText(value: string): boolean {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');

  return new Set([
    'received',
    'order received',
    'received thanks',
    'received thank you',
    'i received it',
    'i have received it',
    'got it',
    'i got it',
  ]).has(normalized);
}

async function maybeConfirmCustomerReceipt({
  tenantId,
  customerId,
  customerWaId,
  sourceMessageId,
  text,
}: {
  tenantId: string;
  customerId: string;
  customerWaId: string;
  sourceMessageId: string;
  text: string;
}): Promise<boolean> {
  if (!isReceiptConfirmationText(text)) return false;

  const possibleCustomers = await rest<Array<{ id: string }>>(
    '/rest/v1/customers?select=id' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&or=(wa_id.eq.' + encodeURIComponent(customerWaId) +
      ',phone.eq.' + encodeURIComponent(customerWaId) +
      ',phone.eq.' + encodeURIComponent('+' + customerWaId) +
      ',wa_id.eq.' + encodeURIComponent('manual:' + customerWaId) + ')' +
      '&limit=10',
  );

  const customerIds = [...new Set([customerId, ...possibleCustomers.map((row) => row.id)])];
  const candidateFilter = customerIds.join(',');

  const candidates = await rest<ReceiptCandidateOrder[]>(
    '/rest/v1/orders?select=id,fulfillment_method,fulfillment_status' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&customer_id=in.(' + candidateFilter + ')' +
      '&status=eq.ready' +
      '&fulfillment_status=eq.out_for_delivery' +
      '&order=updated_at.desc' +
      '&limit=2',
  );

  if (candidates.length !== 1) {
    console.info(JSON.stringify({
      event: 'customer_receipt_confirmation_ignored',
      tenantId,
      reason: candidates.length === 0 ? 'no_out_for_delivery_order' : 'ambiguous_out_for_delivery_orders',
      candidateCount: candidates.length,
    }));
    return true;
  }

  const order = candidates[0];
  if (!order.fulfillment_method) {
    console.info(JSON.stringify({
      event: 'customer_receipt_confirmation_ignored',
      tenantId,
      orderId: order.id,
      reason: 'missing_fulfillment_method',
    }));
    return true;
  }

  const confirmedAt = new Date().toISOString();
  const updated = await rest<Array<{ id: string }>>(
    '/rest/v1/orders?id=eq.' + encodeURIComponent(order.id) +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&status=eq.ready' +
      '&fulfillment_status=eq.out_for_delivery' +
      '&select=id',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'completed',
        status_reason: null,
        fulfillment_status: 'delivered',
        fulfilled_at: confirmedAt,
        fulfillment_confirmed_by: 'customer_whatsapp',
        customer_confirmed_at: confirmedAt,
        customer_confirmation_message_id: sourceMessageId,
        updated_at: confirmedAt,
      }),
    },
  );

  if (updated.length === 1) {
    console.info(JSON.stringify({
      event: 'customer_receipt_confirmed',
      tenantId,
      orderId: order.id,
      channel: 'whatsapp',
    }));
  }

  return true;
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

