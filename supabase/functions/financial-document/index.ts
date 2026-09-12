import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Server configuration error' }, 500);

  const auth = req.headers.get('authorization') || '';
  if (!constantTimeEqual(auth, 'Bearer ' + SERVICE_KEY)) return json({ error: 'Unauthorized' }, 401);

  let body: J;
  try { body = await req.json() as J; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const documentId = uuid(body.documentId);
  if (!documentId) return json({ error: 'documentId is required' }, 400);

  try {
    const document = await loadDocument(documentId);
    if (!document) return json({ error: 'Financial document not found' }, 404);
    if (document.status !== 'issued') return json({ error: 'Voided financial document cannot be rendered' }, 409);

    const version = Math.max(1, Number(document.pdf_version) || 1);
    const filename = financialFilename(document.document_type, document.document_reference);
    const storagePath =
      String(document.tenant_id) + '/' +
      safePath(String(document.public_order_id)) + '/financial/' +
      safePath(String(document.document_reference)) + '-v' + version + '.pdf';

    if (document.pdf_storage_path === storagePath && document.pdf_generated_at) {
      return json({
        documentId,
        documentReference: document.document_reference,
        documentType: document.document_type,
        storageBucket: 'receipts',
        storagePath,
        filename,
        mimeType: 'application/pdf',
        cached: true,
      });
    }

    const pdf = await buildPdf(document);
    if (pdf.byteLength > 2097152) throw new Error('Generated financial document exceeds the 2 MB limit');

    await upload(storagePath, pdf);
    const generatedAt = new Date().toISOString();
    await rest(
      '/rest/v1/order_financial_documents?id=eq.' + encodeURIComponent(documentId),
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          pdf_storage_path: storagePath,
          pdf_generated_at: generatedAt,
          updated_at: generatedAt,
        }),
      },
    );

    return json({
      documentId,
      documentReference: document.document_reference,
      documentType: document.document_type,
      storageBucket: 'receipts',
      storagePath,
      filename,
      mimeType: 'application/pdf',
      cached: false,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? sanitize(error.message) : 'Financial document rendering failed';
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'financial-document',
      event: 'render_failed',
      document_id: documentId,
      error: message,
    }));
    return json({ error: message }, 400);
  }
});

async function loadDocument(id: string): Promise<J | null> {
  const documents = await rest<J[]>(
    '/rest/v1/order_financial_documents?select=' +
    'id,tenant_id,order_id,document_type,document_reference,currency,amount,status,payment_id,issued_at,pdf_storage_path,pdf_generated_at,pdf_version' +
    '&id=eq.' + encodeURIComponent(id) + '&limit=1',
  );
  const row = documents[0];
  if (!row) return null;

  const tenantId = String(row.tenant_id || '');
  const orderId = String(row.order_id || '');
  const paymentId = typeof row.payment_id === 'string' ? row.payment_id : null;

  const orders = await rest<J[]>(
    '/rest/v1/orders?select=id,public_order_id,created_at,customer_id,' +
    'order_items(item_name,quantity,unit_price,line_total)' +
    '&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&id=eq.' + encodeURIComponent(orderId) + '&limit=1',
  );
  const order = orders[0] || null;
  if (!order) throw new Error('Financial document order was not found');

  const tenants = await rest<J[]>(
    '/rest/v1/tenants?select=name,business_email,business_phone' +
    '&id=eq.' + encodeURIComponent(tenantId) + '&limit=1',
  );
  const tenant = tenants[0] || {};

  const customerId = typeof order.customer_id === 'string' ? order.customer_id : '';
  const customers = customerId
    ? await rest<J[]>(
        '/rest/v1/customers?select=display_name,phone,wa_id' +
        '&tenant_id=eq.' + encodeURIComponent(tenantId) +
        '&id=eq.' + encodeURIComponent(customerId) + '&limit=1',
      )
    : [];
  const customer = customers[0] || {};

  const payments = paymentId
    ? await rest<J[]>(
        '/rest/v1/order_payments?select=method_type,provider,provider_reference,provider_transaction_id,confirmed_at,confirmation_source' +
        '&tenant_id=eq.' + encodeURIComponent(tenantId) +
        '&id=eq.' + encodeURIComponent(paymentId) + '&limit=1',
      )
    : [];
  const payment = payments[0] || {};

  return {
    ...row,
    public_order_id: order.public_order_id || '',
    order_created_at: order.created_at || null,
    order_items: Array.isArray(order.order_items) ? order.order_items : [],
    business_name: tenant.name || 'SellerTray merchant',
    business_email: tenant.business_email || null,
    business_phone: tenant.business_phone || null,
    customer_name: customer.display_name || customer.phone || customer.wa_id || 'Customer',
    customer_phone: customer.phone || customer.wa_id || null,
    payment_method_type: payment.method_type || null,
    payment_provider: payment.provider || null,
    payment_reference: payment.provider_reference || null,
    provider_transaction_id: payment.provider_transaction_id || null,
    payment_confirmed_at: payment.confirmed_at || null,
    confirmation_source: payment.confirmation_source || null,
  };
}

async function buildPdf(document: J): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const dark = rgb(16 / 255, 24 / 255, 40 / 255);
  const muted = rgb(102 / 255, 112 / 255, 133 / 255);
  const blue = rgb(36 / 255, 107 / 255, 253 / 255);
  const green = rgb(2 / 255, 122 / 255, 72 / 255);
  const line = rgb(234 / 255, 236 / 255, 240 / 255);
  const width = page.getWidth();
  const margin = 44;
  let y = page.getHeight() - 48;

  const draw = (value: unknown, x: number, size = 10, font = regular, color = dark) => {
    page.drawText(pdfText(String(value ?? '')), { x, y, size, font, color });
  };
  const down = (amount = 16) => { y -= amount; };
  const money = formatMoney(Number(document.amount) || 0, String(document.currency || 'NGN'));
  const isReceipt = document.document_type === 'receipt';
  const title = isReceipt ? 'PAYMENT RECEIPT' : 'INVOICE';

  page.drawRectangle({ x: 0, y: page.getHeight() - 10, width, height: 10, color: blue });

  draw(document.business_name, margin, 20, bold, dark);
  down(25);
  draw(title, margin, 11, bold, blue);
  down(18);
  draw('SellerTray', margin, 9, bold, green);

  page.drawText('Document Ref', { x: 350, y: page.getHeight() - 52, size: 8, font: bold, color: muted });
  page.drawText(pdfText(String(document.document_reference)), { x: 350, y: page.getHeight() - 68, size: 10, font: bold, color: dark });
  page.drawText('Order Ref', { x: 350, y: page.getHeight() - 88, size: 8, font: bold, color: muted });
  page.drawText(pdfText(String(document.public_order_id)), { x: 350, y: page.getHeight() - 104, size: 10, font: bold, color: dark });

  y = page.getHeight() - 145;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: line });
  down(22);

  draw('CUSTOMER', margin, 8, bold, muted);
  down(15);
  draw(document.customer_name, margin, 11, bold, dark);
  down(15);
  if (document.customer_phone) { draw(document.customer_phone, margin, 9, regular, muted); down(15); }

  down(10);
  draw(isReceipt ? 'PAYMENT DETAILS' : 'BILLING DETAILS', margin, 8, bold, muted);
  down(16);
  draw((isReceipt ? 'Paid: ' : 'Issued: ') + formatDate(document.payment_confirmed_at || document.issued_at), margin, 9, regular, dark);
  down(14);
  if (isReceipt && document.payment_method_type) {
    draw('Method: ' + humanMethod(String(document.payment_method_type)), margin, 9, regular, dark);
    down(14);
  }
  if (isReceipt && document.payment_reference) {
    draw('Payment Ref: ' + String(document.payment_reference), margin, 9, regular, dark);
    down(14);
  }

  down(14);
  draw('ITEMS', margin, 8, bold, muted);
  down(18);

  const columns = { item: margin, qty: 330, unit: 380, amount: 470 };
  page.drawText('Description', { x: columns.item, y, size: 8, font: bold, color: muted });
  page.drawText('Qty', { x: columns.qty, y, size: 8, font: bold, color: muted });
  page.drawText('Unit', { x: columns.unit, y, size: 8, font: bold, color: muted });
  page.drawText('Amount', { x: columns.amount, y, size: 8, font: bold, color: muted });
  down(10);
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.8, color: line });
  down(18);

  const items = Array.isArray(document.order_items) ? document.order_items : [];
  for (const rawItem of items.slice(0, 40)) {
    const item = isRecord(rawItem) ? rawItem : {};
    const qty = Number(item.quantity) || 0;
    const unit = Number(item.unit_price);
    const lineTotal = Number(item.line_total);
    page.drawText(pdfText(String(item.item_name || 'Item')).slice(0, 48), {
      x: columns.item, y, size: 9, font: regular, color: dark,
    });
    page.drawText(String(qty), { x: columns.qty, y, size: 9, font: regular, color: dark });
    page.drawText(Number.isFinite(unit) ? formatMoney(unit, String(document.currency)) : '-', {
      x: columns.unit, y, size: 8, font: regular, color: dark,
    });
    page.drawText(formatMoney(Number.isFinite(lineTotal) ? lineTotal : 0, String(document.currency)), {
      x: columns.amount, y, size: 8, font: bold, color: dark,
    });
    down(22);
    if (y < 190) break;
  }

  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: line });
  down(24);
  page.drawText(isReceipt ? 'AMOUNT PAID' : 'AMOUNT DUE', { x: 350, y, size: 10, font: bold, color: dark });
  page.drawText(money, { x: 448, y, size: 11, font: bold, color: blue });
  down(34);

  if (isReceipt) {
    draw('Payment confirmed. This document is SellerTray proof of payment.', margin, 9, bold, green);
  } else {
    draw('This invoice shows an amount due and is not proof of payment.', margin, 9, bold, dark);
  }

  down(18);
  if (document.business_email) { draw('Email: ' + String(document.business_email), margin, 8, regular, muted); down(12); }
  if (document.business_phone) { draw('Phone: ' + String(document.business_phone), margin, 8, regular, muted); down(12); }

  page.drawLine({ start: { x: margin, y: 38 }, end: { x: width - margin, y: 38 }, thickness: 0.5, color: line });
  page.drawText('Generated by SellerTray - ProcessEdge Solutions Limited', {
    x: margin, y: 26, size: 7, font: regular, color: muted,
  });

  return await pdf.save();
}

async function upload(path: string, pdf: Uint8Array): Promise<void> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/receipts/' + encoded, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/pdf',
      'cache-control': '3600',
      'x-upsert': 'true',
    },
    body: pdf,
  });
  if (!r.ok) throw new Error('Financial document upload failed with HTTP ' + r.status);
}

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(SUPABASE_URL + path, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error('SellerTray data request failed with HTTP ' + r.status + ': ' + (await r.text()).slice(0, 240));
  const raw = await r.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

function one(value: unknown): J | null {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : null;
  return isRecord(value) ? value : null;
}
function isRecord(v: unknown): v is J { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function uuid(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const x = v.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x) ? x : null;
}
function safePath(v: string): string { return v.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document'; }
function financialFilename(type: unknown, ref: unknown): string {
  return (type === 'receipt' ? 'Payment-Receipt-' : 'Invoice-') + safePath(String(ref)) + '.pdf';
}
function pdfText(v: string): string {
  return v.replace(/₦/g, 'NGN ').replace(/×/g, 'x').replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").normalize('NFKD').replace(/[^ -~ -ÿ]/g, '?');
}
function formatMoney(value: number, currency: string): string {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : 'NGN';
  return safe + ' ' + new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function formatDate(v: unknown): string {
  if (typeof v !== 'string') return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }).format(d);
}
function humanMethod(v: string): string {
  return ({
    bank_transfer: 'Bank transfer',
    paystack: 'Paystack',
    flutterwave: 'Flutterwave',
    cash_on_delivery: 'Cash on delivery',
    pay_on_pickup: 'Pay on pickup',
  } as Record<string, string>)[v] || v.replace(/_/g, ' ');
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i += 1) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function sanitize(v: string): string { return v.replace(/\s+/g, ' ').slice(0, 300); }
function json(payload: J, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
