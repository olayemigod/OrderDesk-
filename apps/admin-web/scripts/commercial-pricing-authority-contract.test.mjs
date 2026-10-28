import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = (path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
const commercial = read('admin-web/src/CommercialAdminWorkspaces.tsx');
const state = read('admin-web/src/commercial-admin-state.ts');
const edge = read('../supabase/functions/commercial-agreements/index.ts');
const migration = read('../supabase/migrations/20261028191000_admin_pricing_authority_separation.sql');

function block(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing block start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing block end: ${end}`);
  return source.slice(from, to);
}

test('all Admin pricing publication actions require verified AAL2 transport', () => {
  const standardSubscription = block(edge, "if (action === 'admin_publish_subscription_price')", "if (action === 'admin_publish_setup_price')");
  const standardSetup = block(edge, "if (action === 'admin_publish_setup_price')", "if (action === 'admin_publish_subscription_override')");
  const merchantSubscription = block(edge, "if (action === 'admin_publish_subscription_override')", "if (action === 'admin_publish_setup_override')");
  const merchantSetup = block(edge, "if (action === 'admin_publish_setup_override')", "if (action === 'admin_create_initial_purchase')");
  for (const pricingBlock of [standardSubscription, standardSetup, merchantSubscription, merchantSetup]) {
    assert.match(pricingBlock, /jwtAal\(token\) !== 'aal2'/);
  }
});

test('database authority separates platform pricing from Business-scoped pricing', () => {
  assert.match(migration, /admin\.pricing\.manage',null,now\(\)/);
  assert.match(migration, /admin\.pricing\.manage',p_tenant_id,now\(\)/);
  assert.match(migration, /'canManageGlobalPricing'/);
  assert.match(migration, /'canManageMerchantPricing'/);
  assert.match(migration, /'canManage',v_role='admin'/);
});

test('Admin pricing UI consumes pricing authority without taking over purchase authority', () => {
  assert.match(state, /canManageGlobalPricing: boolean/);
  assert.match(state, /canManageMerchantPricing: boolean/);
  assert.match(state, /canManageGlobalPricing: root\.canManageGlobalPricing === true/);
  assert.match(state, /canManageMerchantPricing: root\.canManageMerchantPricing === true/);

  const pricing = block(commercial, 'export function CommercialPricingAdministration', 'export function CommercialOrdersAdministration');
  assert.match(pricing, /state\?\.canManageGlobalPricing === true/);
  assert.match(pricing, /state\?\.canManageMerchantPricing === true/);
  assert.match(pricing, /disabled=\{!canManageGlobalPricing \|\| saving !== null\}/);
  assert.match(pricing, /disabled=\{!canManageMerchantPricing \|\| saving !== null\}/);

  const orders = block(commercial, 'export function CommercialOrdersAdministration', 'export function InstallmentEntitlementAdministration');
  assert.match(orders, /actorRole === 'admin' && state\?\.canManage === true/);
  assert.doesNotMatch(orders, /canManageGlobalPricing|canManageMerchantPricing/);
});

test('purchase preview resolves Business override first without becoming order authority', () => {
  assert.match(commercial, /function resolveEffectivePrice/);
  assert.match(commercial, /a\.priceScope === 'merchant_override'/);
  assert.match(commercial, /Current governed purchase preview/);
  assert.match(commercial, /Subscription source:/);
  assert.match(commercial, /Branch setup source:/);
});
