import { assertEquals } from 'jsr:@std/assert@1.0.14';
import { resolveConversationIntent, type IntentConversationContext } from './intent.ts';

const baseContext: IntentConversationContext = {
  orders: [],
  lastOutboundEventKey: null,
  lastOutboundMessage: null,
  lastEnquiry: {
    id: '11111111-1111-4111-8111-111111111111',
    enquiryType: 'price',
    productQuery: 'Rice',
    matchedCatalogItemId: '22222222-2222-4222-8222-222222222222',
    matchedItemName: 'Rice',
    quotedPrice: 55000,
    currency: 'NGN',
    status: 'replied',
    createdAt: new Date().toISOString(),
  },
};

Deno.test('payment wording cannot convert a recent enquiry to an order', async () => {
  const decision = await resolveConversationIntent({
    text: 'I want to pay by transfer ma',
    vocabulary: [],
    context: baseContext,
  });
  assertEquals(decision.intent, 'payment_method_select');
  assertEquals(decision.paymentMethod, 'BANK');
});

Deno.test('clear quantity commitment converts a matched enquiry contextually', async () => {
  const decision = await resolveConversationIntent({
    text: 'Okay give me 2 bags',
    vocabulary: [],
    context: baseContext,
  });
  assertEquals(decision.intent, 'new_order');
  assertEquals(decision.source, 'context');
  assertEquals(decision.itemText, '2 Rice');
});

Deno.test('unmatched enquiry does not overwrite a fresh explicit purchase sentence', async () => {
  const decision = await resolveConversationIntent({
    text: 'I want to buy a rechargeable battery',
    vocabulary: [],
    context: {
      ...baseContext,
      lastEnquiry: {
        ...baseContext.lastEnquiry!,
        matchedCatalogItemId: null,
        matchedItemName: null,
        productQuery: 'rechargeable battery',
      },
    },
  });
  assertEquals(decision.intent, 'new_order');
  assertEquals(decision.source, 'rules');
  assertEquals(decision.itemText, 'I want to buy a rechargeable battery');
});

Deno.test('price question remains an enquiry', async () => {
  const decision = await resolveConversationIntent({
    text: 'How much is a bag of rice',
    vocabulary: [],
    context: { ...baseContext, lastEnquiry: null },
  });
  assertEquals(decision.intent, 'product_price_enquiry');
});


Deno.test('cash on delivery is a payment method selection', async () => {
  const decision = await resolveConversationIntent({
    text: 'Cash on delivery',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'NLM/000006',
        status: 'accepted',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unassigned',
        createdAt: new Date().toISOString(),
      }],
      lastOutboundEventKey: 'order_accepted',
    },
  });
  assertEquals(decision.intent, 'payment_method_select');
  assertEquals(decision.paymentMethod, 'COD');
});

Deno.test('paying on delivery natural language selects COD', async () => {
  const decision = await resolveConversationIntent({
    text: 'I am paying on delivery',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'NLM/000006',
        status: 'accepted',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unassigned',
        createdAt: new Date().toISOString(),
      }],
      lastOutboundEventKey: 'payment_options',
    },
  });
  assertEquals(decision.intent, 'payment_method_select');
  assertEquals(decision.paymentMethod, 'COD');
});

Deno.test('bank display-name reply after payment options is routed as method selection', async () => {
  const decision = await resolveConversationIntent({
    text: 'Access Bank',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'NLM/000006',
        status: 'accepted',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unassigned',
        createdAt: new Date().toISOString(),
      }],
      lastOutboundEventKey: 'payment_options',
    },
  });
  assertEquals(decision.intent, 'payment_method_select');
  assertEquals(decision.paymentMethod, 'ACCESS_BANK');
});

Deno.test('paid claim is never treated as a new order', async () => {
  const decision = await resolveConversationIntent({
    text: 'I have transferred',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'NLM/000006',
        status: 'accepted',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unassigned',
        createdAt: new Date().toISOString(),
      }],
    },
  });
  assertEquals(decision.intent, 'payment_claim');
});
