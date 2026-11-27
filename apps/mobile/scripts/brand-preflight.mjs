import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const APP_ICON = './assets/icon.png';
const ADAPTIVE_ICON = './assets/adaptive-icon.png';
const MOBILE_MARK = 'assets/sellertray-v2-mark-128.png';
const APPROVED_APP_ICON = '../merchant-web/public/brand/sellertray-app-icon-v2.png';

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const brand = read('src/components/SellerTrayBrand.tsx');
const appConfig = JSON.parse(read('app.json'));
const expo = appConfig.expo ?? {};

for (const asset of [MOBILE_MARK, APP_ICON.replace(/^\.\//, ''), ADAPTIVE_ICON.replace(/^\.\//, ''), APPROVED_APP_ICON]) {
  requireValue(existsSync(join(root, asset)), `Mobile must bundle required SellerTray brand asset ${asset}`);
}

const approvedAppIcon = existsSync(join(root, APPROVED_APP_ICON)) ? readFileSync(join(root, APPROVED_APP_ICON)) : null;
const mobileAppIcon = existsSync(join(root, APP_ICON)) ? readFileSync(join(root, APP_ICON)) : null;
const adaptiveAppIcon = existsSync(join(root, ADAPTIVE_ICON)) ? readFileSync(join(root, ADAPTIVE_ICON)) : null;

requireValue(
  brand.includes("require('../../assets/sellertray-v2-mark-128.png')"),
  'Mobile SellerTrayBrand must render the bundled SellerTray v2 mark instead of the unsupported in-app WebP path',
);
requireValue(
  !brand.includes("require('../../assets/sellertray-admin-logo.webp')"),
  'Mobile SellerTrayBrand must not depend on the Admin WebP runtime decoder path that failed on Android QA',
);
requireValue(
  approvedAppIcon && mobileAppIcon && approvedAppIcon.equals(mobileAppIcon),
  'Mobile launcher icon must match the approved SellerTray v2 app icon exactly',
);
requireValue(
  approvedAppIcon && adaptiveAppIcon && approvedAppIcon.equals(adaptiveAppIcon),
  'Android adaptive launcher foreground must match the approved SellerTray v2 app icon exactly',
);
requireValue(
  expo.icon === APP_ICON,
  'Mobile app icon must use the bundled approved SellerTray icon instead of a remote deployment alias',
);
requireValue(
  expo.android?.adaptiveIcon?.foregroundImage === ADAPTIVE_ICON,
  'Android adaptive icon must use the bundled approved SellerTray adaptive icon instead of a remote deployment alias',
);
const splashPlugin = (expo.plugins ?? []).find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
const splashOptions = splashPlugin?.[1] ?? {};
requireValue(
  expo.splash === undefined && splashOptions.image === APP_ICON &&
    splashOptions.backgroundColor === '#102A43' && splashOptions.resizeMode === 'contain' &&
    splashOptions.imageWidth === 200,
  'Mobile SDK 58 splash plugin must retain the approved SellerTray icon and navy background',
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
