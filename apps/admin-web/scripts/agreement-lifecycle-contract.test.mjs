import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = (path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
const selector = read('admin-web/src/MerchantSelector.tsx');
const lifecycle = read('admin-web/src/AgreementLifecycleManagement.tsx');
const billing = read('admin-web/src/CommercialBillingAdministration.tsx');
const agreementsGateway = read('../supabase/functions/commercial-agreements/index.ts');
const masterGateway = read('../supabase/functions/master-agreements/index.ts');
const c1a = read('../supabase/migrations/20261021001023_c1a_commercial_agreements_foundation.sql');

test('single-Business Billing exposes agreement lifecycle after merchant selection only', () => {
  assert.match(selector, /import AgreementLifecycleManagement/);
  assert.match(selector, /selectedTenantId = mode === 'single'/);
  assert.match(selector, /<AgreementLifecycleManagement session=\{session\} tenantId=\{selectedTenantId\}/);
});

test('replacement workflow reuses governed Admin issue authority and explicit supersession', () => {
  assert.match(lifecycle, /'commercial-agreements'/);
  assert.match(lifecycle, /action: 'admin_overview'/);
  assert.match(lifecycle, /action: 'admin_issue'/);
  assert.match(lifecycle, /supersedesAgreementId: agreement\.id/);
  assert.match(lifecycle, /commercialOrderId: agreement\.commercialOrderId/);
  assert.match(lifecycle, /installmentObligationId: agreement\.installmentObligationId/);
  assert.match(lifecycle, /template\.family === agreement\.family/);
  assert.match(lifecycle, /state\?\.canManage/);
  assert.doesNotMatch(lifecycle, /\.from\(['"]sellertray_commercial_agreements/);
  assert.doesNotMatch(lifecycle, /accept_sellertray_commercial_agreement/);
});

test('shared C1A authority keeps replacement subject and history immutable', () => {
  assert.match(c1a, /Replacement agreement must preserve the original commercial subject/);
  assert.match(c1a, /SellerTray agreement has already been replaced/);
  assert.match(c1a, /Existing SellerTray agreement must be explicitly superseded/);
  assert.match(c1a, /prevent_sellertray_commercial_agreement_mutation/);
  assert.match(c1a, /prevent_sellertray_commercial_agreement_acceptance_mutation/);
});

test('commercial gateway already accepts explicit supersession through the governed issue RPC', () => {
  assert.match(agreementsGateway, /const supersedesAgreementId = optionalUuid\(body\.supersedesAgreementId\)/);
  assert.match(agreementsGateway, /p_supersedes_agreement_id: supersedesAgreementId/);
  assert.match(agreementsGateway, /issue_sellertray_commercial_agreement_admin/);
});

test('agreement lifecycle does not invent due, refund, guarantee decision or entitlement mutation policy', () => {
  assert.doesNotMatch(lifecycle, /dueAt|past_due|grace|refundAmount|guaranteeStatus|current_period_end|tenant_subscriptions/);
  assert.match(lifecycle, /requires fresh merchant acceptance/);
  assert.match(lifecycle, /remains immutable historical evidence/);
});

test('new commercial purchases issue Order Forms through the Master Agreement boundary', () => {
  assert.match(billing, /'master-agreements'/);
  assert.match(billing, /action: 'admin_issue_order_form'/);
  assert.match(billing, /Issue Order Form/);
  assert.match(masterGateway, /issue_sellertray_commercial_order_form_admin/);
  assert.doesNotMatch(agreementsGateway, /action === 'merchant_accept'/);
});
