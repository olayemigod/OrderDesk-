import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, supabase } from './supabase';

type Register = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
};

type Printer = {
  id: string;
  registerId: string;
  registerName: string;
  displayName: string;
  transport: 'bluetooth';
  hardwareIdentifier: string;
  paperWidthMm: 58 | 80;
  isDefault: boolean;
  isActive: boolean;
  updatedAt: string;
};

type PrintJob = {
  jobId: string;
  jobType: 'receipt' | 'test';
  status: 'requested' | 'printing' | 'printed' | 'failed';
  printerName: string;
  registerName: string;
  orderReference: string | null;
  requestedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureMessage: string | null;
};

type Overview = {
  registers: Register[];
  printers: Printer[];
  recentJobs: PrintJob[];
};

type RegisterDraft = {
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
};

type PrinterDraft = {
  registerId: string;
  displayName: string;
  hardwareIdentifier: string;
  paperWidthMm: 58 | 80;
  isDefault: boolean;
  isActive: boolean;
};

type ReceiptCopyType = 'customer' | 'store' | 'audit' | 'accounts' | 'dispatch' | 'production' | 'custom';
type ReceiptCopyDefinition = {
  type: ReceiptCopyType;
  label: string;
  enabled: true;
  sortOrder: number;
};

type ReceiptSettings = {
  printerId: string;
  receiptCopyDefinitions: ReceiptCopyDefinition[];
  merchantReceiptFooter: string | null;
};

const EMPTY_REGISTER: RegisterDraft = { code: '', name: '', isDefault: false, isActive: true };
const EMPTY_PRINTER: PrinterDraft = {
  registerId: '',
  displayName: '',
  hardwareIdentifier: '',
  paperWidthMm: 58,
  isDefault: false,
  isActive: true,
};
const COPY_TYPE_LABELS: Record<ReceiptCopyType, string> = {
  customer: 'Customer Copy',
  store: 'Store Copy',
  audit: 'Audit Copy',
  accounts: 'Accounts Copy',
  dispatch: 'Dispatch Copy',
  production: 'Production Copy',
  custom: 'Custom Copy',
};
const COPY_TYPES = Object.keys(COPY_TYPE_LABELS) as ReceiptCopyType[];

export default function DevicesPrintersManagement({
  tenantId,
  branchId,
  branchName,
}: {
  tenantId: string;
  branchId: string;
  branchName: string;
}) {
  const [overview, setOverview] = useState<Overview>({ registers: [], printers: [], recentJobs: [] });
  const [selectedRegisterId, setSelectedRegisterId] = useState<string | null>(null);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string | null>(null);
  const [registerDraft, setRegisterDraft] = useState<RegisterDraft>(EMPTY_REGISTER);
  const [printerDraft, setPrinterDraft] = useState<PrinterDraft>(EMPTY_PRINTER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedRegister = useMemo(
    () => overview.registers.find((row) => row.id === selectedRegisterId) ?? null,
    [overview.registers, selectedRegisterId],
  );
  const selectedPrinter = useMemo(
    () => overview.printers.find((row) => row.id === selectedPrinterId) ?? null,
    [overview.printers, selectedPrinterId],
  );
  const activeRegisters = useMemo(() => overview.registers.filter((row) => row.isActive), [overview.registers]);

  useEffect(() => {
    setSelectedRegisterId(null);
    setSelectedPrinterId(null);
    setRegisterDraft(EMPTY_REGISTER);
    setPrinterDraft(EMPTY_PRINTER);
    void loadOverview();
  }, [tenantId, branchId]);

  useEffect(() => {
    if (!selectedRegister) return;
    setRegisterDraft({
      code: selectedRegister.code,
      name: selectedRegister.name,
      isDefault: selectedRegister.isDefault,
      isActive: selectedRegister.isActive,
    });
  }, [selectedRegister]);

  useEffect(() => {
    if (!selectedPrinter) return;
    setPrinterDraft({
      registerId: selectedPrinter.registerId,
      displayName: selectedPrinter.displayName,
      hardwareIdentifier: selectedPrinter.hardwareIdentifier,
      paperWidthMm: selectedPrinter.paperWidthMm,
      isDefault: selectedPrinter.isDefault,
      isActive: selectedPrinter.isActive,
    });
  }, [selectedPrinter]);

  async function loadOverview(preferredRegisterId?: string | null, preferredPrinterId?: string | null) {
    if (!tenantId || !branchId) {
      setOverview({ registers: [], printers: [], recentJobs: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_device_management_overview', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
      });
      if (rpcError) throw rpcError;
      const next = parseOverview(data);
      setOverview(next);

      const wantedRegister = preferredRegisterId ?? selectedRegisterId;
      const nextRegisterId = wantedRegister && next.registers.some((row) => row.id === wantedRegister)
        ? wantedRegister
        : next.registers.find((row) => row.isDefault)?.id ?? next.registers[0]?.id ?? null;
      setSelectedRegisterId(nextRegisterId);
      if (!nextRegisterId) setRegisterDraft(EMPTY_REGISTER);

      const wantedPrinter = preferredPrinterId ?? selectedPrinterId;
      const nextPrinterId = wantedPrinter && next.printers.some((row) => row.id === wantedPrinter)
        ? wantedPrinter
        : next.printers.find((row) => row.isDefault)?.id ?? next.printers[0]?.id ?? null;
      setSelectedPrinterId(nextPrinterId);
      if (!nextPrinterId) {
        setPrinterDraft({ ...EMPTY_PRINTER, registerId: nextRegisterId ?? '' });
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load devices and printers.'));
    } finally {
      setLoading(false);
    }
  }

  function newRegister() {
    setSelectedRegisterId(null);
    setRegisterDraft({ ...EMPTY_REGISTER, isDefault: overview.registers.length === 0 });
    setMessage(null);
    setError(null);
  }

  function newPrinter() {
    const registerId = selectedRegisterId && activeRegisters.some((row) => row.id === selectedRegisterId)
      ? selectedRegisterId
      : activeRegisters.find((row) => row.isDefault)?.id ?? activeRegisters[0]?.id ?? '';
    setSelectedPrinterId(null);
    setPrinterDraft({ ...EMPTY_PRINTER, registerId });
    setMessage(null);
    setError(null);
  }

  async function saveRegister(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('save_sellertray_register', {
        p_tenant_id: tenantId,
        p_register_id: selectedRegisterId,
        p_branch_id: branchId,
        p_code: registerDraft.code,
        p_name: registerDraft.name,
        p_is_default: registerDraft.isDefault,
        p_is_active: registerDraft.isActive,
      });
      if (rpcError) throw rpcError;
      const saved = object(data);
      const savedId = typeof saved.registerId === 'string' ? saved.registerId : selectedRegisterId;
      setMessage('Register saved.');
      await loadOverview(savedId, selectedPrinterId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this register.'));
    } finally {
      setSaving(false);
    }
  }

  async function savePrinter(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('printer', {
        body: {
          action: 'save_printer',
          tenantId,
          printerId: selectedPrinterId,
          branchId,
          registerId: printerDraft.registerId,
          displayName: printerDraft.displayName,
          hardwareIdentifier: printerDraft.hardwareIdentifier,
          paperWidthMm: printerDraft.paperWidthMm,
          isDefault: printerDraft.isDefault,
          isActive: printerDraft.isActive,
        },
      });
      if (functionError) throw functionError;
      const saved = object(data);
      const savedId = typeof saved.printerId === 'string' ? saved.printerId : selectedPrinterId;
      setMessage('Printer saved. Bluetooth pairing and test printing remain on SellerTray mobile.');
      await loadOverview(printerDraft.registerId, savedId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this printer.'));
    } finally {
      setSaving(false);
    }
  }

  if (!branchId) {
    return <article className="panel"><div className="empty-state"><strong>Select a Branch</strong><p>Choose a Branch before managing registers and printers.</p></div></article>;
  }

  return <div className="page-stack devices-page">
    <div className="section-heading">
      <div><p className="eyebrow">{branchName || 'Selected Branch'}</p><h2>Devices & Printers</h2></div>
      <p className="muted">Manage registers, receipt-printer assignments and receipt-copy profiles. Bluetooth discovery, pairing and printing stay on SellerTray mobile.</p>
    </div>

    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <div className="device-summary-grid">
      <Summary label="Registers" value={overview.registers.length} detail={`${activeRegisters.length} active`} />
      <Summary label="Printers" value={overview.printers.length} detail={`${overview.printers.filter((row) => row.isActive).length} active`} />
      <Summary label="Failed prints" value={overview.recentJobs.filter((row) => row.status === 'failed').length} detail="Latest 50 attempts" />
    </div>

    <div className="device-two-column">
      <article className="panel device-list-panel">
        <div className="panel-head"><div><p className="eyebrow">Registers</p><h3>Sales registers</h3></div><button className="secondary-button" onClick={newRegister}>New register</button></div>
        {loading ? <p className="muted">Loading registers…</p> : overview.registers.length ? <div className="device-list">
          {overview.registers.map((row) => <button key={row.id} className={selectedRegisterId === row.id ? 'device-row selected' : 'device-row'} onClick={() => setSelectedRegisterId(row.id)}>
            <span><strong>{row.name}</strong><small>{row.code}</small></span>
            <span className="device-row-badges">{row.isDefault ? <em>Default</em> : null}<em className={row.isActive ? 'good' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</em></span>
          </button>)}
        </div> : <div className="empty-state"><strong>No registers</strong><p>Create the first register for this Branch.</p></div>}
      </article>

      <form className="panel device-form" onSubmit={saveRegister}>
        <div className="panel-head"><div><p className="eyebrow">Register details</p><h3>{selectedRegister ? selectedRegister.name : 'New register'}</h3></div></div>
        <label>Register code<input required maxLength={40} value={registerDraft.code} onChange={(event) => setRegisterDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="MAIN" /></label>
        <label>Register name<input required maxLength={120} value={registerDraft.name} onChange={(event) => setRegisterDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Main Register" /></label>
        <div className="device-checks">
          <label><input type="checkbox" checked={registerDraft.isDefault} onChange={(event) => setRegisterDraft((current) => ({ ...current, isDefault: event.target.checked, isActive: event.target.checked ? true : current.isActive }))} /> Default register</label>
          <label><input type="checkbox" checked={registerDraft.isActive} disabled={registerDraft.isDefault} onChange={(event) => setRegisterDraft((current) => ({ ...current, isActive: event.target.checked }))} /> Active</label>
        </div>
        <p className="muted device-help">Setting another register as default moves the default safely. A default register cannot be deactivated directly.</p>
        <button className="primary-button" disabled={saving}>{saving ? 'Saving' : 'Save register'}</button>
      </form>
    </div>

    <div className="device-two-column">
      <article className="panel device-list-panel">
        <div className="panel-head"><div><p className="eyebrow">Receipt printers</p><h3>Bluetooth printers</h3></div><button className="secondary-button" disabled={!activeRegisters.length} onClick={newPrinter}>New printer</button></div>
        {overview.printers.length ? <div className="device-list">
          {overview.printers.map((row) => <button key={row.id} className={selectedPrinterId === row.id ? 'device-row selected' : 'device-row'} onClick={() => setSelectedPrinterId(row.id)}>
            <span><strong>{row.displayName}</strong><small>{row.registerName} · {row.paperWidthMm} mm</small></span>
            <span className="device-row-badges">{row.isDefault ? <em>Default</em> : null}<em className={row.isActive ? 'good' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</em></span>
          </button>)}
        </div> : <div className="empty-state"><strong>No printers</strong><p>Pair a Bluetooth receipt printer on SellerTray mobile, then register or manage it here.</p></div>}
      </article>

      <form className="panel device-form" onSubmit={savePrinter}>
        <div className="panel-head"><div><p className="eyebrow">Printer details</p><h3>{selectedPrinter ? selectedPrinter.displayName : 'New printer'}</h3></div></div>
        <label>Register<select required value={printerDraft.registerId} disabled={Boolean(selectedPrinter)} onChange={(event) => setPrinterDraft((current) => ({ ...current, registerId: event.target.value }))}><option value="">Select register</option>{activeRegisters.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Printer name<input required maxLength={120} value={printerDraft.displayName} onChange={(event) => setPrinterDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="Counter printer" /></label>
        <label>Bluetooth address or device ID<input required maxLength={160} value={printerDraft.hardwareIdentifier} onChange={(event) => setPrinterDraft((current) => ({ ...current, hardwareIdentifier: event.target.value }))} placeholder="Printer identity from SellerTray mobile" /></label>
        <label>Paper width<select value={printerDraft.paperWidthMm} onChange={(event) => setPrinterDraft((current) => ({ ...current, paperWidthMm: event.target.value === '80' ? 80 : 58 }))}><option value="58">58 mm</option><option value="80">80 mm</option></select></label>
        <div className="device-checks">
          <label><input type="checkbox" checked={printerDraft.isDefault} onChange={(event) => setPrinterDraft((current) => ({ ...current, isDefault: event.target.checked, isActive: event.target.checked ? true : current.isActive }))} /> Default for register</label>
          <label><input type="checkbox" checked={printerDraft.isActive} disabled={printerDraft.isDefault} onChange={(event) => setPrinterDraft((current) => ({ ...current, isActive: event.target.checked }))} /> Active</label>
        </div>
        <p className="muted device-help">A registered printer stays with its original Branch and register. Bluetooth pairing and test printing remain on SellerTray mobile.</p>
        <button className="primary-button" disabled={saving || !printerDraft.registerId}>{saving ? 'Saving' : 'Save printer'}</button>
      </form>
    </div>

    {selectedPrinter ? <ReceiptCopySettings tenantId={tenantId} printer={selectedPrinter} /> : <article className="panel"><div className="empty-state"><strong>Receipt-copy profile</strong><p>Save or select a printer to configure the physical copies it prints.</p></div></article>}

    <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">Print activity</p><h3>Recent attempts</h3></div><span className="muted">Latest 50</span></div>
      {overview.recentJobs.length ? <div className="table-wrap"><table><thead><tr><th>Requested</th><th>Type</th><th>Printer</th><th>Register</th><th>Order</th><th>Status</th><th>Result</th></tr></thead><tbody>
        {overview.recentJobs.map((row) => <tr key={row.jobId}><td>{dateTime(row.requestedAt)}</td><td>{row.jobType === 'receipt' ? 'Receipt' : 'Test'}</td><td>{row.printerName}</td><td>{row.registerName}</td><td>{row.orderReference || '—'}</td><td><span className={`status-pill ${row.status === 'printed' ? 'good' : row.status === 'failed' ? 'bad' : 'neutral'}`}>{title(row.status)}</span></td><td>{row.failureMessage || (row.completedAt ? dateTime(row.completedAt) : row.failedAt ? dateTime(row.failedAt) : '—')}</td></tr>)}
      </tbody></table></div> : <div className="empty-state"><strong>No print attempts</strong><p>Receipt and test-print history from SellerTray mobile will appear here.</p></div>}
    </article>
  </div>;
}

function ReceiptCopySettings({ tenantId, printer }: { tenantId: string; printer: Printer }) {
  const [copies, setCopies] = useState<ReceiptCopyDefinition[]>(defaultCopies());
  const [footer, setFooter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings();
  }, [tenantId, printer.id]);

  async function loadSettings() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_sellertray_printer_receipt_settings', {
        p_tenant_id: tenantId,
        p_printer_id: printer.id,
      });
      if (rpcError) throw rpcError;
      const settings = parseReceiptSettings(data, printer.id);
      setCopies(settings.receiptCopyDefinitions.length ? settings.receiptCopyDefinitions : defaultCopies());
      setFooter(settings.merchantReceiptFooter ?? '');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load this printer receipt profile.'));
    } finally {
      setLoading(false);
    }
  }

  function updateCopy(index: number, patch: Partial<ReceiptCopyDefinition>) {
    setCopies((current) => current.map((copy, position) => position === index ? { ...copy, ...patch } : copy));
  }

  function moveCopy(index: number, direction: -1 | 1) {
    setCopies((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next.map((copy, position) => ({ ...copy, sortOrder: position + 1 }));
    });
  }

  function removeCopy(index: number) {
    if (copies.length <= 1) return;
    setCopies((current) => current.filter((_, position) => position !== index).map((copy, position) => ({ ...copy, sortOrder: position + 1 })));
  }

  function addCopy() {
    if (copies.length >= 8) return;
    setCopies((current) => [...current, { type: 'custom', label: `Custom Copy ${current.length + 1}`, enabled: true, sortOrder: current.length + 1 }]);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const normalized: ReceiptCopyDefinition[] = copies.map((copy, index) => ({
        type: copy.type,
        label: copy.label.trim(),
        enabled: true as const,
        sortOrder: index + 1,
      }));
      const { data, error: rpcError } = await supabase.rpc('save_sellertray_printer_receipt_settings', {
        p_tenant_id: tenantId,
        p_printer_id: printer.id,
        p_copy_definitions: normalized,
        p_merchant_footer: footer.trim() || null,
      });
      if (rpcError) throw rpcError;
      const settings = parseReceiptSettings(data, printer.id);
      setCopies(settings.receiptCopyDefinitions.length ? settings.receiptCopyDefinitions : normalized);
      setFooter(settings.merchantReceiptFooter ?? '');
      setMessage('Receipt-copy profile saved. Future print attempts will snapshot this profile and footer.');
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save this receipt-copy profile.'));
    } finally {
      setSaving(false);
    }
  }

  return <form className="panel device-form" onSubmit={saveSettings}>
    <div className="panel-head">
      <div><p className="eyebrow">Receipt-copy profile</p><h3>{printer.displayName}</h3></div>
      <button type="button" className="secondary-button" disabled={loading || saving || copies.length >= 8} onClick={addCopy}>Add copy</button>
    </div>
    <p className="muted">The order below is the physical printing order. Copies reuse the same governed sale and receipt snapshot; they do not create duplicate orders, payments or stock movements.</p>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}
    {loading ? <p className="muted">Loading receipt profile…</p> : <div className="device-list">
      {copies.map((copy, index) => <div className="device-row" key={`${copy.sortOrder}-${index}`}>
        <span><strong>{index + 1}. {copy.label || 'Receipt copy'}</strong><small>Printed in this position</small></span>
        <span className="device-row-badges">
          <button type="button" className="secondary-button" disabled={index === 0 || saving} onClick={() => moveCopy(index, -1)}>Up</button>
          <button type="button" className="secondary-button" disabled={index === copies.length - 1 || saving} onClick={() => moveCopy(index, 1)}>Down</button>
          <button type="button" className="secondary-button" disabled={copies.length <= 1 || saving} onClick={() => removeCopy(index)}>Remove</button>
        </span>
        <label>Copy type<select value={copy.type} disabled={saving} onChange={(event) => {
          const nextType = event.target.value as ReceiptCopyType;
          updateCopy(index, { type: nextType, label: COPY_TYPE_LABELS[nextType] });
        }}>{COPY_TYPES.map((type) => <option key={type} value={type}>{COPY_TYPE_LABELS[type]}</option>)}</select></label>
        <label>Merchant-facing label<input required maxLength={40} value={copy.label} disabled={saving} onChange={(event) => updateCopy(index, { label: event.target.value })} /></label>
      </div>)}
    </div>}
    <label>Receipt footer<textarea maxLength={240} rows={3} value={footer} disabled={loading || saving} onChange={(event) => setFooter(event.target.value)} placeholder="Optional message printed on receipts" /></label>
    <p className="muted device-help">Between 1 and 8 enabled copies are supported. Customer, Store, Audit, Accounts, Dispatch, Production and Custom copy types use this same governed profile. Reprints remain explicit audited print attempts.</p>
    <div className="form-actions"><button className="primary-button" disabled={loading || saving || copies.length < 1 || copies.some((copy) => !copy.label.trim())}>{saving ? 'Saving…' : 'Save receipt profile'}</button></div>
  </form>;
}

function Summary({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function defaultCopies(): ReceiptCopyDefinition[] {
  return [{ type: 'customer', label: 'Customer Copy', enabled: true, sortOrder: 1 }];
}

function parseReceiptSettings(value: unknown, printerId: string): ReceiptSettings {
  const root = object(value);
  const definitions = Array.isArray(root.receiptCopyDefinitions) ? root.receiptCopyDefinitions.map((item, index) => {
    const row = object(item);
    const rawType = String(row.type ?? 'custom').toLowerCase();
    const type: ReceiptCopyType = COPY_TYPES.includes(rawType as ReceiptCopyType) ? rawType as ReceiptCopyType : 'custom';
    return {
      type,
      label: String(row.label ?? COPY_TYPE_LABELS[type]),
      enabled: true as const,
      sortOrder: typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder) ? row.sortOrder : index + 1,
    };
  }).filter((copy) => copy.label.trim()).sort((a, b) => a.sortOrder - b.sortOrder) : [];
  return {
    printerId: typeof root.printerId === 'string' ? root.printerId : printerId,
    receiptCopyDefinitions: definitions,
    merchantReceiptFooter: typeof root.merchantReceiptFooter === 'string' ? root.merchantReceiptFooter : null,
  };
}

function parseOverview(value: unknown): Overview {
  const root = object(value);
  const registers = Array.isArray(root.registers) ? root.registers.map((item) => {
    const row = object(item);
    return {
      id: String(row.id ?? ''),
      code: String(row.code ?? ''),
      name: String(row.name ?? 'Register'),
      isDefault: row.isDefault === true,
      isActive: row.isActive === true,
    } satisfies Register;
  }).filter((row) => row.id) : [];
  const printers = Array.isArray(root.printers) ? root.printers.map((item) => {
    const row = object(item);
    return {
      id: String(row.id ?? ''),
      registerId: String(row.registerId ?? ''),
      registerName: String(row.registerName ?? 'Register'),
      displayName: String(row.displayName ?? 'Printer'),
      transport: 'bluetooth' as const,
      hardwareIdentifier: String(row.hardwareIdentifier ?? ''),
      paperWidthMm: row.paperWidthMm === 80 ? 80 as const : 58 as const,
      isDefault: row.isDefault === true,
      isActive: row.isActive === true,
      updatedAt: String(row.updatedAt ?? ''),
    } satisfies Printer;
  }).filter((row) => row.id) : [];
  const recentJobs = Array.isArray(root.recentJobs) ? root.recentJobs.map((item) => {
    const row = object(item);
    const status = row.status === 'printing' || row.status === 'printed' || row.status === 'failed' ? row.status : 'requested';
    return {
      jobId: String(row.jobId ?? ''),
      jobType: row.jobType === 'test' ? 'test' as const : 'receipt' as const,
      status,
      printerName: String(row.printerName ?? 'Printer'),
      registerName: String(row.registerName ?? 'Register'),
      orderReference: typeof row.orderReference === 'string' ? row.orderReference : null,
      requestedAt: String(row.requestedAt ?? ''),
      completedAt: typeof row.completedAt === 'string' ? row.completedAt : null,
      failedAt: typeof row.failedAt === 'string' ? row.failedAt : null,
      failureMessage: typeof row.failureMessage === 'string' ? row.failureMessage : null,
    } satisfies PrintJob;
  }).filter((row) => row.jobId) : [];
  return { registers, printers, recentJobs };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function title(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
