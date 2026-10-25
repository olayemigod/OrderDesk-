import type { PrintContentSnapshot, ReceiptPrintItem, ReceiptPrintSnapshot, TestPrintSnapshot } from '../data/printerRepository';

export type EscPosPaperWidth = 58 | 80;
type EnhancedReceiptSnapshot = ReceiptPrintSnapshot & { copyLabel?: string; merchantFooter?: string; platformAttribution?: string };
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
  copyLabel?: string;
  merchantFooter?: string | null;
  platformAttribution?: string;
};
export type MobileBusinessPrintSnapshot = SalesInvoicePrintSnapshot | PaymentReceiptPrintSnapshot;

const ESC = 0x1b; const GS = 0x1d; const LF = 0x0a;

export function buildEscPosPrintBytes(snapshot: PrintContentSnapshot | MobileBusinessPrintSnapshot, paperWidthMm: EscPosPaperWidth): Uint8Array {
  const width = paperWidthMm === 80 ? 48 : 32; const bytes: number[] = [];
  push(bytes, ESC, 0x40); push(bytes, ESC, 0x61, 0x01); push(bytes, ESC, 0x45, 0x01);
  if (snapshot.documentType === 'test') appendTestPrint(bytes, snapshot, width);
  else if (snapshot.documentType === 'sales_invoice') appendSalesInvoice(bytes, snapshot, width);
  else if (snapshot.documentType === 'payment_receipt') appendPaymentReceipt(bytes, snapshot, width);
  else appendReceipt(bytes, snapshot as EnhancedReceiptSnapshot, width);
  push(bytes, ESC, 0x45, 0x00); push(bytes, ESC, 0x61, 0x00); push(bytes, ESC, 0x64, 0x04); return Uint8Array.from(bytes);
}
function appendTestPrint(bytes: number[], snapshot: TestPrintSnapshot, width: number) {
  appendCentered(bytes, snapshot.title.toUpperCase(), width); push(bytes, ESC, 0x45, 0x00); appendCentered(bytes, snapshot.businessName, width); appendCentered(bytes, snapshot.branchName, width); appendLine(bytes, divider(width)); push(bytes, ESC, 0x61, 0x00); appendKeyValue(bytes, 'Register', snapshot.registerName, width); appendKeyValue(bytes, 'Printer', snapshot.printerName, width); appendKeyValue(bytes, 'Paper', `${snapshot.paperWidthMm} mm`, width); appendKeyValue(bytes, 'Status', 'Printer connection ready', width); appendLine(bytes, divider(width)); push(bytes, ESC, 0x61, 0x01); appendCentered(bytes, 'SellerTray', width); appendCentered(bytes, formatDate(snapshot.requestedAt), width);
}
function appendReceipt(bytes: number[], snapshot: EnhancedReceiptSnapshot, width: number) {
  appendMerchantHeader(bytes, snapshot, width);
  if (snapshot.copyLabel) { appendLine(bytes, divider(width)); push(bytes, ESC, 0x45, 0x01); appendCentered(bytes, snapshot.copyLabel.toUpperCase(), width); push(bytes, ESC, 0x45, 0x00); }
  appendLine(bytes, divider(width)); push(bytes, ESC, 0x45, 0x01); appendCentered(bytes, 'PAYMENT RECEIPT', width); push(bytes, ESC, 0x45, 0x00); push(bytes, ESC, 0x61, 0x00);
  appendKeyValue(bytes, 'Receipt', snapshot.receiptReference, width); appendKeyValue(bytes, 'Order', snapshot.orderReference, width); appendKeyValue(bytes, 'Date', formatDate(snapshot.issuedAt), width); if (snapshot.cashierName) appendKeyValue(bytes, 'Cashier', snapshot.cashierName, width); appendKeyValue(bytes, 'Customer', snapshot.customerName, width); if (isPrintableCustomerPhone(snapshot.customerPhone)) appendKeyValue(bytes, 'Phone', snapshot.customerPhone!, width); appendLine(bytes, divider(width));
  for (const item of snapshot.items) { for (const line of wrapText(item.name, width)) appendLine(bytes, line); const detail = `${formatQuantity(item.quantity)} ${item.uom} x ${formatCurrencyAmount(item.unitPrice, snapshot.currency)}`; for (const line of wrapText(detail, width)) appendLine(bytes, line); appendColumns(bytes, '', formatCurrencyAmount(item.lineTotal, snapshot.currency), width); }
  const itemSubtotal = roundMoney(snapshot.items.reduce((sum, item) => sum + item.lineTotal, 0));
  const subtotal = validMoney(snapshot.subtotalAmount) ? snapshot.subtotalAmount! : itemSubtotal;
  const gross = validMoney(snapshot.grossAmount) ? snapshot.grossAmount! : snapshot.amountPaid;
  const tax = validMoney(snapshot.taxAmount) ? snapshot.taxAmount! : roundMoney(Math.max(gross - subtotal, 0));
  const showTax = tax > 0.004 && snapshot.taxDisplayBreakdown !== false;
  appendLine(bytes, divider(width)); appendColumns(bytes, 'SUBTOTAL', formatCurrencyAmount(subtotal, snapshot.currency), width); if (showTax) appendColumns(bytes, taxLabel(snapshot.taxRatePercent), formatCurrencyAmount(tax, snapshot.currency), width); push(bytes, ESC, 0x45, 0x01); appendColumns(bytes, 'TOTAL', formatCurrencyAmount(gross, snapshot.currency), width); push(bytes, ESC, 0x45, 0x00); appendKeyValue(bytes, 'Payment', humanize(snapshot.paymentMethod), width); if (snapshot.paymentReference) appendKeyValue(bytes, 'Reference', snapshot.paymentReference, width); appendReceiptFooter(bytes, width, snapshot.merchantFooter, snapshot.platformAttribution);
}
function appendSalesInvoice(bytes: number[], snapshot: SalesInvoicePrintSnapshot, width: number) {
  appendMerchantHeader(bytes, snapshot, width);
  appendLine(bytes, divider(width)); push(bytes, ESC, 0x45, 0x01); appendCentered(bytes, 'SALES INVOICE', width); push(bytes, ESC, 0x45, 0x00); push(bytes, ESC, 0x61, 0x00);
  appendKeyValue(bytes, 'Invoice', snapshot.invoiceReference, width); appendKeyValue(bytes, 'Order', snapshot.orderReference, width); appendKeyValue(bytes, 'Date', formatDate(snapshot.issuedAt), width); if (snapshot.cashierName) appendKeyValue(bytes, 'Cashier', snapshot.cashierName, width); appendKeyValue(bytes, 'Customer', snapshot.customerName, width); if (isPrintableCustomerPhone(snapshot.customerPhone)) appendKeyValue(bytes, 'Phone', snapshot.customerPhone!, width); appendLine(bytes, divider(width));
  for (const item of snapshot.items) { for (const line of wrapText(item.name, width)) appendLine(bytes, line); const detail = `${formatQuantity(item.quantity)} ${item.uom} x ${formatCurrencyAmount(item.unitPrice, snapshot.currency)}`; for (const line of wrapText(detail, width)) appendLine(bytes, line); appendColumns(bytes, '', formatCurrencyAmount(item.lineTotal, snapshot.currency), width); }
  appendLine(bytes, divider(width)); appendColumns(bytes, 'SUBTOTAL', formatCurrencyAmount(snapshot.subtotalAmount, snapshot.currency), width); if (snapshot.taxApplied && snapshot.taxAmount > 0.004 && snapshot.taxDisplayBreakdown !== false) appendColumns(bytes, taxLabel(snapshot.taxRatePercent), formatCurrencyAmount(snapshot.taxAmount, snapshot.currency), width); push(bytes, ESC, 0x45, 0x01); appendColumns(bytes, 'TOTAL', formatCurrencyAmount(snapshot.grossAmount, snapshot.currency), width); push(bytes, ESC, 0x45, 0x00); appendKeyValue(bytes, 'Payment', snapshot.paymentLabel, width); appendKeyValue(bytes, 'Fulfilment', snapshot.fulfillmentLabel, width); appendLine(bytes, divider(width)); push(bytes, ESC, 0x61, 0x01); appendCentered(bytes, snapshot.platformAttribution || 'Powered by SellerTray', width);
}
function appendPaymentReceipt(bytes: number[], snapshot: PaymentReceiptPrintSnapshot, width: number) {
  appendMerchantHeader(bytes, snapshot, width);
  if (snapshot.copyLabel) { appendLine(bytes, divider(width)); push(bytes, ESC, 0x45, 0x01); appendCentered(bytes, snapshot.copyLabel.toUpperCase(), width); push(bytes, ESC, 0x45, 0x00); }
  appendLine(bytes, divider(width)); push(bytes, ESC, 0x45, 0x01); appendCentered(bytes, 'PAYMENT RECEIPT', width); push(bytes, ESC, 0x45, 0x00); push(bytes, ESC, 0x61, 0x00);
  appendKeyValue(bytes, 'Payment ID', compactPaymentId(snapshot.paymentId), width); appendKeyValue(bytes, 'Order', snapshot.orderReference, width); appendKeyValue(bytes, 'Date', formatDate(snapshot.issuedAt), width); if (snapshot.cashierName) appendKeyValue(bytes, 'Cashier', snapshot.cashierName, width); appendKeyValue(bytes, 'Customer', snapshot.customerName, width); if (isPrintableCustomerPhone(snapshot.customerPhone)) appendKeyValue(bytes, 'Phone', snapshot.customerPhone!, width); appendKeyValue(bytes, 'Method', humanize(snapshot.paymentMethod), width); if (snapshot.paymentProvider && snapshot.paymentProvider !== snapshot.paymentMethod) appendKeyValue(bytes, 'Provider', humanize(snapshot.paymentProvider), width); if (snapshot.paymentReference) appendKeyValue(bytes, 'Reference', snapshot.paymentReference, width); appendKeyValue(bytes, 'Payment', snapshot.paymentLabel, width); appendKeyValue(bytes, 'Fulfilment', snapshot.fulfillmentLabel, width); appendLine(bytes, divider(width)); push(bytes, ESC, 0x45, 0x01); appendColumns(bytes, 'AMOUNT RECEIVED', formatCurrencyAmount(snapshot.amountReceived, snapshot.currency), width); push(bytes, ESC, 0x45, 0x00); appendReceiptFooter(bytes, width, snapshot.merchantFooter, snapshot.platformAttribution);
}
function appendMerchantHeader(bytes: number[], snapshot: { businessName: string; branchName: string; businessPhone: string | null; businessEmail: string | null }, width: number) { appendCentered(bytes, snapshot.businessName.toUpperCase(), width); push(bytes, ESC, 0x45, 0x00); appendCentered(bytes, snapshot.branchName, width); if (snapshot.businessPhone) appendCentered(bytes, snapshot.businessPhone, width); if (snapshot.businessEmail) appendCentered(bytes, snapshot.businessEmail, width); }
function appendReceiptFooter(bytes: number[], width: number, merchantFooter?: string | null, platformAttribution?: string) { appendLine(bytes, divider(width)); push(bytes, ESC, 0x61, 0x01); appendCentered(bytes, 'Thank you for your payment', width); if (merchantFooter) appendCentered(bytes, merchantFooter, width); appendCentered(bytes, platformAttribution || 'Powered by SellerTray', width); }
function isPrintableCustomerPhone(value: string | null): value is string { return !!value?.trim() && !/^(pos:|walk[- ]?in|anonymous|guest)/i.test(value.trim()); }
function appendKeyValue(bytes: number[], label: string, value: string, width: number) { const prefix = `${label}: `; const cleanValue = normalizeText(value); if (prefix.length + cleanValue.length <= width) { appendLine(bytes, `${prefix}${cleanValue}`); return; } appendLine(bytes, prefix.trimEnd()); for (const line of wrapText(cleanValue, Math.max(width - 2, 8))) appendLine(bytes, `  ${line}`.slice(0, width)); }
function appendColumns(bytes: number[], left: string, right: string, width: number) { const cleanLeft = normalizeText(left); const cleanRight = normalizeText(right); if (cleanRight.length >= width || (cleanLeft && cleanLeft.length + cleanRight.length + 1 > width)) { if (cleanLeft) for (const line of wrapText(cleanLeft, width)) appendLine(bytes, line); for (const line of wrapText(cleanRight, width)) appendLine(bytes, line.padStart(width)); return; } const availableLeft = Math.max(width - cleanRight.length - 1, 0); const leftPart = cleanLeft.slice(0, availableLeft); const spaces = Math.max(width - leftPart.length - cleanRight.length, 1); appendLine(bytes, `${leftPart}${' '.repeat(spaces)}${cleanRight}`); }
function appendCentered(bytes: number[], text: string, width: number) { for (const line of wrapText(text, width)) appendLine(bytes, line); }
function appendLine(bytes: number[], text: string) { for (const byte of encodePrinterAscii(text)) bytes.push(byte); bytes.push(LF); }
function encodePrinterAscii(value: string): number[] { return Array.from(normalizeText(value)).map((character) => { const code = character.charCodeAt(0); return code >= 32 && code <= 126 ? code : 0x3f; }); }
function normalizeText(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[·•]/g, '|').replace(/₦/g, 'NGN ').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim(); }
function wrapText(value: string, width: number): string[] { const clean = normalizeText(value); if (!clean) return ['']; const words = clean.split(' '); const lines: string[] = []; let current = ''; for (const word of words) { if (word.length > width) { if (current) { lines.push(current); current = ''; } for (let index = 0; index < word.length; index += width) lines.push(word.slice(index, index + width)); continue; } const next = current ? `${current} ${word}` : word; if (next.length <= width) current = next; else { lines.push(current); current = word; } } if (current) lines.push(current); return lines; }
function divider(width: number): string { return '-'.repeat(width); }
function formatCurrencyAmount(value: number, currency: string): string { const amount = Number.isFinite(value) ? value : 0; const currencyCode = normalizeText(currency || 'NGN').toUpperCase(); return `${currencyCode} ${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function formatQuantity(value: number): string { if (!Number.isFinite(value)) return '0'; return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))); }
function formatDate(value: string): string { const date = new Date(value); if (Number.isNaN(date.getTime())) return normalizeText(value); return date.toLocaleString('en-NG', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function humanize(value: string): string { return normalizeText(value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())); }
function compactPaymentId(value: string): string { const clean = normalizeText(value); return clean.length <= 16 ? clean : `PAY-${clean.slice(0, 8).toUpperCase()}`; }
function taxLabel(rate: number | undefined): string { return validMoney(rate) && rate! > 0 ? `TAX (${formatQuantity(rate!)}%)` : 'TAX'; }
function validMoney(value: number | undefined): boolean { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function push(bytes: number[], ...values: number[]) { bytes.push(...values); }
export const ESC_POS_CONTROL_BYTES = { initialize: [ESC, 0x40] as const, alignLeft: [ESC, 0x61, 0x00] as const, alignCenter: [ESC, 0x61, 0x01] as const, boldOn: [ESC, 0x45, 0x01] as const, boldOff: [ESC, 0x45, 0x00] as const, feedFourLines: [ESC, 0x64, 0x04] as const, groupSeparator: GS };
