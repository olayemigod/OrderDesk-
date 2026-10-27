import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '../..');
const read = (relative) => fs.readFileSync(path.resolve(root, relative), 'utf8');
const readRepo = (relative) => fs.readFileSync(path.resolve(repo, relative), 'utf8');

const adminUi = read('src/AgreementLifecycleManagement.tsx');
const gateway = readRepo('supabase/functions/master-agreements/index.ts');
const renderer = readRepo('supabase/functions/master-agreements/agreement-pdf.ts');
const migration = readRepo('supabase/migrations/20261027170000_agreement_document_artifacts.sql');

test('redesigned Admin Add New tab supports reviewed PDF publication without bypassing publication governance', () => {
  assert.match(adminUi, /Add New/);
  assert.match(adminUi, /Upload reviewed PDF/);
  assert.match(adminUi, /Paste legal content/);
  assert.match(adminUi, /action:'admin_publish_pdf'/);
  assert.match(adminUi, /commandId/);
  assert.match(adminUi, /MAX_PDF_BYTES/);
  assert.match(gateway, /action === 'admin_publish_pdf'/);
  assert.match(gateway, /jwtAal\(token\) !== 'aal2'/);
  assert.match(gateway, /publish_sellertray_master_agreement_pdf_admin/);
  assert.match(migration, /platform_admin_has_capability\(p_actor_user_id,'admin\.agreements\.publish'/);
});

test('Admin retrieves the same governed Agreement Package artifacts behind AAL2', () => {
  assert.match(adminUi, /Agreement Package PDFs/);
  assert.match(adminUi, /action:'admin_get_document'/);
  assert.match(adminUi, /Executed PDF/);
  assert.match(gateway, /action === 'admin_get_document'/);
  assert.match(gateway, /jwtAal\(token\) !== 'aal2'/);
  assert.match(gateway, /get_sellertray_order_forms_admin/);
});

test('Agreement PDF artifacts are private immutable derived evidence rather than a second contract authority', () => {
  assert.match(migration, /sellertray_agreement_package_artifacts/);
  assert.match(migration, /public,file_size_limit[\s\S]*false/);
  assert.match(migration, /prevent_sellertray_agreement_package_artifact_mutation/);
  assert.match(migration, /pdf_sha256/);
  assert.match(migration, /package_fingerprint/);
  assert.match(migration, /Master acceptance and Order Form confirmation evidence/);
  assert.doesNotMatch(migration, /update public\.sellertray_master_agreement_versions/);
  assert.doesNotMatch(migration, /update public\.sellertray_commercial_order_forms/);
});

test('Server PDF contains branded integrity and electronic execution certificate sections', () => {
  assert.match(renderer, /ProcessEdge Solutions Limited/);
  assert.match(renderer, /SellerTray/);
  assert.match(renderer, /Agreement Package integrity/);
  assert.match(renderer, /Electronic Execution Certificate/);
  assert.match(renderer, /Verification reference/);
  assert.match(renderer, /PDFDocument\.create/);
});
