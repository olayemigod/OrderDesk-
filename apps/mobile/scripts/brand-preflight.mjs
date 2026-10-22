import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const V2_ICON_URL = 'https://sellertray.vercel.app/brand/sellertray-app-icon-v2.png';
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

requireValue(
  existsSync(join(root, MOBILE_MARK)),
  'Mobile must bundle the Android-safe SellerTray v2 mark derived from the approved brand artwork',
);
requireValue(
  brand.includes("require('../../assets/sellertray-v2-mark-128.png')"),
  'Mobile SellerTrayBrand must render the bundled SellerTray v2 mark instead of the unsupported in-app WebP path',
);
requireValue(
  !brand.includes("require('../../assets/sellertray-admin-logo.webp')"),
  'Mobile SellerTrayBrand must not depend on the Admin WebP runtime decoder path that failed on Android QA',
);
requireValue(
  expo.icon === V2_ICON_URL,
  'Mobile app icon must use the same SellerTray v2 icon source as Admin Portal',
);
requireValue(
  expo.android?.adaptiveIcon?.foregroundImage === V2_ICON_URL,
  'Android adaptive icon must use the same SellerTray v2 icon source as Admin Portal',
);
requireValue(
  expo.splash?.image === V2_ICON_URL,
  'Mobile splash branding must use the same SellerTray v2 icon source as Admin Portal',
);

if (failures.length) {
  console.error('SellerTray Mobile brand preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Mobile brand preflight passed.');
