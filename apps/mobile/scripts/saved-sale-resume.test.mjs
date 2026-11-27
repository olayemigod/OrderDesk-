import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildResumedPosDraft, buildResumedPosDraftEdits } from '../src/redesign/posDraftResume.ts';

function product(overrides = {}) {
  return {
    id: 'product-rice',
    name: 'Rice',
    isActive: true,
    stockUom: 'kg',
    uoms: [{ id: 'bag-50', name: 'Bag 50kg', sellingPrice: 50000, conversionFactor: 50, allowFractional: false }],
    ...overrides,
  };
}
function order(overrides = {}) {
  return {
    id: 'draft-001',
    branchId: 'branch-a',
    source: 'pos',
    status: 'draft',
    paymentStatus: 'unpaid',
    amountPaid: 0,
    customerId: 'customer-a',
    customerName: 'Ada',
    customerPhone: '',
    items: [{ id: 'line-001', catalogItemId: 'product-rice', name: 'Rice', selectedUom: 'Bag 50kg', quantity: 2 }],
    ...overrides,
  };
}

test('reopen only a saved unpaid POS draft while preserving customer, item and selected UOM', () => {
  const draft = buildResumedPosDraft(order(), [product()]);
  assert.equal(draft.orderId, 'draft-001');
  assert.equal(draft.branchId, 'branch-a');
  assert.deepEqual(draft.customer, { id: 'customer-a', name: 'Ada', phone: '' });
  assert.equal(draft.lines[0].orderItemId, 'line-001');
  assert.equal(draft.lines[0].uom.conversionFactor, 50);
});

test('do not resume paid, posted, or non-POS orders as saved sales', () => {
  for (const changed of [
    { amountPaid: 100 },
    { paymentStatus: 'verification_required' },
    { status: 'completed' },
    { source: 'whatsapp' },
    { status: 'cancelled' },
  ]) {
    assert.throws(() => buildResumedPosDraft(order(changed), [product()]), /Only an unpaid saved POS sale/);
  }
});

test('do not silently substitute disabled products or changed selling UOM', () => {
  assert.throws(() => buildResumedPosDraft(order(), [product({ isActive: false })]), /no longer available/);
  assert.throws(() => buildResumedPosDraft(order(), [product({ uoms: [{ id: 'other', name: 'Piece', sellingPrice: 10, allowFractional: false }] })]), /selling unit/);
  assert.throws(() => buildResumedPosDraft(order(), [product({ uoms: [{ id: 'bag-50', name: 'Bag 50kg', sellingPrice: null, allowFractional: false }] })]), /selling unit/);
});

test('reject duplicate product/UOM rows instead of silently rewriting stock or history', () => {
  const duplicated = order({ items: [order().items[0], { ...order().items[0], id: 'line-002' }] });
  assert.throws(() => buildResumedPosDraft(duplicated, [product()]), /duplicate/);
});

test('resumed edits retain original line identifiers and represent removed lines with zero', () => {
  const original = order({ items: [
    order().items[0],
    { id: 'line-002', catalogItemId: 'product-other', name: 'Other', selectedUom: 'Piece', quantity: 3 },
  ] });
  const loaded = buildResumedPosDraft(original, [product(), product({ id: 'product-other', name: 'Other', uoms: [{ id: 'piece', name: 'Piece', sellingPrice: 10, allowFractional: false }] })]);
  const edited = buildResumedPosDraftEdits(original, [{ ...loaded.lines[0], quantity: 4 }]);
  assert.deepEqual(edited, [{ orderItemId: 'line-001', quantity: 4 }, { orderItemId: 'line-002', quantity: 0 }]);
  assert.throws(() => buildResumedPosDraftEdits(original, [{ ...loaded.lines[0], orderItemId: 'invented' }]), /not part of the original/);
});
