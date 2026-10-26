import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = (path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
const workspace = read('admin-web/src/AdminWorkspace.tsx');
const selector = read('admin-web/src/MerchantSelector.tsx');
const commercial = read('admin-web/src/CommercialAdminWorkspaces.tsx');
const commercialState = read('admin-web/src/commercial-admin-state.ts');
const lifecycle = read('admin-web/src/AgreementLifecycleManagement.tsx');
const masterGateway = read('../supabase/functions/master-agreements/index.ts');
const legacyGateway = read('../supabase/functions/commercial-agreements/index.ts');
const masterAuthority = read('../supabase/migrations/20261026060117_universal_master_agreement_authority.sql');

test('focused Agreements workspace routes directly to the platform-scoped Master Agreement lifecycle', () => {
  assert.match(workspace, /\{ id: 'commercial\/agreements', label: 'Agreements', description: 'Master Agreement publication and Business acceptance history' \}/);
  assert.match(workspace, /case 'commercial\/agreements': return <PageFrame/);
  assert.match(workspace, /<AgreementLifecycleManagement session=\{session\} tenantId=\{tenantId \?\? undefined\} \/>/);
  assert.doesNotMatch(workspace, /CommercialAgreementAdministration/);
  assert.doesNotMatch(workspace, /commercial\/agreements'.*merchantScoped: true/);
  assert.doesNotMatch(commercial, /AgreementLifecycleManagement|CommercialAgreementAdministration|LegacyAgreementHistory|Legacy agreement history/);
  assert.doesNotMatch(commercialState, /OnboardingTemplate|OnboardingAgreement|templates:|agreements:|row\.family/);
  assert.match(selector, /showCommercialPortfolio === true/);
  assert.doesNotMatch(selector, /showCommercialPortfolio \?\? mode === 'single'/);
});

test('Agreements workspace publishes one universal version and reviews Business acceptance only', () => {
  assert.match(lifecycle, /tenantId\?: string/);
  assert.match(lifecycle, /'master-agreements'/);
  assert.match(lifecycle, /action: 'admin_get'/);
  assert.match(lifecycle, /action: 'admin_publish'/);
  assert.match(lifecycle, /state\?\.canPublish/);
  assert.match(lifecycle, /All SellerTray Businesses/);
  assert.match(lifecycle, /Merchant-specific issuance and order-specific agreement replacement are retired/);
  assert.match(lifecycle, /not tied to a commercial order, installment, Branch or payment/);
  assert.doesNotMatch(lifecycle, /action: 'admin_issue'/);
  assert.doesNotMatch(lifecycle, /supersedesAgreementId|commercialOrderId|installmentObligationId/);
  assert.doesNotMatch(lifecycle, /accept_sellertray_commercial_agreement/);
});

test('legacy commercial gateway fails closed on retired agreement mutations', () => {
  for (const action of ['merchant_accept', 'admin_publish_template', 'admin_issue']) {
    assert.match(legacyGateway, new RegExp(`'${action}'`));
  }
  assert.match(legacyGateway, /RETIRED_AGREEMENT_MUTATIONS/);
  assert.match(legacyGateway, /order-bound agreement mutation is retired/);
  assert.match(legacyGateway, /}, 410\);/);
  assert.doesNotMatch(legacyGateway, /accept_sellertray_commercial_agreement/);
  assert.doesNotMatch(legacyGateway, /publish_sellertray_commercial_agreement_template_admin/);
  assert.doesNotMatch(legacyGateway, /issue_sellertray_commercial_agreement_admin/);
});

test('shared Master Agreement authority is platform-wide and retires current-path order agreements', () => {
  assert.match(masterAuthority, /create table public\.sellertray_master_agreement_versions/);
  assert.match(masterAuthority, /create table public\.sellertray_master_agreement_acceptances/);
  assert.match(masterAuthority, /unique \(tenant_id,agreement_version_id\)/);
  assert.match(masterAuthority, /sellertray_master_agreement_accepted_at/);
  assert.match(masterAuthority, /Legacy order-bound agreement acceptance is retired/);
  assert.match(masterAuthority, /Legacy merchant\/order-specific agreement issuance is retired/);
  assert.match(masterAuthority, /prevent_sellertray_master_agreement_version_mutation/);
  assert.match(masterAuthority, /prevent_sellertray_master_agreement_acceptance_mutation/);
});

test('Master Agreement Admin gateway enforces verified publication authority', () => {
  assert.match(masterGateway, /action === 'admin_get'/);
  assert.match(masterGateway, /jwtAal\(token\) !== 'aal2'/);
  assert.match(masterGateway, /publish_sellertray_master_agreement_admin/);
  assert.match(masterGateway, /get_sellertray_master_agreement_admin/);
  assert.doesNotMatch(masterGateway, /issue_sellertray_commercial_agreement_admin/);
  assert.doesNotMatch(masterGateway, /accept_sellertray_commercial_agreement/);
});

test('agreement lifecycle does not invent commercial, refund, guarantee or entitlement policy', () => {
  assert.doesNotMatch(lifecycle, /dueAt|past_due|grace|refundAmount|guaranteeStatus|current_period_end|tenant_subscriptions/);
  assert.match(lifecycle, /Published versions are immutable and remain available for legal history/);
  assert.match(lifecycle, /Publish one immutable agreement version for the entire SellerTray platform/);
  assert.match(lifecycle, /review-only for Master Agreement publication/);
});
