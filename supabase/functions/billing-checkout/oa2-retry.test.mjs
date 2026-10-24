import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const source = stripTypeScriptTypes(readFileSync(new URL('./index.ts', import.meta.url), 'utf8'));
const input = { tenantId: 'fixture-business', installmentScheduleId: 'fixture-schedule', commandId: 'fixture-command', userId: 'fixture-owner', email: 'owner@example.com' };

function checkout(reservationStatus, initializationStatus = 'in_progress') {
  const calls = [];
  const reservation = { sessionId: 'fixture-session', status: reservationStatus, reference: 'fixture-reference', installmentScheduleId: input.installmentScheduleId, amount: 560, currency: 'NGN', planCode: 'business', needsProviderInitialization: true };
  const context = vm.createContext({
    Response, Request, Headers, URL, TextEncoder, TextDecoder, crypto, console, performance,
    Deno: { env: { get: () => 'fixture-only' }, serve: () => {} },
    fetch: async (url) => {
      calls.push(url);
      if (url.endsWith('/rpc/reserve_sellertray_installment_checkout')) return Response.json(reservation);
      if (url.endsWith('/rpc/begin_sellertray_installment_checkout_initialization')) {
        return Response.json({ started: false, status: initializationStatus, reference: 'fixture-reference' });
      }
      throw new Error(`Unexpected outbound request: ${url}`);
    },
  });
  vm.runInContext(source, context);
  return { run: () => vm.runInContext('startInstallmentCheckout', context)(input), calls };
}

for (const status of ['failed', 'superseded', 'expired']) {
  test(`${status} reservation retires its command before any provider request`, async () => {
    const fixture = checkout(status);
    const response = await fixture.run();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'retry_required');
    assert.equal(body.needsNewCommand, true);
    assert.equal(fixture.calls.length, 1);
  });
  test(`${status} initialization result safely requires a fresh explicit attempt`, async () => {
    const fixture = checkout('preparing', status);
    const body = await (await fixture.run()).json();
    assert.equal(body.status, 'retry_required');
    assert.equal(body.needsNewCommand, true);
    assert.equal(fixture.calls.length, 2);
  });
}

test('ambiguous initialization preserves the existing command and does not call the provider', async () => {
  const fixture = checkout('preparing');
  const response = await fixture.run();
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.status, 'preparing');
  assert.notEqual(body.needsNewCommand, true);
  assert.equal(fixture.calls.length, 2);
});

test('already paid reservation never starts another provider initialization', async () => {
  const fixture = checkout('paid');
  const body = await (await fixture.run()).json();
  assert.equal(body.status, 'paid');
  assert.equal(fixture.calls.length, 1);
});
