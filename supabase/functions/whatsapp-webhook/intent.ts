type JsonRecord = Record<string, unknown>;

export type ConversationIntent =
  | 'new_order'
  | 'order_add_items'
  | 'order_remove_items'
  | 'order_change_items'
  | 'order_cancel'
  | 'payment_options'
  | 'payment_method_select'
  | 'payment_claim'
  | 'payment_status'
  | 'invoice_request'
  | 'financial_receipt_request'
  | 'order_status'
  | 'delivery_status'
  | 'delivery_confirm'
  | 'pickup_request'
  | 'delivery_instruction'
  | 'product_price_enquiry'
  | 'product_availability_enquiry'
  | 'product_enquiry'
  | 'catalogue_query'
  | 'complaint'
  | 'refund_request'
  | 'general_chatter'
  | 'unknown';

export type IntentSource = 'vocabulary' | 'rules' | 'context' | 'ai' | 'none';

export type VocabularyEntry = {
  intent: string;
  phrase: string;
  match_mode: 'exact' | 'contains' | 'prefix';
  confidence: number | string;
  priority?: number | string;
};

export type IntentOrderContext = {
  id: string;
  publicOrderId: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  createdAt: string;
};

export type IntentEnquiryContext = {
  id: string;
  enquiryType: 'price' | 'availability' | 'product' | 'general';
  productQuery: string | null;
  matchedCatalogItemId: string | null;
  matchedItemName: string | null;
  quotedPrice: number | null;
  currency: string;
  status: 'open' | 'replied' | 'converted' | 'dismissed';
  createdAt: string;
};

export type IntentConversationContext = {
  orders: IntentOrderContext[];
  lastOutboundEventKey: string | null;
  lastOutboundMessage: string | null;
  lastEnquiry: IntentEnquiryContext | null;
};

export type IntentDecision = {
  intent: ConversationIntent;
  source: IntentSource;
  confidence: number;
  explicitOrderRef: string | null;
  targetOrderRef: string | null;
  paymentMethod: string | null;
  itemText: string | null;
  deliveryText: string | null;
  aiModel: string | null;
  aiInputTokens: number | null;
  aiOutputTokens: number | null;
  aiTotalTokens: number | null;
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_INTENT_MODEL = Deno.env.get('OPENAI_INTENT_MODEL') ?? 'gpt-5.6-luna';

const ALLOWED_INTENTS = new Set<ConversationIntent>([
  'new_order',
  'order_add_items',
  'order_remove_items',
  'order_change_items',
  'order_cancel',
  'payment_options',
  'payment_method_select',
  'payment_claim',
  'payment_status',
  'invoice_request',
  'financial_receipt_request',
  'order_status',
  'delivery_status',
  'delivery_confirm',
  'pickup_request',
  'delivery_instruction',
  'product_price_enquiry',
  'product_availability_enquiry',
  'product_enquiry',
  'catalogue_query',
  'complaint',
  'refund_request',
  'general_chatter',
  'unknown',
]);

const outputSchema = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [...ALLOWED_INTENTS],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    target_order_ref: { type: ['string', 'null'] },
    payment_method: { type: ['string', 'null'] },
    item_text: { type: ['string', 'null'] },
    delivery_text: { type: ['string', 'null'] },
  },
  required: [
    'intent',
    'confidence',
    'target_order_ref',
    'payment_method',
    'item_text',
    'delivery_text',
  ],
  additionalProperties: false,
} as const;

export function normalizeIntentText(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9+\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function resolveConversationIntent(input: {
  text: string;
  vocabulary: VocabularyEntry[];
  context: IntentConversationContext;
}): Promise<IntentDecision> {
  const normalized = normalizeIntentText(input.text);
  const explicitOrderRef = extractOrderRef(input.text);

  const vocabularyDecision = matchVocabulary(normalized, input.vocabulary, explicitOrderRef);
  if (
    vocabularyDecision &&
    !(vocabularyDecision.intent === 'new_order' && looksLikeNonOrderWorkflow(normalized))
  ) {
    return vocabularyDecision;
  }

  const rulesDecision = ruleDecision(input.text, normalized, input.context, explicitOrderRef);
  if (rulesDecision) return rulesDecision;

  if (!shouldInvokeAi(normalized, input.context)) {
    return emptyDecision('unknown', 'none', 0, explicitOrderRef);
  }

  const aiDecision = await resolveWithAi({
    text: input.text,
    normalized,
    context: input.context,
    explicitOrderRef,
  });
  if (aiDecision?.intent === 'new_order' && looksLikeNonOrderWorkflow(normalized)) {
    return emptyDecision('unknown', 'rules', 1, explicitOrderRef);
  }
  return aiDecision ?? emptyDecision('unknown', 'none', 0, explicitOrderRef);
}

function matchVocabulary(
  normalized: string,
  vocabulary: VocabularyEntry[],
  explicitOrderRef: string | null,
): IntentDecision | null {
  if (!normalized) return null;

  const sorted = [...vocabulary].sort(
    (left, right) => numberValue(left.priority, 100) - numberValue(right.priority, 100),
  );

  let best: { entry: VocabularyEntry; score: number } | null = null;

  for (const entry of sorted) {
    if (!ALLOWED_INTENTS.has(entry.intent as ConversationIntent)) continue;
    const phrase = normalizeIntentText(entry.phrase);
    if (!phrase) continue;

    let matches = false;
    if (entry.match_mode === 'exact') {
      matches = normalized === phrase || normalized === phrase + ' ' + (explicitOrderRef ?? '').toLocaleLowerCase();
    } else if (entry.match_mode === 'prefix') {
      matches = normalized === phrase || normalized.startsWith(phrase + ' ');
    } else {
      matches = (' ' + normalized + ' ').includes(' ' + phrase + ' ');
    }

    if (!matches) continue;

    const confidence = clamp(numberValue(entry.confidence, 0.9));
    const specificity = phrase.length / 1000;
    const score = confidence + specificity;
    if (!best || score > best.score) best = { entry, score };
  }

  if (!best) return null;

  return {
    ...emptyDecision(
      best.entry.intent as ConversationIntent,
      'vocabulary',
      clamp(numberValue(best.entry.confidence, 0.9)),
      explicitOrderRef,
    ),
    itemText: itemTextForIntent(best.entry.intent as ConversationIntent, normalized),
    deliveryText: best.entry.intent === 'delivery_instruction' ? normalized : null,
  };
}

function ruleDecision(
  rawText: string,
  normalized: string,
  context: IntentConversationContext,
  explicitOrderRef: string | null,
): IntentDecision | null {
  if (!normalized) return emptyDecision('general_chatter', 'rules', 1, explicitOrderRef);

  const paymentSelect = rawText.match(
    /^\s*(?:pay\s+)?(?:[A-Z0-9]{3}\/[0-9]{6,}\s+)?(PAYSTACK|FLUTTERWAVE|FLW|COD|BANK(?:\s*TRANSFER)?|TRANSFER|PICKUP|PAY\s+ON\s+PICKUP)\s*$/i,
  );
  if (
    paymentSelect &&
    (explicitOrderRef || context.lastOutboundEventKey === 'payment_options')
  ) {
    return {
      ...emptyDecision('payment_method_select', 'context', 0.98, explicitOrderRef),
      paymentMethod: normalizePaymentMethod(paymentSelect[1]),
    };
  }

  if (/\b(?:refund|money back|return my money)\b/i.test(normalized)) {
    return emptyDecision('refund_request', 'rules', 0.96, explicitOrderRef);
  }

  if (/\b(?:wrong order|not what i ordered|complaint|damaged|spoilt|spoiled|missing item|problem with)\b/i.test(normalized)) {
    return emptyDecision('complaint', 'rules', 0.94, explicitOrderRef);
  }

  if (/\b(?:cancel|stop)\b.*\b(?:order|it|this)\b/i.test(normalized)) {
    return emptyDecision('order_cancel', 'rules', 0.96, explicitOrderRef);
  }

  if (/^(?:remove|take out|delete)\b/i.test(normalized)) {
    return {
      ...emptyDecision('order_remove_items', 'rules', 0.95, explicitOrderRef),
      itemText: normalized,
    };
  }

  if (/^(?:add|include)\b/i.test(normalized)) {
    return {
      ...emptyDecision('order_add_items', 'rules', 0.93, explicitOrderRef),
      itemText: normalized,
    };
  }

  if (/\b(?:change|replace|instead|make it)\b/i.test(normalized) && context.orders.length > 0) {
    return {
      ...emptyDecision('order_change_items', 'context', 0.9, explicitOrderRef),
      itemText: normalized,
    };
  }

  if (/\b(?:send invoice|invoice)\b/i.test(normalized)) {
    return emptyDecision('invoice_request', 'rules', 0.97, explicitOrderRef);
  }

  if (/\b(?:payment receipt|financial receipt|send receipt)\b/i.test(normalized)) {
    return emptyDecision('financial_receipt_request', 'rules', 0.97, explicitOrderRef);
  }

  if (/\b(?:where is my order|track my order|order status|status of my order)\b/i.test(normalized)) {
    return emptyDecision('order_status', 'rules', 0.98, explicitOrderRef);
  }

  if (/\b(?:where is the rider|has the rider left|on the way|delivery status)\b/i.test(normalized)) {
    return emptyDecision('delivery_status', 'rules', 0.96, explicitOrderRef);
  }

  if (/\b(?:received|got it|it has arrived|i got it|i received it)\b/i.test(normalized)) {
    return emptyDecision('delivery_confirm', 'rules', 0.93, explicitOrderRef);
  }

  if (/\b(?:pick it up|pick it myself|pickup|pick up myself|come and collect)\b/i.test(normalized)) {
    return emptyDecision('pickup_request', 'rules', 0.94, explicitOrderRef);
  }

  if (/\b(?:deliver to|bring it to|send it to|use this address)\b/i.test(normalized)) {
    return {
      ...emptyDecision('delivery_instruction', 'rules', 0.92, explicitOrderRef),
      deliveryText: rawText.trim(),
    };
  }

  if (looksLikePaymentOptionsLanguage(normalized)) {
    const paymentMethod = paymentMethodFromSentence(normalized);
    return {
      ...emptyDecision(paymentMethod ? 'payment_method_select' : 'payment_options', 'rules', 0.97, explicitOrderRef),
      paymentMethod,
    };
  }

  if (/\b(?:how much|what(?:s| is) the price|price of|cost of|how much be|wetin be the price)\b/i.test(normalized)) {
    return {
      ...emptyDecision('product_price_enquiry', 'rules', 0.97, explicitOrderRef),
      itemText: rawText.trim(),
    };
  }

  if (/\b(?:do you have|do you sell|is .* available|in stock|you get|una get|do you stock)\b/i.test(normalized)) {
    return {
      ...emptyDecision('product_availability_enquiry', 'rules', 0.96, explicitOrderRef),
      itemText: rawText.trim(),
    };
  }

  if (/\b(?:tell me about|what size|which size|what type|which one|show me|what do you have)\b/i.test(normalized)) {
    return {
      ...emptyDecision('product_enquiry', 'rules', 0.90, explicitOrderRef),
      itemText: rawText.trim(),
    };
  }

  const contextualOrder = contextualOrderFromEnquiry(rawText, normalized, context);
  if (contextualOrder) return contextualOrder;

  if (looksLikeNewOrder(normalized)) {
    return {
      ...emptyDecision('new_order', 'rules', 0.88, explicitOrderRef),
      itemText: rawText.trim(),
    };
  }

  return null;
}

function shouldInvokeAi(
  normalized: string,
  context: IntentConversationContext,
): boolean {
  if (!OPENAI_API_KEY || !normalized) return false;
  if (normalized.length > 1000) return false;

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 1 && !context.lastOutboundEventKey) return false;

  if (
    /\b(?:thanks|thank you|okay|ok|alright|noted|great|nice|hello|hi|good morning|good afternoon|good evening)\b/i.test(normalized) &&
    tokens.length <= 4
  ) {
    return false;
  }

  if (looksLikeNewOrder(normalized)) return false;

  if (context.lastEnquiry && looksLikeEnquiryFollowUp(normalized)) return false;

  const activeContext = context.orders.some((order) =>
    !['completed', 'cancelled', 'rejected'].includes(order.status),
  );
  const actionHint = /\b(?:pay|paid|transfer|cancel|change|remove|add|replace|refund|receipt|invoice|order|rider|deliver|delivery|pickup|pick|collect|wrong|problem|account|bank|status|where|when|how|instead|again|dont|do not|yes|no|price|cost|available|stock|want|take|give|send|bring)\b/i.test(normalized);

  return activeContext || Boolean(context.lastEnquiry) || actionHint;
}

async function resolveWithAi(input: {
  text: string;
  normalized: string;
  context: IntentConversationContext;
  explicitOrderRef: string | null;
}): Promise<IntentDecision | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(4500),
      headers: {
        authorization: 'Bearer ' + OPENAI_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_INTENT_MODEL,
        store: false,
        reasoning: { effort: 'none' },
        max_output_tokens: 500,
        input: [
          {
            role: 'system',
            content:
              'You classify a WhatsApp customer message for SellerTray, a merchant order workflow. ' +
              'Use Nigerian English, Pidgin, shorthand and conversational context naturally. ' +
              'The customer must never need to know special commands. ' +
              'Choose exactly one allowed intent. ' +
              'Never claim that payment is verified merely because a customer says they paid. ' +
              'Never infer a refund, cancellation, order modification, payment or delivery confirmation if the message is only casual chatter. ' +
              'Distinguish enquiries from purchase commitments carefully. A customer asking "how much is a bag of rice?", "do you have rice?" or "what sizes do you have?" is asking an enquiry and is NOT placing an order. ' +
              'Use product_price_enquiry for price questions, product_availability_enquiry for stock/availability questions, and product_enquiry for other product questions. ' +
              'Use new_order only when the customer expresses purchase commitment or a clear request to supply/buy an item, including follow-ups to a recent enquiry such as "okay give me two", "I will take one", or "send two bags". ' +
              'Payment, transfer, refund, receipt, invoice, delivery, cancellation, complaint or order-status language is never enough to create a new product order, even when there is a recent enquiry. ' +
              'If meaning is unsafe or genuinely unclear, use unknown. ' +
              'target_order_ref must be one of the supplied order references or null. ' +
              'payment_method should be BANK, PAYSTACK, FLUTTERWAVE, COD or PICKUP only when the customer selected one. ' +
              'item_text and delivery_text should contain only the relevant customer wording, otherwise null.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              message: input.text,
              normalized_message: input.normalized,
              explicit_order_ref: input.explicitOrderRef,
              recent_orders: input.context.orders.map((order) => ({
                order_ref: order.publicOrderId,
                status: order.status,
                payment_status: order.paymentStatus,
                fulfillment_status: order.fulfillmentStatus,
                created_at: order.createdAt,
              })),
              last_sellertray_message: input.context.lastOutboundMessage
                ? {
                    event: input.context.lastOutboundEventKey,
                    text: input.context.lastOutboundMessage.slice(0, 600),
                  }
                : null,
              last_product_enquiry: input.context.lastEnquiry
                ? {
                    enquiry_type: input.context.lastEnquiry.enquiryType,
                    product_query: input.context.lastEnquiry.productQuery,
                    matched_item_name: input.context.lastEnquiry.matchedItemName,
                    quoted_price: input.context.lastEnquiry.quotedPrice,
                    currency: input.context.lastEnquiry.currency,
                    status: input.context.lastEnquiry.status,
                    created_at: input.context.lastEnquiry.createdAt,
                  }
                : null,
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'sellertray_conversation_intent',
            strict: true,
            schema: outputSchema,
          },
        },
      }),
    });

    if (!response.ok) return null;
    const payload = await response.json() as unknown;
    const outputText = extractOutputText(payload);
    if (!outputText) return null;

    const raw = JSON.parse(outputText) as unknown;
    if (!isRecord(raw)) return null;

    const intent = typeof raw.intent === 'string' && ALLOWED_INTENTS.has(raw.intent as ConversationIntent)
      ? raw.intent as ConversationIntent
      : 'unknown';
    const confidence = clamp(numberValue(raw.confidence, 0));
    const usage = extractUsage(payload);

    return {
      intent,
      source: 'ai',
      confidence,
      explicitOrderRef: input.explicitOrderRef,
      targetOrderRef: cleanNullableString(raw.target_order_ref),
      paymentMethod: cleanNullableString(raw.payment_method),
      itemText: cleanNullableString(raw.item_text),
      deliveryText: cleanNullableString(raw.delivery_text),
      aiModel: usage.model,
      aiInputTokens: usage.inputTokens,
      aiOutputTokens: usage.outputTokens,
      aiTotalTokens: usage.totalTokens,
    };
  } catch (error) {
    console.warn('SellerTray conversation AI intent resolver unavailable', error);
    return null;
  }
}

function looksLikeNewOrder(normalized: string): boolean {
  if (looksLikeNonOrderWorkflow(normalized)) return false;
  if (/\b(?:how much|price|cost|available|availability|do you have|do you sell|in stock|tell me about|what size|which size)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(?:i want|i need|i need to buy|send me|give me|get me|bring me|i wan buy|i wan get|i go take|ill take|i will take|let me have|order)\b/i.test(normalized)) {
    return true;
  }
  const quantityWord = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|a dozen|half dozen|\d+)\b/i;
  const purchaseWord = /\b(?:carton|pack|piece|pcs|bottle|bag|crate|box|unit|kg|litre|liter)\b/i;
  if (quantityWord.test(normalized) && purchaseWord.test(normalized)) return true;

  const leadingQuantity = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\s+[a-z0-9]/i;
  const trailingQuantity = /[a-z]\s+(?:x\s*)?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)$/i;
  return leadingQuantity.test(normalized) || trailingQuantity.test(normalized);
}

function contextualOrderFromEnquiry(
  rawText: string,
  normalized: string,
  context: IntentConversationContext,
): IntentDecision | null {
  const enquiry = context.lastEnquiry;
  if (!enquiry || enquiry.status === 'converted' || enquiry.status === 'dismissed') return null;
  if (!enquiry.matchedItemName && !enquiry.productQuery) return null;
  if (!looksLikeEnquiryFollowUp(normalized)) return null;

  const quantity =
    extractFollowUpQuantity(normalized) ??
    (/\b(?:take it|give me it|send it|bring it|want it|need it)\b/i.test(normalized) ? '1' : null);
  const itemName = enquiry.matchedItemName ?? enquiry.productQuery ?? '';
  const orderText = (quantity ?? '1') + ' ' + itemName;

  return {
    ...emptyDecision('new_order', 'context', 0.96, null),
    itemText: orderText,
  };
}

function looksLikeEnquiryFollowUp(normalized: string): boolean {
  if (looksLikeNonOrderWorkflow(normalized)) return false;
  return /^(?:(?:ok|okay|alright|oya|yes|fine|good)\s+)?(?:give me|send me|bring me|i(?:ll| will)? take|let me have|make it|i want|i need|i go take)\b/i.test(normalized) ||
    /^(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b.*\b(?:please|abeg|thanks)?$/i.test(normalized);
}

function looksLikePaymentOptionsLanguage(normalized: string): boolean {
  return /\b(?:i want to pay|i wan pay|want to pay|make i pay|how can i pay|how do i pay|how to pay|where can i pay|where should i transfer|pay by|pay with|payment options|payment details|bank transfer|paystack|flutterwave|cash on delivery|pay on pickup)\b/i.test(normalized);
}

function paymentMethodFromSentence(normalized: string): string | null {
  if (/\b(?:paystack)\b/i.test(normalized)) return 'PAYSTACK';
  if (/\b(?:flutterwave|flw)\b/i.test(normalized)) return 'FLUTTERWAVE';
  if (/\b(?:cash on delivery|cod)\b/i.test(normalized)) return 'COD';
  if (/\b(?:pay on pickup|pickup)\b/i.test(normalized)) return 'PICKUP';
  if (/\b(?:bank transfer|transfer|bank)\b/i.test(normalized)) return 'BANK';
  return null;
}

function looksLikeNonOrderWorkflow(normalized: string): boolean {
  return (
    looksLikePaymentOptionsLanguage(normalized) ||
    /\b(?:paid|payment|refund|money back|receipt|invoice|cancel|stop order|order status|track my order|where is my order|delivery status|where is the rider|rider|pickup|pick up|collect|complaint|damaged|spoilt|spoiled|missing item)\b/i.test(normalized)
  );
}

function extractFollowUpQuantity(normalized: string): string | null {
  const match = normalized.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\b/i);
  if (!match) return null;
  const words: Record<string,string> = {
    one: '1', two: '2', three: '3', four: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  };
  return words[match[1].toLowerCase()] ?? match[1];
}

function extractOrderRef(value: string): string | null {
  const match = value.match(/\b[A-Z0-9]{3}\/[0-9]{6,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function itemTextForIntent(intent: ConversationIntent, normalized: string): string | null {
  return [
    'new_order',
    'order_add_items',
    'order_remove_items',
    'order_change_items',
    'product_price_enquiry',
    'product_availability_enquiry',
    'product_enquiry',
    'catalogue_query',
  ].includes(intent)
    ? normalized
    : null;
}

function normalizePaymentMethod(value: string): string {
  const token = normalizeIntentText(value).replace(/\s+/g, '_').toUpperCase();
  if (token === 'FLW') return 'FLUTTERWAVE';
  if (token === 'TRANSFER' || token === 'BANK_TRANSFER' || token === 'BANK') return 'BANK';
  if (token === 'PAY_ON_PICKUP') return 'PICKUP';
  return token;
}

function emptyDecision(
  intent: ConversationIntent,
  source: IntentSource,
  confidence: number,
  explicitOrderRef: string | null,
): IntentDecision {
  return {
    intent,
    source,
    confidence,
    explicitOrderRef,
    targetOrderRef: explicitOrderRef,
    paymentMethod: null,
    itemText: null,
    deliveryText: null,
    aiModel: null,
    aiInputTokens: null,
    aiOutputTokens: null,
    aiTotalTokens: null,
  };
}

function extractOutputText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.output_text === 'string' && value.output_text.trim()) return value.output_text;

  const output = Array.isArray(value.output) ? value.output : [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') {
        return part.text;
      }
    }
  }
  return null;
}

function extractUsage(value: unknown): {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  if (!isRecord(value)) {
    return { model: OPENAI_INTENT_MODEL, inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const usage = isRecord(value.usage) ? value.usage : {};
  return {
    model: typeof value.model === 'string' ? value.model : OPENAI_INTENT_MODEL,
    inputTokens: integerOrNull(usage.input_tokens),
    outputTokens: integerOrNull(usage.output_tokens),
    totalTokens: integerOrNull(usage.total_tokens),
  };
}

function cleanNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, 500) : null;
}

function integerOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
