import { requireOptionalNativeModule } from 'expo';

export type PairedBluetoothPrinter = {
  name: string;
  address: string;
};

type NativePrinterModule = {
  isAvailable(): boolean;
  getBondedDevices(): Promise<PairedBluetoothPrinter[]>;
  write(address: string, payloadBase64: string): Promise<{ bytesWritten: number }>;
};

const nativePrinter = requireOptionalNativeModule<NativePrinterModule>('SellerTrayBluetoothPrinter');

export function isSellerTrayBluetoothPrinterAvailable(): boolean {
  return nativePrinter?.isAvailable() === true;
}

export async function getPairedBluetoothPrinters(): Promise<PairedBluetoothPrinter[]> {
  if (!nativePrinter) throw nativeBuildRequiredError();
  const devices = await nativePrinter.getBondedDevices();
  return devices
    .filter((device) => typeof device?.address === 'string' && typeof device?.name === 'string')
    .map((device) => ({ name: device.name, address: device.address.toUpperCase() }));
}

export async function writeSellerTrayBluetoothPrinter(
  address: string,
  payloadBase64: string,
): Promise<number> {
  if (!nativePrinter) throw nativeBuildRequiredError();
  const result = await nativePrinter.write(address, payloadBase64);
  if (!result || !Number.isFinite(result.bytesWritten) || result.bytesWritten <= 0) {
    throw new Error('The Bluetooth printer did not accept the receipt data.');
  }
  return result.bytesWritten;
}

function nativeBuildRequiredError(): Error {
  return new Error('Bluetooth printing requires the installed SellerTray Android app. It is not available in Expo Go.');
}
