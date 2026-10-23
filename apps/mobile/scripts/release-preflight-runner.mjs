import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const scriptsDir = import.meta.dirname;
const mobileRoot = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(mobileRoot, '../..');
const sourcePath = path.join(scriptsDir, 'release-preflight.mjs');
const runtimePath = path.join(scriptsDir, '.release-preflight.runtime.mjs');
const appPath = path.join(mobileRoot, 'app.json');
const packagePath = path.join(mobileRoot, 'package.json');
const provisionedAppPath = path.join(mobileRoot, 'src', 'ProvisionedApp.tsx');
const redesignWorkspacePath = path.join(mobileRoot, 'src', 'redesign', 'RedesignWorkspace.tsx');
const moreWorkspacePath = path.join(mobileRoot, 'src', 'redesign', 'MoreWorkspace.tsx');
const printerManifestPath = path.join(mobileRoot, 'modules', 'sellertray-bluetooth-printer', 'android', 'src', 'main', 'AndroidManifest.xml');
const printerModulePath = path.join(mobileRoot, 'modules', 'sellertray-bluetooth-printer', 'android', 'src', 'main', 'java', 'ng', 'processedge', 'sellertray', 'bluetooth', 'SellerTrayBluetoothPrinterModule.kt');

const staleOrderChangeCheck = `requireValue(
  orderChangeRequestFunction.includes("admin.auth.getUser(token)") &&
    orderChangeRequestFunction.includes("request_kind === 'add_items'") &&
    orderChangeRequestFunction.includes("request_kind === 'cancel_order'") &&
    orderChangeRequestFunction.includes('For remove/change requests') &&
    orderChangeRequestFunction.includes('tenant_members'),
  'Merchant order-change actions must remain authenticated, tenant-scoped and explicit',
);`;

const currentOrderChangeCheck = `const orderChangeGovernanceMigration = read(join(repoRoot, 'supabase/migrations/20261013100000_order_change_governance.sql'));
const orderChangeBranchConvergenceMigration = read(join(repoRoot, 'supabase/migrations/20261013120317_order_change_branch_authority_convergence.sql'));
requireValue(
  orderChangeRequestFunction.includes("admin.auth.getUser(token)") &&
    orderChangeRequestFunction.includes("'resolve_sellertray_customer_order_change'") &&
    orderChangeRequestFunction.includes('p_actor_user_id: userId') &&
    orderChangeGovernanceMigration.includes('create or replace function public.resolve_sellertray_customer_order_change') &&
    orderChangeGovernanceMigration.includes("'can_manage_orders'") &&
    orderChangeGovernanceMigration.includes("v_action not in ('apply','resolve','reject')") &&
    orderChangeBranchConvergenceMigration.includes('create or replace function public.resolve_sellertray_customer_order_change') &&
    orderChangeBranchConvergenceMigration.includes('sellertray_user_can_operate_branch') &&
    !orderChangeBranchConvergenceMigration.includes('sellertray_user_can_access_branch') &&
    orderChangeBranchConvergenceMigration.includes("v_request.status not in ('pending','reviewed')"),
  'Merchant order-change actions must remain authenticated, tenant-scoped, branch-authorized and retry-safe',
);`;

const staleFulfillmentCheck = `requireValue(
  orderFulfillmentFunction.includes('admin.auth.getUser(token)') &&
    orderFulfillmentFunction.includes("orderdesk_subscription_can_write") &&
    orderFulfillmentFunction.includes("order.status !== 'cancelled'") &&
    orderFulfillmentFunction.includes('tenant_members'),
  'Merchant fulfillment actions must remain authenticated, subscription-gated and tenant-scoped',
);`;

const currentFulfillmentCheck = `const fulfillmentBranchAuthorityMigration = read(join(repoRoot, 'supabase/migrations/20261013170500_fulfillment_branch_authority.sql'));
requireValue(
  orderFulfillmentFunction.includes('admin.auth.getUser(token)') &&
    orderFulfillmentFunction.includes("'complete_sellertray_order_fulfillment'") &&
    orderFulfillmentFunction.includes('p_actor_user_id: userId') &&
    fulfillmentBranchAuthorityMigration.includes('create or replace function public.complete_sellertray_order_fulfillment') &&
    fulfillmentBranchAuthorityMigration.includes('sellertray_user_can_operate_branch') &&
    fulfillmentBranchAuthorityMigration.includes("orderdesk_subscription_can_write") &&
    fulfillmentBranchAuthorityMigration.includes("v_order.status <> 'cancelled'"),
  'Merchant fulfillment actions must remain authenticated, subscription-gated, tenant-scoped and branch-authorized',
);`;

const staleReleaseCheck = `requireValue(
  moreWorkspaceReleaseMarker.includes('Android build 35'),
  'More screen must expose the current Android QA build marker',
);`;

const currentReleaseCheck = `requireValue(
  moreWorkspaceReleaseMarker.includes("import Constants from 'expo-constants';") &&
    moreWorkspaceReleaseMarker.includes('Constants.expoConfig?.android?.versionCode') &&
    moreWorkspaceReleaseMarker.includes('Android build ') &&
    !/Android build \\d+/.test(moreWorkspaceReleaseMarker),
  'More screen must derive the current Android build marker from Expo config',
);`;

const app = JSON.parse(fs.readFileSync(appPath, 'utf8')).expo;
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const blockedPermissions = new Set(app.android?.blockedPermissions ?? []);
if (blockedPermissions.has('android.permission.BLUETOOTH_CONNECT')) throw new Error('Bluetooth printer connection must not be blocked when the SellerTray printer module is enabled');
if (!blockedPermissions.has('android.permission.BLUETOOTH_SCAN')) throw new Error('Bluetooth scanning must remain blocked; SellerTray supports already-paired printers only');
if (blockedPermissions.has('android.permission.CAMERA')) throw new Error('SellerTray POS barcode scanning requires Android camera permission');
if (pkg.dependencies?.['expo-camera'] !== '~57.0.6') throw new Error('SellerTray POS barcode scanning must retain the pinned expo-camera dependency');
const cameraPlugin = (app.plugins ?? []).find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera');
if (!cameraPlugin) throw new Error('SellerTray POS barcode scanning requires the expo-camera config plugin');
if (!String(cameraPlugin?.[1]?.cameraPermission ?? '').includes('scan product barcodes')) throw new Error('SellerTray camera permission must explain product barcode scanning');
if (!fs.existsSync(printerManifestPath) || !fs.existsSync(printerModulePath)) throw new Error('Bluetooth printer permission requires the governed SellerTray local printer module');

const printerManifest = fs.readFileSync(printerManifestPath, 'utf8');
const printerModule = fs.readFileSync(printerModulePath, 'utf8');
if (!printerManifest.includes('android.permission.BLUETOOTH_CONNECT')) throw new Error('SellerTray printer module must declare BLUETOOTH_CONNECT');
if (printerManifest.includes('android.permission.BLUETOOTH_SCAN')) throw new Error('SellerTray printer module must not declare BLUETOOTH_SCAN');
if (!printerModule.includes('BluetoothDevice.BOND_BONDED')) throw new Error('SellerTray printer transport must remain restricted to Android-paired devices');
if (!printerModule.includes('00001101-0000-1000-8000-00805F9B34FB')) throw new Error('SellerTray printer transport must retain the Bluetooth Classic SPP contract');

const provisionedApp = fs.readFileSync(provisionedAppPath, 'utf8');
if (!provisionedApp.includes("import RedesignWorkspace from './redesign/RedesignWorkspace';")) throw new Error('SellerTray merchant runtime must import RedesignWorkspace');
if (!provisionedApp.includes("import { OnboardingActivationGate } from './components/OnboardingActivationGate';")) throw new Error('SellerTray merchant runtime must import the governed onboarding activation gate');
if (!provisionedApp.includes('<OnboardingActivationGate business={activeBusiness}><RedesignWorkspace /></OnboardingActivationGate>')) throw new Error('SellerTray merchant runtime must gate operational RedesignWorkspace behind governed onboarding activation');
if (provisionedApp.includes('return <RedesignWorkspace />;')) throw new Error('SellerTray merchant runtime must not bypass governed onboarding activation');
if (provisionedApp.includes("import SaasApp from './SaasApp';") || provisionedApp.includes('<SaasApp')) throw new Error('Redesign QA must not retain a merchant-runtime fallback to legacy SaasApp');
if (provisionedApp.includes('EXPO_PUBLIC_SELLERTRAY_MOBILE_REDESIGN')) throw new Error('Redesign QA must not depend on an environment flag to select the new SellerTray runtime');

const redesignWorkspace = fs.readFileSync(redesignWorkspacePath, 'utf8');
for (const label of ['Home', 'Sell', 'Orders', 'Inventory', 'More']) {
  if (!redesignWorkspace.includes(label)) throw new Error(`Redesign workspace is missing required primary navigation label: ${label}`);
}
const moreWorkspace = fs.readFileSync(moreWorkspacePath, 'utf8');
if (
  !moreWorkspace.includes("import Constants from 'expo-constants';") ||
  !moreWorkspace.includes('Constants.expoConfig?.android?.versionCode') ||
  !moreWorkspace.includes('Android build ${androidBuild}') ||
  /Android build \d+/.test(moreWorkspace)
) {
  throw new Error('Redesigned More screen must derive its Android build marker from the current Expo config without a hard-coded build number');
}

let source = fs.readFileSync(sourcePath, 'utf8');
if (source.split(staleOrderChangeCheck).length !== 2) throw new Error('Expected exactly one legacy order-change governance check in release preflight');
source = source.replace(staleOrderChangeCheck, currentOrderChangeCheck);
if (source.split(staleFulfillmentCheck).length !== 2) throw new Error('Expected exactly one legacy fulfillment governance check in release preflight');
source = source.replace(staleFulfillmentCheck, currentFulfillmentCheck);
if (source.split(staleReleaseCheck).length !== 2) throw new Error('Expected exactly one legacy Android build marker check in release preflight');
source = source.replace(staleReleaseCheck, currentReleaseCheck);
fs.writeFileSync(runtimePath, source);

const result = spawnSync(process.execPath, [runtimePath], { cwd: mobileRoot, stdio: 'inherit' });
try {
  fs.rmSync(runtimePath, { force: true });
} finally {
  process.exit(result.status ?? 1);
}
