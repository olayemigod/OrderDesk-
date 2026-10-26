import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from '../node_modules/typescript/lib/typescript.js';

const actorUserId = '00000000-0000-4000-8000-000000000101';
const tenantId = '00000000-0000-4000-8000-000000000201';
const orderFormId = '00000000-0000-4000-8000-000000000301';
const commandId = '00000000-0000-4000-8000-000000000401';
const commercialOrderId = '00000000-0000-4000-8000-000000000501';
const templateVersionId = '00000000-0000-4000-8000-000000000601';

const sourcePath = resolve(import.meta.dirname, '../../../supabase/functions/master-agreements/index.ts');
const source = readFileSync(sourcePath, 'utf8').replace(
  /^import \{ createClient \} from 'npm:@supabase\/supabase-js@2\.115\.0';/,
  'const createClient = globalThis.__sellertrayCreateClient;',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

let handler;
let calls = [];
let authenticated = true;
const center = {
  tenantId,
  actorRole: 'owner',
  canAccept: true,
  masterAcceptanceRequired: true,
  masterAgreement: { id: templateVersionId, versionCode: 'master-v1', acceptance: null },
  orderForms: [{ id: orderFormId, isCurrent: true, confirmation: null }],
  legacyAgreements: [],
};
const rpcResults = {
  get_sellertray_master_agreement_center: center,
  get_sellertray_installment_billing_states_for_tenant: [],
  reconcile_sellertray_installment_entitlements_for_tenant: [],
  confirm_sellertray_agreement_package: {
    masterAcceptanceId: '00000000-0000-4000-8000-000000000701',
    orderFormConfirmationId: '00000000-0000-4000-8000-000000000801',
    agreementPackageId: '00000000-0000-4000-8000-000000000901',
    packageFingerprint: 'a'.repeat(64),
  },
  issue_sellertray_commercial_order_form_admin: orderFormId,
};

globalThis.__sellertrayCreateClient = () => ({
  auth: {
    getUser: async () => authenticated
      ? { data: { user: { id: actorUserId } }, error: null }
      : { data: { user: null }, error: new Error('invalid token') },
  },
  rpc: async (name, args) => {
    calls.push({ name, args });
    if (!(name in rpcResults)) return { data: null, error: { message: `Unexpected RPC ${name}` } };
    return { data: rpcResults[name], error: null };
  },
});

new Function('Deno', compiled)({
  env: { get: (key) => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key' })[key] },
  serve: (value) => { handler = value; },
});

function request(body, authorization = true) {
  return handler(new Request('https://fixture.invalid/functions/v1/master-agreements', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization: 'Bearer fixture-token' } : {}) },
    body: JSON.stringify(body),
  }));
}

test('Master Agreement boundary requires authenticated identity', async () => {
  assert.equal((await request({ action: 'merchant_list', tenantId }, false)).status, 401);
  authenticated = false;
  assert.equal((await request({ action: 'merchant_list', tenantId })).status, 401);
  authenticated = true;
});

test('merchant read dispatches governed package and installment reads', async () => {
  calls = [];
  const response = await request({ action: 'merchant_list', tenantId, actorUserId: 'attacker' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.center.masterAcceptanceRequired, true);
  assert.ok(calls.some(({ name, args }) => name === 'get_sellertray_master_agreement_center'
    && args.p_tenant_id === tenantId && args.p_actor_user_id === actorUserId));
  assert.ok(calls.some(({ name }) => name === 'get_sellertray_installment_billing_states_for_tenant'));
});

test('merchant confirmation requires explicit authority and dispatches exact command facts', async () => {
  assert.equal((await request({
    action: 'merchant_confirm_package', tenantId, orderFormId, commandId,
    legalName: 'Merchant Owner', authorityConfirmed: false,
  })).status, 400);

  calls = [];
  const response = await request({
    action: 'merchant_confirm_package', tenantId, orderFormId, commandId,
    legalName: '  Merchant   Owner  ', authorityConfirmed: true,
  });
  assert.equal(response.status, 200);
  const call = calls.find(({ name }) => name === 'confirm_sellertray_agreement_package');
  assert.deepEqual(call?.args, {
    p_tenant_id: tenantId,
    p_order_form_id: orderFormId,
    p_confirmed_legal_name: 'Merchant Owner',
    p_request_evidence: { channel: 'merchant_web', authority_confirmed: true },
    p_command_id: commandId,
    p_actor_user_id: actorUserId,
  });
});

test('Admin issuance requires reason and uses Order Form authority', async () => {
  const incomplete = await request({
    action: 'admin_issue_order_form', tenantId, commercialOrderId, templateVersionId,
    reference: 'OF-001', renderedContent: 'Exact Order Form', reason: 'short',
  });
  assert.equal(incomplete.status, 400);

  calls = [];
  const response = await request({
    action: 'admin_issue_order_form', tenantId, commercialOrderId, templateVersionId,
    reference: 'OF-001', renderedContent: 'Exact Order Form', reason: 'Issue governed Order Form',
  });
  assert.equal(response.status, 201);
  const call = calls.find(({ name }) => name === 'issue_sellertray_commercial_order_form_admin');
  assert.equal(call?.args.p_reason, 'Issue governed Order Form');
  assert.equal(call?.args.p_actor_user_id, actorUserId);
  assert.equal(call?.args.p_commercial_order_id, commercialOrderId);
});
