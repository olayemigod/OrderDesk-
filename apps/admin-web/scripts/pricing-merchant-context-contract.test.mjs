import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workspace = readFileSync(new URL('../src/CommercialAdminWorkspaces.tsx', import.meta.url), 'utf8');
const state = readFileSync(new URL('../src/commercial-admin-state.ts', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../../../supabase/functions/commercial-price-overrides/index.ts', import.meta.url), 'utf8');
const retirement = readFileSync(new URL('../../../supabase/migrations/20261031140000_business_retirement_authority.sql', import.meta.url), 'utf8');

test('Business context changes clear pending price controls and override drafts', () => {
  assert.match(workspace, /setPriceControl\(null\);[\s\S]*setSubscriptionOverride[\s\S]*setSetupOverride[\s\S]*\}, \[tenantId\]\);/);
});

test('Business-scoped lifecycle controls fail closed when tenant context no longer matches', () => {
  assert.match(workspace, /selectedPrice\.priceScope === 'merchant_override' && selectedPrice\.tenantId !== tenantId/);
  assert.match(workspace, /Business context changed\. Select the price again for the current Business\./);
});

test('Business override actions route to the dedicated governed Edge boundary', () => {
  assert.match(state, /admin_publish_subscription_override/);
  assert.match(state, /admin_publish_setup_override/);
  assert.match(state, /commercial-price-overrides/);
});

test('override Edge boundary delegates to capability-checked database publishers', () => {
  assert.match(edge, /publish_sellertray_merchant_subscription_price_override_admin/);
  assert.match(edge, /publish_sellertray_merchant_branch_setup_price_override_admin/);
  assert.match(edge, /p_actor_user_id: actorUserId/);
});

test('Business retirement migration is replay-safe but still fails closed on unknown drift', () => {
  assert.match(retirement, /if position\(v_old in v_def\)>0 then[\s\S]*execute replace\(v_def,v_old,v_new_pattern\);[\s\S]*return;/);
  assert.match(retirement, /if position\(v_new_pattern in v_def\)>0 then[\s\S]*return;/);
  assert.match(retirement, /raise exception 'Retirement convergence pattern missing in %'/);
});
