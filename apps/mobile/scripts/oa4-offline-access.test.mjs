import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isCachedOperationalAccessAllowed as allowed } from '../src/data/offlineAccessPolicy.ts';

test('missing, denied or malformed cached access cannot enable offline selling', () => {
  assert.equal(allowed(null), false);
  assert.equal(allowed({ canWrite: false, validUntil: null }), false);
  assert.equal(allowed({ canWrite: true, validUntil: 'bad-date' }), false);
  assert.equal(allowed({ canWrite: true }), false);
});
test('cached entitlement expires at the authoritative boundary', () => {
  const end = '2026-10-24T12:00:00Z';
  assert.equal(allowed({ canWrite: true, validUntil: end }, Date.parse(end) - 1), true);
  assert.equal(allowed({ canWrite: true, validUntil: end }, Date.parse(end)), false);
  assert.equal(allowed({ canWrite: true, validUntil: end }, Date.parse(end) + 1), false);
});
test('legacy active access retains its existing unbounded compatibility semantics', () => {
  assert.equal(allowed({ canWrite: true, validUntil: null }), true);
});
