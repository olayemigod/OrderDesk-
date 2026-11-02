import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');

const [mobileHandoff, mobileAppConfig, serverHandoff, adminIndex, adminVercel, adminNavigation] = await Promise.all([
  readFile(path.join(repoRoot, 'apps/mobile/src/data/merchantWebHandoff.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/mobile/app.json'), 'utf8'),
  readFile(path.join(repoRoot, 'supabase/functions/merchant-web-handoff/index.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/admin-web/index.html'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/admin-web/vercel.json'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/admin-web/src/admin-navigation.css'), 'utf8'),
]);

const canonicalMerchantOrigin = 'https://app.sellertray.com';
const retiredAliases = [
  'https://sellertray-merchant.vercel.app',
  'https://sellertray-admin.vercel.app',
  'https://sellertray.vercel.app',
];

assert.match(serverHandoff, /const MERCHANT_WEB_ORIGIN = 'https:\/\/app\.sellertray\.com';/);
assert.match(serverHandoff, /url: `\$\{MERCHANT_WEB_ORIGIN\}\/\#st_handoff=/);
assert.doesNotMatch(serverHandoff, /SELLERTRAY_MERCHANT_WEB_URL/);

assert.match(mobileHandoff, /const MERCHANT_WEB_ORIGIN = 'https:\/\/app\.sellertray\.com';/);
assert.match(mobileHandoff, /url\.origin === MERCHANT_WEB_ORIGIN/);
assert.match(mobileHandoff, /url\.pathname === '\/'/);
assert.match(mobileHandoff, /url\.search === ''/);
assert.match(mobileAppConfig, /"icon": "\.\/assets\/icon\.png"/);
assert.match(mobileAppConfig, /"foregroundImage": "\.\/assets\/adaptive-icon\.png"/);
assert.match(mobileAppConfig, /"image": "\.\/assets\/icon\.png"/);

assert.match(adminIndex, /href="\/brand\/sellertray-admin-icon\.png"/);
assert.doesNotMatch(adminVercel, /sellertray\.vercel\.app/);
assert.match(adminNavigation, /url\('\/brand\/sellertray-admin-icon\.png'\)/);

for (const alias of retiredAliases) {
  assert.equal(mobileHandoff.includes(alias), false, `Mobile handoff still references retired alias ${alias}`);
  assert.equal(mobileAppConfig.includes(alias), false, `Mobile app config still references retired alias ${alias}`);
  assert.equal(serverHandoff.includes(alias), false, `Server handoff still references retired alias ${alias}`);
  assert.equal(adminIndex.includes(alias), false, `Admin shell still references retired alias ${alias}`);
  assert.equal(adminVercel.includes(alias), false, `Admin config still references retired alias ${alias}`);
  assert.equal(adminNavigation.includes(alias), false, `Admin navigation still references retired alias ${alias}`);
}

assert.equal(canonicalMerchantOrigin, 'https://app.sellertray.com');
console.log('Canonical production-domain preflight passed.');
