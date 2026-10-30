import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const adminSource = readFileSync(resolve(import.meta.dirname, '../src/AgreementLifecycleCore.tsx'), 'utf8');
const gatewaySource = readFileSync(resolve(import.meta.dirname, '../../../supabase/functions/master-agreements/index.ts'), 'utf8');
const quarantineMigration = readFileSync(resolve(import.meta.dirname, '../../../supabase/migrations/20261027123000_master_agreement_publication_quarantine.sql'), 'utf8');

test('Master Agreement publication accepts governed version input instead of a hard-coded legal release', () => {
  assert.match(adminSource, /<span>Version code<\/span><input[^>]+value=\{form\.versionCode\}/);
  assert.match(adminSource, /versionCode:form\.versionCode\.trim\(\)/);
  assert.match(gatewaySource, /const versionCode = cleanText\(body\.versionCode, 64\)/);
  assert.match(gatewaySource, /p_version_code: versionCode/);

  for (const forbidden of ["versionCode:'v0.9'", 'versionCode:"v0.9"', "versionCode:'v1.0'", 'versionCode:"v1.0"']) {
    assert.equal(adminSource.includes(forbidden), false, `Admin must not hard-code ${forbidden}`);
    assert.equal(gatewaySource.includes(forbidden), false, `Gateway must not hard-code ${forbidden}`);
  }
});

test('current Master resolution is effective-date driven and remains generic across later versions', () => {
  assert.match(quarantineMigration, /where v\.effective_from<=p_as_of[\s\S]*not exists[\s\S]*order by v\.effective_from desc,v\.published_at desc,v\.id desc/);
  assert.doesNotMatch(quarantineMigration, /version_code\s*=\s*'v0\.9'/i);
  assert.doesNotMatch(quarantineMigration, /version_code\s*=\s*'v1\.0'/i);
});

test('Admin presents immutable Add New versioning so later agreement text is configuration, not code', () => {
  assert.match(adminSource, /Add New/);
  assert.match(adminSource, /New universal Master Agreement/);
  assert.match(adminSource, /Publishing is immutable/);
  assert.match(adminSource, /Upload reviewed PDF/);
  assert.match(adminSource, /Paste legal content/);
  assert.match(gatewaySource, /admin_publish_pdf/);
  assert.match(gatewaySource, /admin_publish/);
});
