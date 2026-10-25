import { supabase } from '../lib/supabase';

export type ReceiptCopyType = 'customer' | 'store' | 'audit' | 'accounts' | 'dispatch' | 'production' | 'custom';
export type ReceiptCopyDefinition = { type: ReceiptCopyType; label: string; sortOrder: number };
export type PrinterReceiptSettings = { printerId: string; copyDefinitions: ReceiptCopyDefinition[]; merchantFooter: string | null };

export type SellerTrayPrinter = {
  id: string;
  registerId: string;
  registerName: string;
  displayName: string;
  transport: 'bluetooth';
  hardwareIdentifier: string;
  paperWidthMm: 58 | 80;
  isDefault: boolean;
  isActive: boolean;
};
export type PrintingCapabilities = { canPrintReceipt: boolean; canManageDevices: boolean };
export type ReceiptPrintReference = { documentId: string; documentReference: string; amount: number; currency: string; issuedAt: string };
export type ReceiptPrintItem = { name: string; quantity: number; uom: string; unitPrice: number; lineTotal: number };
export type ReceiptPrintSnapshot = {
  formatVersion: number;
  documentType: 'receipt';
  businessName: string;
  businessEmail: string | null;
  businessPhone: string | null;
  branchName: string;
  registerName: string;
  cashierName: string | null;
  orderReference: string;
  receiptReference: string;
  issuedAt: string;
  customerName: string;
  customerPhone: string | null;
  currency: string;
  amountPaid: number;
  subtotalAmount?: number;
  taxApplied?: boolean;
  taxRatePercent?: number;
  taxAmount?: number;
  taxDisplayBreakdown?: boolean;
  grossAmount?: number;
  paymentMethod: string;
  paymentProvider: string;
  paymentReference: string | null;
  paymentConfirmedAt: string | null;
  items: ReceiptPrintItem[];
  footer?: string;
  copyDefinitions?: ReceiptCopyDefinition[];
  copyLabel?: string;
  merchantFooter?: string | null;
  platformAttribution?: string;
};
export type SalesInvoicePrintSnapshot = {
  formatVersion: number;
  documentType: 'sales_invoice';
  businessName: string;
  businessEmail: string | null;
  businessPhone: string | null;
  branchName: string;
  cashierName: string | null;
  orderReference: string;
  invoiceReference: string;
  issuedAt: string;
  customerName: string;
  customerPhone: string | null;
  currency: string;
  subtotalAmount: number;
  taxApplied: boolean;
  taxRatePercent: number;
  taxAmount: number;
  taxDisplayBreakdown: boolean;
  grossAmount: number;
  paymentLabel: string;
  fulfillmentLabel: string;
  items: ReceiptPrintItem[];
  platformAttribution?: string;
};
export type PaymentReceiptPrintSnapshot = {
  formatVersion: number;
  documentType: 'payment_receipt';
  businessName: string;
  businessEmail: string | null;
  businessPhone: string | null;
  branchName: string;
  cashierName: string | null;
  orderReference: string;
  paymentId: string;
  paymentReference: string | null;
  issuedAt: string;
  customerName: string;
  customerPhone: string | null;
  currency: string;
  amountReceived: number;
  paymentMethod: string;
  paymentProvider: string;
  paymentLabel: string;
  fulfillmentLabel: string;
  copyDefinitions?: ReceiptCopyDefinition[];
  copyLabel?: string;
  merchantFooter?: string | null;
  platformAttribution?: string;
};
export type TestPrintSnapshot = {
  formatVersion: number;
  documentType: 'test';
  title: string;
  businessName: string;
  branchName: string;
  registerName: string;
  printerName: string;
  paperWidthMm: 58 | 80;
  requestedAt: string;
  footer: string;
};
export type PrintContentSnapshot = ReceiptPrintSnapshot | SalesInvoicePrintSnapshot | PaymentReceiptPrintSnapshot | TestPrintSnapshot;
export type PrintJobStatus = 'requested' | 'printing' | 'printed' | 'failed';
export type PrintJobType = 'receipt' | 'test';
export type BusinessDocumentPrintType = 'sales_invoice' | 'payment_receipt';
type PrintRequestKind = PrintJobType | BusinessDocumentPrintType;
export type PrintJob = {
  jobId: string;
  status: PrintJobStatus;
  jobType: PrintJobType;
  orderId: string | null;
  financialDocumentId: string | null;
  printerId: string;
  printerName: string;
  transport: 'bluetooth';
  hardwareIdentifier: string;
  paperWidthMm: 58 | 80;
  contentSnapshot: PrintContentSnapshot;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  idempotentReplay?: boolean;
};

type PrinterRpcRow = { id: string; register_id: string; register_name: string; display_name: string; transport: 'bluetooth'; hardware_identifier: string; paper_width_mm: number; is_default: boolean; is_active: boolean };
type CapabilityRpcRow = { can_print_receipt: boolean; can_manage_devices: boolean };
type ReceiptRpcRow = { document_id: string; document_reference: string; amount: number | string; currency: string; issued_at: string };

export async function loadPrintingCapabilities(tenantId: string, branchId: string): Promise<PrintingCapabilities> {
  if (!tenantId || !branchId) return { canPrintReceipt: false, canManageDevices: false };
  const { data, error } = await supabase.rpc('get_sellertray_printing_capabilities', { p_tenant_id: tenantId, p_branch_id: branchId });
  if (error) throw error;
  const row = ((data ?? []) as CapabilityRpcRow[])[0];
  return { canPrintReceipt: row?.can_print_receipt === true, canManageDevices: row?.can_manage_devices === true };
}

export async function loadPrinters(tenantId: string, branchId: string, registerId?: string | null): Promise<SellerTrayPrinter[]> {
  if (!tenantId || !branchId) return [];
  const { data, error } = await supabase.rpc('get_sellertray_printers', { p_tenant_id: tenantId, p_branch_id: branchId, p_register_id: registerId ?? null });
  if (error) throw error;
  return ((data ?? []) as PrinterRpcRow[]).map((row) => ({
    id: row.id,
    registerId: row.register_id,
    registerName: row.register_name,
    displayName: row.display_name,
    transport: row.transport,
    hardwareIdentifier: row.hardware_identifier,
    paperWidthMm: row.paper_width_mm === 80 ? 80 : 58,
    isDefault: row.is_default === true,
    isActive: row.is_active === true,
  }));
}

export async function loadReceiptPrintReference(tenantId: string, orderId: string): Promise<ReceiptPrintReference | null> {
  if (!tenantId || !orderId) return null;
  const { data, error } = await supabase.rpc('get_sellertray_receipt_for_order', { p_tenant_id: tenantId, p_order_id: orderId });
  if (error) throw error;
  const row = ((data ?? []) as ReceiptRpcRow[])[0];
  return row ? { documentId: row.document_id, documentReference: row.document_reference, amount: toNumber(row.amount), currency: row.currency, issuedAt: row.issued_at } : null;
}

export async function savePrinter(input: { tenantId: string; printerId?: string | null; branchId: string; registerId: string; displayName: string; hardwareIdentifier: string; paperWidthMm: 58 | 80; isDefault: boolean; isActive: boolean }): Promise<SellerTrayPrinter> {
  if (!input.tenantId || !input.branchId || !input.registerId) throw new Error('Business, branch and register are required.');
  if (!input.displayName.trim()) throw new Error('Printer name is required.');
  if (!input.hardwareIdentifier.trim()) throw new Error('Bluetooth printer identity is required.');
  const data = await invokePrinter({
    action: 'save_printer',
    tenantId: input.tenantId,
    printerId: input.printerId ?? null,
    branchId: input.branchId,
    registerId: input.registerId,
    displayName: input.displayName.trim(),
    hardwareIdentifier: input.hardwareIdentifier.trim(),
    paperWidthMm: input.paperWidthMm,
    isDefault: input.isDefault,
    isActive: input.isActive,
  }, 'Unable to save this printer.');
  if (!isPrinterState(data)) throw new Error('SellerTray returned an invalid printer result.');
  return {
    id: data.printerId,
    registerId: data.registerId,
    registerName: '',
    displayName: data.displayName,
    transport: data.transport,
    hardwareIdentifier: data.hardwareIdentifier,
    paperWidthMm: data.paperWidthMm,
    isDefault: data.isDefault,
    isActive: data.isActive,
  };
}

export async function loadPrinterReceiptSettings(tenantId: string, printerId: string): Promise<PrinterReceiptSettings> {
  const { data, error } = await supabase.rpc('get_sellertray_printer_receipt_settings', { p_tenant_id: tenantId, p_printer_id: printerId });
  if (error) throw error;
  return parseReceiptSettings(data as Record<string, unknown>);
}

export async function savePrinterReceiptSettings(input: { tenantId: string; printerId: string; copyDefinitions: ReceiptCopyDefinition[]; merchantFooter?: string | null }): Promise<PrinterReceiptSettings> {
  if (input.copyDefinitions.length < 1 || input.copyDefinitions.length > 8) throw new Error('Choose between 1 and 8 receipt copies.');
  const labels = new Set<string>();
  const copies = input.copyDefinitions.map((copy, index) => {
    const label = copy.label.trim();
    if (!label || label.length > 40) throw new Error('Each receipt copy needs a label up to 40 characters.');
    const key = label.toLowerCase();
    if (labels.has(key)) throw new Error('Receipt copy labels must be unique.');
    labels.add(key);
    return { type: copy.type, label, enabled: true, sortOrder: index + 1 };
  });
  const { data, error } = await supabase.rpc('save_sellertray_printer_receipt_settings', {
    p_tenant_id: input.tenantId,
    p_printer_id: input.printerId,
    p_copy_definitions: copies,
    p_merchant_footer: input.merchantFooter?.trim() || null,
  });
  if (error) throw error;
  return parseReceiptSettings(data as Record<string, unknown>);
}

export async function requestPrintJob(input: { tenantId: string; printerId: string; jobType: PrintJobType; orderId?: string | null; requestKey?: string }): Promise<PrintJob> {
  if (!input.tenantId || !input.printerId) throw new Error('Business and printer are required.');
  if (input.jobType === 'receipt' && !input.orderId) throw new Error('Receipt order is required.');
  const data = await invokePrinter({
    action: 'request_print',
    tenantId: input.tenantId,
    printerId: input.printerId,
    jobType: input.jobType,
    orderId: input.jobType === 'receipt' ? input.orderId : null,
    requestKey: input.requestKey ?? createPrintRequestKey(input.jobType),
  }, 'Unable to prepare this print.');
  return parsePrintJob(data);
}

export async function requestBusinessDocumentPrint(input: {
  tenantId: string;
  printerId: string;
  orderId: string;
  documentType: BusinessDocumentPrintType;
  paymentId?: string | null;
  requestKey?: string;
}): Promise<PrintJob> {
  if (!input.tenantId || !input.printerId || !input.orderId) throw new Error('Business, printer and sale are required.');
  if (input.documentType === 'payment_receipt' && !input.paymentId) throw new Error('Confirmed payment is required for a Payment Receipt.');
  if (input.documentType === 'sales_invoice' && input.paymentId) throw new Error('A Sales Invoice must not be tied to a collection payment.');
  const data = await invokePrinter({
    action: 'request_business_document_print',
    tenantId: input.tenantId,
    printerId: input.printerId,
    orderId: input.orderId,
    documentType: input.documentType,
    paymentId: input.documentType === 'payment_receipt' ? input.paymentId : null,
    requestKey: input.requestKey ?? createPrintRequestKey(input.documentType),
  }, `Unable to prepare this ${input.documentType === 'sales_invoice' ? 'Sales Invoice' : 'Payment Receipt'}.`);
  return parsePrintJob(data);
}

export async function updatePrintJob(input: { tenantId: string; jobId: string; status: 'printing' | 'printed' | 'failed'; failureCode?: string | null; failureMessage?: string | null }): Promise<{ jobId: string; status: PrintJobStatus; idempotentReplay: boolean }> {
  if (!input.tenantId || !input.jobId) throw new Error('Business and print job are required.');
  if (input.status === 'failed' && !input.failureMessage?.trim()) throw new Error('Printer failure message is required.');
  const data = await invokePrinter({
    action: 'update_print',
    tenantId: input.tenantId,
    jobId: input.jobId,
    status: input.status,
    failureCode: input.status === 'failed' ? input.failureCode?.trim() || null : null,
    failureMessage: input.status === 'failed' ? input.failureMessage?.trim() || null : null,
  }, 'Unable to update this print attempt.');
  if (typeof data.jobId !== 'string' || !['requested', 'printing', 'printed', 'failed'].includes(String(data.status))) {
    throw new Error('SellerTray returned an invalid print status.');
  }
  return { jobId: data.jobId, status: data.status as PrintJobStatus, idempotentReplay: data.idempotentReplay === true };
}

export async function loadPrintJob(tenantId: string, jobId: string): Promise<PrintJob | null> {
  if (!tenantId || !jobId) return null;
  const { data, error } = await supabase.rpc('get_sellertray_print_job', { p_tenant_id: tenantId, p_job_id: jobId });
  if (error) throw error;
  return data === null ? null : parsePrintJob(data as Record<string, unknown>);
}

export function createPrintRequestKey(kind: PrintRequestKind): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function invokePrinter(body: Record<string, unknown>, fallback: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('printer', { body });
  if (error) throw new Error(await functionErrorMessage(error, fallback));
  if (!data || typeof data !== 'object') throw new Error('SellerTray returned an invalid printer response.');
  return data as Record<string, unknown>;
}

function isPrinterState(value: Record<string, unknown>): value is Record<string, unknown> & { printerId: string; registerId: string; displayName: string; transport: 'bluetooth'; hardwareIdentifier: string; paperWidthMm: 58 | 80; isDefault: boolean; isActive: boolean } {
  return typeof value.printerId === 'string'
    && typeof value.registerId === 'string'
    && typeof value.displayName === 'string'
    && value.transport === 'bluetooth'
    && typeof value.hardwareIdentifier === 'string'
    && (value.paperWidthMm === 58 || value.paperWidthMm === 80)
    && typeof value.isDefault === 'boolean'
    && typeof value.isActive === 'boolean';
}

function parsePrintJob(value: Record<string, unknown>): PrintJob {
  if (typeof value.jobId !== 'string'
      || !['requested', 'printing', 'printed', 'failed'].includes(String(value.status))
      || !['receipt', 'test'].includes(String(value.jobType))
      || typeof value.printerId !== 'string'
      || typeof value.printerName !== 'string'
      || value.transport !== 'bluetooth'
      || typeof value.hardwareIdentifier !== 'string'
      || (value.paperWidthMm !== 58 && value.paperWidthMm !== 80)) {
    throw new Error('SellerTray returned an invalid print job.');
  }
  return {
    jobId: value.jobId,
    status: value.status as PrintJobStatus,
    jobType: value.jobType as PrintJobType,
    orderId: typeof value.orderId === 'string' ? value.orderId : null,
    financialDocumentId: typeof value.financialDocumentId === 'string' ? value.financialDocumentId : null,
    printerId: value.printerId,
    printerName: value.printerName,
    transport: 'bluetooth',
    hardwareIdentifier: value.hardwareIdentifier,
    paperWidthMm: value.paperWidthMm,
    contentSnapshot: parseSnapshot(value.contentSnapshot),
    requestedAt: typeof value.requestedAt === 'string' ? value.requestedAt : null,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
    failedAt: typeof value.failedAt === 'string' ? value.failedAt : null,
    failureCode: typeof value.failureCode === 'string' ? value.failureCode : null,
    failureMessage: typeof value.failureMessage === 'string' ? value.failureMessage : null,
    idempotentReplay: value.idempotentReplay === true,
  };
}

function parseSnapshot(value: unknown): PrintContentSnapshot {
  if (!value || typeof value !== 'object') throw new Error('SellerTray returned an invalid print snapshot.');
  const row = value as Record<string, unknown>;
  if (row.documentType === 'test') return parseTestSnapshot(row);
  if (row.documentType === 'sales_invoice') return parseSalesInvoiceSnapshot(row);
  if (row.documentType === 'payment_receipt') return parsePaymentReceiptSnapshot(row);
  if (row.documentType === 'receipt') return parseLegacyReceiptSnapshot(row);
  throw new Error('SellerTray returned an unknown print document.');
}

function parseTestSnapshot(row: Record<string, unknown>): TestPrintSnapshot {
  if (typeof row.title !== 'string' || typeof row.businessName !== 'string' || typeof row.branchName !== 'string' || typeof row.registerName !== 'string' || typeof row.printerName !== 'string' || (row.paperWidthMm !== 58 && row.paperWidthMm !== 80) || typeof row.requestedAt !== 'string' || typeof row.footer !== 'string') {
    throw new Error('SellerTray returned an invalid test print snapshot.');
  }
  return { formatVersion: toNumber(row.formatVersion), documentType: 'test', title: row.title, businessName: row.businessName, branchName: row.branchName, registerName: row.registerName, printerName: row.printerName, paperWidthMm: row.paperWidthMm, requestedAt: row.requestedAt, footer: row.footer };
}

function parseLegacyReceiptSnapshot(row: Record<string, unknown>): ReceiptPrintSnapshot {
  if (typeof row.businessName !== 'string' || typeof row.branchName !== 'string' || typeof row.registerName !== 'string' || typeof row.orderReference !== 'string' || typeof row.receiptReference !== 'string' || typeof row.issuedAt !== 'string' || typeof row.customerName !== 'string' || typeof row.currency !== 'string' || typeof row.paymentMethod !== 'string' || typeof row.paymentProvider !== 'string' || !Array.isArray(row.items)) {
    throw new Error('SellerTray returned an invalid receipt print snapshot.');
  }
  return {
    formatVersion: toNumber(row.formatVersion),
    documentType: 'receipt',
    businessName: row.businessName,
    businessEmail: typeof row.businessEmail === 'string' ? row.businessEmail : null,
    businessPhone: typeof row.businessPhone === 'string' ? row.businessPhone : null,
    branchName: row.branchName,
    registerName: row.registerName,
    cashierName: typeof row.cashierName === 'string' ? row.cashierName : null,
    orderReference: row.orderReference,
    receiptReference: row.receiptReference,
    issuedAt: row.issuedAt,
    customerName: row.customerName,
    customerPhone: typeof row.customerPhone === 'string' ? row.customerPhone : null,
    currency: row.currency,
    amountPaid: toNumber(row.amountPaid),
    subtotalAmount: optionalNumber(row.subtotalAmount),
    taxApplied: typeof row.taxApplied === 'boolean' ? row.taxApplied : undefined,
    taxRatePercent: optionalNumber(row.taxRatePercent),
    taxAmount: optionalNumber(row.taxAmount),
    taxDisplayBreakdown: typeof row.taxDisplayBreakdown === 'boolean' ? row.taxDisplayBreakdown : undefined,
    grossAmount: optionalNumber(row.grossAmount),
    paymentMethod: row.paymentMethod,
    paymentProvider: row.paymentProvider,
    paymentReference: typeof row.paymentReference === 'string' ? row.paymentReference : null,
    paymentConfirmedAt: typeof row.paymentConfirmedAt === 'string' ? row.paymentConfirmedAt : null,
    items: row.items.map(parseReceiptItem),
    footer: typeof row.footer === 'string' ? row.footer : undefined,
    copyDefinitions: parseCopies(row.copyDefinitions),
    merchantFooter: typeof row.merchantFooter === 'string' ? row.merchantFooter : null,
    platformAttribution: typeof row.platformAttribution === 'string' ? row.platformAttribution : undefined,
  };
}

function parseSalesInvoiceSnapshot(row: Record<string, unknown>): SalesInvoicePrintSnapshot {
  if (typeof row.businessName !== 'string' || typeof row.branchName !== 'string' || typeof row.orderReference !== 'string' || typeof row.invoiceReference !== 'string' || typeof row.issuedAt !== 'string' || typeof row.customerName !== 'string' || typeof row.currency !== 'string' || typeof row.paymentLabel !== 'string' || typeof row.fulfillmentLabel !== 'string' || !Array.isArray(row.items)) {
    throw new Error('SellerTray returned an invalid Sales Invoice print snapshot.');
  }
  return {
    formatVersion: toNumber(row.formatVersion),
    documentType: 'sales_invoice',
    businessName: row.businessName,
    businessEmail: typeof row.businessEmail === 'string' ? row.businessEmail : null,
    businessPhone: typeof row.businessPhone === 'string' ? row.businessPhone : null,
    branchName: row.branchName,
    cashierName: typeof row.cashierName === 'string' ? row.cashierName : null,
    orderReference: row.orderReference,
    invoiceReference: row.invoiceReference,
    issuedAt: row.issuedAt,
    customerName: row.customerName,
    customerPhone: typeof row.customerPhone === 'string' ? row.customerPhone : null,
    currency: row.currency,
    subtotalAmount: toNumber(row.subtotalAmount),
    taxApplied: row.taxApplied === true,
    taxRatePercent: toNumber(row.taxRatePercent),
    taxAmount: toNumber(row.taxAmount),
    taxDisplayBreakdown: row.taxDisplayBreakdown !== false,
    grossAmount: toNumber(row.grossAmount),
    paymentLabel: row.paymentLabel,
    fulfillmentLabel: row.fulfillmentLabel,
    items: row.items.map(parseReceiptItem),
    platformAttribution: typeof row.platformAttribution === 'string' ? row.platformAttribution : undefined,
  };
}

function parsePaymentReceiptSnapshot(row: Record<string, unknown>): PaymentReceiptPrintSnapshot {
  if (typeof row.businessName !== 'string' || typeof row.branchName !== 'string' || typeof row.orderReference !== 'string' || typeof row.paymentId !== 'string' || typeof row.issuedAt !== 'string' || typeof row.customerName !== 'string' || typeof row.currency !== 'string' || typeof row.paymentMethod !== 'string' || typeof row.paymentProvider !== 'string' || typeof row.paymentLabel !== 'string' || typeof row.fulfillmentLabel !== 'string') {
    throw new Error('SellerTray returned an invalid Payment Receipt print snapshot.');
  }
  return {
    formatVersion: toNumber(row.formatVersion),
    documentType: 'payment_receipt',
    businessName: row.businessName,
    businessEmail: typeof row.businessEmail === 'string' ? row.businessEmail : null,
    businessPhone: typeof row.businessPhone === 'string' ? row.businessPhone : null,
    branchName: row.branchName,
    cashierName: typeof row.cashierName === 'string' ? row.cashierName : null,
    orderReference: row.orderReference,
    paymentId: row.paymentId,
    paymentReference: typeof row.paymentReference === 'string' ? row.paymentReference : null,
    issuedAt: row.issuedAt,
    customerName: row.customerName,
    customerPhone: typeof row.customerPhone === 'string' ? row.customerPhone : null,
    currency: row.currency,
    amountReceived: toNumber(row.amountReceived),
    paymentMethod: row.paymentMethod,
    paymentProvider: row.paymentProvider,
    paymentLabel: row.paymentLabel,
    fulfillmentLabel: row.fulfillmentLabel,
    copyDefinitions: parseCopies(row.copyDefinitions),
    merchantFooter: typeof row.merchantFooter === 'string' ? row.merchantFooter : null,
    platformAttribution: typeof row.platformAttribution === 'string' ? row.platformAttribution : undefined,
  };
}

function parseReceiptSettings(value: Record<string, unknown>): PrinterReceiptSettings {
  if (typeof value.printerId !== 'string') throw new Error('SellerTray returned invalid receipt settings.');
  return {
    printerId: value.printerId,
    copyDefinitions: parseCopies(value.receiptCopyDefinitions) ?? [{ type: 'customer', label: 'Customer Copy', sortOrder: 1 }],
    merchantFooter: typeof value.merchantReceiptFooter === 'string' ? value.merchantReceiptFooter : null,
  };
}

function parseCopies(value: unknown): ReceiptCopyDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const copies = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') return null;
    const row = entry as Record<string, unknown>;
    const type = String(row.type ?? '') as ReceiptCopyType;
    if (!['customer', 'store', 'audit', 'accounts', 'dispatch', 'production', 'custom'].includes(type) || typeof row.label !== 'string') return null;
    return { type, label: row.label, sortOrder: toNumber(row.sortOrder) || index + 1 };
  }).filter((copy): copy is ReceiptCopyDefinition => copy !== null);
  return copies.length ? copies : undefined;
}

function parseReceiptItem(value: unknown): ReceiptPrintItem {
  if (!value || typeof value !== 'object') throw new Error('SellerTray returned an invalid receipt line.');
  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string' || typeof row.uom !== 'string') throw new Error('SellerTray returned an invalid receipt line.');
  return { name: row.name, quantity: toNumber(row.quantity), uom: row.uom, unitPrice: toNumber(row.unitPrice), lineTotal: toNumber(row.lineTotal) };
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  let message = error instanceof Error && error.message ? error.message : fallback;
  if (!error || typeof error !== 'object' || !('context' in error)) return message;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('clone' in context)) return message;
  try {
    const payload = await (context as Response).clone().json() as { error?: string };
    if (payload?.error) message = payload.error;
  } catch {
    // Keep the SDK/fallback message.
  }
  return message;
}
