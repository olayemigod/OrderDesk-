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
