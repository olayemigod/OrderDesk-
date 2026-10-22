import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = (path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
const workspace = read('admin-web/src/AdminWorkspace.tsx');
const merchants = read('admin-web/src/MerchantPortfolio.tsx');
const commercial = read('admin-web/src/CommercialBillingAdministration.tsx');
const platformAdmin = read('../supabase/functions/platform-admin/index.ts');

test('merchant discovery uses the governed paginated read model', () => {
  assert.match(workspace, /<MerchantPortfolio session=\{session\}/);
  assert.doesNotMatch(workspace, /function MerchantsPage|function MerchantSummaryDrawer/);
  assert.match(merchants, /action: 'merchant_portfolio'/);
  assert.match(merchants, /afterName: cursor\?\.afterName/);
  assert.match(merchants, /afterId: cursor\?\.afterId/);
  assert.doesNotMatch(merchants, /overview\.tenants|\.reduce\(/);
});

test('Merchant 360 is a governed server read with a commercial drill-down', () => {
  assert.match(merchants, /action: 'merchant_detail'/);
  assert.match(merchants, /billing\?tenant=/);
  assert.match(workspace, /initialTenantId=\{merchantFromHash\(\)\}/);
  assert.match(commercial, /initialTenantId\?: string \| null/);
});

test('Edge Function validates and dispatches both merchant read models', () => {
  assert.match(platformAdmin, /if \(action === 'merchant_portfolio'\)/);
  assert.match(platformAdmin, /platform_admin_merchant_portfolio/);
  assert.match(platformAdmin, /requestedLimit < 1 \|\| requestedLimit > 50/);
  assert.match(platformAdmin, /if \(action === 'merchant_detail'\)/);
  assert.match(platformAdmin, /platform_admin_merchant_detail/);
});

test('merchant financial display preserves currency partitions and scope disclosure', () => {
  assert.match(merchants, /performance\.money\.map/);
  assert.match(merchants, /GMV is gross completed order value by currency/);
  assert.doesNotMatch(merchants, /profit|exchange rate|converted/i);
});
