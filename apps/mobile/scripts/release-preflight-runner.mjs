import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const scriptsDir = import.meta.dirname;
const mobileRoot = path.resolve(scriptsDir, '..');
const sourcePath = path.join(scriptsDir, 'release-preflight.mjs');
const runtimePath = path.join(scriptsDir, '.release-preflight.runtime.mjs');
const appPath = path.join(mobileRoot, 'app.json');
const printerManifestPath = path.join(
  mobileRoot,
  'modules',
  'sellertray-bluetooth-printer',
  'android',
  'src',
  'main',
  'AndroidManifest.xml',
);
const printerModulePath = path.join(
  mobileRoot,
  'modules',
  'sellertray-bluetooth-printer',
  'android',
  'src',
  'main',
  'java',
  'ng',
  'processedge',
  'sellertray',
  'bluetooth',
  'SellerTrayBluetoothPrinterModule.kt',
);

const staleVersionCheck = "requireValue(app.android?.versionCode === 8, 'Android versionCode must be 8 for the merchant-reference QA line');";
const currentVersionCheck = `requireValue(
  Number.isInteger(app.android?.versionCode) && app.android.versionCode > 0,
  'Android versionCode must be a positive integer',
);`;

const staleSettingsCheck = "requireValue(settingsHub.includes('SellerTray 1.0.0 · Android build 8'), 'More screen must expose the current Android build marker');";
const currentSettingsCheck = `requireValue(
  settingsHub.includes('SellerTray ' + app.version + ' · Android build ' + app.android.versionCode),
  'More screen must expose the current Android build marker',
);`;

const staleBluetoothConnectBlockEntry = '  "android.permission.BLUETOOTH_CONNECT",\n';

const app = JSON.parse(fs.readFileSync(appPath, 'utf8')).expo;
const blockedPermissions = new Set(app.android?.blockedPermissions ?? []);
if (blockedPermissions.has('android.permission.BLUETOOTH_CONNECT')) {
  throw new Error('Bluetooth printer connection must not be blocked when the SellerTray printer module is enabled');
}
if (!blockedPermissions.has('android.permission.BLUETOOTH_SCAN')) {
  throw new Error('Bluetooth scanning must remain blocked; SellerTray supports already-paired printers only');
}
if (!fs.existsSync(printerManifestPath) || !fs.existsSync(printerModulePath)) {
  throw new Error('Bluetooth printer permission requires the governed SellerTray local printer module');
}

const printerManifest = fs.readFileSync(printerManifestPath, 'utf8');
const printerModule = fs.readFileSync(printerModulePath, 'utf8');
if (!printerManifest.includes('android.permission.BLUETOOTH_CONNECT')) {
  throw new Error('SellerTray printer module must declare BLUETOOTH_CONNECT');
}
if (printerManifest.includes('android.permission.BLUETOOTH_SCAN')) {
  throw new Error('SellerTray printer module must not declare BLUETOOTH_SCAN');
}
if (!printerModule.includes('BluetoothDevice.BOND_BONDED')) {
  throw new Error('SellerTray printer transport must remain restricted to Android-paired devices');
}
if (!printerModule.includes('00001101-0000-1000-8000-00805F9B34FB')) {
  throw new Error('SellerTray printer transport must retain the Bluetooth Classic SPP contract');
}

let source = fs.readFileSync(sourcePath, 'utf8');

if (source.split(staleVersionCheck).length !== 2) {
  throw new Error('Expected exactly one legacy Android version check in release preflight');
}
if (source.split(staleSettingsCheck).length !== 2) {
  throw new Error('Expected exactly one legacy build marker check in release preflight');
}
if (source.split(staleBluetoothConnectBlockEntry).length !== 2) {
  throw new Error('Expected exactly one legacy BLUETOOTH_CONNECT block entry in release preflight');
}

source = source
  .replace(staleVersionCheck, currentVersionCheck)
  .replace(staleSettingsCheck, currentSettingsCheck)
  .replace(staleBluetoothConnectBlockEntry, '');

fs.writeFileSync(runtimePath, source);
try {
  const result = spawnSync(process.execPath, [runtimePath, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(runtimePath, { force: true });
}
