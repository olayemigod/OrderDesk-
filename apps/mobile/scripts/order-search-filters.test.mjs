import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ORDER_FILTERS, matchesOrderSearch } from '../src/redesign/orderSearchFilters.ts';

const now = new Date('2026-11-09T12:00:00').getTime();
function order(overrides = {}) {
  return {
    id: 'order-1',
    publicOrderId: 'ST/ABC/000123',
    customerName: 'Ada Trading',
    customerPhone: '+2348012345678',
    source: 'pos',
    status: 'draft',
    paymentStatus: 'unpaid',
    amountPaid: 0,
    receivedAt: new Date(now - 60_000).toISOString(),
    grossAmount: 4000,
    items: [{ name: 'Semo 50kg', unitPrice: 4000, quantity: 1 }],
    ...overrides,
  };
}
function matching(row, overrides) {
  return matchesOrderSearch(row, { ...DEFAULT_ORDER_FILTERS, ...overrides }, now);
}

test('search covers order reference, customer, phone, and purchased products', () => {
  for (const query of ['000123', 'ada', '08012345678', 'semo']) {
    assert.equal(matching(order(), { query }), true, query);
  }
  assert.equal(matching(order(), { query: 'unknown buyer' }), false);
});

test('status filters keep saved POS drafts distinct from active and reviewed orders', () => {
  assert.equal(matching(order(), { status: 'draft' }), true);
  assert.equal(matching(order(), { status: 'active' }), false);
  assert.equal(matching(order({ status: 'processing' }), { status: 'active' }), true);
  assert.equal(matching(order({ status: 'needs_review' }), { status: 'needs_review' }), true);
});

test('payment filters preserve pending verification and partial collection semantics', () => {
  assert.equal(matching(order(), { payment: 'unpaid' }), true);
  assert.equal(matching(order({ amountPaid: 1000 }), { payment: 'partially_paid' }), true);
  assert.equal(matching(order({ paymentStatus: 'verification_required' }), { payment: 'awaiting_verification' }), true);
  assert.equal(matching(order({ paymentStatus: 'paid', amountPaid: 4000 }), { payment: 'partially_paid' }), false);
  assert.equal(matching(order({ paymentStatus: 'paid', amountPaid: 4000 }), { payment: 'paid' }), true);
});

test('source and date filters do not accept mismatching channels or stale history', () => {
  assert.equal(matching(order(), { source: 'whatsapp' }), false);
  assert.equal(matching(order({ source: 'whatsapp' }), { source: 'whatsapp' }), true);
  assert.equal(matching(order({ receivedAt: new Date(now - 8 * 86_400_000).toISOString() }), { period: 'seven_days' }), false);
  assert.equal(matching(order(), { period: 'today' }), true);
});
