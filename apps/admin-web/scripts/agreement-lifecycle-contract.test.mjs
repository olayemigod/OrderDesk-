import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = (path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
const selector = read('admin-web/src/MerchantSelector.tsx');
const commercial = read('admin-web/src/CommercialAdminWorkspaces.tsx');
const lifecycle = read('admin-web/src/AgreementLifecycleManagement.tsx');
const masterGateway = read('../supabase/functions/master-agreements/index.ts');
const masterAuthority = read('../supabase/migrations/20261026060117_universal_master_agreement_authority.sql');
const packageAuthority = read('../supabase/migrations/20261027100000_master_order_form_package_oa5c_convergence.sql');
const retirement = read('../supabase/migrations/20261027100100_order_form_admin_boundary_and_legacy_retirement.sql');
const quarantineAuthority = read('../supabase/migrations/20261027123000_master_agreement_publication_quarantine.sql');
const documentAuthority = read('../supabase/migrations/20261027170000_agreement_document_artifacts.sql');
const zeroTouchAuthority = read('../supabase/migrations/20261027173000_agreement_package_zero_touch_orchestration.sql');

test('focused Agreements workspace keeps universal governance and reusable Order Form configuration without routine issuance', () => {
  assert.match(commercial, /import AgreementLifecycleManagement/);
  assert.match(commercial, /<AgreementLifecycleManagement session=\{session\} tenantId=\{tenantId\}/);
  assert.match(commercial, /title="Order Form templates"/);
  assert.match(commercial, /Automatic agreement orchestration/);
  assert.match(commercial, /Zero-touch normal path/);
  assert.match(commercial, /action: 'admin_publish_order_form_template'/);
  assert.doesNotMatch(commercial, /title="Issue Order Form"/);
  assert.doesNotMatch(commercial, /action: 'admin_issue_order_form'/);
  assert.doesNotMatch(commercial, /Order Form reference<input/);
  assert.doesNotMatch(commercial, /Rendered agreement content/);
  assert.match(selector, /showCommercialPortfolio === true/);
  assert.doesNotMatch(selector, /showCommercialPortfolio \?\? mode === 'single'/);
});

test('universal Master Agreement publication remains one platform-wide immutable authority with redesigned List/Add views', () => {
  assert.match(lifecycle, /'master-agreements'/);
  assert.match(lifecycle, /action:'admin_get'/);
  assert.match(lifecycle, /action:'admin_publish'/);
  assert.match(lifecycle, /action:'admin_publish_pdf'/);
  assert.match(lifecycle, /state\?\.canPublish/);
  assert.match(lifecycle, /All SellerTray Businesses/);
  assert.match(lifecycle, /Merchant-specific issuance remains retired/);
  assert.match(lifecycle, /List View/);
  assert.match(lifecycle, /Add New/);
  assert.match(lifecycle, /Upload reviewed PDF/);
  assert.match(lifecycle, /Paste legal content/);
  assert.match(lifecycle, /not tied to an order, installment, Branch or payment/);
  assert.doesNotMatch(lifecycle, /action:'admin_issue_order_form'/);
});

test('Master Agreement authority remains platform-wide while Order Forms are exact automatically-instantiated purchase evidence', () => {
  assert.match(masterAuthority, /create table public\.sellertray_master_agreement_versions/);
  assert.match(masterAuthority, /create table public\.sellertray_master_agreement_acceptances/);
  assert.match(masterAuthority, /unique \(tenant_id,agreement_version_id\)/);
  assert.match(masterAuthority, /sellertray_master_agreement_accepted_at/);
  assert.match(masterAuthority, /prevent_sellertray_master_agreement_version_mutation/);
  assert.match(masterAuthority, /prevent_sellertray_master_agreement_acceptance_mutation/);
  assert.match(packageAuthority, /create table public\.sellertray_commercial_order_forms/);
  assert.match(packageAuthority, /create table public\.sellertray_agreement_packages/);
  assert.match(packageAuthority, /create table public\.sellertray_order_form_confirmations/);
  assert.match(packageAuthority, /commercial_snapshot_sha256/);
  assert.match(packageAuthority, /package_fingerprint/);
  assert.match(packageAuthority, /sellertray_installment_contract_accepted_at/);
  assert.match(zeroTouchAuthority, /ensure_sellertray_agreement_package_for_commercial_order/);
  assert.match(zeroTouchAuthority, /orchestrate_sellertray_agreement_package_after_installment_schedule/);
  assert.match(zeroTouchAuthority, /ST-OF-/);
  assert.match(zeroTouchAuthority, /order_form_template_missing/);
  assert.match(zeroTouchAuthority, /master_agreement_missing/);
});

test('invalid Master publications are quarantined without rewriting immutable legal evidence', () => {
  assert.match(quarantineAuthority, /sellertray_master_agreement_version_quarantines/);
  assert.match(quarantineAuthority, /quarantine_sellertray_master_agreement_version_admin/);
  assert.match(quarantineAuthority, /sellertray_master_agreement_version_quarantined/);
  assert.match(quarantineAuthority, /resolve_sellertray_master_agreement_version_id/);
  assert.match(quarantineAuthority, /not exists[\s\S]*sellertray_master_agreement_version_quarantines/);
  assert.match(quarantineAuthority, /'quarantined',q\.id is not null/);
  assert.match(quarantineAuthority, /'quarantineReason',q\.reason/);
  assert.doesNotMatch(quarantineAuthority, /delete from public\.sellertray_master_agreement_versions/);
  assert.doesNotMatch(quarantineAuthority, /update public\.sellertray_master_agreement_versions/);
});

test('reviewed PDF upload remains an immutable version publication path rather than a file attachment shortcut', () => {
  assert.match(documentAuthority, /sellertray_master_agreement_source_documents/);
  assert.match(documentAuthority, /publish_sellertray_master_agreement_pdf_admin/);
  assert.match(documentAuthority, /publication_command_id/);
  assert.match(documentAuthority, /sourcePdfSha256|source_pdf_sha256/i);
  assert.match(documentAuthority, /cannot receive a later source PDF/);
  assert.match(documentAuthority, /sellertray_master_agreement_source_pdf_published/);
  assert.match(masterGateway, /inspectUploadedMasterPdf/);
  assert.match(masterGateway, /admin_publish_pdf/);
  assert.match(masterGateway, /p_source_pdf_sha256/);
});

test('Master Agreement gateway enforces AAL2 Admin legal authority and exception-only reconciliation', () => {
  assert.match(masterGateway, /action === 'admin_get'/);
  assert.match(masterGateway, /jwtAal\(token\) !== 'aal2'/);
  assert.match(masterGateway, /publish_sellertray_master_agreement_admin/);
  assert.match(masterGateway, /publish_sellertray_master_agreement_pdf_admin/);
  assert.match(masterGateway, /publish_sellertray_order_form_template_admin/);
  assert.match(masterGateway, /admin_reconcile_agreement_package/);
  assert.match(masterGateway, /reconcile_sellertray_agreement_package_admin/);
  assert.match(masterGateway, /confirm_sellertray_agreement_package_reviewed/);
  assert.match(masterGateway, /get_sellertray_order_forms_admin/);
  assert.doesNotMatch(masterGateway, /admin_issue_order_form/);
  assert.doesNotMatch(masterGateway, /issue_sellertray_commercial_order_form_admin/);
  assert.doesNotMatch(masterGateway, /accept_sellertray_commercial_agreement/);
});

test('legacy C1A and routine manual Order Form mutation are retired without deleting historical evidence', () => {
  assert.match(retirement, /revoke execute on function public\.accept_sellertray_commercial_agreement/);
  assert.match(retirement, /revoke execute on function public\.issue_sellertray_commercial_agreement_admin/);
  assert.match(retirement, /revoke execute on function public\.publish_sellertray_commercial_agreement_template_admin/);
  assert.match(retirement, /revoke execute on function public\.publish_sellertray_commercial_agreement_template_version/);
  assert.match(zeroTouchAuthority, /revoke execute on function public\.issue_sellertray_commercial_order_form_admin/);
  assert.doesNotMatch(retirement, /drop table public\.sellertray_commercial_agreements/);
  assert.doesNotMatch(retirement, /delete from public\.sellertray_commercial_agreement/);
});

test('agreement lifecycle does not invent commercial, refund, guarantee or entitlement policy', () => {
  assert.doesNotMatch(lifecycle, /dueAt|past_due|grace|refundAmount|guaranteeStatus|current_period_end|tenant_subscriptions/);
  assert.match(lifecycle, /Published versions remain available for immutable legal history/);
  assert.match(lifecycle, /one reviewed immutable version for the entire SellerTray platform/);
  assert.match(lifecycle, /review-only for Master Agreement publication/);
  assert.match(commercial, /Governed commercial order → exact commercial snapshot → Order Form → Agreement Package/);
  assert.doesNotMatch(commercial, /refundAmount|guaranteeStatus|tenant_subscriptions/);
});
