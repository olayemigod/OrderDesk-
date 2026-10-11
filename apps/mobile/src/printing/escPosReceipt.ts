import type { PrintContentSnapshot, ReceiptPrintSnapshot, TestPrintSnapshot } from '../data/printerRepository';

export type EscPosPaperWidth = 58 | 80;

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export function buildEscPosPrintBytes(
  snapshot: PrintContentSnapshot,
  paperWidthMm: EscPosPaperWidth,
): Uint8Array {
  const width = paperWidthMm === 80 ? 48 : 32;
  const bytes: number[] = [];

  push(bytes, ESC, 0x40); // Initialize.
  push(bytes, ESC, 0x61, 0x01); // Center.
  push(bytes, ESC, 0x45, 0x01); // Bold.

  if (snapshot.documentType === 'test') {
    appendTestPrint(bytes, snapshot, width);
  } else {
    appendReceipt(bytes, snapshot, width);
  }

  push(bytes, ESC, 0x45, 0x00);
  push(bytes, ESC, 0x61, 0x00);
  push(bytes, ESC, 0x64, 0x04); // Feed four lines for manual tear.

  return Uint8Array.from(bytes);
}

function appendTestPrint(bytes: number[], snapshot: TestPrintSnapshot, width: number) {
  appendCentered(bytes, snapshot.title.toUpperCase(), width);
  push(bytes, ESC, 0x45, 0x00);
  appendCentered(bytes, snapshot.businessName, width);
  appendCentered(bytes, snapshot.branchName, width);
  appendLine(bytes, divider(width));
  push(bytes, ESC, 0x61, 0x00);
  appendKeyValue(bytes, 'Register', snapshot.registerName, width);
  appendKeyValue(bytes, 'Printer', snapshot.printerName, width);
  appendKeyValue(bytes, 'Paper', `${snapshot.paperWidthMm} mm`, width);
  appendKeyValue(bytes, 'Status', 'Printer connection ready', width);
  appendLine(bytes, divider(width));
  push(bytes, ESC, 0x61, 0x01);
  appendCentered(bytes, snapshot.footer, width);
  appendCentered(bytes, formatDate(snapshot.requestedAt), width);
}

function appendReceipt(bytes: number[], snapshot: ReceiptPrintSnapshot, width: number) {
  appendCentered(bytes, snapshot.businessName.toUpperCase(), width);
  push(bytes, ESC, 0x45, 0x00);
  appendCentered(bytes, snapshot.branchName, width);
  if (snapshot.businessPhone) appendCentered(bytes, snapshot.businessPhone, width);
  if (snapshot.businessEmail) appendCentered(bytes, snapshot.businessEmail, width);

  appendLine(bytes, divider(width));
  push(bytes, ESC, 0x61, 0x00);
  appendKeyValue(bytes, 'Receipt', snapshot.receiptReference, width);
  appendKeyValue(bytes, 'Order', snapshot.orderReference, width);
  appendKeyValue(bytes, 'Date', formatDate(snapshot.issuedAt), width);
  appendKeyValue(bytes, 'Customer', snapshot.customerName, width);
  if (snapshot.customerPhone) appendKeyValue(bytes, 'Phone', snapshot.customerPhone, width);
  appendLine(bytes, divider(width));

  for (const item of snapshot.items) {
    for (const line of wrapText(item.name, width)) appendLine(bytes, line);
    const quantityText = `${formatQuantity(item.quantity)} ${item.uom}`;
    const rateText = `${formatCurrencyAmount(item.unitPrice, snapshot.currency)} ea`;
    appendColumns(bytes, quantityText, rateText, width);
    appendColumns(bytes, '', formatCurrencyAmount(item.lineTotal, snapshot.currency), width);
  }

  appendLine(bytes, divider(width));
  push(bytes, ESC, 0x45, 0x01);
  appendColumns(bytes, 'AMOUNT PAID', formatCurrencyAmount(snapshot.amountPaid, snapshot.currency), width);
  push(bytes, ESC, 0x45, 0x00);
  appendKeyValue(bytes, 'Payment', humanize(snapshot.paymentMethod), width);
  if (snapshot.paymentReference) appendKeyValue(bytes, 'Reference', snapshot.paymentReference, width);
  appendLine(bytes, divider(width));
  push(bytes, ESC, 0x61, 0x01);
  appendCentered(bytes, 'Thank you for your purchase', width);
  appendCentered(bytes, snapshot.footer, width);
}

function appendKeyValue(bytes: number[], label: string, value: string, width: number) {
  const prefix = `${label}: `;
  const cleanValue = normalizeText(value);
  if (prefix.length + cleanValue.length <= width) {
    appendLine(bytes, `${prefix}${cleanValue}`);
    return;
  }
  appendLine(bytes, prefix.trimEnd());
  for (const line of wrapText(cleanValue, Math.max(width - 2, 8))) appendLine(bytes, `  ${line}`.slice(0, width));
}

function appendColumns(bytes: number[], left: string, right: string, width: number) {
  const cleanLeft = normalizeText(left);
  const cleanRight = normalizeText(right);
  if (cleanRight.length >= width) {
    if (cleanLeft) appendLine(bytes, cleanLeft.slice(0, width));
    appendLine(bytes, cleanRight.slice(0, width));
    return;
  }
  const availableLeft = Math.max(width - cleanRight.length - 1, 0);
  const leftPart = cleanLeft.slice(0, availableLeft);
  const spaces = Math.max(width - leftPart.length - cleanRight.length, 1);
  appendLine(bytes, `${leftPart}${' '.repeat(spaces)}${cleanRight}`.slice(0, width));
}

function appendCentered(bytes: number[], text: string, width: number) {
  for (const line of wrapText(text, width)) appendLine(bytes, line);
}

function appendLine(bytes: number[], text: string) {
  for (const byte of encodePrinterAscii(text)) bytes.push(byte);
  bytes.push(LF);
}

function encodePrinterAscii(value: string): number[] {
  const clean = normalizeText(value);
  const output: number[] = [];
  for (const character of clean) {
    const code = character.charCodeAt(0);
    output.push(code >= 32 && code <= 126 ? code : 0x3f);
  }
  return output;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₦/g, 'NGN ')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapText(value: string, width: number): string[] {
  const clean = normalizeText(value);
  if (!clean) return [''];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function divider(width: number): string {
  return '-'.repeat(width);
}

function formatCurrencyAmount(value: number, currency: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  const currencyCode = normalizeText(currency || 'NGN').toUpperCase();
  return `${currencyCode} ${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return normalizeText(value);
  return date.toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function humanize(value: string): string {
  return normalizeText(value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()));
}

function push(bytes: number[], ...values: number[]) {
  bytes.push(...values);
}

export const ESC_POS_CONTROL_BYTES = {
  initialize: [ESC, 0x40] as const,
  alignLeft: [ESC, 0x61, 0x00] as const,
  alignCenter: [ESC, 0x61, 0x01] as const,
  boldOn: [ESC, 0x45, 0x01] as const,
  boldOff: [ESC, 0x45, 0x00] as const,
  feedFourLines: [ESC, 0x64, 0x04] as const,
  groupSeparator: GS,
};