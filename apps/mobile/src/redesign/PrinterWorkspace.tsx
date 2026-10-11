import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { loadCashRegisters, type CashRegister, type CashShift } from '../data/cashShiftRepository';
import type { CommerceBranch } from '../data/commerceRepository';
import {
  loadPrinters,
  loadPrintingCapabilities,
  requestPrintJob,
  savePrinter,
  type PrintingCapabilities,
  type SellerTrayPrinter,
} from '../data/printerRepository';
import {
  bluetoothPrintingSupported,
  listPairedBluetoothPrinters,
  type BluetoothPrinterDevice,
} from '../printing/bluetoothPrinter';
import { executePreparedPrintJob } from '../printing/printExecutor';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  activeShift: CashShift | null;
  onClose: () => void;
};

const NO_CAPABILITIES: PrintingCapabilities = { canPrintReceipt: false, canManageDevices: false };

export function PrinterWorkspace({ tenantId, branch, activeShift, onClose }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [registerId, setRegisterId] = useState(activeShift?.registerId ?? '');
  const [printers, setPrinters] = useState<SellerTrayPrinter[]>([]);
  const [capabilities, setCapabilities] = useState<PrintingCapabilities>(NO_CAPABILITIES);
  const [pairedDevices, setPairedDevices] = useState<BluetoothPrinterDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deviceAddress, setDeviceAddress] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [paperWidthMm, setPaperWidthMm] = useState<58 | 80>(58);
  const [isDefault, setIsDefault] = useState(true);
  const [isActive, setIsActive] = useState(true);

  const selectedRegister = useMemo(
    () => registers.find((register) => register.id === registerId) ?? null,
    [registerId, registers],
  );

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      loadCashRegisters(tenantId, branch.id),
      loadPrintingCapabilities(tenantId, branch.id),
    ])
      .then(([nextRegisters, nextCapabilities]) => {
        if (!mounted) return;
        setRegisters(nextRegisters);
        setCapabilities(nextCapabilities);
        setRegisterId((current) => {
          if (nextRegisters.some((register) => register.id === current)) return current;
          if (activeShift && nextRegisters.some((register) => register.id === activeShift.registerId)) {
            return activeShift.registerId;
          }
          return nextRegisters.find((register) => register.isDefault)?.id ?? nextRegisters[0]?.id ?? '';
        });
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Unable to load printer settings.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [tenantId, branch.id, activeShift?.registerId]);

  useEffect(() => {
    if (!registerId) {
      setPrinters([]);
      return undefined;
    }
    let mounted = true;
    setError(null);
    void loadPrinters(tenantId, branch.id, registerId)
      .then((rows) => {
        if (mounted) setPrinters(rows);
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Unable to load printers.');
      });
    return () => {
      mounted = false;
    };
  }, [tenantId, branch.id, registerId]);

  async function refreshPrinters() {
    if (!registerId) return;
    setPrinters(await loadPrinters(tenantId, branch.id, registerId));
  }

  async function loadPaired() {
    setDiscovering(true);
    setError(null);
    setNotice(null);
    try {
      const devices = await listPairedBluetoothPrinters();
      setPairedDevices(devices);
      if (devices.length === 0) setNotice('No paired Bluetooth devices were found. Pair the printer in Android Bluetooth settings first.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read paired Bluetooth devices.');
    } finally {
      setDiscovering(false);
    }
  }

  function selectDevice(device: BluetoothPrinterDevice) {
    setDeviceAddress(device.address);
    if (!displayName.trim()) setDisplayName(device.name);
    setNotice(null);
  }

  function editPrinter(printer: SellerTrayPrinter) {
    setEditingId(printer.id);
    setDeviceAddress(printer.hardwareIdentifier);
    setDisplayName(printer.displayName);
    setPaperWidthMm(printer.paperWidthMm);
    setIsDefault(printer.isDefault);
    setIsActive(printer.isActive);
    setError(null);
    setNotice(null);
  }

  function resetForm() {
    setEditingId(null);
    setDeviceAddress('');
    setDisplayName('');
    setPaperWidthMm(58);
    setIsDefault(printers.length === 0);
    setIsActive(true);
  }

  async function persistPrinter() {
    if (!registerId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await savePrinter({
        tenantId,
        printerId: editingId,
        branchId: branch.id,
        registerId,
        displayName,
        hardwareIdentifier: deviceAddress,
        paperWidthMm,
        isDefault,
        isActive,
      });
      await refreshPrinters();
      resetForm();
      setNotice('Printer settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this printer.');
    } finally {
      setSaving(false);
    }
  }

  async function testPrinter(printer: SellerTrayPrinter) {
    setPrintingId(printer.id);
    setError(null);
    setNotice(null);
    try {
      const job = await requestPrintJob({ tenantId, printerId: printer.id, jobType: 'test' });
      await executePreparedPrintJob(tenantId, job);
      setNotice(`Test receipt printed on ${printer.displayName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test print failed.');
    } finally {
      setPrintingId(null);
    }
  }

  return (
    <View style={styles.stack}>
      <Pressable onPress={onClose} style={styles.backRow}>
        <Ionicons name="chevron-back" size={20} color={dark ? theme.colors.cloud : theme.colors.navy} />
        <Text style={[styles.backText, dark && darkStyles.titleText]}>More</Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>DEVICES & PRINTERS</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>Receipt printers</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Connect an Android-paired Bluetooth thermal printer to a register. Test prints and receipt reprints are recorded separately from the sale.
        </Text>
      </View>

      {!bluetoothPrintingSupported() ? (
        <View style={[styles.infoCard, dark && darkStyles.card]}>
          <Ionicons name="information-circle-outline" size={21} color={theme.colors.greenDark} />
          <Text style={[styles.infoText, dark && darkStyles.bodyText]}>
            Bluetooth printing requires the installed SellerTray Android build. Expo Go cannot load the printer module.
          </Text>
        </View>
      ) : null}

      {error ? <MessageCard tone="error" text={error} dark={dark} /> : null}
      {notice ? <MessageCard tone="success" text={notice} dark={dark} /> : null}

      {loading ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading printer settings…</Text>
        </View>
      ) : null}

      {!loading && registers.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No register is available</Text>
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Create or activate a register before assigning a printer.</Text>
        </View>
      ) : null}

      {registers.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, dark && darkStyles.bodyText]}>REGISTER</Text>
          <View style={styles.chipRow}>
            {registers.map((register) => (
              <Pressable
                key={register.id}
                onPress={() => setRegisterId(register.id)}
                style={[styles.chip, register.id === registerId && styles.chipActive, dark && darkStyles.outline]}
              >
                <Text style={[styles.chipText, register.id === registerId && styles.chipTextActive, dark && register.id !== registerId && darkStyles.bodyText]}>
                  {register.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {selectedRegister ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionLabel, dark && darkStyles.bodyText]}>CONFIGURED</Text>
              <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{selectedRegister.name}</Text>
            </View>
          </View>

          {printers.length === 0 ? (
            <View style={[styles.emptyCard, dark && darkStyles.card]}>
              <Ionicons name="print-outline" size={26} color={theme.colors.greenDark} />
              <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No printer configured</Text>
              <Text style={[styles.muted, dark && darkStyles.bodyText]}>Add a paired Bluetooth printer below.</Text>
            </View>
          ) : null}

          {printers.map((printer) => (
            <View key={printer.id} style={[styles.printerCard, dark && darkStyles.card]}>
              <View style={styles.printerMain}>
                <View style={[styles.printerIcon, printer.isActive && styles.printerIconActive]}>
                  <Ionicons name="print-outline" size={22} color={theme.colors.greenDark} />
                </View>
                <View style={styles.printerCopy}>
                  <Text style={[styles.printerName, dark && darkStyles.titleText]}>{printer.displayName}</Text>
                  <Text style={[styles.printerMeta, dark && darkStyles.bodyText]}>{printer.paperWidthMm} mm · {printer.hardwareIdentifier}</Text>
                  <Text style={[styles.printerMeta, dark && darkStyles.bodyText]}>{printer.isDefault ? 'Default printer' : 'Additional printer'} · {printer.isActive ? 'Active' : 'Inactive'}</Text>
                </View>
              </View>
              <View style={styles.actionRow}>
                {capabilities.canManageDevices ? (
                  <Pressable onPress={() => editPrinter(printer)} style={[styles.smallButton, dark && darkStyles.outline]}>
                    <Text style={[styles.smallButtonText, dark && darkStyles.bodyText]}>Edit</Text>
                  </Pressable>
                ) : null}
                {capabilities.canPrintReceipt && printer.isActive ? (
                  <Pressable
                    disabled={printingId !== null}
                    onPress={() => void testPrinter(printer)}
                    style={[styles.testButton, printingId !== null && styles.disabled]}
                  >
                    {printingId === printer.id ? <ActivityIndicator size="small" color={theme.colors.white} /> : <Ionicons name="receipt-outline" size={16} color={theme.colors.white} />}
                    <Text style={styles.testButtonText}>{printingId === printer.id ? 'Printing…' : 'Test print'}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {capabilities.canManageDevices && selectedRegister ? (
        <View style={[styles.setupCard, dark && darkStyles.card]}>
          <View style={styles.sectionHeader}>
            <View style={styles.flexOne}>
              <Text style={[styles.sectionLabel, dark && darkStyles.bodyText]}>{editingId ? 'EDIT PRINTER' : 'ADD PRINTER'}</Text>
              <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{editingId ? 'Update printer' : 'Pair with SellerTray'}</Text>
            </View>
            {editingId ? <Pressable onPress={resetForm}><Text style={styles.linkText}>Cancel</Text></Pressable> : null}
          </View>

          <Text style={[styles.helper, dark && darkStyles.bodyText]}>Pair the printer in Android Bluetooth settings first, then load paired devices here.</Text>
          <Pressable disabled={discovering} onPress={() => void loadPaired()} style={[styles.outlineButton, dark && darkStyles.outline]}>
            {discovering ? <ActivityIndicator size="small" /> : <Ionicons name="bluetooth-outline" size={18} color={theme.colors.greenDark} />}
            <Text style={[styles.outlineButtonText, dark && darkStyles.titleText]}>{discovering ? 'Loading…' : 'Show paired devices'}</Text>
          </Pressable>

          {pairedDevices.length > 0 ? (
            <View style={styles.deviceList}>
              {pairedDevices.map((device) => (
                <Pressable
                  key={device.address}
                  onPress={() => selectDevice(device)}
                  style={[styles.deviceRow, deviceAddress === device.address && styles.deviceRowSelected, dark && darkStyles.outline]}
                >
                  <Ionicons name="bluetooth" size={17} color={theme.colors.greenDark} />
                  <View style={styles.flexOne}>
                    <Text style={[styles.deviceName, dark && darkStyles.titleText]}>{device.name}</Text>
                    <Text style={[styles.deviceAddress, dark && darkStyles.bodyText]}>{device.address}</Text>
                  </View>
                  {deviceAddress === device.address ? <Ionicons name="checkmark-circle" size={20} color={theme.colors.greenDark} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Printer name</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Front counter printer"
            placeholderTextColor={theme.colors.subtle}
            style={[styles.input, dark && darkStyles.input]}
          />

          <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Bluetooth address</Text>
          <TextInput
            value={deviceAddress}
            onChangeText={(value) => setDeviceAddress(value.toUpperCase())}
            autoCapitalize="characters"
            placeholder="00:11:22:33:44:55"
            placeholderTextColor={theme.colors.subtle}
            style={[styles.input, dark && darkStyles.input]}
          />

          <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Paper width</Text>
          <View style={styles.chipRow}>
            {([58, 80] as const).map((width) => (
              <Pressable key={width} onPress={() => setPaperWidthMm(width)} style={[styles.chip, width === paperWidthMm && styles.chipActive, dark && darkStyles.outline]}>
                <Text style={[styles.chipText, width === paperWidthMm && styles.chipTextActive, dark && width !== paperWidthMm && darkStyles.bodyText]}>{width} mm</Text>
              </Pressable>
            ))}
          </View>

          <ToggleRow label="Default printer" value={isDefault} onChange={setIsDefault} dark={dark} />
          <ToggleRow label="Active" value={isActive} onChange={setIsActive} dark={dark} />

          <Pressable
            disabled={saving || !displayName.trim() || !deviceAddress.trim()}
            onPress={() => void persistPrinter()}
            style={[styles.saveButton, (saving || !displayName.trim() || !deviceAddress.trim()) && styles.disabled]}
          >
            {saving ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="save-outline" size={18} color={theme.colors.white} />}
            <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save printer'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ToggleRow({ label, value, onChange, dark }: { label: string; value: boolean; onChange: (value: boolean) => void; dark: boolean }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.toggleLabel, dark && darkStyles.titleText]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: '#D0D5DD', true: '#ABEFC6' }} thumbColor={value ? theme.colors.green : '#F2F4F7'} />
    </View>
  );
}

function MessageCard({ tone, text, dark }: { tone: 'error' | 'success'; text: string; dark: boolean }) {
  return (
    <View style={[styles.messageCard, tone === 'error' ? styles.errorCard : styles.successCard, dark && darkStyles.card]}>
      <Ionicons name={tone === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={19} color={tone === 'error' ? theme.colors.danger : theme.colors.greenDark} />
      <Text style={[styles.messageText, dark && darkStyles.bodyText]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  backRow: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 4 },
  backText: { color: theme.colors.navy, fontSize: 13, fontWeight: '800' },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { color: theme.colors.navy, fontSize: 27, lineHeight: 33, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 13, lineHeight: 19 },
  section: { gap: 9 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  sectionTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900', marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.white },
  chipActive: { borderColor: '#75E0A7', backgroundColor: theme.colors.mintSoft },
  chipText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  chipTextActive: { color: theme.colors.greenDark },
  infoCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  infoText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  messageCard: { borderRadius: theme.radius.md, borderWidth: 1, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorCard: { borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft },
  successCard: { borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft },
  messageText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  emptyCard: { minHeight: 96, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, alignItems: 'center', justifyContent: 'center', gap: 6 },
  emptyTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  printerCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 12, gap: 10 },
  printerMain: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  printerIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: theme.colors.cloud, alignItems: 'center', justifyContent: 'center' },
  printerIconActive: { backgroundColor: theme.colors.mintSoft },
  printerCopy: { flex: 1, minWidth: 0 },
  printerName: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  printerMeta: { color: theme.colors.muted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  smallButton: { minHeight: 38, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.white },
  smallButtonText: { color: theme.colors.slate, fontSize: 11, fontWeight: '900' },
  testButton: { minHeight: 38, borderRadius: 11, backgroundColor: theme.colors.green, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  testButtonText: { color: theme.colors.white, fontSize: 11, fontWeight: '900' },
  setupCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 10 },
  helper: { color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  outlineButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  outlineButtonText: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' },
  deviceList: { gap: 7 },
  deviceRow: { minHeight: 54, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  deviceRowSelected: { borderColor: '#75E0A7', backgroundColor: theme.colors.mintSoft },
  deviceName: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  deviceAddress: { color: theme.colors.muted, fontSize: 10, marginTop: 2 },
  fieldLabel: { color: theme.colors.slate, fontSize: 11, fontWeight: '900' },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 11, color: theme.colors.navy, fontSize: 12 },
  toggleRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleLabel: { color: theme.colors.navy, fontSize: 12, fontWeight: '800' },
  saveButton: { minHeight: 44, borderRadius: 12, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  saveButtonText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  linkText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  flexOne: { flex: 1 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  outline: { backgroundColor: '#1D2939', borderColor: '#475467' },
  input: { backgroundColor: '#1D2939', borderColor: '#475467', color: theme.colors.cloud },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});
