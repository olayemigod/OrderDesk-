import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const ADMIN_LOGO_PATH = '/brand/sellertray-admin-logo.webp';
const ADMIN_FAVICON_URL = 'https://sellertray.vercel.app/brand/sellertray-app-icon-v2.png';

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const shell = read('src/merchantShell.tsx');
const html = read('index.html');

requireValue(
  existsSync(join(root, 'public/brand/sellertray-admin-logo.webp')),
  'Merchant Web must bundle the exact Admin Portal SellerTray logo asset',
);
requireValue(
  shell.includes(`const SELLERTRAY_LOGO = '${ADMIN_LOGO_PATH}'`) && !shell.includes('sellertray-app-icon.png'),
  'Merchant Web shell and login must use the Admin Portal SellerTray logo instead of a local variant',
);
requireValue(
  html.includes(`href="${ADMIN_FAVICON_URL}"`),
  'Merchant Web favicon must use the same SellerTray v2 icon source as Admin Portal',
);

if (failures.length) {
  console.error('SellerTray Merchant Web brand preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Merchant Web brand preflight passed.');
