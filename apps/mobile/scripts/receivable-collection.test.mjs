import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

// Exercise the real repository with only the transport and UUID factory stubbed.
let response;
let thrown;
const requests = [];
globalThis.__receivableTransport = {
  async rpc(name, args) {
    requests.push({ name, args });
    if (thrown) throw thrown;
    return response;
  },
};
const source = (await readFile(new URL('../src/data/receivablesRepository.ts', import.meta.url), 'utf8'))
  .replace("import { supabase } from '../lib/supabase';", 'const supabase = globalThis.__receivableTransport;')
  .replace("import { createPosClientReference } from './commerceRepository';", "const createPosClientReference = () => 'generated-command';");
const { collectCustomerBalance, customerCollectionErrorMessage: message } = await import(
  'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64')
);
const input = { tenantId: 'business', orderId: 'sale', paymentMethodId: null, amount: 12.5, commandId: 'same-command' };
test('uses the governed command and preserves identity on repeated Cash/Terminal/Bank requests', async () => {
  for (const [methodType, status] of [['cash', 'confirmed'], ['card_terminal', 'confirmed'], ['bank_transfer', 'pending_verification']]) {
    response = { data: { orderId: 'sale', amount: 12.5, methodType, status }, error: null };
    assert.equal((await collectCustomerBalance(input)).status, status);
    assert.equal((await collectCustomerBalance(input)).status, status);
    assert.equal(requests.at(-1).name, 'collect_sellertray_customer_receivable');
    assert.equal(requests.at(-1).args.p_command_id, 'same-command');
    assert.deepEqual(requests.at(-1), requests.at(-2));
  }
});
test('structured governed rejection becomes an actionable Error instead of an opaque object', async () => {
  response = { data: null, error: { code: '23514', message: 'Payment exceeds the outstanding customer balance' } };
  await assert.rejects(collectCustomerBalance(input), /outstanding balance has changed/);
  assert.match(message({ code: '42501', message: 'internal secret SQL' }), /permission/);
  assert.match(message({ code: '23514', message: 'Payment method is not enabled for this Branch' }), /no longer available/);
  assert.match(message({ code: '23514', message: 'Payment exceeds the unreserved customer balance' }), /awaiting verification/);
  assert.match(message({ code: '23514', message: 'Open a cashier shift in this Branch before taking counter cash payments' }), /Open a cashier shift/);
});
test('unknown SQL and transport errors do not leak internals or turn into confirmation', async () => {
  for (const code of ['XX000', '23514', '22023', undefined]) {
    const safe = message({ code, message: 'select service_role_secret from pg_private', details: 'stack trace' });
    assert.doesNotMatch(safe, /service_role|pg_private|stack trace|select /);
    assert.match(safe, /retry the same payment/);
  }
  thrown = new TypeError('fetch failed with private details');
  await assert.rejects(collectCustomerBalance(input), /Check your connection and retry the same payment/);
  thrown = null;
  response = { data: { orderId: 'sale', amount: 12.5, methodType: 'cash', status: 'invented' }, error: null };
  await assert.rejects(collectCustomerBalance(input), /invalid customer payment result/);
});
test('both collection callers keep the command reference across an uncertain failure', async () => {
  for (const path of ['../src/redesign/OrderBalanceCollection.tsx', '../../merchant-web/src/ReceivablesManagement.tsx']) {
    const ui = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(ui, /collectionCommand = useRef/);
    assert.match(ui, /collectionCommand.current.id/);
    const catchBlock = ui.slice(ui.indexOf('async function collect()')).split('catch (cause)')[1].split('finally')[0];
    assert.doesNotMatch(catchBlock, /collectionCommand.current = null/);
  }
});
