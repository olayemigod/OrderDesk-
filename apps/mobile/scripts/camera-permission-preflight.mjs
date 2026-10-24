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

const appConfig = JSON.parse(read(join(mobileRoot, 'app.json')));
const packageJson = JSON.parse(read(join(mobileRoot, 'package.json')));
const scanner = read(join(mobileRoot, 'src/redesign/BarcodeScannerSheet.tsx'));
const plugins = appConfig?.expo?.plugins ?? [];
const blockedPermissions = appConfig?.expo?.android?.blockedPermissions ?? [];

function pluginOptions(name) {
  const entry = plugins.find((plugin) => Array.isArray(plugin) ? plugin[0] === name : plugin === name);
  return Array.isArray(entry) ? (entry[1] ?? {}) : entry ? {} : null;
}

const cameraOptions = pluginOptions('expo-camera');
const imagePickerOptions = pluginOptions('expo-image-picker');

requireValue(packageJson.dependencies?.['expo-camera'], 'expo-camera must remain a locked mobile dependency');
requireValue(cameraOptions !== null, 'expo-camera config plugin must remain enabled');
requireValue(cameraOptions?.recordAudioAndroid === false, 'barcode scanning must not re-enable Android microphone recording');
requireValue(!blockedPermissions.includes('android.permission.CAMERA'), 'Android CAMERA permission must not be blocked');
requireValue(imagePickerOptions !== null, 'expo-image-picker config plugin must remain explicit');
requireValue(imagePickerOptions?.cameraPermission !== false, 'expo-image-picker must not block Android CAMERA permission needed by barcode scanning');
requireValue(
  scanner.includes('useCameraPermissions()') &&
    scanner.includes('requestPermission') &&
    scanner.includes('getPermission') &&
    scanner.includes('permission?.canAskAgain === false') &&
    scanner.includes('Linking.openSettings()') &&
    scanner.includes("AppState.addEventListener('change'") &&
    scanner.includes('<CameraView'),
  'Barcode scanner must request camera access, recover from permanent denial through Settings, refresh permission on return and mount CameraView only after grant',
);

if (failures.length > 0) {
  console.error('SellerTray camera permission preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray camera permission preflight passed.');
