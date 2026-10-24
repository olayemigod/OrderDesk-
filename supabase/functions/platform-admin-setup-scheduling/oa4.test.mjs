import { strict as assert } from 'node:assert';
import { test } from 'node:test';

let handler;
globalThis.Deno = { env: { get: (key) => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key' })[key] }, serve: (fn) => { handler = fn; } };
await import('./index.ts');
const userId = '00000000-0000-4000-8000-000000000001';
const tenantId = '00000000-0000-4000-8000-000000000002';
const obligationId = '00000000-0000-4000-8000-000000000003';
const token = (aal) => `fixture.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.fixture`;
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status });
let calls = [];
globalThis.fetch = async (url, options) => {
  if (url.endsWith('/auth/v1/user')) return reply({ id: userId });
  const name = url.split('/').at(-1), body = JSON.parse(options.body);
  calls.push({ name, body });
  return reply(name === 'platform_admin_retry_setup_activation' ? { retryRequired: true } : {});
};
const request = (body, aal = 'aal2', authenticated = true) => new Request('https://fixture.invalid', { method: 'POST', headers: { ...(authenticated ? { authorization: `Bearer ${token(aal)}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('recovery requires verified authentication and AAL2 before any RPC', async () => {
  calls = [];
  assert.equal((await handler(request({ action: 'retry_activation', tenantId }, 'aal2', false))).status, 401);
  assert.equal((await handler(request({ action: 'retry_activation', tenantId }, 'aal1'))).status, 403);
  assert.equal(calls.length, 0);
});
test('malformed recovery subject and missing reason fail before RPC', async () => {
  calls = [];
  assert.equal((await handler(request(null))).status, 400);
  assert.equal((await handler(request({ action: 'retry_activation', tenantId, installmentObligationId: 'bad', reason: 'Retry setup' }))).status, 400);
  assert.equal((await handler(request({ action: 'retry_activation', tenantId, installmentObligationId: obligationId }))).status, 400);
  assert.equal(calls.length, 0);
});
test('recovery forwards verified actor and exposes unresolved results without a direct entitlement mutation', async () => {
  calls = [];
  const response = await handler(request({ action: 'retry_activation', tenantId, installmentObligationId: obligationId, actorUserId: tenantId, reason: 'Retry setup activation' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.retryRequired, true);
  assert.deepEqual(calls.map((c) => c.name), ['platform_admin_retry_setup_activation', 'platform_admin_setup_scheduling_center']);
  assert.equal(calls[0].body.p_actor_user_id, userId);
  assert.equal(calls[0].body.p_tenant_id, tenantId);
});
test('database capability denial is reported as forbidden', async () => {
  globalThis.fetch = async (url) => url.endsWith('/auth/v1/user') ? reply({ id: userId }) : reply({ message: 'Branch setup management capability required' }, 400);
  assert.equal((await handler(request({ action: 'retry_activation', tenantId, installmentObligationId: obligationId, reason: 'Retry setup activation' }))).status, 403);
});
