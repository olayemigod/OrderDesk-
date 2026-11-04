import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const dynamicConfig = require('../../apps/mobile/app.config.js');
const original = require('../../apps/mobile/app.json').expo;
const eas = require('../../apps/mobile/eas.json');
const testUrl = 'https://' + 's'.repeat(20) + '.supabase.co';
const testKey = 'sb_publishable_' + 's'.repeat(24);
const dir = mkdtempSync(join(tmpdir(), 'sellertray-qa-config-'));
const firebasePath = join(dir, 'google-services.qa.json');
writeFileSync(firebasePath, JSON.stringify({
  project_info: { project_id: 'sellertray-qa-placeholder' },
  client: [
    { client_info: { android_client_info: { package_name: 'ng.processedge.sellertray.qa' } } },
  ]
}));
process.on('exit', () => rmSync(dir, { recursive:true, force:true }));
const validEnv = () => ({
  SELLERTRAY_APP_VARIANT:'qa-staging',
  EXPO_PUBLIC_SUPABASE_URL:testUrl,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:testKey,
  SELLERTRAY_QA_GOOGLE_SERVICES_FILE:firebasePath,
});

test('default and production builds preserve original app identity without an opt-in flag', () => {
  assert.deepEqual(dynamicConfig({config:original}, {}), original);
  assert.equal(original.android.package, 'ng.processedge.sellertray');
  assert.equal(original.name, 'SellerTray');
  assert.equal(eas.build.production.env.EXPO_PUBLIC_SUPABASE_URL,
    'https://eujxswjspolugrzlsjnn.supabase.co');
});

test('staging profile exists but has no production API URL or key fallback', () => {
  assert.equal(eas.build['qa-staging'].env.SELLERTRAY_APP_VARIANT, 'qa-staging');
  assert.equal(eas.build['qa-staging'].env.EXPO_PUBLIC_SUPABASE_URL, undefined);
  assert.equal(eas.build['qa-staging'].env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, undefined);
});

test('QA Android app installs alongside production with distinct app name, scheme and Firebase', () => {
  const qa = dynamicConfig({config:original}, validEnv());
  assert.equal(qa.android.package, 'ng.processedge.sellertray.qa');
  assert.notEqual(qa.android.package, original.android.package);
  assert.equal(qa.name, 'SellerTray QA');
  assert.equal(qa.ios.bundleIdentifier, qa.android.package);
  assert.deepEqual(qa.scheme, ['sellertray-qa']);
  assert.deepEqual(qa.android.intentFilters, []);
  assert.equal(qa.android.googleServicesFile, firebasePath);
  assert.equal(original.android.package,'ng.processedge.sellertray');
  assert.equal(original.android.googleServicesFile,'./google-services.json');
});

test('fail closed on an unsupported variant rather than silently produce production app', () => {
  assert.throws(() => dynamicConfig({config:original}, {SELLERTRAY_APP_VARIANT:'qa'}), /Unsupported/);
});

test('QA cannot run against production or the unrebuilt Agreement Package Test project', () => {
  for (const endpoint of [
    'https://eujxswjspolugrzlsjnn.supabase.co',
    'https://iukgsukdoowvnhlfmpml.supabase.co',
    'http://'+'s'.repeat(20)+'.supabase.co',
    'https://app.sellertray.com',
  ]) {
    assert.throws(() => dynamicConfig({config:original}, {...validEnv(),EXPO_PUBLIC_SUPABASE_URL:endpoint}), /attested, non-production/);
  }
});

test('QA requires protected independent publishable key', () => {
  assert.throws(() => dynamicConfig({config:original}, {...validEnv(),EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:eas.build.production.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY}), /separate staging publishable key/);
  assert.throws(() => dynamicConfig({config:original}, {...validEnv(),EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''}), /separate staging publishable key/);
});

test('QA fails without its dedicated Firebase configuration', () => {
  assert.throws(() => dynamicConfig({config:original}, {...validEnv(),SELLERTRAY_QA_GOOGLE_SERVICES_FILE:''}), /separate protected Firebase/);
  assert.throws(() => dynamicConfig({config:original}, {...validEnv(),SELLERTRAY_QA_GOOGLE_SERVICES_FILE:'./google-services.json'}), /separate protected Firebase/);
  assert.throws(() => dynamicConfig({config:original}, {...validEnv(),SELLERTRAY_QA_GOOGLE_SERVICES_FILE:'/nonexistent/test-only.json'}), /Firebase file is missing/);
});

test('QA rejects a Firebase configuration registered to a production Android package', () => {
  const bad = join(dir, 'production-firebase-placeholder.json');
  writeFileSync(bad, JSON.stringify({client:[{client_info:{android_client_info:{package_name:'ng.processedge.sellertray'}}}]}));
  assert.throws(() => dynamicConfig({config:original}, {...validEnv(),SELLERTRAY_QA_GOOGLE_SERVICES_FILE:bad}), /Firebase package identity/);
});

test('QA fails when production source application ID drifts instead of modifying another package', () => {
  assert.throws(() => dynamicConfig({config:{...original,android:{...original.android,package:'com.example.other'}}},validEnv()), /base app identity/);
});
