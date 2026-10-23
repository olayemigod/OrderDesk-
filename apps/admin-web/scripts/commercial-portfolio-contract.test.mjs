import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = (path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
const selector = read('admin-web/src/MerchantSelector.tsx');
const portfolio = read('admin-web/src/CommercialPortfolio.tsx');
const gateway = read('../supabase/functions/platform-admin-commercial/index.ts');
const migration = read('../supabase/migrations/20261022093000_platform_admin_commercial_portfolios.sql');

test('Billing single-merchant selection exposes the commercial portfolio without changing multi-select communications', () => {
  assert.match(selector, /import CommercialPortfolio/);
  assert.match(selector, /showCommercialPortfolio \?\? mode === 'single'/);
  assert.match(selector, /<CommercialPortfolio/);
  assert.match(selector, /onOpenMerchant=\{\(merchant\) => onChange\(new Set\(\[merchant\.id\]\), merchant\)\}/);
});

test('commercial portfolio uses bounded server reads and existing merchant drill-down authority', () => {
  assert.match(portfolio, /'platform-admin-commercial'/);
  assert.match(portfolio, /action: tab/);
  assert.match(portfolio, /limit: 20/);
  assert.match(portfolio, /loadMerchantDetail\(session, tenantId\)/);
  assert.match(portfolio, /Installment progress uses confirmed payment facts only/);
  assert.match(portfolio, /No due-date, grace, aging or cross-currency policy is inferred here/);
});

test('commercial portfolio gateway requires AAL2 and only dispatches service-authority RPCs', () => {
  assert.match(gateway, /identity\.aal !== 'aal2'/);
  assert.match(gateway, /platform_admin_commercial_installment_portfolio/);
  assert.match(gateway, /platform_admin_commercial_agreement_portfolio/);
  assert.match(gateway, /authorization: `Bearer \$\{SERVICE_ROLE_KEY\}`/);
  assert.doesNotMatch(gateway, /from\(['"]sellertray_commercial_/);
});

test('portfolio projections are service-only and do not implement ungoverned financial or timing fields', () => {
  assert.match(migration, /revoke all on function public\.platform_admin_commercial_installment_portfolio[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /revoke all on function public\.platform_admin_commercial_agreement_portfolio[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.platform_admin_commercial_installment_portfolio[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.platform_admin_commercial_agreement_portfolio[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /sch\.due_at|grace_ends_at|exchange_rate|fx_rate|recognized_revenue|recognised_revenue|gross_profit|net_profit/);
});
