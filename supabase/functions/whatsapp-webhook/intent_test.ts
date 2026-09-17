import { assertEquals } from 'jsr:@std/assert@1.0.14';
import { resolveConversationIntent, type IntentConversationContext } from './intent.ts';

const baseContext: IntentConversationContext = {
  orders: [],
  lastOutboundEventKey: null,
  lastOutboundMessage: null,
  lastInboundMessageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  lastInboundMessage: 'How much is rice',
  lastInboundReceivedAt: new Date().toISOString(),
  pendingClarificationIntent: null,
  pendingClarificationOrderRefs: [],
  pendingClarificationCreatedAt: null,
  lastEnquiry: {
    id: '11111111-1111-4111-8111-111111111111',
    sourceInboundMessageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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


Deno.test('pay on pickup selects payment method instead of fulfillment pickup', async () => {
  const decision = await resolveConversationIntent({
    text: 'I will pay on pickup',
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
  assertEquals(decision.intent, 'payment_method_select');
  assertEquals(decision.paymentMethod, 'PICKUP');
});


Deno.test('numeric payment option reply is routed after payment options', async () => {
  const decision = await resolveConversationIntent({
    text: '1',
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
  assertEquals(decision.paymentMethod, '1');
});

Deno.test('explicit product wording overrides older matched enquiry context', async () => {
  const decision = await resolveConversationIntent({
    text: 'I want to buy 2 rechargeable batteries',
    vocabulary: [],
    context: baseContext,
  });
  assertEquals(decision.intent, 'new_order');
  assertEquals(decision.source, 'rules');
  assertEquals(decision.itemText, 'I want to buy 2 rechargeable batteries');
});

Deno.test('natural customer pickup wording is recognised', async () => {
  const decision = await resolveConversationIntent({
    text: 'I will come and pick up',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'REV/000003',
        status: 'accepted',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unassigned',
        createdAt: new Date().toISOString(),
      }],
    },
  });
  assertEquals(decision.intent, 'pickup_request');
});

Deno.test('natural receipt request is recognised', async () => {
  const decision = await resolveConversationIntent({
    text: 'I need receipt please',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'REV/000003',
        status: 'completed',
        paymentStatus: 'paid',
        fulfillmentStatus: 'collected',
        createdAt: new Date().toISOString(),
      }],
    },
  });
  assertEquals(decision.intent, 'financial_receipt_request');
});

Deno.test('short acknowledgement is chatter instead of unknown', async () => {
  const decision = await resolveConversationIntent({
    text: 'Okay noted',
    vocabulary: [],
    context: baseContext,
  });
  assertEquals(decision.intent, 'general_chatter');
});

Deno.test('pronoun price follow-up uses only the immediately previous enquiry', async () => {
  const decision = await resolveConversationIntent({
    text: 'How much is it',
    vocabulary: [],
    context: baseContext,
  });
  assertEquals(decision.intent, 'product_price_enquiry');
  assertEquals(decision.source, 'context');
  assertEquals(decision.itemText, 'Rice');
});

Deno.test('pronoun price follow-up does not jump over an intervening customer message', async () => {
  const decision = await resolveConversationIntent({
    text: 'How much is it',
    vocabulary: [],
    context: {
      ...baseContext,
      lastInboundMessageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      lastInboundMessage: 'Good day want to buy 50k bag of rice',
    },
  });
  assertEquals(decision.intent, 'product_price_enquiry');
  assertEquals(decision.source, 'rules');
  assertEquals(decision.itemText, 'How much is it');
});

Deno.test('receipt clarification accepts numeric order suffix', async () => {
  const now = new Date().toISOString();
  const decision = await resolveConversationIntent({
    text: '0000003',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [
        {
          id: '33333333-3333-4333-8333-333333333331',
          publicOrderId: 'REV/000003',
          status: 'completed',
          paymentStatus: 'paid',
          fulfillmentStatus: 'collected',
          createdAt: now,
        },
        {
          id: '33333333-3333-4333-8333-333333333332',
          publicOrderId: 'REV/000002',
          status: 'completed',
          paymentStatus: 'paid',
          fulfillmentStatus: 'collected',
          createdAt: new Date(Date.now() - 60000).toISOString(),
        },
      ],
      pendingClarificationIntent: 'financial_receipt_request',
      pendingClarificationOrderRefs: ['REV/000003', 'REV/000002'],
      pendingClarificationCreatedAt: now,
    },
  });
  assertEquals(decision.intent, 'financial_receipt_request');
  assertEquals(decision.source, 'context');
  assertEquals(decision.targetOrderRef, 'REV/000003');
});

Deno.test('receipt clarification accepts latest order', async () => {
  const now = new Date().toISOString();
  const decision = await resolveConversationIntent({
    text: 'Latest order',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [
        {
          id: '33333333-3333-4333-8333-333333333331',
          publicOrderId: 'REV/000003',
          status: 'completed',
          paymentStatus: 'paid',
          fulfillmentStatus: 'collected',
          createdAt: now,
        },
        {
          id: '33333333-3333-4333-8333-333333333332',
          publicOrderId: 'REV/000002',
          status: 'completed',
          paymentStatus: 'paid',
          fulfillmentStatus: 'collected',
          createdAt: new Date(Date.now() - 60000).toISOString(),
        },
      ],
      pendingClarificationIntent: 'financial_receipt_request',
      pendingClarificationOrderRefs: ['REV/000003', 'REV/000002'],
      pendingClarificationCreatedAt: now,
    },
  });
  assertEquals(decision.intent, 'financial_receipt_request');
  assertEquals(decision.targetOrderRef, 'REV/000003');
});

Deno.test('pickup tomorrow wording is recognised', async () => {
  const decision = await resolveConversationIntent({
    text: 'I will come and pick tomorrow',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'REV/000004',
        status: 'accepted',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unassigned',
        createdAt: new Date().toISOString(),
      }],
    },
  });
  assertEquals(decision.intent, 'pickup_request');
});

Deno.test('no problem is normal chatter', async () => {
  const decision = await resolveConversationIntent({
    text: 'No problem',
    vocabulary: [],
    context: baseContext,
  });
  assertEquals(decision.intent, 'general_chatter');
});

Deno.test('obvious it typo can use immediate enquiry context', async () => {
  const decision = await resolveConversationIntent({
    text: 'How much is ot',
    vocabulary: [],
    context: baseContext,
  });
  assertEquals(decision.intent, 'product_price_enquiry');
  assertEquals(decision.source, 'context');
  assertEquals(decision.itemText, 'Rice');
});


Deno.test('Pidgin pronoun price enquiry uses immediate catalogue context', async () => {
  const decision = await resolveConversationIntent({
    text: 'Abeg how much be this?',
    vocabulary: [],
    context: baseContext,
  });
  assertEquals(decision.intent, 'product_price_enquiry');
  assertEquals(decision.source, 'context');
  assertEquals(decision.itemText, 'Rice');
});

Deno.test('Pidgin availability pronoun uses immediate catalogue context', async () => {
  const decision = await resolveConversationIntent({
    text: 'Abeg you get am?',
    vocabulary: [],
    context: baseContext,
  });
  assertEquals(decision.intent, 'product_availability_enquiry');
  assertEquals(decision.source, 'context');
  assertEquals(decision.itemText, 'Rice');
});

Deno.test('Pidgin purchase commitment is an order and not an enquiry', async () => {
  const decision = await resolveConversationIntent({
    text: 'I wan buy 3 rechargeable batteries',
    vocabulary: [],
    context: { ...baseContext, lastEnquiry: null },
  });
  assertEquals(decision.intent, 'new_order');
  assertEquals(decision.source, 'rules');
  assertEquals(decision.itemText, 'I wan buy 3 rechargeable batteries');
});

Deno.test('Pidgin delivery instruction stays attached to an active order', async () => {
  const decision = await resolveConversationIntent({
    text: 'You fit send am tomorrow?',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'NLM/000009',
        status: 'accepted',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unassigned',
        createdAt: new Date().toISOString(),
      }],
    },
  });
  assertEquals(decision.intent, 'delivery_instruction');
  assertEquals(decision.source, 'context');
  assertEquals(decision.deliveryText, 'You fit send am tomorrow?');
});

Deno.test('Pidgin delivery wording without active order is not fabricated into an order', async () => {
  const decision = await resolveConversationIntent({
    text: 'You fit send am tomorrow?',
    vocabulary: [],
    context: { ...baseContext, orders: [], lastEnquiry: null },
  });
  assertEquals(decision.intent, 'unknown');
});

Deno.test('Pidgin cancellation phrase maps to order cancellation', async () => {
  const decision = await resolveConversationIntent({
    text: 'I no want again',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'NLM/000010',
        status: 'accepted',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unassigned',
        createdAt: new Date().toISOString(),
      }],
    },
  });
  assertEquals(decision.intent, 'order_cancel');
});

Deno.test('Pidgin payment claim never means payment verified', async () => {
  const decision = await resolveConversationIntent({
    text: 'I don transfer',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'NLM/000011',
        status: 'accepted',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unassigned',
        createdAt: new Date().toISOString(),
      }],
    },
  });
  assertEquals(decision.intent, 'payment_claim');
});

Deno.test('Pidgin quantity amendment maps to order change', async () => {
  const decision = await resolveConversationIntent({
    text: 'Make am two',
    vocabulary: [],
    context: {
      ...baseContext,
      orders: [{
        id: '33333333-3333-4333-8333-333333333333',
        publicOrderId: 'NLM/000012',
        status: 'accepted',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unassigned',
        createdAt: new Date().toISOString(),
      }],
    },
  });
  assertEquals(decision.intent, 'order_change_items');
  assertEquals(decision.itemText, 'make am two');
});
