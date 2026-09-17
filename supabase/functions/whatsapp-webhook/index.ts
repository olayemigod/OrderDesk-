import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { handleCustomerPaymentSelfService } from './payment.ts';
import {
  normalizeIntentText,
  resolveConversationIntent,
  type ConversationIntent,
  type IntentDecision,
  type IntentEnquiryContext,
  type IntentOrderContext,
  type VocabularyEntry,
} from './intent.ts';

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
const ORDER_PARSER_AUTH_TOKEN = ORDER_PARSER_TOKEN || SERVICE_ROLE_KEY;
const AI_CATALOGUE_CONTEXT_LIMIT = 160;
const AI_ALIAS_CONTEXT_LIMIT = 6;
const AI_CUSTOMER_MINUTE_LIMIT = boundedEnvInt('AI_CUSTOMER_MINUTE_LIMIT', 6, 1, 60);
const AI_TENANT_MINUTE_LIMIT = boundedEnvInt('AI_TENANT_MINUTE_LIMIT', 60, 1, 1000);
const AI_TENANT_DAILY_LIMIT = boundedEnvInt('AI_TENANT_DAILY_LIMIT', 2000, 1, 100000);

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

  let webhookReceiptId: string | null = null;
  try {
    webhookReceiptId = await recordWebhookReceipt(payload);
  } catch (error) {
    console.warn('Unable to record WhatsApp webhook receipt diagnostic', error);
  }

  try {
    // Privacy-by-design boundary: inspect only webhook routing metadata first.
    // Message content/media/order fields are not interpreted until the mapped
    // business has an active consent for the current SellerTray legal versions.
    const consentedPhoneNumberIds = await resolveConsentedWebhookPhoneNumbers(payload);
    if (consentedPhoneNumberIds.size === 0) {
      await updateWebhookReceipt(webhookReceiptId, 'ignored', 'no_consented_route');
      return new Response('OK', { status: 200 });
    }

    const events = extractInboundMessages(payload, consentedPhoneNumberIds);
    for (const event of events) {
      await ingestMessage(event);
    }
    await updateWebhookReceipt(webhookReceiptId, 'accepted', null);
  } catch (error) {
    await updateWebhookReceipt(webhookReceiptId, 'failed', diagnosticError(error));
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


async function recordWebhookReceipt(payload: JsonRecord): Promise<string | null> {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  let changeCount = 0;
  let messageCount = 0;
  let statusCount = 0;

  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    changeCount += entry.changes.length;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      if (Array.isArray(value.messages)) messageCount += value.messages.length;
      if (Array.isArray(value.statuses)) statusCount += value.statuses.length;
    }
  }

  const rows = await rest<Array<{ id: string }>>('/rest/v1/whatsapp_webhook_receipts?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      signature_valid: true,
      phone_number_ids: extractWebhookPhoneNumberIds(payload),
      entry_count: entries.length,
      change_count: changeCount,
      message_count: messageCount,
      status_count: statusCount,
      processing_result: 'received',
    }),
  });
  return rows[0]?.id ?? null;
}

async function updateWebhookReceipt(
  id: string | null,
  result: 'accepted' | 'ignored' | 'failed',
  errorCode: string | null,
): Promise<void> {
  if (!id) return;
  try {
    await rest('/rest/v1/whatsapp_webhook_receipts?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        processing_result: result,
        error_code: errorCode,
      }),
    });
  } catch (error) {
    console.warn('Unable to update WhatsApp webhook receipt diagnostic', error);
  }
}

function diagnosticError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function extractWebhookPhoneNumberIds(payload: JsonRecord): string[] {
  const ids = new Set<string>();
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const metadata = isRecord(change.value.metadata) ? change.value.metadata : null;
      const phoneNumberId = metadata ? asString(metadata.phone_number_id) : null;
      if (phoneNumberId) ids.add(phoneNumberId);
    }
  }

  return [...ids];
}

async function resolveConsentedWebhookPhoneNumbers(
  payload: JsonRecord,
): Promise<Set<string>> {
  const allowed = new Set<string>();

  for (const phoneNumberId of extractWebhookPhoneNumberIds(payload)) {
    const tenants = await rest<Array<{ id: string }>>(
      '/rest/v1/tenants?select=id' +
        '&whatsapp_phone_number_id=eq.' + encodeURIComponent(phoneNumberId) +
        '&limit=1',
    );
    const tenantId = tenants[0]?.id ?? null;

    if (!tenantId) {
      console.warn('No SellerTray tenant mapped to WhatsApp phone number', phoneNumberId);
      continue;
    }

    const consentActive = await rest<boolean>('/rest/v1/rpc/sellertray_whatsapp_consent_active', {
      method: 'POST',
      body: JSON.stringify({ p_tenant_id: tenantId }),
    });

    if (consentActive === true) {
      allowed.add(phoneNumberId);
    } else {
      console.warn(
        'SellerTray WhatsApp payload content skipped because active data-processing consent is absent',
        tenantId,
      );
    }
  }

  return allowed;
}

function extractInboundMessages(
  payload: JsonRecord,
  allowedPhoneNumberIds: ReadonlySet<string>,
) {
  const results: Array<{
    phoneNumberId: string;
    providerMessageId: string;
    waId: string;
    customerName: string | null;
    messageType: string;
    text: string | null;
    mediaId: string | null;
    mediaCaption: string | null;
    mediaMimeType: string | null;
    mediaSha256: string | null;
    nativeOrder: {
      catalogId: string;
      text: string | null;
      items: Array<{
        retailerId: string;
        quantity: number;
        unitPrice: number | null;
        currency: string | null;
      }>;
    } | null;
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
      if (!phoneNumberId || !allowedPhoneNumberIds.has(phoneNumberId)) continue;

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
        const image = messageType === 'image' && isRecord(message.image) ? message.image : null;
        const mediaId = image ? asString(image.id) : null;
        const mediaCaption = image ? asString(image.caption) : null;
        const mediaMimeType = image ? asString(image.mime_type) : null;
        const mediaSha256 = image ? asString(image.sha256) : null;

        const order = messageType === 'order' && isRecord(message.order) ? message.order : null;
        const orderCatalogId = order ? asString(order.catalog_id) : null;
        const orderText = order ? asString(order.text) : null;
        const orderItems: Array<{
          retailerId: string;
          quantity: number;
          unitPrice: number | null;
          currency: string | null;
        }> = [];
        if (order && Array.isArray(order.product_items)) {
          for (const item of order.product_items.slice(0, 40)) {
            if (!isRecord(item)) continue;
            const retailerId = asString(item.product_retailer_id);
            const quantityValue = typeof item.quantity === 'number' ? item.quantity : Number(item.quantity);
            const priceValue = typeof item.item_price === 'number' ? item.item_price : Number(item.item_price);
            if (!retailerId || !Number.isFinite(quantityValue) || quantityValue <= 0) continue;
            orderItems.push({
              retailerId,
              quantity: quantityValue,
              unitPrice: Number.isFinite(priceValue) && priceValue >= 0 ? priceValue : null,
              currency: asString(item.currency),
            });
          }
        }
        const nativeOrder = orderCatalogId
          ? { catalogId: orderCatalogId, text: orderText, items: orderItems }
          : null;

        if (!providerMessageId || !waId) continue;
        results.push({
          phoneNumberId,
          providerMessageId,
          waId,
          customerName: contactName,
          messageType,
          text,
          mediaId,
          mediaCaption,
          mediaMimeType,
          mediaSha256,
          nativeOrder,
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

  const consentActive = await rest<boolean>('/rest/v1/rpc/sellertray_whatsapp_consent_active', {
    method: 'POST',
    body: JSON.stringify({ p_tenant_id: tenantId }),
  });
  if (consentActive !== true) {
    console.warn('SellerTray WhatsApp ingestion skipped because active data-processing consent is absent', tenantId);
    return;
  }

  const customerPayload: JsonRecord = {
    tenant_id: tenantId,
    wa_id: event.waId,
    phone: event.waId,
  };
  if (event.customerName) customerPayload.display_name = event.customerName;

  let customerId: string | null = null;
  const existingCustomers = await rest<Array<{ id: string }>>(
    '/rest/v1/customers?select=id' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&wa_id=eq.' + encodeURIComponent(event.waId) +
      '&limit=1',
  );
  customerId = existingCustomers[0]?.id ?? null;

  if (!customerId) {
    try {
      const createdCustomers = await rest<Array<{ id: string }>>(
        '/rest/v1/customers?select=id',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(customerPayload),
        },
      );
      customerId = createdCustomers[0]?.id ?? null;
    } catch (error) {
      // A concurrent delivery may have created the same customer first.
      const racedCustomers = await rest<Array<{ id: string }>>(
        '/rest/v1/customers?select=id' +
          '&tenant_id=eq.' + encodeURIComponent(tenantId) +
          '&wa_id=eq.' + encodeURIComponent(event.waId) +
          '&limit=1',
      );
      customerId = racedCustomers[0]?.id ?? null;
      if (!customerId) throw error;
    }
  }

  if (!customerId) throw new Error('Customer lookup/create returned no row.');

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

  let sourceMessageId = storedMessages[0]?.id ?? null;
  if (!sourceMessageId) {
    const existing = await rest<Array<{ id: string; tenant_id: string; customer_id: string }>>(
      '/rest/v1/inbound_messages?select=id,tenant_id,customer_id' +
        '&provider_message_id=eq.' + encodeURIComponent(event.providerMessageId) +
        '&limit=1',
    );
    const row = existing[0];
    if (!row) throw new Error('Duplicate WhatsApp message could not be reloaded.');
    if (row.tenant_id !== tenantId || row.customer_id !== customerId) {
      throw new Error('WhatsApp provider message id resolved to a different tenant/customer.');
    }
    sourceMessageId = row.id;
  }

  const claimed = await rest<boolean>('/rest/v1/rpc/claim_sellertray_inbound_message', {
    method: 'POST',
    body: JSON.stringify({ p_message_id: sourceMessageId }),
  });
  if (claimed !== true) return;

  try {
    await processClaimedInboundMessage({
      event,
      tenant,
      tenantId,
      customerId,
      sourceMessageId,
    });
    await finishInboundProcessing(sourceMessageId, 'completed', null);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 500) : 'WhatsApp processing failed';
    try {
      await finishInboundProcessing(sourceMessageId, 'failed', message);
    } catch (finishError) {
      console.error('Unable to record failed WhatsApp processing state', finishError);
    }
    throw error;
  }
}

async function processClaimedInboundMessage({
  event,
  tenant,
  tenantId,
  customerId,
  sourceMessageId,
}: {
  event: ReturnType<typeof extractInboundMessages>[number];
  tenant: { id: string; currency: string | null; name: string };
  tenantId: string;
  customerId: string;
  sourceMessageId: string;
}) {
  const existingOrders = await rest<Array<{ id: string }>>(
    '/rest/v1/orders?select=id' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&source_message_id=eq.' + encodeURIComponent(sourceMessageId) +
      '&limit=1',
  );
  if (existingOrders[0]) return;

  if (event.messageType === 'order' && event.nativeOrder) {
    await createNativeWhatsAppCatalogueOrder({
      tenant,
      tenantId,
      customerId,
      sourceMessageId,
      nativeOrder: event.nativeOrder,
    });
    return;
  }

  if (event.messageType === 'image' && event.mediaId) {
    await recordInboundImageMedia({
      tenantId,
      customerId,
      sourceMessageId,
      providerMediaId: event.mediaId,
      caption: event.mediaCaption,
      mimeType: event.mediaMimeType,
      sha256: event.mediaSha256,
    });
    return;
  }

  if (!event.text) {
    return;
  }

  const intentRoute = await maybeHandleUnifiedConversationIntent({
    tenantId,
    businessName: tenant.name,
    currency: tenant.currency || 'NGN',
    customerId,
    customerWaId: event.waId,
    sourceMessageId,
    fromPhoneNumberId: event.phoneNumberId,
    text: event.text,
  });
  if (intentRoute.handled) {
    return;
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
  const orderText = intentRoute.orderTextOverride || event.text;
  const parsed = await parseOrder(orderText, catalogue, tenantId, customerId, sourceMessageId);
  const enrichedItems = enrichFromCatalogue(parsed.items, catalogue);

  // A normal WhatsApp conversation must never become an empty SellerTray order.
  // External AI and the deterministic fallback may both conclude that a message
  // contains no order items; in that case the message remains conversation history only.
  if (enrichedItems.length === 0) {
    console.info(JSON.stringify({
      event: 'whatsapp_message_not_an_order',
      tenantId,
      customerId,
      sourceMessageId,
      parserSource: parsed.source,
    }));
    return;
  }

  const reviewReasons = buildReviewReasons(parsed, enrichedItems);

  const orderId = await rest<string>('/rest/v1/rpc/create_sellertray_whatsapp_order_atomic', {
    method: 'POST',
    body: JSON.stringify({
      p_tenant_id: tenantId,
      p_customer_id: customerId,
      p_source_message_id: sourceMessageId,
      p_customer_note: event.text,
      p_parser_confidence: parsed.confidence,
      p_parser_source: parsed.source,
      p_parser_version: parsed.version,
      p_review_reasons: reviewReasons,
      p_currency: tenant.currency || 'NGN',
      p_items: enrichedItems.map((item) => ({
        catalog_item_id: item.catalogItemId,
        item_name: item.canonicalName,
        original_item_name: item.originalName,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        match_source: item.matchSource,
        match_confidence: item.matchConfidence,
      })),
    }),
  });

  if (!orderId) throw new Error('Atomic order creation returned no order id.');

  if (intentRoute.enquiryId) {
    await markEnquiryConverted({
      tenantId,
      enquiryId: intentRoute.enquiryId,
      orderId,
    });
  }

  const createdOrderState = await reloadConversationOrder(tenantId, orderId);
  await recordCommercialAction({
    tenantId,
    customerId,
    sourceMessageId,
    decision: intentRoute.decision,
    targetOrderId: orderId,
    actionType: intentRoute.enquiryId ? 'enquiry_converted_to_order' : 'order_created',
    riskClass: 'medium',
    policyResult: 'allowed',
    actionStatus: 'applied',
    beforeState: {},
    afterState: conversationOrderState(createdOrderState),
    currency: createdOrderState?.currency ?? tenant.currency ?? 'NGN',
    interpretationSource: parsed.source === 'ai' ? 'ai' : intentRoute.decision?.source ?? null,
    interpretationConfidence: parsed.source === 'ai' ? parsed.confidence : intentRoute.decision?.confidence ?? null,
    metadata: {
      intent_source: intentRoute.decision?.source ?? null,
      parser_source: parsed.source,
      parser_confidence: parsed.confidence,
      enquiry_id: intentRoute.enquiryId,
    },
  });
}


type ConversationOrderRow = {
  id: string;
  public_order_id: string;
  status: string;
  payment_status: string;
  amount_paid: number | string;
  total_amount: number | string | null;
  currency: string;
  fulfillment_status: string;
  fulfillment_method: string | null;
  delivery_provider: string | null;
  delivery_reference: string | null;
  created_at: string;
  updated_at: string;
};

type ConversationEnquiryRow = {
  id: string;
  source_inbound_message_id: string | null;
  enquiry_type: 'price' | 'availability' | 'product' | 'general';
  status: 'open' | 'replied' | 'converted' | 'dismissed';
  product_query: string | null;
  matched_catalog_item_id: string | null;
  matched_item_name: string | null;
  quoted_price: number | string | null;
  currency: string;
  created_at: string;
};

type ConversationTarget = ConversationOrderRow | null;

type IntentRouteResult = {
  handled: boolean;
  orderTextOverride: string | null;
  enquiryId: string | null;
  decision: IntentDecision | null;
};

async function maybeHandleUnifiedConversationIntent({
  tenantId,
  businessName,
  currency,
  customerId,
  customerWaId,
  sourceMessageId,
  fromPhoneNumberId,
  text,
}: {
  tenantId: string;
  businessName: string;
  currency: string;
  customerId: string;
  customerWaId: string;
  sourceMessageId: string;
  fromPhoneNumberId: string;
  text: string;
}): Promise<IntentRouteResult> {
  const [vocabulary, customerIds] = await Promise.all([
    loadIntentVocabulary(),
    resolveCustomerIdsForWhatsApp(tenantId, customerId, customerWaId),
  ]);

  const [orders, lastOutboundRows, lastInboundRows, lastEnquiry] = await Promise.all([
    loadRecentConversationOrders(tenantId, customerIds),
    rest<Array<{ event_key: string; message_body: string; created_at: string; source_inbound_message_id: string | null }>>(
      '/rest/v1/outbound_notifications?select=event_key,message_body,created_at,source_inbound_message_id' +
        '&tenant_id=eq.' + encodeURIComponent(tenantId) +
        '&customer_id=eq.' + encodeURIComponent(customerId) +
        '&order=created_at.desc&limit=1',
    ),
    rest<Array<{ id: string; text_body: string | null; received_at: string }>>(
      '/rest/v1/inbound_messages?select=id,text_body,received_at' +
        '&tenant_id=eq.' + encodeURIComponent(tenantId) +
        '&customer_id=eq.' + encodeURIComponent(customerId) +
        '&id=neq.' + encodeURIComponent(sourceMessageId) +
        '&order=received_at.desc&limit=1',
    ),
    loadRecentCustomerEnquiry(tenantId, customerId),
  ]);

  const lastOutbound = lastOutboundRows[0] ?? null;
  const pendingClarificationIntent =
    lastOutbound?.event_key === 'workflow_clarification' &&
    lastOutbound.source_inbound_message_id
      ? await loadIntentForSourceMessage(tenantId, lastOutbound.source_inbound_message_id)
      : null;
  const pendingClarificationOrderRefs =
    lastOutbound?.event_key === 'workflow_clarification'
      ? extractOrderRefs(lastOutbound.message_body)
      : [];

  if (
    pendingClarificationIntent &&
    pendingClarificationOrderRefs.length > 1 &&
    isAllClarificationReply(text)
  ) {
    const handledAll = await handleAllReadOnlyClarificationReply({
      tenantId,
      businessName,
      customerId,
      customerWaId,
      sourceMessageId,
      fromPhoneNumberId,
      intent: pendingClarificationIntent,
      orderRefs: pendingClarificationOrderRefs,
    });
    if (handledAll) {
      const decision: IntentDecision = {
        intent: pendingClarificationIntent,
        source: 'context',
        confidence: 0.99,
        explicitOrderRef: null,
        targetOrderRef: null,
        paymentMethod: null,
        itemText: null,
        deliveryText: null,
        aiModel: null,
        aiInputTokens: null,
        aiOutputTokens: null,
        aiTotalTokens: null,
      };
      await recordConversationIntent({
        tenantId,
        customerId,
        sourceMessageId,
        decision,
        target: null,
        text,
      });
      return {
        handled: true,
        orderTextOverride: null,
        enquiryId: null,
        decision,
      };
    }
  }

  const decision = await resolveConversationIntent({
    text,
    vocabulary,
    context: {
      orders: orders.map(toIntentOrderContext),
      lastOutboundEventKey: lastOutbound?.event_key ?? null,
      lastOutboundMessage: lastOutbound?.message_body ?? null,
      lastInboundMessageId: lastInboundRows[0]?.id ?? null,
      lastInboundMessage: lastInboundRows[0]?.text_body ?? null,
      lastInboundReceivedAt: lastInboundRows[0]?.received_at ?? null,
      pendingClarificationIntent,
      pendingClarificationOrderRefs,
      pendingClarificationCreatedAt: lastOutbound?.event_key === 'workflow_clarification'
        ? lastOutbound.created_at
        : null,
      lastEnquiry: toIntentEnquiryContext(lastEnquiry),
    },
  });

  let target = resolveConversationTarget(decision, orders);
  await recordConversationIntent({
    tenantId,
    customerId,
    sourceMessageId,
    decision,
    target,
    text,
  });

  if (decision.source === 'ai' && decision.confidence >= 0.88) {
    await recordIntentVocabularyCandidate(decision, sourceMessageId, text);
  }

  if (decision.intent === 'new_order') {
    const contextualEnquiry =
      decision.source === 'context' &&
      lastEnquiry &&
      ['open', 'replied'].includes(lastEnquiry.status)
        ? lastEnquiry
        : null;

    return {
      handled: false,
      orderTextOverride: decision.itemText || null,
      enquiryId: contextualEnquiry?.id ?? null,
      decision,
    };
  }

  if (decision.intent === 'unknown') {
    if (looksLikeUnresolvedCommercialMessage(text)) {
      await handleCustomerProductEnquiry({
        tenantId,
        businessName,
        currency,
        customerId,
        customerWaId,
        sourceMessageId,
        fromPhoneNumberId,
        decision,
        text,
      });
      await recordCommercialAction({
        tenantId,
        customerId,
        sourceMessageId,
        decision,
        targetOrderId: null,
        actionType: 'customer_enquiry_recorded',
        riskClass: 'low',
        policyResult: 'clarification_required',
        actionStatus: 'requested',
        metadata: { unresolved_commercial_message: true },
      });
      return {
        handled: true,
        orderTextOverride: null,
        enquiryId: null,
        decision,
      };
    }

    console.info(JSON.stringify({
      event: 'sellertray_message_no_safe_commercial_intent',
      tenantId,
      customerId,
      sourceMessageId,
    }));
    return {
      handled: true,
      orderTextOverride: null,
      enquiryId: null,
      decision,
    };
  }

  if (decision.intent === 'general_chatter') {
    return { handled: true, orderTextOverride: null, enquiryId: null, decision };
  }

  if (
    decision.intent === 'product_price_enquiry' ||
    decision.intent === 'product_availability_enquiry' ||
    decision.intent === 'product_enquiry' ||
    decision.intent === 'catalogue_query'
  ) {
    await handleCustomerProductEnquiry({
      tenantId,
      businessName,
      currency,
      customerId,
      customerWaId,
      sourceMessageId,
      fromPhoneNumberId,
      decision,
      text,
    });
    await recordCommercialAction({
      tenantId,
      customerId,
      sourceMessageId,
      decision,
      targetOrderId: null,
      actionType: 'customer_enquiry_recorded',
      riskClass: 'low',
      policyResult: 'not_applicable',
      actionStatus: 'applied',
      metadata: { enquiry_intent: decision.intent },
    });
    return { handled: true, orderTextOverride: null, enquiryId: null, decision };
  }

  if (decision.intent === 'delivery_confirm') {
    target = target ?? chooseSingleOrder(
      orders.filter((order) =>
        order.status === 'ready' && order.fulfillment_status === 'out_for_delivery'
      ),
    );
    const beforeState = conversationOrderState(target);
    await maybeConfirmCustomerReceipt({
      tenantId,
      customerId,
      customerWaId,
      sourceMessageId,
      text: 'received',
    });
    const afterTarget = target ? await reloadConversationOrder(tenantId, target.id) : null;
    const applied = Boolean(
      afterTarget &&
      afterTarget.status === 'completed' &&
      afterTarget.fulfillment_status === 'delivered',
    );
    await recordCommercialAction({
      tenantId,
      customerId,
      sourceMessageId,
      decision,
      targetOrderId: target?.id ?? null,
      actionType: 'delivery_confirmation',
      riskClass: 'medium',
      policyResult: applied ? 'allowed' : 'clarification_required',
      actionStatus: applied ? 'applied' : 'clarification_required',
      beforeState,
      afterState: conversationOrderState(afterTarget),
      currency: afterTarget?.currency ?? target?.currency ?? null,
      metadata: {
        confirmation_channel: 'whatsapp',
      },
    });
    return { handled: true, orderTextOverride: null, enquiryId: null, decision };
  }

  if (
    decision.intent === 'payment_claim' ||
    decision.intent === 'payment_options' ||
    decision.intent === 'payment_method_select' ||
    decision.intent === 'payment_status' ||
    decision.intent === 'invoice_request' ||
    decision.intent === 'financial_receipt_request'
  ) {
    target = target ?? resolvePaymentTarget(decision.intent, orders);
    if (target) {
      await recordConversationIntent({
        tenantId,
        customerId,
        sourceMessageId,
        decision,
        target,
        text,
      });
    }
    if (!target) {
      await queueWorkflowClarification({
        tenantId,
        customerId,
        customerWaId,
        sourceMessageId,
        fromPhoneNumberId,
        businessName,
        intent: decision.intent,
        orders: paymentCandidatesForIntent(decision.intent, orders),
      });
      await recordCommercialAction({
        tenantId,
        customerId,
        sourceMessageId,
        decision,
        targetOrderId: null,
        actionType: actionTypeForIntent(decision.intent),
        riskClass: riskClassForIntent(decision.intent),
        policyResult: 'clarification_required',
        actionStatus: 'clarification_required',
      });
      return { handled: true, orderTextOverride: null, enquiryId: null, decision };
    }

    const beforeState = conversationOrderState(target);
    const routedText = paymentIntentText(decision, target.public_order_id);
    const handled = await handleCustomerPaymentSelfService({
      tenantId,
      businessName,
      customerId,
      customerWaId,
      sourceMessageId,
      fromPhoneNumberId,
      text: routedText,
    });
    const afterTarget = await reloadConversationOrder(tenantId, target.id);
    await recordCommercialAction({
      tenantId,
      customerId,
      sourceMessageId,
      decision,
      targetOrderId: target.id,
      actionType: actionTypeForIntent(decision.intent),
      riskClass: riskClassForIntent(decision.intent),
      policyResult: handled ? 'allowed' : 'blocked',
      actionStatus: handled ? 'applied' : 'failed',
      beforeState,
      afterState: conversationOrderState(afterTarget),
      currency: afterTarget?.currency ?? target.currency,
      metadata: {
        routed_action: decision.intent,
      },
    });
    return { handled: true, orderTextOverride: null, enquiryId: null, decision };
  }

  if (decision.intent === 'order_status' || decision.intent === 'delivery_status') {
    target = target ?? chooseSingleOrder(
      orders.filter((order) => !['cancelled', 'rejected'].includes(order.status)),
    );
    if (!target && orders.length === 1) target = orders[0];
    if (target) {
      await recordConversationIntent({
        tenantId,
        customerId,
        sourceMessageId,
        decision,
        target,
        text,
      });
    }
    if (!target && orders.length > 1) {
      await queueWorkflowClarification({
        tenantId,
        customerId,
        customerWaId,
        sourceMessageId,
        fromPhoneNumberId,
        businessName,
        intent: decision.intent,
        orders,
      });
      await recordCommercialAction({
        tenantId,
        customerId,
        sourceMessageId,
        decision,
        targetOrderId: null,
        actionType: actionTypeForIntent(decision.intent),
        riskClass: 'low',
        policyResult: 'clarification_required',
        actionStatus: 'clarification_required',
      });
      return { handled: true, orderTextOverride: null, enquiryId: null, decision };
    }
    if (!target) {
      return { handled: true, orderTextOverride: null, enquiryId: null, decision };
    }

    const handled = await maybeHandleCustomerSelfService({
      tenantId,
      businessName,
      customerName: null,
      customerId,
      customerWaId,
      sourceMessageId,
      fromPhoneNumberId,
      text: 'STATUS ' + target.public_order_id,
    });
    await recordCommercialAction({
      tenantId,
      customerId,
      sourceMessageId,
      decision,
      targetOrderId: target.id,
      actionType: actionTypeForIntent(decision.intent),
      riskClass: 'low',
      policyResult: handled ? 'allowed' : 'blocked',
      actionStatus: handled ? 'applied' : 'failed',
      beforeState: conversationOrderState(target),
      afterState: conversationOrderState(target),
      currency: target.currency,
    });
    return { handled: true, orderTextOverride: null, enquiryId: null, decision };
  }

  if (
    decision.intent === 'order_add_items' ||
    decision.intent === 'order_remove_items' ||
    decision.intent === 'order_change_items' ||
    decision.intent === 'order_cancel' ||
    decision.intent === 'pickup_request' ||
    decision.intent === 'delivery_instruction'
  ) {
    target = target ?? chooseSingleOrder(
      orders.filter((order) => ['needs_review', 'accepted', 'processing', 'ready'].includes(order.status)),
    );

    if (target) {
      await recordConversationIntent({
        tenantId,
        customerId,
        sourceMessageId,
        decision,
        target,
        text,
      });
    }

    if (!target) {
      await queueWorkflowClarification({
        tenantId,
        customerId,
        customerWaId,
        sourceMessageId,
        fromPhoneNumberId,
        businessName,
        intent: decision.intent,
        orders: orders.filter((order) => ['needs_review', 'accepted', 'processing', 'ready'].includes(order.status)),
      });
      await recordCommercialAction({
        tenantId,
        customerId,
        sourceMessageId,
        decision,
        targetOrderId: null,
        actionType: actionTypeForIntent(decision.intent),
        riskClass: riskClassForIntent(decision.intent),
        policyResult: 'clarification_required',
        actionStatus: 'clarification_required',
      });
      return { handled: true, orderTextOverride: null, enquiryId: null, decision };
    }

    await createCustomerWorkflowChangeRequest({
      tenantId,
      customerId,
      sourceMessageId,
      target,
      decision,
      text,
    });
    await recordCommercialAction({
      tenantId,
      customerId,
      sourceMessageId,
      decision,
      targetOrderId: target.id,
      actionType: actionTypeForIntent(decision.intent),
      riskClass: riskClassForIntent(decision.intent),
      policyResult: 'pending',
      actionStatus: 'requested',
      beforeState: conversationOrderState(target),
      currency: target.currency,
      metadata: {
        requested_change: decision.intent,
      },
    });
    return { handled: true, orderTextOverride: null, enquiryId: null, decision };
  }

  if (decision.intent === 'complaint' || decision.intent === 'refund_request') {
    if (decision.intent === 'refund_request') {
      target = target ?? chooseSingleOrder(
        orders.filter((order) => order.payment_status === 'paid' || order.status === 'completed'),
      );
      const eligible = orders.filter((order) => order.payment_status === 'paid' || order.status === 'completed');
      if (!target && eligible.length > 1) {
        await queueWorkflowClarification({
          tenantId,
          customerId,
          customerWaId,
          sourceMessageId,
          fromPhoneNumberId,
          businessName,
          intent: decision.intent,
          orders: eligible,
        });
        await recordCommercialAction({
          tenantId,
          customerId,
          sourceMessageId,
          decision,
          targetOrderId: null,
          actionType: 'refund_requested',
          riskClass: 'high',
          policyResult: 'clarification_required',
          actionStatus: 'clarification_required',
        });
        return { handled: true, orderTextOverride: null, enquiryId: null, decision };
      }
    } else {
      target = target ?? orders[0] ?? null;
    }

    await queueMerchantWorkflowAttention({
      tenantId,
      customerId,
      sourceMessageId,
      target,
      intent: decision.intent,
      text,
    });
    await recordCommercialAction({
      tenantId,
      customerId,
      sourceMessageId,
      decision,
      targetOrderId: target?.id ?? null,
      actionType: actionTypeForIntent(decision.intent),
      riskClass: riskClassForIntent(decision.intent),
      policyResult: decision.intent === 'refund_request' ? 'pending' : 'not_applicable',
      actionStatus: 'requested',
      beforeState: conversationOrderState(target),
      currency: target?.currency ?? null,
      metadata: {
        customer_text: text.slice(0, 1000),
        amount_paid: target ? toNumber(target.amount_paid) ?? 0 : null,
        total_amount: target ? toNumber(target.total_amount) : null,
      },
    });
    return { handled: true, orderTextOverride: null, enquiryId: null, decision };
  }

  return { handled: false, orderTextOverride: null, enquiryId: null, decision };
}

async function loadIntentVocabulary(): Promise<VocabularyEntry[]> {
  try {
    return await rest<VocabularyEntry[]>(
      '/rest/v1/sellertray_intent_vocab?select=intent,phrase,match_mode,confidence,priority' +
        '&active=eq.true&order=priority.asc,id.asc&limit=500',
    );
  } catch (error) {
    console.warn('SellerTray intent vocabulary unavailable; continuing with built-in rules', error);
    return [];
  }
}

async function loadRecentConversationOrders(
  tenantId: string,
  customerIds: string[],
): Promise<ConversationOrderRow[]> {
  if (customerIds.length === 0) return [];
  return rest<ConversationOrderRow[]>(
    '/rest/v1/orders?select=id,public_order_id,status,payment_status,amount_paid,total_amount,currency,fulfillment_status,fulfillment_method,delivery_provider,delivery_reference,created_at,updated_at' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&customer_id=in.(' + customerIds.join(',') + ')' +
      '&order=updated_at.desc&limit=6',
  );
}

async function reloadConversationOrder(
  tenantId: string,
  orderId: string,
): Promise<ConversationOrderRow | null> {
  const rows = await rest<ConversationOrderRow[]>(
    '/rest/v1/orders?select=id,public_order_id,status,payment_status,amount_paid,total_amount,currency,fulfillment_status,fulfillment_method,delivery_provider,delivery_reference,created_at,updated_at' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&id=eq.' + encodeURIComponent(orderId) +
      '&limit=1',
  );
  return rows[0] ?? null;
}

function conversationOrderState(order: ConversationOrderRow | null): Record<string, unknown> {
  if (!order) return {};
  return {
    public_order_id: order.public_order_id,
    status: order.status,
    payment_status: order.payment_status,
    amount_paid: toNumber(order.amount_paid) ?? 0,
    total_amount: toNumber(order.total_amount),
    currency: order.currency,
    fulfillment_status: order.fulfillment_status,
    fulfillment_method: order.fulfillment_method,
    delivery_provider: order.delivery_provider,
    delivery_reference: order.delivery_reference,
  };
}

async function loadRecentCustomerEnquiry(
  tenantId: string,
  customerId: string,
): Promise<ConversationEnquiryRow | null> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const rows = await rest<ConversationEnquiryRow[]>(
    '/rest/v1/customer_enquiries?select=id,source_inbound_message_id,enquiry_type,status,product_query,matched_catalog_item_id,matched_item_name,quoted_price,currency,created_at' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&customer_id=eq.' + encodeURIComponent(customerId) +
      '&status=in.(open,replied)' +
      '&converted_order_id=is.null' +
      '&created_at=gte.' + encodeURIComponent(since) +
      '&order=created_at.desc&limit=1',
  );
  return rows[0] ?? null;
}

function toIntentOrderContext(order: ConversationOrderRow): IntentOrderContext {
  return {
    id: order.id,
    publicOrderId: order.public_order_id,
    status: order.status,
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    createdAt: order.created_at,
  };
}

function toIntentEnquiryContext(enquiry: ConversationEnquiryRow | null): IntentEnquiryContext | null {
  if (!enquiry) return null;
  return {
    id: enquiry.id,
    sourceInboundMessageId: enquiry.source_inbound_message_id,
    enquiryType: enquiry.enquiry_type,
    productQuery: enquiry.product_query,
    matchedCatalogItemId: enquiry.matched_catalog_item_id,
    matchedItemName: enquiry.matched_item_name,
    quotedPrice: toNumber(enquiry.quoted_price),
    currency: enquiry.currency,
    status: enquiry.status,
    createdAt: enquiry.created_at,
  };
}

function looksLikeUnresolvedCommercialMessage(value: string): boolean {
  const normalized = normalizeIntentText(value);
  if (!normalized || normalized.length < 4) return false;

  return /\b(?:buy|want|need|price|cost|how much|sell|stock|available|availability|product|item|bag|bags|piece|pieces|pcs|pack|packs|bottle|bottles|carton|cartons|crate|crates|box|boxes|unit|units|kg|litre|liter)\b/i.test(normalized);
}

async function loadIntentForSourceMessage(
  tenantId: string,
  sourceMessageId: string,
): Promise<ConversationIntent | null> {
  const rows = await rest<Array<{ intent: string }>>(
    '/rest/v1/sellertray_intent_events?select=intent' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&source_inbound_message_id=eq.' + encodeURIComponent(sourceMessageId) +
      '&order=created_at.desc&limit=1',
  );
  const intent = rows[0]?.intent ?? null;
  return isConversationIntent(intent) ? intent : null;
}

function extractOrderRefs(value: string | null | undefined): string[] {
  if (!value) return [];
  const matches = value.match(/\b[A-Z0-9]{3}\/\d{6,}\b/gi) ?? [];
  return [...new Set(matches.map((ref) => ref.toUpperCase()))];
}

function isAllClarificationReply(value: string): boolean {
  const normalized = normalizeIntentText(value);
  return /^(?:both|all|both of them|all of them|send both|send all|both receipts|all receipts)$/i.test(normalized);
}

function isConversationIntent(value: string | null): value is ConversationIntent {
  return value === 'new_order' ||
    value === 'order_add_items' ||
    value === 'order_remove_items' ||
    value === 'order_change_items' ||
    value === 'order_cancel' ||
    value === 'payment_options' ||
    value === 'payment_method_select' ||
    value === 'payment_claim' ||
    value === 'payment_status' ||
    value === 'invoice_request' ||
    value === 'financial_receipt_request' ||
    value === 'order_status' ||
    value === 'delivery_status' ||
    value === 'delivery_confirm' ||
    value === 'pickup_request' ||
    value === 'delivery_instruction' ||
    value === 'product_price_enquiry' ||
    value === 'product_availability_enquiry' ||
    value === 'product_enquiry' ||
    value === 'catalogue_query' ||
    value === 'complaint' ||
    value === 'refund_request' ||
    value === 'general_chatter' ||
    value === 'unknown';
}

async function handleAllReadOnlyClarificationReply(input: {
  tenantId: string;
  businessName: string;
  customerId: string;
  customerWaId: string;
  sourceMessageId: string;
  fromPhoneNumberId: string;
  intent: ConversationIntent;
  orderRefs: string[];
}): Promise<boolean> {
  if (![
    'financial_receipt_request',
    'invoice_request',
    'order_status',
    'payment_status',
    'delivery_status',
  ].includes(input.intent)) {
    return false;
  }

  for (const ref of input.orderRefs.slice(0, 4)) {
    if (input.intent === 'order_status' || input.intent === 'delivery_status') {
      await maybeHandleCustomerSelfService({
        tenantId: input.tenantId,
        businessName: input.businessName,
        customerName: null,
        customerId: input.customerId,
        customerWaId: input.customerWaId,
        sourceMessageId: input.sourceMessageId,
        fromPhoneNumberId: input.fromPhoneNumberId,
        text: 'status ' + ref,
      });
      continue;
    }

    const routedText =
      input.intent === 'financial_receipt_request' ? 'PAYMENT RECEIPT ' + ref :
      input.intent === 'invoice_request' ? 'INVOICE ' + ref :
      'PAYMENT STATUS ' + ref;

    await handleCustomerPaymentSelfService({
      tenantId: input.tenantId,
      businessName: input.businessName,
      customerId: input.customerId,
      customerWaId: input.customerWaId,
      sourceMessageId: input.sourceMessageId,
      fromPhoneNumberId: input.fromPhoneNumberId,
      text: routedText,
    });
  }

  return true;
}

function resolveConversationTarget(
  decision: IntentDecision,
  orders: ConversationOrderRow[],
): ConversationTarget {
  const targetRef = decision.explicitOrderRef ?? decision.targetOrderRef;
  if (!targetRef) return null;
  return orders.find((order) => order.public_order_id.toUpperCase() === targetRef.toUpperCase()) ?? null;
}

function resolvePaymentTarget(
  intent: IntentDecision['intent'],
  orders: ConversationOrderRow[],
): ConversationTarget {
  return chooseSingleOrder(paymentCandidatesForIntent(intent, orders));
}

function paymentCandidatesForIntent(
  intent: IntentDecision['intent'],
  orders: ConversationOrderRow[],
): ConversationOrderRow[] {
  if (intent === 'financial_receipt_request') {
    return orders.filter((order) => order.payment_status === 'paid');
  }
  if (intent === 'invoice_request') {
    return orders.filter((order) => ['accepted', 'processing', 'ready', 'completed'].includes(order.status));
  }
  if (intent === 'payment_status') {
    const unpaid = orders.filter((order) => !['cancelled', 'rejected'].includes(order.status) && order.payment_status !== 'paid');
    return unpaid.length > 0 ? unpaid : orders.filter((order) => !['cancelled', 'rejected'].includes(order.status));
  }
  return orders.filter((order) =>
    ['accepted', 'processing', 'ready'].includes(order.status) &&
    order.payment_status !== 'paid'
  );
}

function chooseSingleOrder(orders: ConversationOrderRow[]): ConversationTarget {
  return orders.length === 1 ? orders[0] : null;
}

function paymentIntentText(decision: IntentDecision, orderRef: string): string {
  if (decision.intent === 'payment_claim') return 'PAID ' + orderRef;
  if (decision.intent === 'payment_status') return 'PAYMENT STATUS ' + orderRef;
  if (decision.intent === 'invoice_request') return 'INVOICE ' + orderRef;
  if (decision.intent === 'financial_receipt_request') return 'PAYMENT RECEIPT ' + orderRef;
  if (decision.intent === 'payment_method_select' && decision.paymentMethod) {
    return 'PAY ' + orderRef + ' ' + decision.paymentMethod;
  }
  return 'PAY ' + orderRef;
}

async function handleCustomerProductEnquiry(input: {
  tenantId: string;
  businessName: string;
  currency: string;
  customerId: string;
  customerWaId: string;
  sourceMessageId: string;
  fromPhoneNumberId: string;
  decision: IntentDecision;
  text: string;
}): Promise<void> {
  const catalogue = await loadCatalogue(input.tenantId);
  const enquiryText = input.decision.itemText?.trim() || input.text;
  const match = findEnquiryCatalogueMatch(enquiryText, catalogue);
  const clarificationCandidates = match
    ? []
    : findEnquiryClarificationCandidates(enquiryText, catalogue);
  const enquiryType =
    input.decision.intent === 'product_price_enquiry' ? 'price' :
    input.decision.intent === 'product_availability_enquiry' ? 'availability' :
    input.decision.intent === 'product_enquiry' ? 'product' :
    'general';
  const productQuery = match?.item.name ?? extractEnquiryProductQuery(enquiryText);

  let responseText: string;
  if (match) {
    const price = toNumber(match.item.price_ngn);
    if (enquiryType === 'price' && price !== null) {
      responseText =
        match.item.name + ' is ' + formatCurrencyAmount(price, input.currency) +
        '. If you want to order, just tell me the quantity you need.';
    } else if (enquiryType === 'availability') {
      responseText =
        'I found ' + match.item.name + ' in ' + input.businessName + '\'s catalogue' +
        (price !== null ? ' at ' + formatCurrencyAmount(price, input.currency) : '') +
        '. The merchant will confirm current stock availability. If you want to order it, tell me the quantity.';
    } else {
      responseText =
        match.item.name +
        (price !== null ? ' is listed at ' + formatCurrencyAmount(price, input.currency) : ' is in the catalogue') +
        '. Ask for a quantity whenever you are ready to order.';
    }
  } else if (clarificationCandidates.length >= 2) {
    responseText =
      'Sure. We found these catalogue options: ' +
      formatCatalogueChoiceList(clarificationCandidates.map((candidate) => candidate.item.name)) +
      '. Which one would you like?';
  } else {
    responseText =
      'Thanks. Please give me a minute — I’ll respond to your enquiry shortly.';
  }

  const rows = await rest<Array<{ id: string }>>(
    '/rest/v1/customer_enquiries?on_conflict=tenant_id,source_inbound_message_id&select=id',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        customer_id: input.customerId,
        source_inbound_message_id: input.sourceMessageId,
        channel: 'whatsapp',
        enquiry_type: enquiryType,
        status: 'open',
        original_text: input.text.slice(0, 2000),
        normalized_text: normalizeIntentText(input.text).slice(0, 1000),
        product_query: productQuery?.slice(0, 500) ?? null,
        matched_catalog_item_id: match?.item.id ?? null,
        matched_item_name: match?.item.name ?? null,
        quoted_price: match ? toNumber(match.item.price_ngn) : null,
        currency: input.currency,
        response_text: responseText.slice(0, 2000),
        replied_at: null,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  await rest('/rest/v1/outbound_notifications', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      customer_id: input.customerId,
      source_inbound_message_id: input.sourceMessageId,
      event_key: 'customer_enquiry_reply',
      delivery_status: 'pending',
      from_phone_number_id: input.fromPhoneNumberId,
      to_wa_id: input.customerWaId,
      message_body: responseText.slice(0, 2000),
      conversation_window_expires_at: new Date(Date.now() + 86400000).toISOString(),
    }),
  });

  await kickNotificationWorker();

  await rest('/rest/v1/merchant_notifications', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      event_key: 'customer_enquiry',
      severity: match || clarificationCandidates.length >= 2 ? 'info' : 'attention',
      title: match
        ? 'Customer product enquiry'
        : clarificationCandidates.length >= 2
          ? 'Catalogue choice sent to customer'
          : 'Customer enquiry needs review',
      body: (
        input.text +
        (match
          ? ' · Matched: ' + match.item.name
          : clarificationCandidates.length >= 2
            ? ' · Asked customer to choose: ' + clarificationCandidates.map((candidate) => candidate.item.name).join(', ')
            : merchantCandidateHint(input.text, catalogue))
      ).slice(0, 1000),
      source_inbound_message_id: input.sourceMessageId,
    }),
  });

  console.info(JSON.stringify({
    event: 'sellertray_customer_enquiry_recorded',
    tenantId: input.tenantId,
    customerId: input.customerId,
    enquiryId: rows[0]?.id ?? null,
    enquiryType,
    matchedItemId: match?.item.id ?? null,
    clarificationCandidateCount: clarificationCandidates.length,
  }));
}

function findEnquiryClarificationCandidates(
  text: string,
  catalogue: CatalogueRow[],
): Array<{
  item: CatalogueRow;
  source: 'normalized_name' | 'normalized_alias';
  score: number;
}> {
  const productQuery = extractEnquiryProductQuery(text);
  const shape = productDiscoveryShape(productQuery || text);
  if (shape.coreTokens.length === 0) return [];

  const ranked = fuzzyCatalogueCandidates(productQuery || text, catalogue);
  const bestScore = ranked[0]?.score ?? 0;
  if (bestScore < 72) return [];

  const safeFloor = Math.max(72, bestScore - 12);
  const candidates = ranked
    .filter((candidate) =>
      candidate.score >= safeFloor &&
      catalogueItemSupportsQueryCore(candidate.item, shape.coreTokens)
    )
    .slice(0, 4);

  // One strong candidate belongs to normal automatic resolution. Clarification
  // is only for a genuinely ambiguous set of catalogue-backed choices.
  return candidates.length >= 2 ? candidates : [];
}

function catalogueItemSupportsQueryCore(item: CatalogueRow, queryCoreTokens: string[]): boolean {
  const phrases = [
    item.name,
    ...(item.catalog_item_aliases ?? []).map((alias) => alias.alias),
  ];

  return phrases.some((phrase) => {
    const candidateTokens = new Set(productDiscoveryShape(phrase).coreTokens);
    return queryCoreTokens.every((token) => candidateTokens.has(token));
  });
}

function formatCatalogueChoiceList(names: string[]): string {
  const safe = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (safe.length === 0) return '';
  if (safe.length === 1) return safe[0];
  if (safe.length === 2) return safe[0] + ' or ' + safe[1];
  return safe.slice(0, -1).join(', ') + ', or ' + safe[safe.length - 1];
}

function findEnquiryCatalogueMatch(
  text: string,
  catalogue: CatalogueRow[],
): CatalogueMatch | null {
  const productQuery = extractEnquiryProductQuery(text);
  const direct = findCatalogueMatch(productQuery, catalogue);
  if (direct) return direct;

  const normalizedText = normalizePhrase(productQuery || text);
  const messageTokens = new Set(normalizedText.split(' ').filter((token) => token.length >= 2));
  const ranked = catalogue
    .map((item) => ({
      item,
      score: catalogueContextScore(normalizedText, messageTokens, item),
    }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 35) return null;
  if (best.score < 100 && second && best.score - second.score < 10) return null;

  const exact = findCatalogueMatch(best.item.name, [best.item]);
  return exact ?? { item: best.item, source: 'normalized_name', confidence: Math.min(0.92, best.score / 100) };
}

function merchantCandidateHint(text: string, catalogue: CatalogueRow[]): string {
  const candidates = fuzzyCatalogueCandidates(extractEnquiryProductQuery(text), catalogue)
    .filter((candidate) => candidate.score >= 55)
    .slice(0, 4)
    .map((candidate) => candidate.item.name);

  return candidates.length > 0
    ? ' · Needs merchant review. Possible catalogue matches: ' + candidates.join(', ')
    : ' · No confident catalogue match';
}

function extractEnquiryProductQuery(text: string): string {
  return normalizeIntentText(text)
    .replace(/^(?:hi|hello|hey|good morning|good afternoon|good evening)\s+/i, '')
    .replace(/^(?:please\s+)?(?:how much (?:is|are|be)|what(?:s| is) the price of|price of|cost of|wetin be the price(?: of)?|do you have|do you sell|do you stock|is|are|you get|una get|tell me about|show me)\s+/i, '')
    .replace(/\b(?:available|in stock)\b/gi, '')
    .replace(/^(?:a|an|the)\s+/i, '')
    .trim()
    .slice(0, 500);
}

function formatCurrencyAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: /^[A-Z]{3}$/.test(currency) ? currency : 'NGN',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return (currency || 'NGN') + ' ' + value.toFixed(2);
  }
}

async function markEnquiryConverted(input: {
  tenantId: string;
  enquiryId: string;
  orderId: string;
}): Promise<void> {
  await rest(
    '/rest/v1/customer_enquiries?id=eq.' + encodeURIComponent(input.enquiryId) +
      '&tenant_id=eq.' + encodeURIComponent(input.tenantId) +
      '&converted_order_id=is.null' +
      '&status=in.(open,replied)',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'converted',
        converted_order_id: input.orderId,
        converted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    },
  );
}

async function createCustomerWorkflowChangeRequest(input: {
  tenantId: string;
  customerId: string;
  sourceMessageId: string;
  target: ConversationOrderRow;
  decision: IntentDecision;
  text: string;
}): Promise<void> {
  const kind =
    input.decision.intent === 'order_add_items' ? 'add_items' :
    input.decision.intent === 'order_remove_items' ? 'remove_items' :
    input.decision.intent === 'order_change_items' ? 'change_items' :
    input.decision.intent === 'order_cancel' ? 'cancel_order' :
    'other';

  await rest('/rest/v1/customer_order_change_requests?on_conflict=tenant_id,source_inbound_message_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      order_id: input.target.id,
      customer_id: input.customerId,
      source_inbound_message_id: input.sourceMessageId,
      request_kind: kind,
      request_text: input.text.slice(0, 2000),
      parsed_items: [],
      status: 'pending',
    }),
  });
}

async function queueMerchantWorkflowAttention(input: {
  tenantId: string;
  customerId: string;
  sourceMessageId: string;
  target: ConversationTarget;
  intent: 'complaint' | 'refund_request';
  text: string;
}): Promise<void> {
  const eventKey = input.intent === 'complaint' ? 'customer_complaint' : 'refund_request';
  const severity = input.intent === 'refund_request' ? 'urgent' : 'attention';
  const title = input.intent === 'complaint'
    ? 'Customer needs attention'
    : 'Customer requested a refund';

  await rest('/rest/v1/merchant_notifications', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      event_key: eventKey,
      severity,
      title,
      body: input.text.slice(0, 1000),
      order_id: input.target?.id ?? null,
      source_inbound_message_id: input.sourceMessageId,
    }),
  });
}

async function queueWorkflowClarification(input: {
  tenantId: string;
  customerId: string;
  customerWaId: string;
  sourceMessageId: string;
  fromPhoneNumberId: string;
  businessName: string;
  intent: IntentDecision['intent'];
  orders: ConversationOrderRow[];
}): Promise<void> {
  const options = input.orders.slice(0, 4);
  let message: string;

  if (options.length === 0) {
    message = 'I understood your request, but I could not find an order it can safely be applied to. Please tell us which order you mean.';
  } else {
    message =
      'I found more than one order that may match your request. Please reply with the order reference you mean:\n' +
      options.map((order) =>
        '• ' + order.public_order_id + ' — ' + humanCompactOrderState(order)
      ).join('\n');
  }

  await rest('/rest/v1/outbound_notifications', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      customer_id: input.customerId,
      source_inbound_message_id: input.sourceMessageId,
      event_key: 'workflow_clarification',
      delivery_status: 'pending',
      from_phone_number_id: input.fromPhoneNumberId,
      to_wa_id: input.customerWaId,
      message_body: message.slice(0, 2000),
      conversation_window_expires_at: new Date(Date.now() + 86400000).toISOString(),
    }),
  });

  await kickNotificationWorker();

  await rest('/rest/v1/merchant_notifications', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      event_key: 'workflow_clarification',
      severity: 'info',
      title: 'SellerTray asked the customer to clarify',
      body: (input.intent + ': ' + message).slice(0, 1000),
      source_inbound_message_id: input.sourceMessageId,
    }),
  });
}

function humanCompactOrderState(order: ConversationOrderRow): string {
  if (order.fulfillment_status === 'out_for_delivery') return 'Out for delivery';
  if (order.payment_status === 'paid') return order.status.replace(/_/g, ' ') + ' · paid';
  return order.status.replace(/_/g, ' ') + ' · ' + order.payment_status.replace(/_/g, ' ');
}

async function recordConversationIntent(input: {
  tenantId: string;
  customerId: string;
  sourceMessageId: string;
  decision: IntentDecision;
  target: ConversationTarget;
  text: string;
}): Promise<void> {
  try {
    await rest('/rest/v1/sellertray_intent_events?on_conflict=tenant_id,source_inbound_message_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        customer_id: input.customerId,
        source_inbound_message_id: input.sourceMessageId,
        channel: 'whatsapp',
        intent: input.decision.intent,
        source: input.decision.source,
        confidence: input.decision.confidence,
        target_order_id: input.target?.id ?? null,
        target_order_ref: input.target?.public_order_id ?? input.decision.targetOrderRef,
        ai_model: input.decision.aiModel,
        ai_input_tokens: input.decision.aiInputTokens,
        ai_output_tokens: input.decision.aiOutputTokens,
        ai_total_tokens: input.decision.aiTotalTokens,
        metadata: {
          normalized_text: normalizeIntentText(input.text).slice(0, 500),
          payment_method: input.decision.paymentMethod,
          item_text: input.decision.itemText,
          delivery_text: input.decision.deliveryText,
        },
      }),
    });
  } catch (error) {
    console.warn('SellerTray intent telemetry write failed', error);
  }
}

async function recordIntentVocabularyCandidate(
  decision: IntentDecision,
  sourceMessageId: string,
  text: string,
): Promise<void> {
  if (decision.intent === 'unknown' || decision.intent === 'general_chatter' || decision.intent === 'new_order') return;
  try {
    await rest('/rest/v1/rpc/sellertray_record_intent_vocab_candidate', {
      method: 'POST',
      body: JSON.stringify({
        p_normalized_phrase: normalizeIntentText(text).slice(0, 500),
        p_intent: decision.intent,
        p_confidence: decision.confidence,
        p_source_message_id: sourceMessageId,
      }),
    });
  } catch (error) {
    console.warn('SellerTray intent vocabulary candidate write failed', error);
  }
}

async function recordCommercialAction(input: {
  tenantId: string;
  customerId: string;
  sourceMessageId: string;
  decision: IntentDecision | null;
  targetOrderId: string | null;
  actionType: string;
  riskClass: 'low' | 'medium' | 'high';
  policyResult: 'pending' | 'allowed' | 'blocked' | 'clarification_required' | 'not_applicable';
  actionStatus: 'requested' | 'applied' | 'rejected' | 'clarification_required' | 'failed';
  financialImpact?: number | null;
  currency?: string | null;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  actorUserId?: string | null;
  requestedBy?: 'customer' | 'merchant' | 'staff' | 'ai' | 'system';
  interpretationSource?: 'vocabulary' | 'rules' | 'context' | 'ai' | 'none' | null;
  interpretationConfidence?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await rest('/rest/v1/commercial_action_ledger?on_conflict=tenant_id,action_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        action_key: input.sourceMessageId + ':' + input.actionType,
        channel: 'whatsapp',
        source_inbound_message_id: input.sourceMessageId,
        customer_id: input.customerId,
        target_order_id: input.targetOrderId,
        action_type: input.actionType,
        risk_class: input.riskClass,
        requested_by: input.requestedBy ?? 'customer',
        actor_user_id: input.actorUserId ?? null,
        interpretation_source: input.interpretationSource ?? input.decision?.source ?? null,
        interpretation_confidence: input.interpretationConfidence ?? input.decision?.confidence ?? null,
        policy_result: input.policyResult,
        action_status: input.actionStatus,
        financial_impact: input.financialImpact ?? null,
        currency: input.currency ?? null,
        before_state: input.beforeState ?? {},
        after_state: input.afterState ?? {},
        metadata: input.metadata ?? {},
        applied_at: input.actionStatus === 'applied' ? new Date().toISOString() : null,
      }),
    });
  } catch (error) {
    console.warn('SellerTray commercial action ledger write failed', error);
  }
}

function actionTypeForIntent(intent: IntentDecision['intent']): string {
  const map: Partial<Record<IntentDecision['intent'], string>> = {
    payment_claim: 'payment_claimed',
    payment_options: 'payment_options_requested',
    payment_method_select: 'payment_method_selected',
    payment_status: 'payment_status_requested',
    invoice_request: 'invoice_requested',
    financial_receipt_request: 'payment_receipt_requested',
    order_status: 'order_status_requested',
    delivery_status: 'delivery_status_requested',
    order_add_items: 'order_add_items_requested',
    order_remove_items: 'order_remove_items_requested',
    order_change_items: 'order_change_requested',
    order_cancel: 'order_cancel_requested',
    pickup_request: 'pickup_requested',
    delivery_instruction: 'delivery_instruction_requested',
    complaint: 'complaint_reported',
    refund_request: 'refund_requested',
  };
  return map[intent] ?? intent;
}

function riskClassForIntent(intent: IntentDecision['intent']): 'low' | 'medium' | 'high' {
  if (['payment_claim', 'refund_request', 'order_cancel'].includes(intent)) return 'high';
  if ([
    'payment_method_select',
    'order_add_items',
    'order_remove_items',
    'order_change_items',
    'pickup_request',
    'delivery_instruction',
  ].includes(intent)) return 'medium';
  return 'low';
}

async function createNativeWhatsAppCatalogueOrder({
  tenant,
  tenantId,
  customerId,
  sourceMessageId,
  nativeOrder,
}: {
  tenant: { id: string; currency: string | null; name: string };
  tenantId: string;
  customerId: string;
  sourceMessageId: string;
  nativeOrder: {
    catalogId: string;
    text: string | null;
    items: Array<{
      retailerId: string;
      quantity: number;
      unitPrice: number | null;
      currency: string | null;
    }>;
  };
}): Promise<void> {
  const subscription = await getSubscriptionAccess(tenantId);
  if (subscription.accessMode !== 'full') {
    console.warn(
      'Native WhatsApp catalogue order skipped because tenant subscription is read-only',
      tenantId,
      subscription.effectiveStatus ?? 'unknown',
    );
    return;
  }

  const retailerIds = Array.from(new Set(
    nativeOrder.items.map((item) => item.retailerId).filter(Boolean),
  ));

  const mapped = retailerIds.length
    ? await rest<Array<{
        retailer_id: string;
        catalog_item_id: string;
        item_name: string;
        price_ngn: number | string | null;
      }>>('/rest/v1/rpc/resolve_sellertray_whatsapp_catalog_items', {
        method: 'POST',
        body: JSON.stringify({
          p_tenant_id: tenantId,
          p_catalog_id: nativeOrder.catalogId,
          p_retailer_ids: retailerIds,
        }),
      })
    : [];

  const byRetailerId = new Map(
    mapped.map((row) => [row.retailer_id, row]),
  );

  const settings = await rest<Array<{ catalog_id: string; is_enabled: boolean }>>(
    '/rest/v1/tenant_whatsapp_catalog_settings?select=catalog_id,is_enabled' +
      '&tenant_id=eq.' + encodeURIComponent(tenantId) +
      '&limit=1',
  );
  const configured = settings[0] ?? null;

  const reviewReasons = new Set<string>();
  if (!nativeOrder.items.length) reviewReasons.add('no_items');
  if (configured && !configured.is_enabled) reviewReasons.add('whatsapp_catalog_mapping_disabled');
  if (configured && configured.catalog_id !== nativeOrder.catalogId) {
    reviewReasons.add('whatsapp_catalog_id_mismatch');
  }

  const currencies = new Set<string>();
  let priceMismatch = false;

  const items = nativeOrder.items.map((item) => {
    if (item.currency) currencies.add(item.currency.toUpperCase());
    const match = byRetailerId.get(item.retailerId) ?? null;
    const localPrice = match ? toNumber(match.price_ngn) : null;
    const unitPrice = item.unitPrice ?? localPrice;

    if (!match) reviewReasons.add('unmatched_whatsapp_catalog_item');
    if (unitPrice === null) reviewReasons.add('missing_price');
    if (
      match &&
      item.unitPrice !== null &&
      localPrice !== null &&
      Math.abs(item.unitPrice - localPrice) > 0.009
    ) {
      priceMismatch = true;
    }

    return {
      catalog_item_id: match?.catalog_item_id ?? null,
      item_name: match?.item_name ?? ('WhatsApp catalogue item ' + item.retailerId),
      original_item_name: item.retailerId,
      quantity: item.quantity,
      unit_price: unitPrice,
      match_source: match ? 'whatsapp_catalog' : 'unmatched',
      match_confidence: match ? 1 : 0,
    };
  });

  if (currencies.size > 1) reviewReasons.add('mixed_currency');
  if (priceMismatch) reviewReasons.add('whatsapp_price_differs_from_catalogue');

  const orderCurrency = currencies.values().next().value || tenant.currency || 'NGN';
  const note = nativeOrder.text ||
    ('WhatsApp catalogue order from catalog ' + nativeOrder.catalogId);

  const orderId = await rest<string>('/rest/v1/rpc/create_sellertray_whatsapp_order_atomic', {
    method: 'POST',
    body: JSON.stringify({
      p_tenant_id: tenantId,
      p_customer_id: customerId,
      p_source_message_id: sourceMessageId,
      p_customer_note: note,
      p_parser_confidence: 1,
      p_parser_source: 'native_catalog',
      p_parser_version: 'meta-order-v1',
      p_review_reasons: Array.from(reviewReasons),
      p_currency: orderCurrency,
      p_items: items,
    }),
  });

  if (!orderId) throw new Error('Native WhatsApp catalogue order creation returned no order id.');
}

async function recordInboundImageMedia({
  tenantId,
  customerId,
  sourceMessageId,
  providerMediaId,
  caption,
  mimeType,
  sha256,
}: {
  tenantId: string;
  customerId: string;
  sourceMessageId: string;
  providerMediaId: string;
  caption: string | null;
  mimeType: string | null;
  sha256: string | null;
}): Promise<void> {
  await rest(
    '/rest/v1/inbound_message_media?on_conflict=tenant_id,inbound_message_id',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        tenant_id: tenantId,
        inbound_message_id: sourceMessageId,
        customer_id: customerId,
        media_type: 'image',
        provider_media_id: providerMediaId,
        media_caption: caption,
        media_mime_type: mimeType,
        media_sha256: sha256,
      }),
    },
  );
}

async function finishInboundProcessing(
  sourceMessageId: string,
  status: 'completed' | 'failed',
  error: string | null,
): Promise<void> {
  const patch: JsonRecord = {
    processing_status: status,
    processing_error: error,
    updated_at: new Date().toISOString(),
  };
  if (status === 'completed') patch.processing_completed_at = new Date().toISOString();

  await rest(
    '/rest/v1/inbound_messages?id=eq.' + encodeURIComponent(sourceMessageId) +
      '&processing_status=eq.processing',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    },
  );
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
  const normalizedParsed = normalizeProductPhrase(parsedName);

  for (const item of catalogue) {
    if (normalizedParsed === normalizeProductPhrase(item.name)) {
      return { item, source: 'catalogue_name', confidence: 1 };
    }
  }

  for (const item of catalogue) {
    for (const alias of item.catalog_item_aliases ?? []) {
      if (normalizedParsed === normalizeProductPhrase(alias.alias)) {
        return { item, source: 'catalogue_alias', confidence: 0.99 };
      }
    }
  }

  const parsedKey = productTokenKey(parsedName);
  const parsedBaseKey = productBaseKey(parsedName);
  const candidates: Array<{
    item: CatalogueRow;
    source: Exclude<MatchSource, 'unmatched'>;
    confidence: number;
    score: number;
  }> = [];

  for (const item of catalogue) {
    const nameKey = productTokenKey(item.name);
    const nameBaseKey = productBaseKey(item.name);

    if (parsedKey && parsedKey === nameKey) {
      candidates.push({
        item,
        source: 'normalized_name',
        confidence: 0.97,
        score: 97,
      });
    } else if (parsedBaseKey && parsedBaseKey === nameBaseKey) {
      candidates.push({
        item,
        source: 'normalized_name',
        confidence: 0.95,
        score: 95,
      });
    }

    for (const alias of item.catalog_item_aliases ?? []) {
      const aliasKey = productTokenKey(alias.alias);
      const aliasBaseKey = productBaseKey(alias.alias);
      if (parsedKey && parsedKey === aliasKey) {
        candidates.push({
          item,
          source: 'normalized_alias',
          confidence: 0.96,
          score: 96,
        });
      } else if (parsedBaseKey && parsedBaseKey === aliasBaseKey) {
        candidates.push({
          item,
          source: 'normalized_alias',
          confidence: 0.94,
          score: 94,
        });
      }
    }
  }

  const deduped = new Map<string, typeof candidates[number]>();
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.item.id);
    if (!existing || candidate.score > existing.score) {
      deduped.set(candidate.item.id, candidate);
    }
  }
  const ranked = [...deduped.values()].sort((left, right) => right.score - left.score);

  if (ranked.length === 1) {
    const best = ranked[0];
    return { item: best.item, source: best.source, confidence: best.confidence };
  }

  if (ranked.length > 1 && ranked[0].score - ranked[1].score >= 3) {
    const best = ranked[0];
    return { item: best.item, source: best.source, confidence: best.confidence };
  }

  // Conservative fuzzy discovery: a generic customer term may resolve to one
  // unique catalogue product, but never choose silently between variants.
  const fuzzy = fuzzyCatalogueCandidates(parsedName, catalogue);
  if (fuzzy.length === 1 && fuzzy[0].score >= 72) {
    return {
      item: fuzzy[0].item,
      source: fuzzy[0].source,
      confidence: Math.min(0.92, fuzzy[0].score / 100),
    };
  }

  if (
    fuzzy.length > 1 &&
    fuzzy[0].score >= 82 &&
    fuzzy[0].score - fuzzy[1].score >= 14
  ) {
    return {
      item: fuzzy[0].item,
      source: fuzzy[0].source,
      confidence: Math.min(0.92, fuzzy[0].score / 100),
    };
  }

  return null;
}

function fuzzyCatalogueCandidates(
  value: string,
  catalogue: CatalogueRow[],
): Array<{
  item: CatalogueRow;
  source: 'normalized_name' | 'normalized_alias';
  score: number;
}> {
  const query = productDiscoveryShape(value);
  if (query.coreTokens.length === 0) return [];

  const candidates: Array<{
    item: CatalogueRow;
    source: 'normalized_name' | 'normalized_alias';
    score: number;
  }> = [];

  for (const item of catalogue) {
    const phrases = [
      { value: item.name, source: 'normalized_name' as const },
      ...(item.catalog_item_aliases ?? []).map((alias) => ({
        value: alias.alias,
        source: 'normalized_alias' as const,
      })),
    ];

    let best: typeof candidates[number] | null = null;
    for (const phrase of phrases) {
      const candidate = productDiscoveryShape(phrase.value);
      if (candidate.coreTokens.length === 0) continue;

      // If the customer stated a size/weight/volume, a candidate with a
      // conflicting variant must never be selected.
      if (
        query.variantTokens.length > 0 &&
        !query.variantTokens.every((token) => candidate.variantTokens.includes(token))
      ) {
        continue;
      }

      const querySet = new Set(query.coreTokens);
      const candidateSet = new Set(candidate.coreTokens);
      const matched = query.coreTokens.filter((token) => candidateSet.has(token)).length;
      const coverage = matched / query.coreTokens.length;
      if (coverage < 0.67) continue;

      const precision = matched / candidate.coreTokens.length;
      const phraseDice = diceCoefficient(
        query.coreTokens.join(' '),
        candidate.coreTokens.join(' '),
      );

      let score = coverage * 58 + precision * 22 + phraseDice * 20;
      if (query.coreTokens.every((token) => candidateSet.has(token))) score += 8;
      if (
        query.variantTokens.length > 0 &&
        query.variantTokens.every((token) => candidate.variantTokens.includes(token))
      ) {
        score += 8;
      }

      const current = {
        item,
        source: phrase.source,
        score: Math.min(100, score),
      };
      if (!best || current.score > best.score) best = current;
    }

    if (best) candidates.push(best);
  }

  return candidates.sort((left, right) =>
    right.score - left.score ||
    left.item.name.localeCompare(right.item.name)
  );
}

function productDiscoveryShape(value: string): {
  coreTokens: string[];
  variantTokens: string[];
} {
  const tokens = normalizeProductPhrase(value).split(' ').filter(Boolean);
  const variantTokens = tokens.filter(isVariantToken);
  const coreTokens = tokens.filter((token) =>
    token !== 'of' &&
    !isPackagingToken(token) &&
    !isVariantToken(token) &&
    !/^\d+(?:\.\d+)?$/.test(token) &&
    !PRODUCT_DISCOVERY_STOPWORDS.has(token)
  );
  return {
    coreTokens: [...new Set(coreTokens)],
    variantTokens: [...new Set(variantTokens)],
  };
}

function isVariantToken(token: string): boolean {
  return /^\d+(?:\.\d+)?(?:kg|g|l|ml)$/.test(token);
}

const PRODUCT_DISCOVERY_STOPWORDS = new Set([
  'a','an','the','please','pls','need','want','buy','give','send','bring',
  'tomorrow','today','now','me','my','i','we','you','some',
]);

function normalizeProductPhrase(value: string): string {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*(kilograms?|kilogrammes?|kgs?)\b/g, '$1kg')
    .replace(/(\d+(?:\.\d+)?)\s*(grams?|gms?)\b/g, '$1g')
    .replace(/(\d+(?:\.\d+)?)\s*(litres?|liters?|ltrs?)\b/g, '$1l')
    .replace(/(\d+(?:\.\d+)?)\s*(millilitres?|milliliters?|mls?)\b/g, '$1ml')
    .replace(/\bsemo\b/g, 'semolina')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized
    .split(' ')
    .map((token) => normalizeProductToken(normalizePackagingToken(token)))
    .filter(Boolean)
    .join(' ');
}

function normalizeProductToken(token: string): string {
  if (!token) return token;
  if (/^\d+(?:\.\d+)?(?:kg|g|l|ml)$/.test(token)) return token;
  if (/^\d+(?:\.\d+)?$/.test(token)) return token;
  if (isPackagingToken(token)) return token;

  const irregular: Record<string,string> = {
    batteries: 'battery',
    knives: 'knife',
    loaves: 'loaf',
    leaves: 'leaf',
    potatoes: 'potato',
    tomatoes: 'tomato',
  };
  if (irregular[token]) return irregular[token];

  if (token.length > 4 && token.endsWith('ies')) {
    return token.slice(0, -3) + 'y';
  }
  if (
    token.length > 4 &&
    (token.endsWith('ches') || token.endsWith('shes') || token.endsWith('xes') || token.endsWith('zes'))
  ) {
    return token.slice(0, -2);
  }
  if (
    token.length > 3 &&
    token.endsWith('s') &&
    !token.endsWith('ss') &&
    !token.endsWith('us') &&
    !token.endsWith('is')
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function productTokenKey(value: string): string {
  return normalizeProductPhrase(value)
    .split(' ')
    .filter((token) => token && token !== 'of')
    .sort()
    .join(' ');
}

function productBaseKey(value: string): string {
  const tokens = normalizeProductPhrase(value)
    .split(' ')
    .filter(Boolean);

  const withoutLeadingQuantity =
    tokens.length >= 2 &&
    /^\d+(?:\.\d+)?$/.test(tokens[0]) &&
    isPackagingToken(tokens[1])
      ? tokens.slice(2)
      : tokens;

  return withoutLeadingQuantity
    .filter((token) => token !== 'of' && !isPackagingToken(token))
    .sort()
    .join(' ');
}

function normalizePackagingToken(token: string): string {
  const map: Record<string,string> = {
    bags: 'bag',
    cartons: 'carton',
    packs: 'pack',
    packets: 'packet',
    bottles: 'bottle',
    crates: 'crate',
    boxes: 'box',
    pieces: 'piece',
    pcs: 'piece',
    units: 'unit',
  };
  return map[token] ?? token;
}

function isPackagingToken(token: string): boolean {
  return new Set([
    'bag','carton','pack','packet','bottle','crate','box','piece','unit',
  ]).has(normalizePackagingToken(token));
}

function phraseVariants(value: string): Set<string> {
  const normalized = normalizeProductPhrase(value);
  const variants = new Set<string>([normalized, productTokenKey(value), productBaseKey(value)]);
  variants.delete('');
  return variants;
}

function normalizePhrase(value: string): string {
  return normalizeProductPhrase(value);
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
  customerId: string,
  sourceMessageId: string,
): Promise<ParsedOrder> {
  if (ORDER_PARSER_URL && ORDER_PARSER_AUTH_TOKEN) {
    if (!(await consumeAiRequestBudget(tenantId, customerId))) {
      console.warn(JSON.stringify({
        event: 'ai_order_parser_rate_limited',
        tenantId,
        customerId,
        sourceMessageId,
      }));
      return fallbackParseOrder(text);
    }
    const parserCatalogue = selectParserCatalogue(text, catalogue);
    try {
      const response = await fetch(ORDER_PARSER_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ORDER_PARSER_AUTH_TOKEN}`,
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

async function consumeAiRequestBudget(tenantId: string, customerId: string): Promise<boolean> {
  const contracts: Array<[string,string,number,number]> = [
    ['ai_customer_minute', tenantId + ':' + customerId, AI_CUSTOMER_MINUTE_LIMIT, 60],
    ['ai_tenant_minute', tenantId, AI_TENANT_MINUTE_LIMIT, 60],
    ['ai_tenant_day', tenantId, AI_TENANT_DAILY_LIMIT, 86400],
  ];
  for (const [scope,key,limit,windowSeconds] of contracts) {
    const allowed = await rest<boolean>('/rest/v1/rpc/consume_sellertray_rate_limit', {
      method: 'POST',
      body: JSON.stringify({
        p_scope: scope,
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }),
    });
    if (allowed !== true) return false;
  }
  return true;
}

function boundedEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Deno.env.get(name);
  const value = raw ? Number(raw) : fallback;
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
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

  await kickNotificationWorker();
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

async function kickNotificationWorker(): Promise<void> {
  try {
    await rest('/rest/v1/rpc/sellertray_kick_notification_worker', {
      method: 'POST',
      body: '{}',
    });
  } catch (error) {
    console.warn('SellerTray notification worker kick failed; cron retry remains available.', error);
  }
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

