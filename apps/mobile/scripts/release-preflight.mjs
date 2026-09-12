import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
requireValue(app.android?.versionCode === 7, 'Android versionCode must be 7 for the merchant-reference QA line');
requireValue(app.ios?.bundleIdentifier === 'ng.processedge.sellertray', 'iOS bundle ID must match SellerTray identity');
requireValue(eas.build?.qa?.android?.buildType === 'apk', 'EAS QA profile must build an APK');
requireValue(eas.build?.preview?.android?.buildType === 'apk', 'EAS preview profile must build an APK');
requireValue(eas.build?.production?.android?.buildType === 'app-bundle', 'EAS production profile must build an AAB');

const brandGate = releaseAcceptance.gates.find((gate) => gate.id === 'sellertray_brand_assets');
if (brandGate?.status === 'accepted') {
  requireValue(app.icon === './assets/brand/icon.png', 'Accepted brand gate requires SellerTray launcher icon in Expo config');
  requireValue(app.android?.adaptiveIcon?.foregroundImage === './assets/brand/adaptive-icon.png', 'Accepted brand gate requires Android adaptive icon foreground');
  requireValue(Boolean(app.android?.adaptiveIcon?.backgroundColor), 'Accepted brand gate requires Android adaptive icon background colour');
  requireValue(app.splash?.image === './assets/brand/splash-icon.png', 'Accepted brand gate requires SellerTray splash icon');
  requireValue(app.splash?.resizeMode === 'contain', 'Accepted brand gate requires contain splash resize mode');
  requireValue(Boolean(app.splash?.backgroundColor), 'Accepted brand gate requires splash background colour');
  for (const path of [app.icon, app.android?.adaptiveIcon?.foregroundImage, app.splash?.image]) {
    if (path) requireValue(existsSync(join(mobileRoot, path)), 'Accepted brand asset file is missing: '+path);
  }
}

for (const profileName of ['qa', 'preview', 'production']) {
  const env = eas.build?.[profileName]?.env ?? {};
  for (const key of Object.keys(env)) {
    requireValue(key.startsWith('EXPO_PUBLIC_'), 'EAS '+profileName+' env may contain public client variables only: '+key);
    requireValue(
      !/(SERVICE_ROLE|SECRET|OPENAI|PAYSTACK|WHATSAPP|WORKER_TOKEN|ORDER_PARSER_TOKEN)/i.test(key),
      'Forbidden server/provider secret variable in EAS '+profileName+': '+key,
    );
  }
}

const authEmailConfirmation = read(join(repoRoot, 'supabase/templates/confirmation.html'));
const authEmailRecovery = read(join(repoRoot, 'supabase/templates/recovery.html'));
const authEmailTemplateReadme = read(join(repoRoot, 'supabase/templates/README.md'));
requireValue(authEmailConfirmation.includes('SellerTray'), 'Signup confirmation template must use SellerTray branding');
requireValue(authEmailConfirmation.includes('{{ .ConfirmationURL }}'), 'Signup confirmation template must preserve Supabase ConfirmationURL');
requireValue(authEmailRecovery.includes('SellerTray'), 'Password recovery template must use SellerTray branding');
requireValue(authEmailRecovery.includes('{{ .ConfirmationURL }}'), 'Password recovery template must preserve Supabase ConfirmationURL');
requireValue(authEmailConfirmation.includes('https://processedge.com.ng/sellertray/privacy'), 'Signup confirmation template must link the SellerTray Privacy Policy');
requireValue(authEmailRecovery.includes('https://processedge.com.ng/sellertray/privacy'), 'Password recovery template must link the SellerTray Privacy Policy');
requireValue(!authEmailConfirmation.includes('OrderDesk') && !authEmailRecovery.includes('OrderDesk'), 'Production Auth email templates must not expose the OrderDesk beta name');
requireValue(authEmailTemplateReadme.includes('Send Email Auth Hook'), 'Auth email deployment notes must retain the Send Email Hook contract');
const sendAuthEmailFunction = read(join(repoRoot, 'supabase/functions/send-auth-email/index.ts'));
requireValue(sendAuthEmailFunction.includes("standardwebhooks@1.0.0"), 'Auth email hook must verify Standard Webhooks signatures');
const merchantOrderGeneratedTotalGuard = readFileSync(join(repoRoot, 'supabase/functions/merchant-order/index.ts'), 'utf8');
requireValue(!merchantOrderGeneratedTotalGuard.includes('line_total:'), 'merchant-order must not write generated line_total');
requireValue(sendAuthEmailFunction.includes('RESEND_API_KEY'), 'Auth email hook must read the Resend provider key server-side');
requireValue(sendAuthEmailFunction.includes('AUTH_EMAIL_FROM'), 'Auth email hook must read the sender identity server-side');
requireValue(sendAuthEmailFunction.includes('SEND_EMAIL_HOOK_SECRET'), 'Auth email hook must read the hook verification secret server-side');
requireValue(sendAuthEmailFunction.includes('Confirm your SellerTray email'), 'Auth email hook signup subject must be SellerTray-branded');
requireValue(sendAuthEmailFunction.includes('Reset your SellerTray password'), 'Auth email hook recovery subject must be SellerTray-branded');

const authGate = read(join(mobileRoot, 'src/components/AuthGate.tsx'));
requireValue(authGate.includes('return `sellertray://'), 'Auth redirects must be generated with sellertray://');
requireValue(authGate.includes("url.startsWith('sellertray://')"), 'AuthGate must accept sellertray://');
requireValue(authGate.includes("url.startsWith('orderdesk://')"), 'AuthGate must retain legacy orderdesk:// compatibility');
requireValue(authGate.includes("__DEV__ && Platform.OS !== 'web'"), 'Manual recovery URL fallback must remain development-only');

const provisionedApp = read(join(mobileRoot, 'src/ProvisionedApp.tsx'));
const legalGate = read(join(mobileRoot, 'src/components/LegalAcceptanceGate.tsx'));
requireValue(provisionedApp.includes('<LegalAcceptanceGate>'), 'Authenticated SellerTray sessions must pass through LegalAcceptanceGate');
requireValue(legalGate.includes('acceptSellerTrayLegal'), 'LegalAcceptanceGate must record acceptance through the lifecycle repository');
requireValue(legalGate.includes('https://processedge.com.ng/sellertray/privacy'), 'LegalAcceptanceGate privacy URL is missing');
requireValue(legalGate.includes('https://processedge.com.ng/sellertray/terms'), 'LegalAcceptanceGate terms URL is missing');
requireValue(authGate.includes('signupLegalAccepted'), 'SellerTray signup must require legal acknowledgement');
requireValue(authGate.includes('Email address') && authGate.includes('Confirm password'), 'Authentication forms must retain visible field labels');
requireValue(authGate.includes("keyboardShouldPersistTaps=\"handled\""), 'Authentication forms must remain keyboard-safe and scrollable');
requireValue(authGate.includes("visible ? 'Hide' : 'Show'"), 'Password fields must retain a show/hide control');

const accountControls = read(join(mobileRoot, 'src/components/AccountDataControls.tsx'));
requireValue(accountControls.includes("supabase.auth.signOut({ scope: 'local' })"), 'Account controls must expose device-local SellerTray sign-out');
requireValue(accountControls.includes('Sign out of this device'), 'Account controls must render a visible sign-out action');
requireValue(provisionedApp.includes("supabase.auth.signOut({ scope: 'local' })"), 'Provisioning sign-out must be device-local');
const saasApp = read(join(mobileRoot, 'src/SaasApp.tsx'));
const settingsHub = read(join(mobileRoot, 'src/components/SettingsHub.tsx'));
const catalogueView = read(join(mobileRoot, 'src/components/CatalogueView.tsx'));
const manualOrderComposer = read(join(mobileRoot, 'src/components/ManualOrderComposer.tsx'));
const createBusinessView = read(join(mobileRoot, 'src/components/CreateBusinessView.tsx'));
const businessRepository = read(join(mobileRoot, 'src/data/businessRepository.ts'));
const provisionBusinessFunction = read(join(repoRoot, 'supabase/functions/provision-business/index.ts'));
requireValue(settingsHub.includes('<AccountDataControls business={business} />'), 'Active merchants must reach AccountDataControls through More > Account & privacy');
requireValue(saasApp.includes("supabase.auth.signOut({ scope: 'local' })"), 'Workspace quick sign-out must be device-local');
requireValue(saasApp.includes('label="Products"') && saasApp.includes("onChange('products')"), 'Products must have a first-class bottom tab');
requireValue(saasApp.includes('label="More"') && saasApp.includes("onChange('more')"), 'Business/settings must be separated behind More');
requireValue(saasApp.includes("paddingBottom: Platform.OS === 'android' ? 46 : 10"), 'Android bottom navigation must retain system-navigation clearance');
requireValue(settingsHub.includes("BackHandler.addEventListener('hardwareBackPress'"), 'Android settings must support native back navigation');
requireValue(settingsHub.includes('SellerTray 1.0.0 · Android build 7'), 'More screen must expose the current Android build marker');
requireValue(saasApp.includes("StatusBar.currentHeight"), 'Android status-bar safe area must remain enforced in the merchant workspace');
requireValue(catalogueView.includes('Product name') && catalogueView.includes('Selling price') && catalogueView.includes('Customer words / aliases'), 'Product editor must retain visible field labels and guidance');
requireValue(manualOrderComposer.includes('Create an order') && manualOrderComposer.includes('Customer name') && manualOrderComposer.includes('Products *'), 'Orders must expose guided manual order creation');
requireValue(
  createBusinessView.includes('Merchant ID') &&
    createBusinessView.includes('PIS/000001') &&
    businessRepository.includes('merchantCode'),
  'Merchant onboarding must collect a permanent 3-character Merchant ID',
);
requireValue(
  provisionBusinessFunction.includes('getVerifiedUserId') &&
    provisionBusinessFunction.includes('p_merchant_code') &&
    provisionBusinessFunction.includes('/auth/v1/user'),
  'Business provisioning must verify the user token and persist the Merchant ID',
);
const orderFulfillmentPanel = read(join(mobileRoot, 'src/components/OrderFulfillmentPanel.tsx'));
const ordersRepository = read(join(mobileRoot, 'src/data/ordersRepository.ts'));
const orderFulfillmentFunction = read(join(repoRoot, 'supabase/functions/order-fulfillment/index.ts'));
const fulfillmentIntegrityMigration = read(join(repoRoot, 'supabase/migrations/20260912134000_fulfillment_completion_integrity.sql'));
requireValue(orderFulfillmentPanel.includes('Customer pickup') && orderFulfillmentPanel.includes('Merchant / own rider') && orderFulfillmentPanel.includes('Third-party dispatch'), 'Order fulfillment tracking UI must remain wired');
requireValue(
  ordersRepository.includes("supabase.functions.invoke('order-fulfillment'") &&
    !ordersRepository.includes("fulfillment_status: 'out_for_delivery'"),
  'Merchant fulfillment mutations must remain behind the governed order-fulfillment server operation',
);
requireValue(
  orderFulfillmentFunction.includes('admin.auth.getUser(token)') &&
    orderFulfillmentFunction.includes("orderdesk_subscription_can_write") &&
    orderFulfillmentFunction.includes("eq('fulfillment_status', 'unassigned')") &&
    orderFulfillmentFunction.includes("eq('fulfillment_status', 'out_for_delivery')"),
  'order-fulfillment must authenticate the user, enforce subscription access and use compare-and-set fulfillment transitions',
);
requireValue(
  fulfillmentIntegrityMigration.includes('Completed SellerTray orders require governed fulfillment evidence') &&
    fulfillmentIntegrityMigration.includes("new.fulfillment_status not in ('delivered', 'collected')"),
  'Database order completion must remain impossible without fulfillment evidence',
);
requireValue(orderFulfillmentPanel.includes('Mark delivered & complete') && orderFulfillmentPanel.includes('Mark collected & complete'), 'Order completion must retain fulfillment evidence');
requireValue(orderFulfillmentPanel.includes('Customer confirmed receipt on WhatsApp'), 'Completed orders must show customer receipt-confirmation provenance');
requireValue(
  saasApp.includes('order.publicOrderId') &&
    saasApp.includes('Search order ref, customer, phone, message or product'),
  'Merchant-scoped order references must be visible in the merchant order UI',
);
const orderIdSelfServiceMigration = read(join(repoRoot, 'supabase/migrations/20260912053000_order_ids_whatsapp_self_service.sql'));
const merchantReferenceMigration = read(join(repoRoot, 'supabase/migrations/20260912061000_merchant_scoped_order_references.sql'));
const whatsappReceiptTemplate = read(join(repoRoot, 'supabase/templates/whatsapp/order-receipt.txt'));
requireValue(
  orderIdSelfServiceMigration.includes('public_order_id') &&
    orderIdSelfServiceMigration.includes('order_status_reply') &&
    orderIdSelfServiceMigration.includes('order_receipt'),
  'Order ID and WhatsApp self-service migration contract is missing',
);
requireValue(
  merchantReferenceMigration.includes('merchant_code') &&
    merchantReferenceMigration.includes("merchant_code ~ '^[A-Z0-9]{3}$'") &&
    merchantReferenceMigration.includes("public_order_id ~ '^[A-Z0-9]{3}/[0-9]{6,}$'") &&
    merchantReferenceMigration.includes('sellertray_private.tenant_order_sequences'),
  'Merchant-scoped order reference contract is missing',
);
requireValue(
  whatsappReceiptTemplate.includes('{{public_order_id}}') &&
    whatsappReceiptTemplate.includes('ORDER RECEIPT'),
  'WhatsApp order receipt template must retain the public order ID',
);
const whatsappWebhookReceiptFunction = read(join(repoRoot, 'supabase/functions/whatsapp-webhook/index.ts'));
requireValue(
  whatsappWebhookReceiptFunction.includes('maybeConfirmCustomerReceipt') &&
    whatsappWebhookReceiptFunction.includes("fulfillment_confirmed_by: 'customer_whatsapp'") &&
    whatsappWebhookReceiptFunction.includes("fulfillment_status: 'delivered'"),
  'Customers must be able to confirm delivery receipt on WhatsApp',
);
requireValue(
  whatsappWebhookReceiptFunction.includes('maybeHandleCustomerSelfService') &&
    whatsappWebhookReceiptFunction.includes('detectCustomerSupportIntent') &&
    whatsappWebhookReceiptFunction.includes('renderOrderReceipt') &&
    whatsappWebhookReceiptFunction.includes('renderOrderStatus') &&
    whatsappWebhookReceiptFunction.includes('extractPublicOrderId'),
  'WhatsApp customers must be able to query status or request the latest receipt',
);
const pdfReceiptMigration = read(join(repoRoot, 'supabase/migrations/20260912054500_pdf_receipt_delivery.sql'));
const whatsappNotificationWorker = read(join(repoRoot, 'supabase/functions/send-whatsapp-notifications/index.ts'));
requireValue(
  pdfReceiptMigration.includes("'receipts', 'receipts', false") &&
    pdfReceiptMigration.includes("media_type = 'document'") &&
    pdfReceiptMigration.includes("media_mime_type = 'application/pdf'") &&
    pdfReceiptMigration.includes('guard_sellertray_receipt_cache'),
  'PDF receipt delivery migration contract is missing',
);
requireValue(
  whatsappWebhookReceiptFunction.includes("npm:pdf-lib@1.17.1") &&
    whatsappWebhookReceiptFunction.includes('ensureReceiptPdf') &&
    whatsappWebhookReceiptFunction.includes('uploadPrivateReceipt') &&
    whatsappWebhookReceiptFunction.includes("storageBucket: 'receipts'") &&
    whatsappWebhookReceiptFunction.includes('cachedPath === storagePath'),
  'WhatsApp receipt requests must generate/cache a private deterministic PDF',
);
requireValue(
  whatsappNotificationWorker.includes('sendDocumentNotification') &&
    whatsappNotificationWorker.includes('/media') &&
    whatsappNotificationWorker.includes("type: 'document'") &&
    whatsappNotificationWorker.includes('/storage/v1/object/authenticated/'),
  'WhatsApp notification worker must deliver private PDF receipts as documents',
);
requireValue(accountControls.includes('DELETE MY SELLERTRAY ACCOUNT'), 'Account deletion confirmation must use SellerTray');
requireValue(accountControls.includes('https://processedge.com.ng/sellertray/privacy'), 'In-app SellerTray privacy URL is missing');
requireValue(accountControls.includes('https://processedge.com.ng/sellertray/terms'), 'In-app SellerTray terms URL is missing');

const orderParserFunction = read(join(repoRoot, 'supabase/functions/order-parser/index.ts'));
const merchantOrderFunction = read(join(repoRoot, 'supabase/functions/merchant-order/index.ts'));
const atomicOrderMigration = read(join(repoRoot, 'supabase/migrations/20260912142500_atomic_order_creation.sql'));
const inboundRetryMigration = read(join(repoRoot, 'supabase/migrations/20260912145000_whatsapp_processing_retry_state.sql'));
const usageSettlementWorker = read(join(repoRoot, 'supabase/functions/usage-settlement/index.ts'));
const paystackWebhook = read(join(repoRoot, 'supabase/functions/paystack-webhook/index.ts'));
const usageSettlementMigration = read(join(repoRoot, 'supabase/migrations/20260910230000_usage_settlement_foundation.sql'));
const aiTelemetryMigration = read(join(repoRoot, 'supabase/migrations/20260911000500_ai_parser_cost_telemetry.sql'));
const aiAdminTelemetryMigration = read(join(repoRoot, 'supabase/migrations/20260911000600_platform_admin_ai_parser_telemetry.sql'));
const aiCachedTokenMigration = read(join(repoRoot, 'supabase/migrations/20260911000800_ai_parser_cached_token_telemetry.sql'));
const aiTokenIntegrityMigration = read(join(repoRoot, 'supabase/migrations/20260911000900_ai_parser_token_integrity.sql'));
const aiContextBudgetMigration = read(join(repoRoot, 'supabase/migrations/20260911001000_ai_parser_context_budget.sql'));
const whatsappWebhookFunction = read(join(repoRoot, 'supabase/functions/whatsapp-webhook/index.ts'));
requireValue(
  merchantOrderFunction.includes("admin.auth.getUser(token)") &&
    merchantOrderFunction.includes("tenant_members") &&
    merchantOrderFunction.includes("create_sellertray_manual_order_atomic"),
  'Manual order creation must remain a trusted authenticated atomic server flow',
);
requireValue(
  whatsappWebhookFunction.includes("create_sellertray_whatsapp_order_atomic") &&
    atomicOrderMigration.includes("create or replace function public.create_sellertray_manual_order_atomic") &&
    atomicOrderMigration.includes("create or replace function public.create_sellertray_whatsapp_order_atomic") &&
    atomicOrderMigration.includes("to service_role"),
  'Manual and WhatsApp order aggregates must remain transactional and service-role-only',
);
requireValue(
  whatsappWebhookFunction.includes("claim_sellertray_inbound_message") &&
    whatsappWebhookFunction.includes("finishInboundProcessing") &&
    !whatsappWebhookFunction.includes("Meta retry: already ingested, so do not duplicate an order"),
  'WhatsApp retries must use resumable processing state instead of suppressing every duplicate delivery',
);
requireValue(
  inboundRetryMigration.includes("processing_status in ('received','processing','completed','failed')") &&
    inboundRetryMigration.includes("orders_source_message_unique") &&
    inboundRetryMigration.includes("interval '10 minutes'") &&
    inboundRetryMigration.includes("when unique_violation"),
  'Inbound retry state must support failed/stale reclaim and idempotent one-order-per-message creation',
);
const usageScheduleMigration = read(join(repoRoot, 'supabase/migrations/20260910234500_schedule_usage_settlement_preparation.sql'));
const deletionUsageGuardMigration = read(join(repoRoot, 'supabase/migrations/20260910233000_block_deletion_with_unsettled_usage.sql'));
const usagePeriodCurrencyMigration = read(join(repoRoot, 'supabase/migrations/20260910235500_harden_usage_settlement_period_currency.sql'));
const accountLifecycleFunction = read(join(repoRoot, 'supabase/functions/account-lifecycle/index.ts'));
const accountLifecycleRepository = read(join(mobileRoot, 'src/data/accountLifecycleRepository.ts'));
const usageBillingContract = read(join(repoRoot, 'docs/usage_billing.md'));
const paymentCoreMigration = read(join(repoRoot, 'supabase/migrations/20260912072000_financial_document_contract_payment_core.sql'));
const paymentMethodMigration = read(join(repoRoot, 'supabase/migrations/20260912075000_merchant_payment_method_settings.sql'));
const paymentOrchestrationMigration = read(join(repoRoot, 'supabase/migrations/20260912084500_customer_payment_orchestration_foundation.sql'));
const paymentEnvironmentMigration = read(join(repoRoot, 'supabase/migrations/20260912152000_payment_provider_mode_binding.sql'));
const paymentSettingsFunction = read(join(repoRoot, 'supabase/functions/payment-settings/index.ts'));
const paymentRuntimeFunction = read(join(repoRoot, 'supabase/functions/payment-runtime/index.ts'));
const paystackPaymentWebhook = read(join(repoRoot, 'supabase/functions/paystack-payment-webhook/index.ts'));
const flutterwavePaymentWebhook = read(join(repoRoot, 'supabase/functions/flutterwave-payment-webhook/index.ts'));
const merchantPaymentOperations = read(join(repoRoot, 'supabase/functions/merchant-payment-operations/index.ts'));
const financialDocumentFunction = read(join(repoRoot, 'supabase/functions/financial-document/index.ts'));
const whatsappPaymentModule = read(join(repoRoot, 'supabase/functions/whatsapp-webhook/payment.ts'));
const orderPaymentPanel = read(join(mobileRoot, 'src/components/OrderPaymentPanel.tsx'));
const paymentReconciliationPanel = read(join(mobileRoot, 'src/components/PaymentReconciliationPanel.tsx'));
const paymentReconciliationRepository = read(join(mobileRoot, 'src/data/paymentReconciliationRepository.ts'));
const paymentMethodsSettings = read(join(mobileRoot, 'src/components/PaymentMethodsSettings.tsx'));
const customerPaymentsContract = read(join(repoRoot, 'docs/customer_payments.md'));

requireValue(
  paymentCoreMigration.includes("'ST/' || split_part(v_order_ref,'/',1) || '/' || v_kind || '/' || split_part(v_order_ref,'/',2)") &&
    paymentCoreMigration.includes("when 'invoice' then 'INV'") &&
    paymentCoreMigration.includes("when 'receipt' then 'RCP'") &&
    paymentCoreMigration.includes("document_type='receipt' and payment_id is not null") &&
    paymentCoreMigration.includes("where status='confirmed'"),
  'SellerTray financial document identity and one-confirmed-payment contract must remain intact',
);
requireValue(
  paymentCoreMigration.includes("SellerTray MVP payment must exactly match invoice amount and currency") &&
    paymentCoreMigration.includes("Paid SellerTray orders cannot be cancelled until refund support is available") &&
    paymentCoreMigration.includes('guard_invoiced_order_items'),
  'SellerTray exact-payment, paid-cancellation and invoiced-item lock contracts must remain intact',
);
requireValue(
  paymentMethodMigration.includes('sellertray_private.merchant_gateway_credentials') &&
    paymentMethodMigration.includes('revoke all on table sellertray_private.merchant_gateway_credentials from public,anon,authenticated') &&
    paymentMethodMigration.includes("method_type in ('paystack','flutterwave')") &&
    paymentMethodMigration.includes("configuration_status='configured'"),
  'Merchant-owned gateway credentials must remain server-only and fail closed until configured',
);
requireValue(
  paymentSettingsFunction.includes("SELLERTRAY_PAYMENT_ENCRYPTION_KEY") &&
    paymentSettingsFunction.includes("AES-GCM") &&
    paymentSettingsFunction.includes("Gateway credential storage is not activated yet") &&
    !paymentSettingsFunction.includes("return reply({ secretKey"),
  'Merchant gateway credentials must remain AES-GCM encrypted and never returned to the client',
);
requireValue(
  paymentSettingsFunction.includes("sk_test_") &&
    paymentSettingsFunction.includes("sk_live_") &&
    paymentSettingsFunction.includes("FLWSECK_TEST-") &&
    paymentSettingsFunction.includes("const credentials: J = { secretKey, mode }"),
  'Gateway credential connection must bind provider key material to the selected test/live mode',
);
requireValue(
  paymentEnvironmentMigration.includes('provider_mode') &&
    paymentEnvironmentMigration.includes('credential_mode') &&
    paymentEnvironmentMigration.includes('SellerTray payment provider mode is immutable') &&
    paymentEnvironmentMigration.includes('Disconnect SellerTray gateway credentials before changing test/live mode'),
  'Payment attempts and encrypted gateway credentials must retain immutable environment binding',
);
requireValue(
  paymentRuntimeFunction.includes('gatewayModeMismatch') &&
    paymentRuntimeFunction.includes('Verified Paystack environment does not match SellerTray payment mode') &&
    paymentRuntimeFunction.includes('data.domain') &&
    paymentRuntimeFunction.includes('credential_mode'),
  'Gateway runtime must reject credential/payment/provider environment mismatches before confirming value',
);
requireValue(
  paymentRuntimeFunction.includes('paystackMismatch') &&
    paymentRuntimeFunction.includes('flutterwaveMismatch') &&
    paymentRuntimeFunction.includes('Math.round(actualAmount * 100) !== Math.round(expectedAmount * 100)') &&
    paymentRuntimeFunction.includes('Verified Paystack currency does not match SellerTray payment') &&
    paymentRuntimeFunction.includes('Verified Flutterwave currency does not match SellerTray payment') &&
    paymentRuntimeFunction.includes('Verified Paystack reference does not match SellerTray payment') &&
    paymentRuntimeFunction.includes('Verified Flutterwave reference does not match SellerTray payment'),
  'Both gateway adapters must require exact amount, currency and SellerTray reference verification',
);
requireValue(
  paystackPaymentWebhook.includes("x-paystack-signature") &&
    paystackPaymentWebhook.includes("SHA-512") &&
    paystackPaymentWebhook.includes("paymentRuntimeVerify") &&
    flutterwavePaymentWebhook.includes("flutterwave-signature") &&
    flutterwavePaymentWebhook.includes("SHA-256") &&
    flutterwavePaymentWebhook.includes("paymentRuntimeVerify"),
  'Provider webhooks must authenticate payloads and re-verify provider transactions before confirming value',
);
requireValue(
  paymentOrchestrationMigration.includes('order_payment_events_replay_key') &&
    paymentOrchestrationMigration.includes('confirm_sellertray_offline_payment') &&
    paymentOrchestrationMigration.includes("'payment_confirmed'::text") &&
    paymentOrchestrationMigration.includes('zz_queue_sellertray_payment_confirmation'),
  'Payment audit, offline confirmation and payment-confirmation notification contracts are missing',
);
requireValue(
  financialDocumentFunction.includes("'PAYMENT RECEIPT'") &&
    financialDocumentFunction.includes("'INVOICE'") &&
    financialDocumentFunction.includes('not proof of payment') &&
    financialDocumentFunction.includes('proof of payment') &&
    financialDocumentFunction.includes("/financial/"),
  'Invoice and financial payment receipt PDFs must remain distinct from the legacy order receipt',
);
requireValue(
  whatsappPaymentModule.includes("PAYMENT RECEIPT ") &&
    whatsappPaymentModule.includes("payment_claim_received") &&
    whatsappPaymentModule.includes("pending_verification") &&
    whatsappPaymentModule.includes("kind: 'invoice'") &&
    whatsappPaymentModule.includes('sendInvoiceDocument') &&
    whatsappWebhookFunction.includes('maybeConfirmCustomerReceipt') &&
    whatsappWebhookFunction.includes('ensureReceiptPdf'),
  'WhatsApp payment self-service must coexist with the legacy order receipt and fulfilment-confirmation paths',
);
requireValue(
  orderPaymentPanel.includes('Confirm payment received') &&
    orderPaymentPanel.includes('Verify with provider') &&
    orderPaymentPanel.includes('Confirming payment does not complete the order or delivery') &&
    merchantPaymentOperations.includes('confirm_sellertray_offline_payment') &&
    merchantPaymentOperations.includes("action === 'verify_gateway'"),
  'Merchant payment verification UI must use governed server operations without coupling payment to fulfilment',
);
requireValue(
  paymentMethodsSettings.includes('<PaymentReconciliationPanel tenantId={business.id} />') &&
    paymentReconciliationPanel.includes('Payment inbox') &&
    paymentReconciliationPanel.includes("status === 'pending_verification'") &&
    paymentReconciliationPanel.includes('Verify provider') &&
    paymentReconciliationPanel.includes('Confirm received') &&
    paymentReconciliationRepository.includes("from('order_payments')") &&
    paymentReconciliationRepository.includes('confirmReconciliationPayment') &&
    paymentReconciliationRepository.includes('verifyReconciliationGateway'),
  'P8 tenant payment reconciliation inbox/report must remain wired to governed payment operations',
);
requireValue(
  customerPaymentsContract.includes('No percentage-of-sales / GMV fee') &&
    customerPaymentsContract.includes('SELLERTRAY_PAYMENT_ENCRYPTION_KEY') &&
    customerPaymentsContract.includes('Legacy ORDER RECEIPT') &&
    customerPaymentsContract.includes('external activation'),
  'Customer payment governance documentation is incomplete',
);

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
  accountLifecycleRepository.includes("SELLERTRAY_TERMS_VERSION = '2026-09-11'") &&
    accountLifecycleRepository.includes("SELLERTRAY_PRIVACY_VERSION = '2026-09-11'") &&
    accountLifecycleFunction.includes("SELLERTRAY_TERMS_VERSION = '2026-09-11'") &&
    accountLifecycleFunction.includes("SELLERTRAY_PRIVACY_VERSION = '2026-09-11'"),
  'SellerTray mobile/server legal acceptance versions must remain aligned at 2026-09-11',
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
  'dedicated OrderDesk Supabase project',
];
for (const filePath of collectFiles(join(mobileRoot, 'src')).filter((item) => /\.(ts|tsx)$/.test(item))) {
  const source = read(filePath);
  requireValue(!source.includes('OrderDesk'), 'Legacy OrderDesk product name remains in mobile source: '+filePath.replace(repoRoot + '/', ''));
}

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
  /FLUTTERWAVE_SECRET_KEY/g,
  /FLUTTERWAVE_SECRET_HASH/g,
  /SELLERTRAY_PAYMENT_ENCRYPTION_KEY/g,
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
console.log('- customer payment financial/provider contracts: pass');
console.log('- legal/deletion URL contracts: present');
console.log('- SellerTray Auth email template contracts: present');
console.log('- release acceptance manifest integrity: pass');
console.log('- committed dependency lockfile integrity: pass');
console.log('- sensitive Android permission deny-list: pass');
console.log('- Android Auto Backup disabled: pass');
