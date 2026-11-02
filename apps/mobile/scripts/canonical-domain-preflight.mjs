import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');

const [
  mobileHandoff,
  mobileAppConfig,
  mobileAuth,
  invitationLink,
  assetLinks,
  serverHandoff,
  teamManagement,
  authEmail,
  adminIndex,
  adminVercel,
  adminNavigation,
] = await Promise.all([
  readFile(path.join(repoRoot, 'apps/mobile/src/data/merchantWebHandoff.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/mobile/app.json'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/mobile/src/components/AuthGate.tsx'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/mobile/src/lib/invitationLink.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/merchant-web/public/.well-known/assetlinks.json'), 'utf8'),
  readFile(path.join(repoRoot, 'supabase/functions/merchant-web-handoff/index.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'supabase/functions/team-management/index.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'supabase/functions/send-auth-email/index.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/admin-web/index.html'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/admin-web/vercel.json'), 'utf8'),
  readFile(path.join(repoRoot, 'apps/admin-web/src/admin-navigation.css'), 'utf8'),
]);

const canonicalMerchantOrigin = 'https://app.sellertray.com';
const canonicalPublicOrigin = 'https://sellertray.com';
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
assert.match(mobileAppConfig, /"host": "app\.sellertray\.com"/);
assert.match(mobileAppConfig, /"pathPrefix": "\/invite"/);

assert.match(mobileAuth, /const SELLERTRAY_PRIVACY_URL = 'https:\/\/sellertray\.com\/privacy';/);
assert.match(mobileAuth, /const SELLERTRAY_TERMS_URL = 'https:\/\/sellertray\.com\/terms';/);
assert.match(invitationLink, /app\\\.sellertray\\\.com/);
assert.match(teamManagement, /'https:\/\/app\.sellertray\.com'/);
assert.match(teamManagement, /https:\/\/sellertray\.com\/privacy/);
assert.match(teamManagement, /https:\/\/sellertray\.com\/terms/);
assert.match(authEmail, /'https:\/\/app\.sellertray\.com'/);
assert.match(authEmail, /https:\/\/sellertray\.com\/privacy/);
assert.match(authEmail, /https:\/\/sellertray\.com\/terms/);

const parsedAssetLinks = JSON.parse(assetLinks);
assert.equal(Array.isArray(parsedAssetLinks), true, 'Android assetlinks.json must be a JSON array');
assert.equal(parsedAssetLinks[0]?.target?.package_name, 'ng.processedge.sellertray');
assert.equal(
  parsedAssetLinks[0]?.target?.sha256_cert_fingerprints?.includes('FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C'),
  true,
  'QA Android signing certificate must be associated with the SellerTray invitation origin',
);

assert.match(adminIndex, /href="\/brand\/sellertray-admin-icon\.png"/);
assert.doesNotMatch(adminVercel, /sellertray\.vercel\.app/);
assert.match(adminNavigation, /url\('\/brand\/sellertray-admin-icon\.png'\)/);

const productionSources = [
  ['Mobile handoff', mobileHandoff],
  ['Mobile app config', mobileAppConfig],
  ['Mobile auth', mobileAuth],
  ['Invitation link', invitationLink],
  ['Server handoff', serverHandoff],
  ['Team management', teamManagement],
  ['Auth email', authEmail],
  ['Admin shell', adminIndex],
  ['Admin config', adminVercel],
  ['Admin navigation', adminNavigation],
];

for (const alias of retiredAliases) {
  for (const [name, source] of productionSources) {
    assert.equal(source.includes(alias), false, `${name} still references retired alias ${alias}`);
  }
}

assert.equal(canonicalMerchantOrigin, 'https://app.sellertray.com');
assert.equal(canonicalPublicOrigin, 'https://sellertray.com');
console.log('Canonical production-domain preflight passed.');
