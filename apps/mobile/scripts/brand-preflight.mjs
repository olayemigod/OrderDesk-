import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const V2_ICON_URL = 'https://sellertray.vercel.app/brand/sellertray-app-icon-v2.png';

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
  existsSync(join(root, 'assets/sellertray-admin-logo.webp')),
  'Mobile must bundle the exact Admin Portal SellerTray logo asset',
);
requireValue(
  brand.includes("require('../../assets/sellertray-admin-logo.webp')"),
  'Mobile SellerTrayBrand must render the Admin Portal logo asset instead of a redrawn local mark',
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
