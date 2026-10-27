import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import { extractText, getDocumentProxy } from 'npm:unpdf@1.9.1';

export type MasterSourceDocument = {
  filename: string;
  pdfSha256: string;
  byteSize: number;
  pageCount: number;
  bytes: Uint8Array;
};

export type AgreementPdfInput = {
  artifactKind: 'review_pdf' | 'executed_pdf';
  tenantId: string;
  packageId: string;
  packageFingerprint: string;
  generatedAt: string;
  masterAgreement: {
    id: string;
    versionCode: string;
    title: string;
    contentBody: string;
    contentSha256: string;
    effectiveFrom: string;
    sourceDocument?: MasterSourceDocument | null;
  };
  orderForm: {
    id: string;
    reference: string;
    title: string;
    templateVersion: string;
    renderedContent: string;
    contentSha256: string;
    commercialSnapshotSha256: string;
    commercialSnapshot: Record<string, unknown>;
    issuedAt: string;
  };
  masterAcceptance?: {
    acceptedLegalName: string;
    acceptedRole: string;
    acceptedAt: string;
    acceptedByUserId: string;
  } | null;
  orderFormConfirmation?: {
    confirmedLegalName: string;
    confirmedRole: string;
    confirmedAt: string;
    confirmedByUserId: string;
  } | null;
};

const A4: [number, number] = [595.28, 841.89];
const NAVY = rgb(16 / 255, 42 / 255, 67 / 255);
const GREEN = rgb(18 / 255, 183 / 255, 106 / 255);
const SLATE = rgb(71 / 255, 84 / 255, 103 / 255);
const LIGHT = rgb(248 / 255, 250 / 255, 252 / 255);
const LINE = rgb(228 / 255, 231 / 255, 236 / 255);

export async function inspectUploadedMasterPdf(bytes: Uint8Array): Promise<{ text: string; pageCount: number; pdfSha256: string }> {
  if (bytes.byteLength < 8 || bytes.byteLength > 8 * 1024 * 1024) {
    throw new Error('Reviewed Master Agreement PDF must be between 1 byte and 8 MB');
  }
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== '%PDF-') throw new Error('Upload a valid PDF document');

  const pdf = await getDocumentProxy(bytes, {
    maxImageSize: 16_777_216,
    isEvalSupported: false,
  });
  if (pdf.numPages < 1 || pdf.numPages > 200) throw new Error('Reviewed Master Agreement PDF must contain between 1 and 200 pages');

  const extraction = await Promise.race([
    extractText(pdf, { mergePages: true }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PDF text extraction timed out')), 12_000)),
  ]);
  const raw = typeof extraction.text === 'string' ? extraction.text : extraction.text.join('\n\n');
  const text = normalizeExtractedText(raw);
  if (text.length < 120) {
    throw new Error('The uploaded PDF does not contain enough selectable legal text. Upload a text-based PDF rather than a scanned-image-only document.');
  }
  if (text.length > 200_000) throw new Error('Extracted Master Agreement text exceeds the 200,000 character publication limit');
  return { text, pageCount: pdf.numPages, pdfSha256: await sha256Hex(bytes) };
}

export async function buildAgreementPackagePdf(input: AgreementPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.masterAgreement.title} — ${input.orderForm.reference}`);
  doc.setAuthor('ProcessEdge Solutions Limited');
  doc.setSubject(`SellerTray Agreement Package ${input.orderForm.reference}`);
  doc.setCreator('SellerTray governed agreement service');
  doc.setProducer('SellerTray governed agreement service');
  doc.setCreationDate(new Date(input.generatedAt));

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  drawCover(doc.addPage(A4), regular, bold, input);

  if (input.masterAgreement.sourceDocument?.bytes?.byteLength) {
    const sourceDoc = await PDFDocument.load(input.masterAgreement.sourceDocument.bytes, { ignoreEncryption: false });
    const pages = await doc.copyPages(sourceDoc, sourceDoc.getPageIndices());
    for (const page of pages) doc.addPage(page);
  } else {
    drawTextSection(doc, regular, bold, 'MASTER AGREEMENT', input.masterAgreement.title, input.masterAgreement.contentBody);
  }

  drawOrderForm(doc, regular, bold, input);
  drawIntegrityPage(doc, doc.addPage(A4), regular, bold, input);

  if (input.artifactKind === 'executed_pdf') {
    if (!input.masterAcceptance || !input.orderFormConfirmation) {
      throw new Error('Executed Agreement Package PDF requires Master acceptance and Order Form confirmation evidence');
    }
    drawExecutionCertificate(doc, doc.addPage(A4), regular, bold, italic, input);
  }

  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function drawCover(page: PDFPage, regular: PDFFont, bold: PDFFont, input: AgreementPdfInput) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 16, width, height: 16, color: GREEN });
  page.drawRectangle({ x: 0, y: height - 178, width, height: 162, color: NAVY });
  page.drawText('SellerTray', { x: 54, y: height - 82, size: 30, font: bold, color: rgb(1, 1, 1) });
  page.drawText('ProcessEdge Solutions Limited', { x: 55, y: height - 107, size: 10, font: regular, color: rgb(.86, .91, .95) });
  page.drawText(input.artifactKind === 'executed_pdf' ? 'EXECUTED AGREEMENT PACKAGE' : 'AGREEMENT PACKAGE', {
    x: 55, y: height - 144, size: 13, font: bold, color: GREEN,
  });

  let y = height - 238;
  page.drawText(input.masterAgreement.title, { x: 55, y, size: 21, font: bold, color: NAVY, maxWidth: width - 110 });
  y -= 44;
  const merchant = record(input.orderForm.commercialSnapshot.merchant);
  const facts = [
    ['Business', stringValue(merchant.business_name) || 'SellerTray Business'],
    ['Order Form', input.orderForm.reference],
    ['Master Agreement', `Version ${input.masterAgreement.versionCode}`],
    ['Package reference', shortHash(input.packageFingerprint, 24)],
    ['Prepared', formatDate(input.generatedAt)],
  ] as const;
  for (const [label, value] of facts) {
    page.drawText(label.toUpperCase(), { x: 55, y, size: 8, font: bold, color: GREEN });
    page.drawText(value, { x: 175, y: y - 1, size: 11, font: regular, color: SLATE, maxWidth: width - 230 });
    y -= 31;
  }

  y -= 18;
  page.drawRectangle({ x: 55, y: y - 82, width: width - 110, height: 82, color: LIGHT, borderColor: LINE, borderWidth: 1 });
  page.drawText('This document is a rendered copy of governed SellerTray agreement evidence.', {
    x: 70, y: y - 24, size: 10.5, font: bold, color: NAVY, maxWidth: width - 140,
  });
  page.drawText('The Agreement Package fingerprint binds the exact Master Agreement version, the exact Order Form and the server-governed commercial snapshot.', {
    x: 70, y: y - 45, size: 9.2, font: regular, color: SLATE, maxWidth: width - 140, lineHeight: 13,
  });
  page.drawText('ProcessEdge Solutions Limited · SellerTray', { x: 55, y: 38, size: 8.5, font: regular, color: SLATE });
}

function drawTextSection(doc: PDFDocument, regular: PDFFont, bold: PDFFont, eyebrow: string, title: string, text: string) {
  let page = doc.addPage(A4);
  let y = drawSectionHeader(page, bold, eyebrow, title);
  for (const paragraph of text.split(/\n\s*\n/)) {
    const clean = paragraph.trim();
    if (!clean) continue;
    const result = drawWrappedText(doc, page, regular, clean, 55, y, 485, 10.2, 14.5, SLATE);
    page = result.page;
    y = result.y - 11;
    if (y < 80) {
      page = doc.addPage(A4);
      y = drawSectionHeader(page, bold, eyebrow, `${title} (continued)`);
    }
  }
}

function drawOrderForm(doc: PDFDocument, regular: PDFFont, bold: PDFFont, input: AgreementPdfInput) {
  let page = doc.addPage(A4);
  let y = drawSectionHeader(page, bold, 'MERCHANT ORDER FORM', input.orderForm.title || 'SellerTray Order Form');
  const snapshot = input.orderForm.commercialSnapshot;
  const merchant = record(snapshot.merchant);
  const settlement = record(snapshot.settlementTerms);
  const facts: [string, string][] = [
    ['Order Form reference', input.orderForm.reference],
    ['Template version', input.orderForm.templateVersion],
    ['Business', stringValue(merchant.business_name) || '—'],
    ['Business email', stringValue(merchant.business_email) || '—'],
    ['Business phone', stringValue(merchant.business_phone) || '—'],
    ['Commercial order', stringValue(snapshot.order_reference) || '—'],
    ['Order date', formatDate(stringValue(snapshot.ordered_at))],
    ['Order total', money(numberValue(snapshot.total_gross_amount), stringValue(snapshot.currency) || 'NGN')],
    ['Approved adjustments', money(numberValue(settlement.approvedAdjustmentAmount), stringValue(snapshot.currency) || 'NGN')],
    ['Current amount due', money(numberValue(settlement.netAmountDue), stringValue(snapshot.currency) || 'NGN')],
  ];
  for (const [label, value] of facts) {
    if (y < 92) { page = doc.addPage(A4); y = drawSectionHeader(page, bold, 'MERCHANT ORDER FORM', 'Commercial particulars (continued)'); }
    page.drawText(label, { x: 55, y, size: 8.5, font: bold, color: GREEN });
    page.drawText(value, { x: 205, y: y - 1, size: 10, font: regular, color: SLATE, maxWidth: 335 });
    y -= 24;
  }

  const priceLines = array(snapshot.price_snapshots);
  if (priceLines.length) {
    y -= 9;
    page.drawText('PURCHASE LINES', { x: 55, y, size: 9, font: bold, color: NAVY });
    y -= 22;
    for (const item of priceLines) {
      const line = record(item);
      const description = stringValue(line.description) || `Line ${stringValue(line.line_no)}`;
      const quantity = numberValue(line.quantity);
      const currency = stringValue(line.currency) || stringValue(snapshot.currency) || 'NGN';
      const amount = money(numberValue(line.gross_amount), currency);
      const rowText = `${description}  ·  Qty ${quantity}  ·  ${amount}`;
      const result = drawWrappedText(doc, page, regular, rowText, 65, y, 470, 9.5, 13, SLATE);
      page = result.page; y = result.y - 8;
    }
  }

  y -= 12;
  if (y < 120) { page = doc.addPage(A4); y = drawSectionHeader(page, bold, 'MERCHANT ORDER FORM', 'Legal wording'); }
  page.drawText('ORDER FORM LEGAL WORDING', { x: 55, y, size: 9, font: bold, color: NAVY });
  y -= 24;
  for (const paragraph of input.orderForm.renderedContent.split(/\n\s*\n/)) {
    const clean = paragraph.trim();
    if (!clean) continue;
    const result = drawWrappedText(doc, page, regular, clean, 55, y, 485, 10, 14, SLATE);
    page = result.page; y = result.y - 10;
  }
}

function drawIntegrityPage(doc: PDFDocument, page: PDFPage, regular: PDFFont, bold: PDFFont, input: AgreementPdfInput) {
  const y0 = drawSectionHeader(page, bold, 'VERIFICATION', 'Agreement Package integrity');
  let y = y0;
  const source = input.masterAgreement.sourceDocument;
  const rows: [string, string][] = [
    ['Agreement Package ID', input.packageId],
    ['Package fingerprint', input.packageFingerprint],
    ['Master version', input.masterAgreement.versionCode],
    ['Master content SHA-256', input.masterAgreement.contentSha256],
    ...(source ? [
      ['Reviewed source PDF', source.filename],
      ['Reviewed source PDF SHA-256', source.pdfSha256],
    ] as [string, string][] : []),
    ['Order Form reference', input.orderForm.reference],
    ['Order Form SHA-256', input.orderForm.contentSha256],
    ['Commercial snapshot SHA-256', input.orderForm.commercialSnapshotSha256],
  ];
  for (const [label, value] of rows) {
    page.drawText(label.toUpperCase(), { x: 55, y, size: 7.7, font: bold, color: GREEN });
    const result = drawWrappedText(doc, page, regular, value, 55, y - 18, 485, 9, 12.5, SLATE);
    y = result.y - 18;
  }
  page.drawRectangle({ x: 55, y: 82, width: 485, height: 86, color: LIGHT, borderColor: LINE, borderWidth: 1 });
  page.drawText('Verification reference', { x: 70, y: 139, size: 8.5, font: bold, color: GREEN });
  page.drawText(`ST-AGR-${shortHash(input.packageFingerprint, 20).toUpperCase()}`, { x: 70, y: 117, size: 14, font: bold, color: NAVY });
  page.drawText('SellerTray validates this package from immutable server evidence, not from the appearance of this PDF alone.', {
    x: 70, y: 95, size: 8.5, font: regular, color: SLATE, maxWidth: 455,
  });
}

function drawExecutionCertificate(doc: PDFDocument, page: PDFPage, regular: PDFFont, bold: PDFFont, italic: PDFFont, input: AgreementPdfInput) {
  const acceptance = input.masterAcceptance!;
  const confirmation = input.orderFormConfirmation!;
  let y = drawSectionHeader(page, bold, 'ELECTRONIC EXECUTION', 'Electronic Execution Certificate');
  page.drawText('This certificate records authenticated SellerTray execution evidence for this Agreement Package.', {
    x: 55, y, size: 10.5, font: regular, color: SLATE, maxWidth: 485,
  });
  y -= 44;
  const rows: [string, string][] = [
    ['Business representative', confirmation.confirmedLegalName],
    ['Merchant authority', roleLabel(confirmation.confirmedRole)],
    ['Master Agreement accepted', formatDate(acceptance.acceptedAt)],
    ['Order Form confirmed', formatDate(confirmation.confirmedAt)],
    ['Master acceptance actor', acceptance.acceptedByUserId],
    ['Order Form confirmation actor', confirmation.confirmedByUserId],
    ['Package fingerprint', input.packageFingerprint],
    ['Verification reference', `ST-AGR-${shortHash(input.packageFingerprint, 20).toUpperCase()}`],
  ];
  for (const [label, value] of rows) {
    page.drawText(label, { x: 55, y, size: 8.5, font: bold, color: GREEN });
    const result = drawWrappedText(doc, page, regular, value, 205, y, 335, 9.5, 13, SLATE);
    y = Math.min(y - 28, result.y - 8);
  }

  y -= 22;
  page.drawRectangle({ x: 55, y: y - 104, width: 485, height: 104, color: LIGHT, borderColor: LINE, borderWidth: 1 });
  page.drawText(confirmation.confirmedLegalName, { x: 74, y: y - 39, size: 18, font: italic, color: NAVY, maxWidth: 440 });
  page.drawLine({ start: { x: 74, y: y - 58 }, end: { x: 315, y: y - 58 }, thickness: 1, color: SLATE });
  page.drawText('Authenticated electronic signature', { x: 74, y: y - 76, size: 8.5, font: regular, color: SLATE });
  page.drawText(formatDate(confirmation.confirmedAt), { x: 74, y: y - 91, size: 8.5, font: regular, color: SLATE });

  page.drawText('The typed signature is presentation. Legal evidence is the authenticated identity, merchant authority, immutable hashes, package fingerprint, command evidence and server timestamps.', {
    x: 55, y: 52, size: 8.2, font: regular, color: SLATE, maxWidth: 485, lineHeight: 11,
  });
}

function drawSectionHeader(page: PDFPage, bold: PDFFont, eyebrow: string, title: string): number {
  const { height, width } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: GREEN });
  page.drawText('SellerTray', { x: 55, y: height - 52, size: 15, font: bold, color: NAVY });
  page.drawText(eyebrow, { x: 55, y: height - 88, size: 8.5, font: bold, color: GREEN });
  page.drawText(title, { x: 55, y: height - 116, size: 18, font: bold, color: NAVY, maxWidth: width - 110 });
  page.drawLine({ start: { x: 55, y: height - 138 }, end: { x: width - 55, y: height - 138 }, thickness: 1, color: LINE });
  return height - 166;
}

function drawWrappedText(doc: PDFDocument, page: PDFPage, font: PDFFont, text: string, x: number, y: number, maxWidth: number, size: number, lineHeight: number, color: ReturnType<typeof rgb>): { page: PDFPage; y: number } {
  let currentPage = page;
  let currentY = y;
  const lines = wrapText(font, text, maxWidth, size);
  for (const line of lines) {
    if (currentY < 62) {
      currentPage = doc.addPage(A4);
      currentY = currentPage.getHeight() - 62;
    }
    currentPage.drawText(line, { x, y: currentY, size, font, color });
    currentY -= lineHeight;
  }
  return { page: currentPage, y: currentY };
}

function wrapText(font: PDFFont, text: string, maxWidth: number, size: number): string[] {
  const output: string[] = [];
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line) { output.push(''); continue; }
    const words = line.split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else if (current) {
        output.push(current);
        current = word;
      } else {
        output.push(word.slice(0, 90));
        current = word.slice(90);
      }
    }
    if (current) output.push(current);
  }
  return output;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function numberValue(value: unknown): number { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function shortHash(value: string, length: number) { return value.replace(/[^0-9a-f]/gi, '').slice(0, length); }
function roleLabel(value: string) { return value === 'owner' ? 'Business Owner' : value === 'manager' ? 'Authorised Manager' : value; }
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(date);
}
function money(value: number, currency: string) {
  try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}
