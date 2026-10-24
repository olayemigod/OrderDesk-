import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = (path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
const workspace = read('admin-web/src/AdminWorkspace.tsx');
const selector = read('admin-web/src/MerchantSelector.tsx');
const commercial = read('admin-web/src/CommercialBillingAdministration.tsx');
const commercialLegacy = read('admin-web/src/CommercialBillingAdministrationLegacy.tsx');
const edge = read('../supabase/functions/platform-admin/index.ts');
const migration = read('../supabase/migrations/20261022064000_platform_admin_bounded_bootstrap.sql');

test('active Admin bootstrap is compact and does not load the merchant estate', () => {
  assert.match(workspace, /action: 'bootstrap'/);
  assert.match(workspace, /merchantCount: number/);
  assert.doesNotMatch(workspace, /overview\.tenants|action: 'overview'/);
  assert.match(edge, /platform_admin_bootstrap/);
  assert.ok(edge.indexOf('const action = cleanAction(body.action)') < edge.indexOf("if (action === 'bootstrap')"), 'request body is parsed before bootstrap dispatch');
  assert.match(migration, /'merchantCount'/);
  assert.doesNotMatch(migration, /jsonb_agg/);
});

test('Billing and Communications share bounded merchant selection', () => {
  assert.match(workspace, /<MerchantSelector session=\{session\}/);
  assert.match(commercial, /<CommercialBillingAdministrationLegacy/);
  assert.match(commercialLegacy, /<MerchantSelector/);
  assert.match(selector, /loadMerchantPortfolio/);
  assert.match(selector, /limit: pageSize/);
  assert.match(selector, /nextCursor/);
  assert.doesNotMatch(commercial, /tenants: CommercialAdminTenant\[\]/);
  assert.doesNotMatch(commercialLegacy, /tenants: CommercialAdminTenant\[\]/);
});

test('Operations reads server aggregates and AI readiness avoids tenant iteration', () => {
  assert.match(workspace, /action: 'operations_summary'/);
  assert.match(edge, /platform_admin_operations_summary/);
  assert.match(migration, /'whatsapp',jsonb_build_object/);
  assert.match(migration, /'ai',jsonb_build_object/);
  assert.doesNotMatch(workspace, /tenants\.filter/);
  const readiness = edge.slice(edge.indexOf('function buildAiParserReadiness'), edge.indexOf('function isRecord'));
  assert.doesNotMatch(readiness, /overview\.tenants|for \(const tenant/);
});
