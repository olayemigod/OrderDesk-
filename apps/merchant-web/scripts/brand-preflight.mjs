import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const MERCHANT_ICON_PATH = '/brand/sellertray-app-icon.png';

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const shell = read('src/merchantShell.tsx');
const html = read('index.html');

requireValue(
  existsSync(join(root, 'public/brand/sellertray-app-icon.png')),
  'Merchant Web must bundle its canonical SellerTray app icon',
);
requireValue(
  shell.includes(`const SELLERTRAY_APP_ICON = '${MERCHANT_ICON_PATH}'`)
    && !shell.includes('/brand/sellertray-admin-logo.webp')
    && !shell.includes('/brand/sellertray-logo-v2.svg'),
  'Merchant Web shell and sign-in must use the canonical Merchant Web app icon and must not reuse an Admin Portal wordmark',
);
requireValue(
  html.includes(`href="${MERCHANT_ICON_PATH}"`),
  'Merchant Web favicon must use the local canonical SellerTray app icon',
);

if (failures.length) {
  console.error('SellerTray Merchant Web brand preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Merchant Web brand preflight passed.');
