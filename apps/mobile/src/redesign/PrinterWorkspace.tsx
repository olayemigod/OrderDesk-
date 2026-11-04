import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { loadCashRegisters, type CashRegister, type CashShift } from '../data/cashShiftRepository';
import type { CommerceBranch } from '../data/commerceRepository';
import {
  loadPrinterReceiptSettings,
  loadPrinters,
  loadPrintingCapabilities,
  requestPrintJob,
  savePrinter,
  savePrinterReceiptSettings,
  type PrintingCapabilities,
  type ReceiptCopyDefinition,
  type ReceiptCopyType,
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
const COPY_TYPES: { type: ReceiptCopyType; label: string }[] = [
  { type: 'customer', label: 'Customer Copy' },
  { type: 'store', label: 'Store Copy' },
  { type: 'audit', label: 'Audit Copy' },
  { type: 'accounts', label: 'Accounts Copy' },
  { type: 'dispatch', label: 'Dispatch Copy' },
  { type: 'production', label: 'Production Copy' },
  { type: 'custom', label: 'Custom' },
];
const DEFAULT_COPY: ReceiptCopyDefinition = { type: 'customer', label: 'Customer Copy', sortOrder: 1 };

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
  const [copies, setCopies] = useState<ReceiptCopyDefinition[]>([DEFAULT_COPY]);
  const [merchantFooter, setMerchantFooter] = useState('');

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
        setRegisterId((current) => nextRegisters.some((register) => register.id === current)
          ? current
          : activeShift && nextRegisters.some((register) => register.id === activeShift.registerId)
            ? activeShift.registerId
            : nextRegisters.find((register) => register.isDefault)?.id ?? nextRegisters[0]?.id ?? '');
      })
      .catch((cause) => mounted && setError(cause instanceof Error ? cause.message : 'Unable to load printer settings.'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [tenantId, branch.id, activeShift?.registerId]);

  useEffect(() => {
    if (!registerId) {
      setPrinters([]);
      return undefined;
    }
    let mounted = true;
    void loadPrinters(tenantId, branch.id, registerId)
      .then((rows) => mounted && setPrinters(rows))
      .catch((cause) => mounted && setError(cause instanceof Error ? cause.message : 'Unable to load printers.'));
    return () => { mounted = false; };
  }, [tenantId, branch.id, registerId]);

  async function refreshPrinters() {
    if (registerId) setPrinters(await loadPrinters(tenantId, branch.id, registerId));
  }

  async function loadPaired() {
    setDiscovering(true);
    setError(null);
    setNotice(null);
    try {
      const devices = await listPairedBluetoothPrinters();
      setPairedDevices(devices);
      if (!devices.length) setNotice('No paired Bluetooth devices were found. Pair the printer in Android Bluetooth settings first.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read paired Bluetooth devices.');
    } finally {
      setDiscovering(false);
    }
  }

  function selectDevice(device: BluetoothPrinterDevice) {
    setDeviceAddress(device.address);
    if (!displayName.trim()) setDisplayName(device.name);
    setNotice(null);
  }

  async function editPrinter(printer: SellerTrayPrinter) {
    setEditingId(printer.id);
    setDeviceAddress(printer.hardwareIdentifier);
    setDisplayName(printer.displayName);
    setPaperWidthMm(printer.paperWidthMm);
    setIsDefault(printer.isDefault);
    setIsActive(printer.isActive);
    setError(null);
    setNotice(null);
    try {
      const settings = await loadPrinterReceiptSettings(tenantId, printer.id);
      setCopies(settings.copyDefinitions);
      setMerchantFooter(settings.merchantFooter ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load receipt settings.');
    }
  }

  function resetForm() {
    setEditingId(null);
    setDeviceAddress('');
    setDisplayName('');
    setPaperWidthMm(58);
    setIsDefault(printers.length === 0);
    setIsActive(true);
    setCopies([DEFAULT_COPY]);
    setMerchantFooter('');
  }

  function addCopy() {
    if (copies.length >= 8) return;
    setCopies((current) => [
      ...current,
      { type: 'store', label: 'Store Copy', sortOrder: current.length + 1 },
    ]);
  }

  function removeCopy(index: number) {
    if (copies.length === 1) return;
    setCopies((current) => current
      .filter((_, copyIndex) => copyIndex !== index)
      .map((copy, copyIndex) => ({ ...copy, sortOrder: copyIndex + 1 })));
  }

  function changeCopyType(index: number, type: ReceiptCopyType) {
    const standard = COPY_TYPES.find((option) => option.type === type)?.label ?? 'Custom';
    setCopies((current) => current.map((copy, copyIndex) => copyIndex === index
      ? { ...copy, type, label: type === 'custom' ? (copy.type === 'custom' ? copy.label : '') : standard }
      : copy));
  }

  function changeCopyLabel(index: number, label: string) {
    setCopies((current) => current.map((copy, copyIndex) => copyIndex === index ? { ...copy, label } : copy));
  }

  async function persistPrinter() {
    if (!registerId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const printer = await savePrinter({
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
      await savePrinterReceiptSettings({
        tenantId,
        printerId: printer.id,
        copyDefinitions: copies,
        merchantFooter,
      });
      await refreshPrinters();
      resetForm();
      setNotice('Printer and receipt settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save this printer.');
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Test print failed.');
    } finally {
      setPrintingId(null);
    }
  }

  return (
    <View style={styles.stack}>
      <Pressable onPress={onClose} style={styles.backRow}>
        <Ionicons name="chevron-back" size={20} color={dark ? theme.dark.text : theme.colors.navy} />
        <Text style={[styles.backText, dark && darkStyles.titleText]}>More</Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>DEVICES & PRINTERS</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>Receipt printers</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>Connect a Bluetooth thermal printer, choose receipt copies and test printing for this branch.</Text>
      </View>

      {!bluetoothPrintingSupported() ? (
        <View style={[styles.infoCard, dark && darkStyles.card]}>
          <Ionicons name="information-circle-outline" size={21} color={dark ? theme.dark.accentText : theme.colors.greenDark} />
          <Text style={[styles.infoText, dark && darkStyles.bodyText]}>Bluetooth printing requires the installed SellerTray Android build.</Text>
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

      {registers.length ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, dark && darkStyles.bodyText]}>REGISTER</Text>
          <View style={styles.chipRow}>
            {registers.map((register) => {
              const active = register.id === registerId;
              return (
                <Pressable
                  key={register.id}
                  onPress={() => setRegisterId(register.id)}
                  style={[styles.chip, dark && darkStyles.chip, active && styles.chipActive, dark && active && darkStyles.chipActive]}
                >
                  <Text style={[styles.chipText, dark && darkStyles.chipText, active && styles.chipTextActive, dark && active && darkStyles.chipTextActive]}>{register.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {selectedRegister ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{selectedRegister.name}</Text>
          {!printers.length ? (
            <View style={[styles.emptyCard, dark && darkStyles.card]}>
              <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No printer configured</Text>
            </View>
          ) : printers.map((printer) => (
            <View key={printer.id} style={[styles.printerCard, dark && darkStyles.card]}>
              <View style={styles.printerMain}>
                <Ionicons name="print-outline" size={22} color={dark ? theme.dark.accentText : theme.colors.greenDark} />
                <View style={styles.flexOne}>
                  <Text style={[styles.printerName, dark && darkStyles.titleText]}>{printer.displayName}</Text>
                  <Text style={[styles.printerMeta, dark && darkStyles.bodyText]}>{printer.paperWidthMm} mm · {printer.isDefault ? 'Default' : 'Additional'} · {printer.isActive ? 'Active' : 'Inactive'}</Text>
                </View>
              </View>
              <View style={styles.actionRow}>
                {capabilities.canManageDevices ? (
                  <Pressable onPress={() => void editPrinter(printer)} style={[styles.smallButton, dark && darkStyles.outlineButton]}>
                    <Text style={[styles.smallButtonText, dark && darkStyles.titleText]}>Edit</Text>
                  </Pressable>
                ) : null}
                {capabilities.canPrintReceipt && printer.isActive ? (
                  <Pressable disabled={printingId !== null} onPress={() => void testPrinter(printer)} style={[styles.testButton, printingId !== null && styles.disabled]}>
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
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{editingId ? 'Update printer' : 'Add printer'}</Text>
            {editingId ? <Pressable onPress={resetForm}><Text style={[styles.linkText, dark && darkStyles.accentText]}>Cancel</Text></Pressable> : null}
          </View>

          <Pressable disabled={discovering} onPress={() => void loadPaired()} style={[styles.outlineButton, dark && darkStyles.outlineButton]}>
            <Text style={[styles.outlineButtonText, dark && darkStyles.titleText]}>{discovering ? 'Loading…' : 'Show paired devices'}</Text>
          </Pressable>

          {pairedDevices.map((device) => (
            <Pressable key={device.address} onPress={() => selectDevice(device)} style={[styles.deviceRow, dark && darkStyles.deviceRow]}>
              <Text style={[styles.flexOne, dark && darkStyles.bodyText]}>{device.name} · {device.address}</Text>
            </Pressable>
          ))}

          <Field label="Printer name" value={displayName} onChange={setDisplayName} dark={dark} />
          <Field label="Bluetooth address" value={deviceAddress} onChange={(value) => setDeviceAddress(value.toUpperCase())} dark={dark} />

          <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Paper width</Text>
          <View style={styles.chipRow}>
            {([58, 80] as const).map((width) => {
              const active = width === paperWidthMm;
              return (
                <Pressable key={width} onPress={() => setPaperWidthMm(width)} style={[styles.chip, dark && darkStyles.chip, active && styles.chipActive, dark && active && darkStyles.chipActive]}>
                  <Text style={[styles.chipText, dark && darkStyles.chipText, active && styles.chipTextActive, dark && active && darkStyles.chipTextActive]}>{width} mm</Text>
                </Pressable>
              );
            })}
          </View>

          <ToggleRow label="Default printer" value={isDefault} onChange={setIsDefault} dark={dark} />
          <ToggleRow label="Active" value={isActive} onChange={setIsActive} dark={dark} />

          <View style={styles.copyHeader}>
            <View style={styles.flexOne}>
              <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Receipt copies</Text>
              <Text style={[styles.helper, dark && darkStyles.bodyText]}>Each configured copy prints separately and carries its own heading.</Text>
            </View>
            <Pressable disabled={copies.length >= 8} onPress={addCopy}>
              <Text style={[styles.linkText, dark && darkStyles.accentText]}>+ Add copy</Text>
            </Pressable>
          </View>

          {copies.map((copy, index) => (
            <View key={`${index}-${copy.type}`} style={[styles.copyCard, dark && darkStyles.copyCard]}>
              <View style={styles.chipRow}>
                {COPY_TYPES.map((option) => {
                  const active = copy.type === option.type;
                  return (
                    <Pressable
                      key={option.type}
                      onPress={() => changeCopyType(index, option.type)}
                      style={[styles.copyChip, dark && darkStyles.chip, active && styles.chipActive, dark && active && darkStyles.chipActive]}
                    >
                      <Text style={[styles.copyChipText, dark && darkStyles.chipText, active && styles.chipTextActive, dark && active && darkStyles.chipTextActive]}>{option.type === 'custom' ? 'Custom' : option.label.replace(' Copy', '')}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {copy.type === 'custom' ? (
                <Field label="Custom copy name" value={copy.label} onChange={(value) => changeCopyLabel(index, value)} dark={dark} />
              ) : (
                <Text style={[styles.helper, dark && darkStyles.bodyText]}>{copy.label}</Text>
              )}
              <Pressable disabled={copies.length === 1} onPress={() => removeCopy(index)}>
                <Text style={[styles.removeText, dark && darkStyles.removeText, copies.length === 1 && styles.disabled]}>Remove copy</Text>
              </Pressable>
            </View>
          ))}

          <Field label="Receipt footer (optional)" value={merchantFooter} onChange={setMerchantFooter} dark={dark} placeholder="Thank you for shopping with us" />

          <Pressable
            disabled={saving || !displayName.trim() || !deviceAddress.trim()}
            onPress={() => void persistPrinter()}
            style={[styles.saveButton, (saving || !displayName.trim() || !deviceAddress.trim()) && styles.disabled]}
          >
            <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save printer'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Field({ label, value, onChange, dark, placeholder }: { label: string; value: string; onChange: (value: string) => void; dark: boolean; placeholder?: string }) {
  return (
    <>
      <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.subtle}
        style={[styles.input, dark && darkStyles.input]}
      />
    </>
  );
}

function ToggleRow({ label, value, onChange, dark }: { label: string; value: boolean; onChange: (value: boolean) => void; dark: boolean }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.toggleLabel, dark && darkStyles.titleText]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: dark ? theme.dark.borderStrong : '#D0D5DD', true: theme.colors.green }}
        thumbColor={theme.colors.white}
      />
    </View>
  );
}

function MessageCard({ tone, text, dark }: { tone: 'error' | 'success'; text: string; dark: boolean }) {
  return (
    <View style={[styles.messageCard, tone === 'error' ? styles.errorCard : styles.successCard, dark && darkStyles.card]}>
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
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '900' },
  sectionTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.white },
  chipActive: { borderColor: '#75E0A7', backgroundColor: theme.colors.mintSoft },
  chipText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  chipTextActive: { color: theme.colors.greenDark },
  infoCard: { borderRadius: 12, borderWidth: 1, borderColor: '#ABEFC6', padding: 11, flexDirection: 'row', gap: 8 },
  infoText: { flex: 1, color: theme.colors.slate, fontSize: 11 },
  messageCard: { borderRadius: 12, borderWidth: 1, padding: 10 },
  errorCard: { borderColor: '#FDA29B' },
  successCard: { borderColor: '#ABEFC6' },
  messageText: { color: theme.colors.slate, fontSize: 11 },
  emptyCard: { minHeight: 80, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14, alignItems: 'center', justifyContent: 'center', gap: 6 },
  emptyTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 11 },
  printerCard: { borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 12, gap: 10 },
  printerMain: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  printerName: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  printerMeta: { color: theme.colors.muted, fontSize: 10 },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  smallButton: { minHeight: 38, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, justifyContent: 'center' },
  smallButtonText: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' },
  testButton: { minHeight: 38, borderRadius: 11, backgroundColor: theme.colors.green, paddingHorizontal: 12, justifyContent: 'center' },
  testButtonText: { color: theme.colors.white, fontSize: 11, fontWeight: '900' },
  setupCard: { borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, padding: 13, gap: 10 },
  outlineButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, justifyContent: 'center', alignItems: 'center' },
  outlineButtonText: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' },
  deviceRow: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 10, flexDirection: 'row' },
  fieldLabel: { color: theme.colors.slate, fontSize: 11, fontWeight: '900' },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 11, color: theme.colors.navy, fontSize: 12 },
  toggleRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { color: theme.colors.navy, fontSize: 12, fontWeight: '800' },
  copyHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 5 },
  copyCard: { borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 10, gap: 8 },
  copyChip: { minHeight: 30, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 9, justifyContent: 'center' },
  copyChipText: { color: theme.colors.navy, fontSize: 10, fontWeight: '800' },
  helper: { color: theme.colors.slate, fontSize: 11, lineHeight: 16 },
  removeText: { color: theme.colors.danger, fontSize: 11, fontWeight: '800' },
  saveButton: { minHeight: 44, borderRadius: 12, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center' },
  saveButtonText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  linkText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  flexOne: { flex: 1 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  input: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.borderStrong, color: theme.dark.text },
  outlineButton: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.borderStrong },
  deviceRow: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.borderStrong },
  copyCard: { backgroundColor: theme.dark.surfaceRaised, borderColor: theme.dark.border },
  chip: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.borderStrong },
  chipActive: { backgroundColor: theme.dark.accentSoft, borderColor: theme.colors.green },
  chipText: { color: theme.dark.textMuted },
  chipTextActive: { color: theme.dark.accentText },
  titleText: { color: theme.dark.text },
  bodyText: { color: theme.dark.textMuted },
  accentText: { color: theme.dark.accentText },
  removeText: { color: theme.dark.dangerText },
});
