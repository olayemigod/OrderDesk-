import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobileRoot = process.cwd();
const failures = [];

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const settingsHub = read(join(mobileRoot, 'src/components/SettingsHub.tsx'));
const accountControls = read(join(mobileRoot, 'src/components/AccountDataControls.tsx'));

const accountSecurityIndex = settingsHub.indexOf('ACCOUNT & SECURITY');
const directSignOutIndex = settingsHub.indexOf('icon="log-out-outline"');
const accountPrivacyIndex = settingsHub.indexOf('title="Account & privacy"');

requireValue(
  accountSecurityIndex >= 0 && directSignOutIndex > accountSecurityIndex && directSignOutIndex < accountPrivacyIndex,
  'More must expose direct Sign out under Account & Security before the deeper Account & privacy route',
);
requireValue(
  settingsHub.includes("supabase.auth.signOut({ scope: 'local' })") &&
    settingsHub.includes("'Sign out of SellerTray?'") &&
    settingsHub.includes("'This signs you out on this device only. Your business and order data remain safely stored.'"),
  'Direct Sign out must clear only the local device session and require confirmation on native mobile',
);
requireValue(
  accountControls.includes('styles.signOutButton,\n            appearance.dark && darkStyles.secondaryButton,'),
  'The Account session Sign out button must apply a dark-mode surface before using light text',
);
requireValue(
  accountControls.includes("<Text style={[styles.signOutButtonText, appearance.dark && darkStyles.titleText]}") &&
    accountControls.includes("backgroundColor: '#162F46'"),
  'The dark Account session Sign out control must keep explicit high-contrast text and surface tokens',
);

if (failures.length > 0) {
  console.error('SellerTray account session preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray account session preflight passed.');
