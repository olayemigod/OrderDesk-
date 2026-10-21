import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const migrationName = '20261020175950_tax_backfill_generated_line_compatibility.sql';
const migration = readFileSync(join(migrationsDir, migrationName), 'utf8');

assert.match(
  migration,
  /to_regclass\('public\.sellertray_tax_configurations'\) is null/i,
  'late application must be a no-op after Tax Authority already exists',
);

for (const taxField of [
  'tax_basis_amount',
  'tax_rate_percent',
  'tax_amount',
  'gross_line_total',
]) {
  assert.match(migration, new RegExp(`v_old->>'${taxField}'.*null`, 'is'));
  assert.match(migration, new RegExp(`v_new->>'${taxField}'.*not null`, 'is'));
}

const exclusionLists = [...migration.matchAll(/array\[(.*?)\]::text\[\]/gis)].map((match) => match[1]);
assert.ok(exclusionLists.length >= 2, 'old and new comparison exclusion lists must both exist');
for (const list of exclusionLists) {
  assert.match(list, /'line_total'/, 'generated line_total must be ignored during the BEFORE UPDATE comparison');
  assert.doesNotMatch(list, /'quantity'/, 'quantity must remain a protected commercial fact');
  assert.doesNotMatch(list, /'unit_price'/, 'unit price must remain a protected commercial fact');
  assert.doesNotMatch(list, /'catalog_item_id'/, 'product identity must remain a protected commercial fact');
  assert.doesNotMatch(list, /'selected_uom'/, 'UOM identity must remain a protected commercial fact');
}

assert.match(migration, /v_new\s*-\s*array[\s\S]*=\s*\(\s*v_old\s*-\s*array/i);

const ordered = readdirSync(migrationsDir)
  .filter((name) => /^2026102017|^2026102018/.test(name))
  .sort();
const tempGuard = ordered.indexOf('20261020175900_tax_historical_item_backfill_guard.sql');
const compatibility = ordered.indexOf(migrationName);
const taxFoundation = ordered.indexOf('20261020180000_tax_authority_foundation.sql');
const restore = ordered.indexOf('20261020180050_tax_historical_item_backfill_guard_restore.sql');
assert.ok(
  tempGuard >= 0 && tempGuard < compatibility && compatibility < taxFoundation && taxFoundation < restore,
  'compatibility guard must run only between temporary guard installation and strict guard restoration',
);

console.log('tax historical backfill generated-line contract: ok');
