import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const APP_ICON = './assets/icon.png';
const ADAPTIVE_ICON = './assets/adaptive-icon.png';
const MOBILE_MARK = 'assets/sellertray-v2-mark-128.png';

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const brand = read('src/components/SellerTrayBrand.tsx');
const appConfig = JSON.parse(read('app.json'));
const expo = appConfig.expo ?? {};

for (const asset of [MOBILE_MARK, APP_ICON.replace(/^\.\//, ''), ADAPTIVE_ICON.replace(/^\.\//, '')]) {
  requireValue(existsSync(join(root, asset)), `Mobile must bundle required SellerTray brand asset ${asset}`);
}
requireValue(
  brand.includes("require('../../assets/sellertray-v2-mark-128.png')"),
  'Mobile SellerTrayBrand must render the bundled SellerTray v2 mark instead of the unsupported in-app WebP path',
);
requireValue(
  !brand.includes("require('../../assets/sellertray-admin-logo.webp')"),
  'Mobile SellerTrayBrand must not depend on the Admin WebP runtime decoder path that failed on Android QA',
);
requireValue(
  expo.icon === APP_ICON,
  'Mobile app icon must use the bundled SellerTray icon instead of a remote deployment alias',
);
requireValue(
  expo.android?.adaptiveIcon?.foregroundImage === ADAPTIVE_ICON,
  'Android adaptive icon must use the bundled SellerTray adaptive icon instead of a remote deployment alias',
);
requireValue(
  expo.splash?.image === APP_ICON,
  'Mobile splash branding must use the bundled SellerTray icon instead of a remote deployment alias',
);
requireValue(
  !JSON.stringify(appConfig).includes('vercel.app'),
  'Mobile app configuration must not depend on a Vercel deployment alias for production branding',
);

if (failures.length) {
  console.error('SellerTray Mobile brand preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Mobile brand preflight passed.');
