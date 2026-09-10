type ParsedItem = {
  name: string;
  quantity: number;
};

type ParsedOrder = {
  items: ParsedItem[];
  confidence: number;
};

type CatalogueRow = {
  id: string;
  name: string;
  price_ngn: number | string | null;
  catalog_item_aliases: Array<{ alias: string }> | null;
};

type EnrichedItem = ParsedItem & {
  catalogItemId: string | null;
  canonicalName: string;
  unitPrice: number | null;
};

type JsonRecord = Record<string, unknown>;

const encoder = new TextEncoder();
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const META_VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? '';
const META_APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const ORDER_PARSER_URL = Deno.env.get('ORDER_PARSER_URL') ?? '';
const ORDER_PARSER_TOKEN = Deno.env.get('ORDER_PARSER_TOKEN') ?? '';

Deno.serve(async (request) => {
  if (request.method === 'GET') {
    return verifyWebhookSubscription(request);
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !META_APP_SECRET) {
    console.error('OrderDesk webhook is missing required server secrets.');
    return new Response('Server configuration error', { status: 500 });
  }

  const rawBody = await request.text();
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
});

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
    console.warn('No OrderDesk tenant mapped to WhatsApp phone number', event.phoneNumberId);
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

  const parsed = await parseOrder(event.text);
  const enrichedItems = await enrichFromCatalogue(tenantId, parsed.items);

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
          quantity: item.quantity,
          unit_price: item.unitPrice,
        })),
      ),
    });
  }
}

async function enrichFromCatalogue(tenantId: string, parsedItems: ParsedItem[]): Promise<EnrichedItem[]> {
  if (parsedItems.length === 0) return [];

  const rows = await rest<CatalogueRow[]>(
    `/rest/v1/catalog_items?select=id,name,price_ngn,catalog_item_aliases(alias)&tenant_id=eq.${encodeURIComponent(tenantId)}&is_active=eq.true`,
  );

  return parsedItems.map((item) => {
    const match = findCatalogueMatch(item.name, rows);
    if (!match) {
      return {
        ...item,
        catalogItemId: null,
        canonicalName: item.name,
        unitPrice: null,
      };
    }

    return {
      ...item,
      catalogItemId: match.id,
      canonicalName: match.name,
      unitPrice: toNumber(match.price_ngn),
    };
  });
}

function findCatalogueMatch(parsedName: string, catalogue: CatalogueRow[]): CatalogueRow | null {
  const parsedVariants = phraseVariants(parsedName);

  // Canonical product names take precedence over aliases.
  for (const item of catalogue) {
    const canonical = normalizePhrase(item.name);
    if (parsedVariants.has(canonical)) return item;
  }

  for (const item of catalogue) {
    for (const alias of item.catalog_item_aliases ?? []) {
      if (parsedVariants.has(normalizePhrase(alias.alias))) return item;
    }
  }

  return null;
}

function phraseVariants(value: string): Set<string> {
  const normalized = normalizePhrase(value);
  const variants = new Set<string>([normalized]);
  const words = normalized.split(' ');

  // Common WhatsApp quantity phrases vary only by plural container:
  // "bags of rice" ↔ "bag of rice", "bottles of oil" ↔ "bottle of oil".
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

async function parseOrder(text: string): Promise<ParsedOrder> {
  if (ORDER_PARSER_URL) {
    try {
      const response = await fetch(ORDER_PARSER_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(ORDER_PARSER_TOKEN ? { authorization: `Bearer ${ORDER_PARSER_TOKEN}` } : {}),
        },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        const candidate = await response.json();
        const validated = validateParsedOrder(candidate);
        if (validated) return validated;
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
  };
}

function validateParsedOrder(value: unknown): ParsedOrder | null {
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
