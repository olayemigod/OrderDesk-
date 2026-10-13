import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const scriptsDir = import.meta.dirname;
const mobileRoot = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(mobileRoot, '../..');
const sourcePath = path.join(scriptsDir, 'release-preflight.mjs');
const runtimePath = path.join(scriptsDir, '.release-preflight.runtime.mjs');
const appPath = path.join(mobileRoot, 'app.json');
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

const staleVersionCodeCheck = "requireValue(app.android?.versionCode === 19, 'Android versionCode must be 19 for the merchant-reference QA line');";
const currentVersionCodeCheck = "requireValue(app.android?.versionCode === 21, 'Android versionCode must be 21 for the merchant-reference QA line');";

const app = JSON.parse(fs.readFileSync(appPath, 'utf8')).expo;
const blockedPermissions = new Set(app.android?.blockedPermissions ?? []);
if (blockedPermissions.has('android.permission.BLUETOOTH_CONNECT')) throw new Error('Bluetooth printer connection must not be blocked when the SellerTray printer module is enabled');
if (!blockedPermissions.has('android.permission.BLUETOOTH_SCAN')) throw new Error('Bluetooth scanning must remain blocked; SellerTray supports already-paired printers only');
if (!fs.existsSync(printerManifestPath) || !fs.existsSync(printerModulePath)) throw new Error('Bluetooth printer permission requires the governed SellerTray local printer module');

const printerManifest = fs.readFileSync(printerManifestPath, 'utf8');
const printerModule = fs.readFileSync(printerModulePath, 'utf8');
if (!printerManifest.includes('android.permission.BLUETOOTH_CONNECT')) throw new Error('SellerTray printer module must declare BLUETOOTH_CONNECT');
if (printerManifest.includes('android.permission.BLUETOOTH_SCAN')) throw new Error('SellerTray printer module must not declare BLUETOOTH_SCAN');
if (!printerModule.includes('BluetoothDevice.BOND_BONDED')) throw new Error('SellerTray printer transport must remain restricted to Android-paired devices');
if (!printerModule.includes('00001101-0000-1000-8000-00805F9B34FB')) throw new Error('SellerTray printer transport must retain the Bluetooth Classic SPP contract');

const provisionedApp = fs.readFileSync(provisionedAppPath, 'utf8');
if (!provisionedApp.includes("import RedesignWorkspace from './redesign/RedesignWorkspace';")) throw new Error('SellerTray merchant runtime must import RedesignWorkspace');
if (!provisionedApp.includes('return <RedesignWorkspace />;')) throw new Error('SellerTray merchant runtime must launch RedesignWorkspace by default');
if (provisionedApp.includes("import SaasApp from './SaasApp';") || provisionedApp.includes('<SaasApp')) throw new Error('Redesign QA must not retain a merchant-runtime fallback to legacy SaasApp');
if (provisionedApp.includes('EXPO_PUBLIC_SELLERTRAY_MOBILE_REDESIGN')) throw new Error('Redesign QA must not depend on an environment flag to select the new SellerTray runtime');

const redesignWorkspace = fs.readFileSync(redesignWorkspacePath, 'utf8');
for (const label of ['Home', 'Sell', 'Orders', 'Inventory', 'More']) {
  if (!redesignWorkspace.includes(label)) throw new Error(`Redesign workspace is missing required primary navigation label: ${label}`);
}
const moreWorkspace = fs.readFileSync(moreWorkspacePath, 'utf8');
const expectedBuildMarker = `Android build ${app.android?.versionCode}`;
if (!moreWorkspace.includes('SellerTray ') || !moreWorkspace.includes(expectedBuildMarker)) throw new Error('Redesigned More screen must expose the current Android build marker');

let source = fs.readFileSync(sourcePath, 'utf8');
if (source.split(staleOrderChangeCheck).length !== 2) throw new Error('Expected exactly one legacy order-change governance check in release preflight');
source = source.replace(staleOrderChangeCheck, currentOrderChangeCheck);
if (source.split(staleVersionCodeCheck).length !== 2) throw new Error('Expected exactly one build 19 QA version guard in release preflight');
source = source.replace(staleVersionCodeCheck, currentVersionCodeCheck);

fs.writeFileSync(runtimePath, source);
try {
  const result = spawnSync(process.execPath, [runtimePath, ...process.argv.slice(2)], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(runtimePath, { force: true });
}
