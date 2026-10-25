import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = (path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
const selector = read('admin-web/src/MerchantSelector.tsx');
const commercial = read('admin-web/src/CommercialAdminWorkspaces.tsx');
const lifecycle = read('admin-web/src/AgreementLifecycleManagement.tsx');
const agreementsGateway = read('../supabase/functions/commercial-agreements/index.ts');
const c1a = read('../supabase/migrations/20261021001023_c1a_commercial_agreements_foundation.sql');

test('focused Agreements workspace exposes lifecycle after explicit merchant scope', () => {
  assert.match(commercial, /import AgreementLifecycleManagement/);
  assert.match(commercial, /<AgreementLifecycleManagement session=\{session\} tenantId=\{tenantId\}/);
  assert.match(selector, /showCommercialPortfolio === true/);
  assert.doesNotMatch(selector, /showCommercialPortfolio \?\? mode === 'single'/);
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
