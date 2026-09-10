import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mobileRoot = process.cwd();
const repoRoot = resolve(mobileRoot, '../..');
const failures = [];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

function read(filePath) {
  return readFileSync(filePath, 'utf8');
}

function collectFiles(dir, output = []) {
  for (const name of readdirSync(dir)) {
    const filePath = join(dir, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) collectFiles(filePath, output);
    else output.push(filePath);
  }
  return output;
}

const pkg = readJson(join(mobileRoot, 'package.json'));
const app = readJson(join(mobileRoot, 'app.json')).expo;
const eas = readJson(join(mobileRoot, 'eas.json'));

requireValue(pkg.name === '@sellertray/mobile', 'package.json name must be @sellertray/mobile');
requireValue(pkg.version === '1.0.0', 'package.json version must be 1.0.0');
requireValue(app.name === 'SellerTray', 'Expo display name must be SellerTray');
requireValue(app.slug === 'sellertray', 'Expo slug must be sellertray');
requireValue(app.version === '1.0.0', 'Expo version must be 1.0.0');
requireValue(Array.isArray(app.scheme), 'Expo scheme must be an array during beta compatibility');
requireValue(app.scheme?.[0] === 'sellertray', 'sellertray must be the canonical first scheme');
requireValue(app.scheme?.includes('orderdesk'), 'legacy orderdesk scheme must remain during the beta compatibility window');
requireValue(app.android?.package === 'ng.processedge.sellertray', 'Android package must be ng.processedge.sellertray');
requireValue(app.android?.versionCode === 1, 'Initial Android versionCode must be 1');
requireValue(app.ios?.bundleIdentifier === 'ng.processedge.sellertray', 'iOS bundle ID must match SellerTray identity');
requireValue(eas.build?.preview?.android?.buildType === 'apk', 'EAS preview profile must build an APK');
requireValue(eas.build?.production?.android?.buildType === 'app-bundle', 'EAS production profile must build an AAB');

for (const profileName of ['preview', 'production']) {
  const env = eas.build?.[profileName]?.env ?? {};
  for (const key of Object.keys(env)) {
    requireValue(key.startsWith('EXPO_PUBLIC_'), 'EAS '+profileName+' env may contain public client variables only: '+key);
    requireValue(
      !/(SERVICE_ROLE|SECRET|OPENAI|PAYSTACK|WHATSAPP|WORKER_TOKEN|ORDER_PARSER_TOKEN)/i.test(key),
      'Forbidden server/provider secret variable in EAS '+profileName+': '+key,
    );
  }
}

const authGate = read(join(mobileRoot, 'src/components/AuthGate.tsx'));
requireValue(authGate.includes('return `sellertray://'), 'Auth redirects must be generated with sellertray://');
requireValue(authGate.includes("url.startsWith('sellertray://')"), 'AuthGate must accept sellertray://');
requireValue(authGate.includes("url.startsWith('orderdesk://')"), 'AuthGate must retain legacy orderdesk:// compatibility');

const provisionedApp = read(join(mobileRoot, 'src/ProvisionedApp.tsx'));
const legalGate = read(join(mobileRoot, 'src/components/LegalAcceptanceGate.tsx'));
requireValue(provisionedApp.includes('<LegalAcceptanceGate>'), 'Authenticated SellerTray sessions must pass through LegalAcceptanceGate');
requireValue(legalGate.includes('acceptSellerTrayLegal'), 'LegalAcceptanceGate must record acceptance through the lifecycle repository');
requireValue(legalGate.includes('https://processedge.com.ng/sellertray/privacy'), 'LegalAcceptanceGate privacy URL is missing');
requireValue(legalGate.includes('https://processedge.com.ng/sellertray/terms'), 'LegalAcceptanceGate terms URL is missing');
requireValue(authGate.includes('signupLegalAccepted'), 'SellerTray signup must require legal acknowledgement');

const accountControls = read(join(mobileRoot, 'src/components/AccountDataControls.tsx'));
requireValue(accountControls.includes('DELETE MY SELLERTRAY ACCOUNT'), 'Account deletion confirmation must use SellerTray');
requireValue(accountControls.includes('https://processedge.com.ng/sellertray/privacy'), 'In-app SellerTray privacy URL is missing');
requireValue(accountControls.includes('https://processedge.com.ng/sellertray/terms'), 'In-app SellerTray terms URL is missing');

const releaseRunbook = read(join(repoRoot, 'docs/release_runbook.md'));
const lifecycle = read(join(repoRoot, 'docs/data_lifecycle.md'));
requireValue(releaseRunbook.includes('ng.processedge.sellertray'), 'Release runbook must record the frozen Android package');
requireValue(releaseRunbook.includes('sellertray://auth-confirm'), 'Release runbook must record SellerTray Auth redirects');
requireValue(lifecycle.includes('https://processedge.com.ng/sellertray/account-deletion'), 'Data lifecycle must record the public deletion resource');

const legacyUiPhrases = [
  'Opening OrderDesk',
  'WELCOME TO ORDERDESK',
  'Create your OrderDesk account',
  'Create my OrderDesk',
  'OrderDesk account',
  'private OrderDesk account',
];
for (const filePath of collectFiles(join(mobileRoot, 'src')).filter((item) => /\.(ts|tsx)$/.test(item))) {
  const source = read(filePath);
  for (const phrase of legacyUiPhrases) {
    requireValue(!source.includes(phrase), 'Legacy user-facing phrase "'+phrase+'" remains in '+filePath.replace(repoRoot + '/', ''));
  }
}

const forbiddenSecretPatterns = [
  /SUPABASE_SERVICE_ROLE_KEY/g,
  /OPENAI_API_KEY/g,
  /PAYSTACK_SECRET_KEY/g,
  /WHATSAPP_ACCESS_TOKEN/g,
  /ORDER_PARSER_TOKEN/g,
  /WORKER_TOKEN/g,
  /sb_secret_[A-Za-z0-9_-]+/g,
  /sk_live_[A-Za-z0-9_-]+/g,
  /sk-proj-[A-Za-z0-9_-]+/g,
];

const clientFiles = [
  ...collectFiles(join(mobileRoot, 'src')).filter((item) => /\.(ts|tsx)$/.test(item)),
  join(mobileRoot, 'app.json'),
  join(mobileRoot, 'eas.json'),
  join(mobileRoot, '.env.example'),
];
for (const filePath of clientFiles) {
  const source = read(filePath);
  for (const pattern of forbiddenSecretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) {
      failures.push('Potential server/provider secret reference found in client file: '+filePath.replace(repoRoot + '/', ''));
    }
  }
}

if (failures.length) {
  console.error('\nSellerTray release preflight FAILED:\n');
  for (const failure of failures) console.error('- '+failure);
  process.exit(1);
}

console.log('SellerTray release preflight PASS');
console.log('- production identity: SellerTray 1.0.0');
console.log('- Android package: ng.processedge.sellertray');
console.log('- canonical scheme: sellertray://');
console.log('- preview artifact: APK');
console.log('- production artifact: AAB');
console.log('- client secret-boundary checks: pass');
console.log('- legal/deletion URL contracts: present');
