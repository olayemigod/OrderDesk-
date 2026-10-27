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
const installmentObligationId = '00000000-0000-4000-8000-000000000602';
const agreementPackageId = '00000000-0000-4000-8000-000000000901';
const packageFingerprint = 'a'.repeat(64);

const sourcePath = resolve(import.meta.dirname, '../../../supabase/functions/master-agreements/index.ts');
const source = readFileSync(sourcePath, 'utf8')
  .replace(
    /^import \{ createClient \} from 'npm:@supabase\/supabase-js@2\.115\.0';/m,
    'const createClient = globalThis.__sellertrayCreateClient;',
  )
  .replace(
    /^import \{ buildAgreementPackagePdf, inspectUploadedMasterPdf, sha256Hex, type AgreementPdfInput \} from '\.\/agreement-pdf\.ts';/m,
    [
      'const buildAgreementPackagePdf = globalThis.__sellertrayBuildAgreementPackagePdf;',
      'const inspectUploadedMasterPdf = globalThis.__sellertrayInspectUploadedMasterPdf;',
      'const sha256Hex = globalThis.__sellertraySha256Hex;',
    ].join('\n'),
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
const adminOverview = { actorRole: 'admin', canPublish: true, canIssueOrderForms: true, versions: [], orderForms: [] };
const rpcResults = {
  get_sellertray_agreement_package_center: center,
  get_sellertray_order_forms_admin: adminOverview,
  reconcile_sellertray_installment_entitlements_for_tenant: [],
  confirm_sellertray_agreement_package_reviewed: {
    masterAcceptanceId: '00000000-0000-4000-8000-000000000701',
    masterAcceptanceCreated: true,
    orderFormConfirmationId: '00000000-0000-4000-8000-000000000801',
    orderFormConfirmationCreated: true,
    agreementPackageId,
    packageFingerprint,
  },
  publish_sellertray_order_form_template_admin: templateVersionId,
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
globalThis.__sellertrayBuildAgreementPackagePdf = async () => new Uint8Array([37, 80, 68, 70, 45]);
globalThis.__sellertrayInspectUploadedMasterPdf = async () => ({
  text: 'Reviewed SellerTray Master Agreement legal content for test execution.'.repeat(3),
  pageCount: 1,
  pdfSha256: 'b'.repeat(64),
});
globalThis.__sellertraySha256Hex = async () => 'c'.repeat(64);

new Function('Deno', compiled)({
  env: { get: (key) => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key' })[key] },
  serve: (value) => { handler = value; },
});

function token(aal = 'aal1') {
  const payload = Buffer.from(JSON.stringify({ aal })).toString('base64url');
  return `e30.${payload}.fixture`;
}
function request(body, authorization = token()) {
  return handler(new Request('https://fixture.invalid/functions/v1/master-agreements', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) },
    body: JSON.stringify(body),
  }));
}

test('Master Agreement boundary requires authenticated identity', async () => {
  assert.equal((await request({ action: 'merchant_get', tenantId }, '')).status, 401);
  authenticated = false;
  assert.equal((await request({ action: 'merchant_get', tenantId })).status, 401);
  authenticated = true;
});

test('merchant read derives actor from authentication and dispatches governed package read', async () => {
  calls = [];
  const response = await request({ action: 'merchant_get', tenantId, actorUserId: 'attacker' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.center.masterAcceptanceRequired, true);
  assert.ok(calls.some(({ name, args }) => name === 'get_sellertray_agreement_package_center'
    && args.p_tenant_id === tenantId && args.p_actor_user_id === actorUserId));
});

test('legacy direct Master acceptance action fails closed', async () => {
  const response = await request({ action: 'merchant_accept', tenantId, agreementVersionId: templateVersionId });
  assert.equal(response.status, 409);
});

test('merchant package confirmation requires exact reviewed package and explicit authority', async () => {
  assert.equal((await request({
    action: 'merchant_confirm_package', tenantId, orderFormId, commandId,
    legalName: 'Merchant Owner', authorityConfirmed: true,
  })).status, 400);

  assert.equal((await request({
    action: 'merchant_confirm_package', tenantId, orderFormId, commandId,
    expectedPackageId: agreementPackageId, expectedPackageFingerprint: packageFingerprint,
    legalName: 'Merchant Owner', authorityConfirmed: false,
  })).status, 400);

  calls = [];
  const response = await request({
    action: 'merchant_confirm_package', tenantId, orderFormId, commandId,
    expectedPackageId: agreementPackageId,
    expectedPackageFingerprint: packageFingerprint,
    legalName: '  Merchant   Owner  ', authorityConfirmed: true,
    actorUserId: '00000000-0000-4000-8000-000000000999',
  });
  assert.equal(response.status, 200);
  const call = calls.find(({ name }) => name === 'confirm_sellertray_agreement_package_reviewed');
  assert.deepEqual(call?.args, {
    p_tenant_id: tenantId,
    p_order_form_id: orderFormId,
    p_expected_package_id: agreementPackageId,
    p_expected_package_fingerprint: packageFingerprint,
    p_confirmed_legal_name: 'Merchant Owner',
    p_request_evidence: {
      channel: 'merchant_web',
      authority_confirmed: true,
      electronic_signature_method: 'authenticated_typed_legal_name',
    },
    p_command_id: commandId,
    p_actor_user_id: actorUserId,
  });
  assert.ok(calls.some(({ name }) => name === 'reconcile_sellertray_installment_entitlements_for_tenant'));
});

test('Admin legal mutations require AAL2', async () => {
  const template = await request({
    action: 'admin_publish_order_form_template', tenantId, family: 'installment_agreement',
    versionCode: 'of-v1', title: 'SellerTray Order Form', contentBody: 'Reviewed Order Form legal text.',
    effectiveFrom: '2026-10-27T00:00:00.000Z', reason: 'Publish reviewed Order Form',
  }, token('aal1'));
  assert.equal(template.status, 403);

  const issuance = await request({
    action: 'admin_issue_order_form', tenantId, commercialOrderId, installmentObligationId,
    templateVersionId, orderFormReference: 'OF-001', reason: 'Issue governed Order Form',
  }, token('aal1'));
  assert.equal(issuance.status, 403);
});

test('AAL2 Order Form template publication uses authenticated actor and governed RPC', async () => {
  calls = [];
  const response = await request({
    action: 'admin_publish_order_form_template', tenantId, family: 'installment_agreement',
    versionCode: 'of-v1', title: 'SellerTray Order Form', contentBody: 'Reviewed Order Form legal text.',
    effectiveFrom: '2026-10-27T00:00:00.000Z', reason: 'Publish reviewed Order Form',
    actorUserId: '00000000-0000-4000-8000-000000000999',
  }, token('aal2'));
  assert.equal(response.status, 201);
  const call = calls.find(({ name }) => name === 'publish_sellertray_order_form_template_admin');
  assert.deepEqual(call?.args, {
    p_agreement_family: 'installment_agreement',
    p_version_code: 'of-v1',
    p_title: 'SellerTray Order Form',
    p_content_body: 'Reviewed Order Form legal text.',
    p_effective_from: '2026-10-27T00:00:00.000Z',
    p_reason: 'Publish reviewed Order Form',
    p_actor_user_id: actorUserId,
  });
});

test('Admin Order Form issuance validates reason', async () => {
  const incomplete = await request({
    action: 'admin_issue_order_form', tenantId, commercialOrderId, installmentObligationId,
    templateVersionId, orderFormReference: 'OF-001', reason: 'short',
  }, token('aal2'));
  assert.equal(incomplete.status, 400);
});

test('AAL2 Admin Order Form issuance uses authenticated actor and governed RPC', async () => {
  calls = [];
  const response = await request({
    action: 'admin_issue_order_form', tenantId, commercialOrderId, installmentObligationId,
    templateVersionId, orderFormReference: 'OF-001', reason: 'Issue governed Order Form',
    actorUserId: '00000000-0000-4000-8000-000000000999',
  }, token('aal2'));
  assert.equal(response.status, 201);
  const call = calls.find(({ name }) => name === 'issue_sellertray_commercial_order_form_admin');
  assert.deepEqual(call?.args, {
    p_tenant_id: tenantId,
    p_commercial_order_id: commercialOrderId,
    p_installment_obligation_id: installmentObligationId,
    p_template_version_id: templateVersionId,
    p_order_form_reference: 'OF-001',
    p_supersedes_order_form_id: null,
    p_reason: 'Issue governed Order Form',
    p_actor_user_id: actorUserId,
  });
});
