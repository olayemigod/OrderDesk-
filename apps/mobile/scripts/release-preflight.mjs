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
const lock = readJson(join(mobileRoot, 'package-lock.json'));
const app = readJson(join(mobileRoot, 'app.json')).expo;
const eas = readJson(join(mobileRoot, 'eas.json'));
const releaseAcceptance = readJson(join(repoRoot, 'docs/release_acceptance.json'));
const migrationDir = join(repoRoot, 'supabase/migrations');
const migrationFiles = readdirSync(migrationDir).filter((name) => name.endsWith('.sql'));
const migrationVersions = new Map();
for (const name of migrationFiles) {
  const match = name.match(/^(\d{14})_/);
  requireValue(Boolean(match), 'Supabase migration must start with a 14-digit version: '+name);
  if (!match) continue;
  const version = match[1];
  const previous = migrationVersions.get(version);
  requireValue(!previous, 'Duplicate Supabase migration version '+version+': '+previous+' and '+name);
  migrationVersions.set(version, name);
}

requireValue(lock.lockfileVersion === 3, 'package-lock.json must use npm lockfileVersion 3');
requireValue(lock.name === pkg.name, 'package-lock.json package name must match package.json');
requireValue(lock.version === pkg.version, 'package-lock.json package version must match package.json');
requireValue(lock.packages?.['']?.name === pkg.name, 'package-lock root package name must match package.json');
requireValue(lock.packages?.['']?.version === pkg.version, 'package-lock root package version must match package.json');

const allowedGateStatuses = new Set(['pending', 'accepted', 'waived']);
const requiredGateIds = [
  'public_account_deletion_resource',
  'in_app_legal_acceptance',
  'supabase_auth_redirects',
  'supabase_leaked_password_protection',
  'sellertray_brand_assets',
  'sellertray_legal_policy',
  'production_auth_email',
  'android_preview_apk',
  'android_native_smoke',
  'android_production_aab',
  'meta_whatsapp_production',
  'ai_parser_production',
  'outbound_whatsapp_worker',
  'usage_billing_settlement_foundation',
  'paystack_commercial_activation',
  'google_play_data_safety',
  'google_play_app_content',
  'play_review_access',
  'google_play_store_listing',
  'provider_data_sharing_classification',
];

requireValue(releaseAcceptance.schemaVersion === 1, 'release_acceptance.json schemaVersion must be 1');
requireValue(releaseAcceptance.product === 'SellerTray', 'release_acceptance.json product must be SellerTray');
requireValue(releaseAcceptance.version === pkg.version, 'release_acceptance.json version must match package.json');
requireValue(releaseAcceptance.version === app.version, 'release_acceptance.json version must match Expo app version');
requireValue(
  releaseAcceptance.androidPackage === app.android?.package,
  'release_acceptance.json androidPackage must match Expo Android package',
);
requireValue(Array.isArray(releaseAcceptance.gates), 'release_acceptance.json gates must be an array');

const releaseGates = Array.isArray(releaseAcceptance.gates) ? releaseAcceptance.gates : [];
const gateIds = new Set();

for (const gate of releaseGates) {
  requireValue(gate && typeof gate === 'object' && !Array.isArray(gate), 'Every release gate must be an object');
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) continue;

  const id = typeof gate.id === 'string' ? gate.id.trim() : '';
  requireValue(Boolean(id), 'Every release gate must have a non-empty id');
  if (id) {
    requireValue(!gateIds.has(id), 'Duplicate release gate id: '+id);
    gateIds.add(id);
  }

  requireValue(typeof gate.required === 'boolean', 'Release gate '+(id || '<missing-id>')+' must define required as boolean');
  requireValue(allowedGateStatuses.has(gate.status), 'Release gate '+(id || '<missing-id>')+' has invalid status: '+String(gate.status));

  const evidence = typeof gate.evidence === 'string' ? gate.evidence.trim() : '';
  if (gate.status === 'accepted' || gate.status === 'waived') {
    requireValue(Boolean(evidence), 'Release gate '+(id || '<missing-id>')+' marked '+gate.status+' must include evidence');
  }
}

for (const id of requiredGateIds) {
  requireValue(gateIds.has(id), 'Required release gate missing from manifest: '+id);
}

const codeCheckpoint = releaseAcceptance.codeCheckpoint;
requireValue(codeCheckpoint && typeof codeCheckpoint === 'object' && !Array.isArray(codeCheckpoint), 'release_acceptance.json codeCheckpoint must be an object');
if (codeCheckpoint && typeof codeCheckpoint === 'object' && !Array.isArray(codeCheckpoint)) {
  requireValue(codeCheckpoint.status === 'accepted', 'Release code checkpoint status must remain accepted');
  requireValue(typeof codeCheckpoint.commit === 'string' && /^[0-9a-f]{40}$/.test(codeCheckpoint.commit), 'Release code checkpoint commit must be a full Git SHA');
  requireValue(Number.isInteger(codeCheckpoint.ciRun) && codeCheckpoint.ciRun > 0, 'Release code checkpoint ciRun must be a positive integer');
  requireValue(typeof codeCheckpoint.evidence === 'string' && Boolean(codeCheckpoint.evidence.trim()), 'Release code checkpoint must include evidence');
}

requireValue(pkg.name === '@sellertray/mobile', 'package.json name must be @sellertray/mobile');
requireValue(pkg.version === '1.0.0', 'package.json version must be 1.0.0');
requireValue(app.name === 'SellerTray', 'Expo display name must be SellerTray');
requireValue(app.slug === 'sellertray', 'Expo slug must be sellertray');
requireValue(app.version === '1.0.0', 'Expo version must be 1.0.0');
requireValue(Array.isArray(app.scheme), 'Expo scheme must be an array during beta compatibility');
requireValue(app.scheme?.[0] === 'sellertray', 'sellertray must be the canonical first scheme');
requireValue(app.scheme?.includes('orderdesk'), 'legacy orderdesk scheme must remain during the beta compatibility window');
requireValue(app.android?.package === 'ng.processedge.sellertray', 'Android package must be ng.processedge.sellertray');
requireValue(app.android?.allowBackup === false, 'Android Auto Backup must remain disabled for SellerTray');
const requiredBlockedAndroidPermissions = [
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_PHONE_STATE",
  "android.permission.READ_PHONE_NUMBERS",
  "android.permission.CALL_PHONE",
  "android.permission.READ_CALL_LOG",
  "android.permission.WRITE_CALL_LOG",
  "android.permission.READ_SMS",
  "android.permission.RECEIVE_SMS",
  "android.permission.SEND_SMS",
  "android.permission.BODY_SENSORS",
  "android.permission.BODY_SENSORS_BACKGROUND",
  "android.permission.ACTIVITY_RECOGNITION",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.SCHEDULE_EXACT_ALARM",
  "android.permission.USE_EXACT_ALARM",
  "android.permission.MANAGE_EXTERNAL_STORAGE",
  "android.permission.REQUEST_INSTALL_PACKAGES",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "com.google.android.gms.permission.AD_ID"
];
const blockedAndroidPermissions = new Set(app.android?.blockedPermissions ?? []);
for (const permission of requiredBlockedAndroidPermissions) {
  requireValue(blockedAndroidPermissions.has(permission), 'Sensitive Android permission must remain blocked: '+permission);
}
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

const orderParserFunction = read(join(repoRoot, 'supabase/functions/order-parser/index.ts'));
const usageSettlementWorker = read(join(repoRoot, 'supabase/functions/usage-settlement/index.ts'));
const paystackWebhook = read(join(repoRoot, 'supabase/functions/paystack-webhook/index.ts'));
const usageSettlementMigration = read(join(repoRoot, 'supabase/migrations/20260910230000_usage_settlement_foundation.sql'));
const aiTelemetryMigration = read(join(repoRoot, 'supabase/migrations/20260911000500_ai_parser_cost_telemetry.sql'));
const aiAdminTelemetryMigration = read(join(repoRoot, 'supabase/migrations/20260911000600_platform_admin_ai_parser_telemetry.sql'));
const aiCachedTokenMigration = read(join(repoRoot, 'supabase/migrations/20260911000800_ai_parser_cached_token_telemetry.sql'));
const aiTokenIntegrityMigration = read(join(repoRoot, 'supabase/migrations/20260911000900_ai_parser_token_integrity.sql'));
const aiContextBudgetMigration = read(join(repoRoot, 'supabase/migrations/20260911001000_ai_parser_context_budget.sql'));
const whatsappWebhookFunction = read(join(repoRoot, 'supabase/functions/whatsapp-webhook/index.ts'));
const usageScheduleMigration = read(join(repoRoot, 'supabase/migrations/20260910234500_schedule_usage_settlement_preparation.sql'));
const deletionUsageGuardMigration = read(join(repoRoot, 'supabase/migrations/20260910233000_block_deletion_with_unsettled_usage.sql'));
const usagePeriodCurrencyMigration = read(join(repoRoot, 'supabase/migrations/20260910235500_harden_usage_settlement_period_currency.sql'));
const accountLifecycleFunction = read(join(repoRoot, 'supabase/functions/account-lifecycle/index.ts'));
const usageBillingContract = read(join(repoRoot, 'docs/usage_billing.md'));

requireValue(
  orderParserFunction.includes("reasoning: { effort: 'none' }"),
  'Parser reasoning effort must remain none for bounded SellerTray order extraction',
);
requireValue(
  orderParserFunction.includes('x-sellertray-ai-input-tokens') &&
    orderParserFunction.includes('x-sellertray-ai-cached-input-tokens') &&
    orderParserFunction.includes('x-sellertray-ai-output-tokens') &&
    orderParserFunction.includes('x-sellertray-ai-reasoning-tokens'),
  'Order parser must expose bounded internal token telemetry headers',
);
requireValue(
  aiTelemetryMigration.includes('revoke all on table public.ai_parser_attempts from public, anon, authenticated') &&
    aiTelemetryMigration.includes('foreign key (tenant_id, source_message_id)') &&
    aiTelemetryMigration.includes('on delete cascade'),
  'AI parser telemetry must remain server-only, same-tenant and deletion-safe',
);
requireValue(
  !aiTelemetryMigration.includes('text_body') &&
    !aiTelemetryMigration.includes('raw_payload') &&
    !aiTelemetryMigration.includes('prompt') &&
    !aiTelemetryMigration.includes('output_text'),
  'AI parser telemetry schema must not persist customer content or model output',
);
requireValue(
  whatsappWebhookFunction.includes('recordParserAttempt') &&
    whatsappWebhookFunction.includes('/rest/v1/ai_parser_attempts?on_conflict=source_message_id,provider'),
  'WhatsApp ingestion must persist idempotent AI parser telemetry',
);
requireValue(
  whatsappWebhookFunction.includes('AI_CATALOGUE_CONTEXT_LIMIT = 160') &&
    whatsappWebhookFunction.includes('AI_ALIAS_CONTEXT_LIMIT = 6') &&
    whatsappWebhookFunction.includes('selectParserCatalogue'),
  'WhatsApp ingestion must retain the bounded AI catalogue context contract',
);
requireValue(
  aiContextBudgetMigration.includes('catalogue_items_sent <= catalogue_items_total') &&
    aiContextBudgetMigration.includes('"aiCatalogueItemsSentAvg"'),
  'AI catalogue context telemetry/budget integrity contract is missing',
);
requireValue(
  accountLifecycleFunction.includes("loadTenantRows('ai_parser_attempts'"),
  'Owner data export must include AI parser telemetry records',
);
requireValue(
  aiAdminTelemetryMigration.includes('"aiParserAttemptsPeriod"') &&
    aiAdminTelemetryMigration.includes('"aiTotalTokensPeriod"'),
  'ProcessEdge admin overview must retain AI unit-economics telemetry',
);
requireValue(
  aiCachedTokenMigration.includes('cached_input_tokens') &&
    aiCachedTokenMigration.includes('"aiCachedInputTokensPeriod"') &&
    aiTokenIntegrityMigration.includes('cached_input_tokens <= input_tokens') &&
    aiTokenIntegrityMigration.includes('reasoning_tokens <= output_tokens'),
  'AI cached-input telemetry integrity contract is missing',
);
requireValue(
  usageSettlementWorker.includes("Deno.env.get('USAGE_BILLING_LIVE') === 'true'"),
  'Usage settlement worker must keep an explicit opt-in live charging flag',
);
requireValue(
  usageSettlementWorker.includes("USAGE_SETTLEMENT_TOKEN"),
  'Usage settlement worker must remain protected by a server-only worker token',
);
requireValue(
  usageSettlementWorker.includes("orderdesk_usage_charging_enabled"),
  'Usage settlement worker must retain the independent database charging interlock',
);
requireValue(
  usageSettlementWorker.includes("status=eq.pending&select=id,status") &&
    usageSettlementWorker.includes("chargeClaimedByAnotherRequest"),
  'Usage settlement worker must atomically claim pending settlements before Paystack debit',
);
requireValue(
  usageSettlementWorker.includes("BILLING_AUTH_ENCRYPTION_KEY"),
  'Usage settlement worker must require the billing authorization encryption key',
);
requireValue(
  usageSettlementWorker.includes('/transaction/charge_authorization'),
  'Usage settlement worker must use Paystack reusable authorization charging',
);
requireValue(
  paystackWebhook.includes('billing_payment_authorizations'),
  'Paystack webhook must retain reusable authorizations only in the server-only authorization store',
);
requireValue(
  paystackWebhook.includes("AES-GCM"),
  'Paystack reusable authorization capture must remain encrypted with AES-GCM',
);
requireValue(
  paystackWebhook.includes('providerCurrency !== settlement.currency'),
  'Usage settlement webhook must require an explicit exact currency match',
);
requireValue(
  usageSettlementMigration.includes('revoke all on table public.billing_payment_authorizations from public, anon, authenticated'),
  'Reusable billing authorization table must remain inaccessible to merchant clients',
);
requireValue(
  usageSettlementMigration.includes('revoke all on table public.usage_settlements from public, anon, authenticated'),
  'Usage settlement table must remain inaccessible to merchant clients',
);
requireValue(
  usageBillingContract.includes('No percentage-of-sales'),
  'Usage billing contract must preserve the no-GMV-fee commercial rule',
);
requireValue(
  usageScheduleMigration.includes('sellertray-prepare-usage-settlements'),
  'Closed-period usage settlement preparation Cron contract is missing',
);
requireValue(
  usageScheduleMigration.includes('prepare_due_orderdesk_usage_settlements'),
  'Usage settlement preparation Cron must call the bounded database preparation function',
);
requireValue(
  deletionUsageGuardMigration.includes('orderdesk_has_unsettled_usage'),
  'Outstanding usage deletion guard migration is missing',
);
requireValue(
  accountLifecycleFunction.includes("rpc('orderdesk_has_unsettled_usage'"),
  'Self-service account deletion must check unsettled priced usage',
);
requireValue(
  usagePeriodCurrencyMigration.includes('Usage settlement period must be closed'),
  'Usage settlement preparation must reject open/future billing periods',
);
requireValue(
  usagePeriodCurrencyMigration.includes('usage_events_currency_check'),
  'Usage events must snapshot and validate billing currency',
);
requireValue(
  usageSettlementWorker.includes("action === 'reconcile'"),
  'Usage settlement worker must expose non-debiting provider reconciliation',
);
requireValue(
  usageSettlementWorker.includes('/transaction/verify/'),
  'Usage settlement reconciliation must verify Paystack by provider reference',
);


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
console.log('- release acceptance manifest integrity: pass');
console.log('- committed dependency lockfile integrity: pass');
console.log('- sensitive Android permission deny-list: pass');
console.log('- Android Auto Backup disabled: pass');
