import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ui = readFileSync(new URL('../src/CommercialSettlementAdministration.tsx', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../../../supabase/functions/platform-admin-settlement/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../supabase/migrations/20261102101000_pre_c2_governed_discount_authoring.sql', import.meta.url), 'utf8');
const reconfirmation = readFileSync(new URL('../../../supabase/migrations/20261102103000_pre_c2_discount_order_form_reconfirmation.sql', import.meta.url), 'utf8');

test('Admin exposes fixed-amount and percentage discount authoring', () => {
  assert.match(ui, /<option value="fixed_amount">Fixed amount<\/option>/);
  assert.match(ui, /<option value="percentage">Percentage<\/option>/);
  assert.match(ui, /discountType: adjustment\.type, discountValue/);
  assert.doesNotMatch(ui, /total_gross_amount|selectedOrder\.grossAmount\s*\*|settlement\.grossAmount\s*\*/);
});

test('edge delegates authored discounts to the governed server authority', () => {
  assert.match(edge, /platform_admin_record_commercial_discount/);
  assert.match(edge, /p_discount_type: discountType/);
  assert.match(edge, /p_discount_value: discountValue/);
  assert.match(edge, /Compatibility path for an older Admin bundle/);
});

test('database preserves authored metadata while settlement continues to use monetary amount', () => {
  for (const marker of ['discount_input_type', 'discount_input_value', 'discount_calculation_base_amount']) assert.match(migration, new RegExp(marker));
  assert.match(migration, /total_gross_amount \* v_discount_value \/ 100/);
  assert.match(migration, /Discount cannot reduce the net amount below confirmed payments/);
  assert.match(migration, /supersede_sellertray_stale_installment_checkouts/);
});

test('an adjusted purchase gets a new merchant-confirmed commercial instrument', () => {
  assert.match(reconfirmation, /reissue_sellertray_order_forms_after_discount/);
  assert.match(reconfirmation, /supersedes_order_form_id/);
  assert.match(reconfirmation, /build_sellertray_commercial_agreement_snapshot/);
  assert.match(reconfirmation, /create_sellertray_agreement_package/);
  assert.match(ui, /replacement terms for Merchant review and confirmation/);
});

test('history distinguishes percentage, fixed and historical amount-only discounts', () => {
  assert.match(ui, /row\.discountInputType === 'percentage'/);
  assert.match(ui, /row\.discountInputType === 'fixed_amount'/);
  assert.match(ui, /return money\(row\.amount, currency\)/);
});
