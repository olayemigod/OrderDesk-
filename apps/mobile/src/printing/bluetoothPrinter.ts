import { PermissionsAndroid, Platform } from 'react-native';

import {
  getPairedBluetoothPrinters,
  isSellerTrayBluetoothPrinterAvailable,
  type PairedBluetoothPrinter,
  writeSellerTrayBluetoothPrinter,
} from '../../modules/sellertray-bluetooth-printer';

const BLUETOOTH_CONNECT = 'android.permission.BLUETOOTH_CONNECT' as Parameters<typeof PermissionsAndroid.request>[0];

export type BluetoothPrinterDevice = PairedBluetoothPrinter;

export function bluetoothPrintingSupported(): boolean {
  return Platform.OS === 'android' && isSellerTrayBluetoothPrinterAvailable();
}

export async function listPairedBluetoothPrinters(): Promise<BluetoothPrinterDevice[]> {
  requireAndroid();
  await ensureBluetoothConnectPermission();
  return getPairedBluetoothPrinters();
}

export async function sendBluetoothPrintBytes(address: string, bytes: Uint8Array): Promise<number> {
  requireAndroid();
  if (!address.trim()) throw new Error('Choose a paired Bluetooth printer first.');
  if (bytes.length === 0) throw new Error('There is no receipt data to print.');
  await ensureBluetoothConnectPermission();
  return writeSellerTrayBluetoothPrinter(address.trim().toUpperCase(), encodeBase64(bytes));
}

async function ensureBluetoothConnectPermission(): Promise<void> {
  if (Number(Platform.Version) < 31) return;
  const alreadyGranted = await PermissionsAndroid.check(BLUETOOTH_CONNECT);
  if (alreadyGranted) return;

  const result = await PermissionsAndroid.request(BLUETOOTH_CONNECT, {
    title: 'Connect to Bluetooth printer',
    message: 'SellerTray needs Bluetooth access to print receipts to a printer already paired with this Android device.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Bluetooth printer permission was not granted.');
  }
}

function requireAndroid(): void {
  if (Platform.OS !== 'android') {
    throw new Error('Bluetooth receipt printing is currently available on Android only.');
  }
  if (!isSellerTrayBluetoothPrinterAvailable()) {
    throw new Error('Bluetooth printing requires the installed SellerTray Android app. It is not available in Expo Go.');
  }
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const packed = (first << 16) | (second << 8) | third;
    output += alphabet[(packed >> 18) & 63] ?? '';
    output += alphabet[(packed >> 12) & 63] ?? '';
    output += index + 1 < bytes.length ? alphabet[(packed >> 6) & 63] ?? '' : '=';
    output += index + 2 < bytes.length ? alphabet[packed & 63] ?? '' : '=';
  }
  return output;
}
