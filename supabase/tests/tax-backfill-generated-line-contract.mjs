import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const generatedLineName = '20261020175950_tax_backfill_generated_line_compatibility.sql';
const runtimeGuardName = '20261020175970_tax_backfill_runtime_guard_compatibility.sql';
const runtimeRestoreName = '20261020180025_tax_backfill_runtime_guard_restore.sql';
const generatedLine = readFileSync(join(migrationsDir, generatedLineName), 'utf8');
const runtimeGuard = readFileSync(join(migrationsDir, runtimeGuardName), 'utf8');
const runtimeRestore = readFileSync(join(migrationsDir, runtimeRestoreName), 'utf8');

for (const [label, migration] of [
  ['generated-line compatibility', generatedLine],
  ['runtime-guard compatibility', runtimeGuard],
]) {
  assert.match(
    migration,
    /to_regclass\('public\.sellertray_tax_configurations'\) is null/i,
    `${label} must be a no-op after Tax Authority already exists`,
  );
  assert.doesNotMatch(migration, /disable\s+trigger/i, `${label} must not disable table triggers globally`);
}

for (const taxField of [
  'tax_basis_amount',
  'tax_rate_percent',
  'tax_amount',
  'gross_line_total',
]) {
  assert.match(generatedLine, new RegExp(`v_old->>'${taxField}'.*null`, 'is'));
  assert.match(generatedLine, new RegExp(`v_new->>'${taxField}'.*not null`, 'is'));
}

const exclusionLists = [...generatedLine.matchAll(/array\[(.*?)\]::text\[\]/gis)].map((match) => match[1]);
assert.ok(exclusionLists.length >= 2, 'old and new comparison exclusion lists must both exist');
for (const list of exclusionLists) {
  assert.match(list, /'line_total'/, 'generated line_total must be ignored during the BEFORE UPDATE comparison');
  assert.doesNotMatch(list, /'quantity'/, 'quantity must remain a protected commercial fact');
  assert.doesNotMatch(list, /'unit_price'/, 'unit price must remain a protected commercial fact');
  assert.doesNotMatch(list, /'catalog_item_id'/, 'product identity must remain a protected commercial fact');
  assert.doesNotMatch(list, /'selected_uom'/, 'UOM identity must remain a protected commercial fact');
}
assert.match(generatedLine, /v_new\s*-\s*array[\s\S]*=\s*\(\s*v_old\s*-\s*array/i);

// Read-only subscription bypass is limited to exact historical tax snapshot
// UPDATEs on invoiced order headers/items. All other writes retain the normal
// SellerTray read-only error.
assert.match(runtimeGuard, /create or replace function public\.guard_orderdesk_subscription_write\(\)/i);
assert.match(runtimeGuard, /if public\.orderdesk_subscription_can_write\(v_tenant_id\) then[\s\S]*return coalesce\(new, old\)/i);
assert.match(runtimeGuard, /tg_op='UPDATE'[\s\S]*tg_table_name='order_items'/i);
assert.match(runtimeGuard, /tg_op='UPDATE'[\s\S]*tg_table_name='orders'/i);
assert.match(runtimeGuard, /order_financial_documents[\s\S]*document_type='invoice'/i);
assert.match(runtimeGuard, /tax_rate_percent',''\)::numeric = 0/i);
assert.match(runtimeGuard, /tax_amount',''\)::numeric = 0/i);
assert.match(runtimeGuard, /tax_applied'\)::boolean is false/i);
assert.match(runtimeGuard, /tax_display_breakdown'\)::boolean is false/i);
assert.match(runtimeGuard, /SellerTray subscription is read-only\. Renew or reactivate the business to make changes\./i);
assert.doesNotMatch(runtimeGuard, /tg_table_name='catalog_items'/i);
assert.doesNotMatch(runtimeGuard, /tg_table_name='tenant_subscriptions'/i);

// Return-history exception is equally narrow: only the new zero-tax snapshot
// columns may be populated on the two historical return tables.
assert.match(runtimeGuard, /create or replace function public\.prevent_sellertray_return_mutation\(\)/i);
assert.match(runtimeGuard, /tg_op='UPDATE'[\s\S]*tg_table_name='sale_return_items'/i);
assert.match(runtimeGuard, /tg_op='UPDATE'[\s\S]*tg_table_name='sale_returns'/i);
assert.match(runtimeGuard, /subtotal_amount',''\)::numeric = old\.line_total/i);
assert.match(runtimeGuard, /subtotal_amount',''\)::numeric = old\.amount/i);
assert.match(runtimeGuard, /SellerTray return and refund records are immutable/i);
assert.doesNotMatch(runtimeGuard, /tg_table_name='payment_refunds'/i);

// The immediate restore must contain only strict runtime behavior, not the
// migration-only table/field exceptions.
assert.match(runtimeRestore, /create or replace function public\.guard_orderdesk_subscription_write\(\)/i);
assert.match(runtimeRestore, /if not public\.orderdesk_subscription_can_write\(v_tenant_id\) then/i);
assert.match(runtimeRestore, /SellerTray subscription is read-only\. Renew or reactivate the business to make changes\./i);
assert.match(runtimeRestore, /create or replace function public\.prevent_sellertray_return_mutation\(\)/i);
assert.match(runtimeRestore, /SellerTray return and refund records are immutable/i);
assert.doesNotMatch(runtimeRestore, /tg_table_name/i);
assert.doesNotMatch(runtimeRestore, /tax_basis_amount/i);

const ordered = readdirSync(migrationsDir)
  .filter((name) => /^2026102017|^2026102018/.test(name))
  .sort();
const tempGuard = ordered.indexOf('20261020175900_tax_historical_item_backfill_guard.sql');
const generatedCompatibility = ordered.indexOf(generatedLineName);
const runtimeCompatibility = ordered.indexOf(runtimeGuardName);
const taxFoundation = ordered.indexOf('20261020180000_tax_authority_foundation.sql');
const runtimeRestore = ordered.indexOf(runtimeRestoreName);
const invoiceGuardRestore = ordered.indexOf('20261020180050_tax_historical_item_backfill_guard_restore.sql');
assert.ok(
  tempGuard >= 0
    && tempGuard < generatedCompatibility
    && generatedCompatibility < runtimeCompatibility
    && runtimeCompatibility < taxFoundation
    && taxFoundation < runtimeRestore
    && runtimeRestore < invoiceGuardRestore,
  'all temporary tax-backfill guards must be installed and restored in canonical order',
);

console.log('tax historical backfill guard contracts: ok');
