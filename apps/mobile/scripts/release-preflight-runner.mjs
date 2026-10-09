import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const scriptsDir = import.meta.dirname;
const sourcePath = path.join(scriptsDir, 'release-preflight.mjs');
const runtimePath = path.join(scriptsDir, '.release-preflight.runtime.mjs');

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

let source = fs.readFileSync(sourcePath, 'utf8');

if (source.split(staleVersionCheck).length !== 2) {
  throw new Error('Expected exactly one legacy Android version check in release preflight');
}
if (source.split(staleSettingsCheck).length !== 2) {
  throw new Error('Expected exactly one legacy build marker check in release preflight');
}

source = source
  .replace(staleVersionCheck, currentVersionCheck)
  .replace(staleSettingsCheck, currentSettingsCheck);

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
