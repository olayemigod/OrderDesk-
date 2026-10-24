import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type PrinterAction = 'save_printer' | 'request_print' | 'request_business_document_print' | 'update_print';
type BusinessDocumentType = 'sales_invoice' | 'payment_receipt';
type SupabaseClient = ReturnType<typeof createClient>;
type PrintJobRow = {
  id: string;
  printer_id: string;
  job_type: 'receipt' | 'test';
  order_id: string | null;
  financial_document_id: string | null;
  status: 'requested' | 'printing' | 'printed' | 'failed';
  transport: 'bluetooth';
  printer_name: string;
  hardware_identifier: string;
  paper_width_mm: 58 | 80;
  content_snapshot: unknown;
  requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 16_384;
const MONEY_EPSILON = 0.005;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  : null;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!admin) return json({ error: 'Server configuration error' }, 500);

  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json({ error: 'Authentication required' }, 401);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const userId = authData.user?.id ?? null;
  if (authError || !userId) return json({ error: 'Authentication required' }, 401);

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try {
    body = JSON.parse(bodyRead.text) as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = cleanAction(body.action);
  const tenantId = cleanUuid(body.tenantId);
  if (!action || !tenantId) return json({ error: 'Business and printer action are required' }, 400);

  const { data: membership, error: membershipError } = await admin
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) return json({ error: membershipError.message }, 400);
  if (!membership) return json({ error: 'You do not have access to this business' }, 403);

  if (action === 'request_business_document_print') {
    return requestBusinessDocumentPrint(admin, body, tenantId, userId);
  }

  let rpcName: string;
  let rpcArgs: JsonRecord;

  if (action === 'save_printer') {
    const printerId = body.printerId === null || body.printerId === undefined ? null : cleanUuid(body.printerId);
    const branchId = cleanUuid(body.branchId);
    const registerId = cleanUuid(body.registerId);
    const displayName = cleanText(body.displayName, 120);
    const hardwareIdentifier = cleanText(body.hardwareIdentifier, 160);
    const paperWidthMm = body.paperWidthMm === 58 || body.paperWidthMm === 80 ? body.paperWidthMm : null;
    const isDefault = typeof body.isDefault === 'boolean' ? body.isDefault : null;
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : null;
    if ((body.printerId !== null && body.printerId !== undefined && !printerId)
        || !branchId || !registerId || !displayName || !hardwareIdentifier
        || !paperWidthMm || isDefault === null || isActive === null) {
      return json({ error: 'Branch, register, printer name, Bluetooth identity and paper width are required' }, 400);
    }
    rpcName = 'save_sellertray_printer';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_printer_id: printerId,
      p_branch_id: branchId,
      p_register_id: registerId,
      p_display_name: displayName,
      p_hardware_identifier: hardwareIdentifier,
      p_paper_width_mm: paperWidthMm,
      p_is_default: isDefault,
      p_is_active: isActive,
      p_actor_user_id: userId,
    };
  } else if (action === 'request_print') {
    const printerId = cleanUuid(body.printerId);
    const jobType = body.jobType === 'receipt' || body.jobType === 'test' ? body.jobType : null;
    const orderId = body.orderId === null || body.orderId === undefined ? null : cleanUuid(body.orderId);
    const requestKey = cleanText(body.requestKey, 128);
    if (!printerId || !jobType || !requestKey
        || (jobType === 'receipt' && !orderId)
        || (jobType === 'test' && orderId !== null)) {
      return json({ error: 'Printer, print type and request key are required' }, 400);
    }
    rpcName = 'request_sellertray_print_job';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_printer_id: printerId,
      p_job_type: jobType,
      p_order_id: orderId,
      p_request_key: requestKey,
      p_actor_user_id: userId,
    };
  } else {
    const jobId = cleanUuid(body.jobId);
    const status = body.status === 'printing' || body.status === 'printed' || body.status === 'failed'
      ? body.status
      : null;
    const failureCode = cleanText(body.failureCode, 80);
    const failureMessage = cleanText(body.failureMessage, 500);
    if (!jobId || !status || (status === 'failed' && !failureMessage)) {
      return json({ error: 'Print job and valid print status are required' }, 400);
    }
    rpcName = 'transition_sellertray_print_job';
    rpcArgs = {
      p_tenant_id: tenantId,
      p_job_id: jobId,
      p_status: status,
      p_failure_code: status === 'failed' ? failureCode : null,
      p_failure_message: status === 'failed' ? failureMessage : null,
      p_actor_user_id: userId,
    };
  }

  const { data: result, error } = await admin.rpc(rpcName, rpcArgs);
  if (error || !result || typeof result !== 'object') {
    const message = error?.message ?? 'SellerTray could not complete this printer action';
    return json({ error: message }, printerErrorStatus(message));
  }
  return json({ ok: true, action, ...result });
});

async function requestBusinessDocumentPrint(
  adminClient: SupabaseClient,
  body: JsonRecord,
  tenantId: string,
  userId: string,
): Promise<Response> {
  const printerId = cleanUuid(body.printerId);
  const orderId = cleanUuid(body.orderId);
  const documentType = cleanBusinessDocumentType(body.documentType);
  const paymentId = body.paymentId === null || body.paymentId === undefined ? null : cleanUuid(body.paymentId);
  const requestKey = cleanText(body.requestKey, 128);
  if (!printerId || !orderId || !documentType || !requestKey
      || (documentType === 'payment_receipt' && !paymentId)
      || (documentType === 'sales_invoice' && paymentId !== null)) {
    return json({ error: 'Printer, order, business document and request key are required' }, 400);
  }

  const { data: printer, error: printerError } = await adminClient
    .from('sellertray_printers')
    .select('id,branch_id,register_id,display_name,transport,hardware_identifier,paper_width_mm,is_active')
    .eq('tenant_id', tenantId)
    .eq('id', printerId)
    .maybeSingle();
  if (printerError) return json({ error: printerError.message }, 400);
  if (!printer || printer.is_active !== true || printer.transport !== 'bluetooth') {
    return json({ error: 'Selected printer is unavailable' }, 409);
  }

  const [branchAuthority, printAuthority] = await Promise.all([
    adminClient.rpc('sellertray_user_can_operate_branch', {
      p_tenant_id: tenantId,
      p_branch_id: printer.branch_id,
      p_user_id: userId,
    }),
    adminClient.rpc('sellertray_user_has_capability', {
      p_tenant_id: tenantId,
      p_user_id: userId,
      p_capability: 'can_print_receipt',
    }),
  ]);
  if (branchAuthority.error) return json({ error: branchAuthority.error.message }, 403);
  if (printAuthority.error) return json({ error: printAuthority.error.message }, 403);
  if (branchAuthority.data !== true || printAuthority.data !== true) {
    return json({ error: 'You do not have permission to print in this branch' }, 403);
  }

  const existing = await loadPrintJobByRequestKey(adminClient, tenantId, requestKey);
  if (existing.error) return json({ error: existing.error }, 400);
  if (existing.job) {
    const snapshot = objectOrNull(existing.job.content_snapshot);
    const matches = existing.job.printer_id === printerId
      && existing.job.order_id === orderId
      && existing.job.job_type === 'receipt'
      && snapshot?.documentType === documentType
      && (documentType !== 'payment_receipt' || snapshot?.paymentId === paymentId);
    if (!matches) return json({ error: 'This print request key is already used for different facts' }, 409);
    return json({ ok: true, action: 'request_business_document_print', ...printJobState(existing.job, true) });
  }

  const { data: order, error: orderError } = await adminClient
    .from('orders')
    .select('id,branch_id,branch_name_snapshot,pos_operator_name,public_order_id,status,fulfillment_status,payment_status,pos_payment_terms,total_amount,subtotal_amount,tax_applied,tax_rate_percent,tax_amount,tax_display_breakdown,gross_amount,currency,customer_id,source')
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) return json({ error: orderError.message }, 400);
  if (!order) return json({ error: 'Order not found' }, 404);
  if (order.branch_id !== printer.branch_id) return json({ error: 'Sale document and printer must belong to the same branch' }, 409);
  if (order.source !== 'pos') return json({ error: 'This Mobile print path is only available for POS sales' }, 409);
  if (order.status !== 'completed') return json({ error: 'Only a completed POS sale can produce this sale document' }, 409);

  const [invoiceResult, businessResult, itemsResult] = await Promise.all([
    adminClient
      .from('order_financial_documents')
      .select('id,document_reference,currency,amount,status,issued_at')
      .eq('tenant_id', tenantId)
      .eq('order_id', orderId)
      .eq('document_type', 'invoice')
      .eq('status', 'issued')
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient.from('tenants').select('name,business_email,business_phone').eq('id', tenantId).maybeSingle(),
    adminClient
      .from('order_items')
      .select('id,item_name,quantity,selected_uom,unit_price,line_total,created_at')
      .eq('tenant_id', tenantId)
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ]);
  if (invoiceResult.error) return json({ error: invoiceResult.error.message }, 400);
  if (businessResult.error) return json({ error: businessResult.error.message }, 400);
  if (itemsResult.error) return json({ error: itemsResult.error.message }, 400);
  const invoice = invoiceResult.data;
  const business = businessResult.data;
  const itemRows = itemsResult.data;
  if (!invoice) return json({ error: 'This sale does not have an issued Sales Invoice' }, 409);
  if (!business) return json({ error: 'Business print identity is unavailable' }, 409);
  if (!itemRows?.length) return json({ error: 'This Sales Invoice has no historical sale lines' }, 409);

  const invoiceAmount = money(invoice.amount);
  const governedGrossAmount = money(order.gross_amount ?? order.total_amount);
  if (Math.abs(invoiceAmount - governedGrossAmount) > 0.01) {
    return json({ error: 'The issued Sales Invoice total does not match the governed sale total' }, 409);
  }

  let customerName = 'Walk-in Customer';
  let customerPhone: string | null = null;
  if (order.customer_id) {
    const { data: customer, error: customerError } = await adminClient
      .from('customers')
      .select('display_name,phone,wa_id')
      .eq('tenant_id', tenantId)
      .eq('id', order.customer_id)
      .maybeSingle();
    if (customerError) return json({ error: customerError.message }, 400);
    if (customer) {
      customerName = cleanText(customer.display_name, 160)
        ?? cleanText(customer.phone, 80)
        ?? cleanText(customer.wa_id, 80)
        ?? customerName;
      customerPhone = cleanText(customer.phone, 80) ?? cleanText(customer.wa_id, 80);
    }
  }

  const items = itemRows.map((item) => ({
    name: String(item.item_name ?? 'Item'),
    quantity: numberValue(item.quantity),
    uom: String(item.selected_uom ?? 'Each'),
    unitPrice: money(item.unit_price),
    lineTotal: money(item.line_total),
  }));
  const itemSubtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const subtotalAmount = order.subtotal_amount === null || order.subtotal_amount === undefined
    ? itemSubtotal
    : money(order.subtotal_amount);
  const taxAmount = order.tax_amount === null || order.tax_amount === undefined
    ? roundMoney(Math.max(governedGrossAmount - subtotalAmount, 0))
    : money(order.tax_amount);
  const taxApplied = typeof order.tax_applied === 'boolean' ? order.tax_applied : taxAmount > MONEY_EPSILON;
  const taxRatePercent = order.tax_rate_percent === null || order.tax_rate_percent === undefined
    ? (subtotalAmount > MONEY_EPSILON ? roundNumber((taxAmount / subtotalAmount) * 100, 4) : 0)
    : numberValue(order.tax_rate_percent);
  const taxDisplayBreakdown = typeof order.tax_display_breakdown === 'boolean'
    ? order.tax_display_breakdown
    : taxApplied;
  if (Math.abs(subtotalAmount + taxAmount - governedGrossAmount) > 0.01) {
    return json({ error: 'The stored tax snapshot does not reconcile to the governed sale total' }, 409);
  }

  const branchName = cleanText(order.branch_name_snapshot, 160) ?? 'Branch';
  const cashierName = cleanText(order.pos_operator_name, 160);
  const fulfillmentLabel = titleCase(String(order.fulfillment_status ?? 'pending'));

  let snapshot: JsonRecord;
  if (documentType === 'sales_invoice') {
    snapshot = {
      formatVersion: 1,
      documentType: 'sales_invoice',
      businessName: String(business.name ?? 'SellerTray Business'),
      businessEmail: cleanText(business.business_email, 200),
      businessPhone: cleanText(business.business_phone, 80),
      branchName,
      cashierName,
      orderReference: String(order.public_order_id ?? order.id),
      invoiceReference: String(invoice.document_reference),
      issuedAt: String(invoice.issued_at),
      customerName,
      customerPhone,
      currency: String(invoice.currency ?? order.currency ?? 'NGN'),
      subtotalAmount,
      taxApplied,
      taxRatePercent,
      taxAmount,
      taxDisplayBreakdown,
      grossAmount: governedGrossAmount,
      paymentLabel: originalInvoicePaymentLabel(String(order.pos_payment_terms ?? ''), String(order.payment_status ?? 'unpaid')),
      fulfillmentLabel,
      items,
      platformAttribution: 'Powered by SellerTray',
    };
  } else {
    const { data: payment, error: paymentError } = await adminClient
      .from('order_payments')
      .select('id,method_type,provider,status,exception_state,amount,currency,provider_reference,provider_transaction_id,confirmed_at,created_at')
      .eq('tenant_id', tenantId)
      .eq('order_id', orderId)
      .eq('id', paymentId)
      .maybeSingle();
    if (paymentError) return json({ error: paymentError.message }, 400);
    if (!payment || payment.status !== 'confirmed' || payment.exception_state !== 'none') {
      return json({ error: 'Only a confirmed payment can produce a Payment Receipt' }, 409);
    }
    snapshot = {
      formatVersion: 1,
      documentType: 'payment_receipt',
      businessName: String(business.name ?? 'SellerTray Business'),
      businessEmail: cleanText(business.business_email, 200),
      businessPhone: cleanText(business.business_phone, 80),
      branchName,
      cashierName,
      orderReference: String(order.public_order_id ?? order.id),
      paymentId: String(payment.id),
      paymentReference: cleanText(payment.provider_reference, 200) ?? cleanText(payment.provider_transaction_id, 200),
      issuedAt: String(payment.confirmed_at ?? payment.created_at),
      customerName,
      customerPhone,
      currency: String(payment.currency ?? invoice.currency ?? order.currency ?? 'NGN'),
      amountReceived: money(payment.amount),
      paymentMethod: String(payment.method_type ?? 'payment'),
      paymentProvider: String(payment.provider ?? payment.method_type ?? 'payment'),
      paymentLabel: 'Confirmed',
      fulfillmentLabel,
      platformAttribution: 'Powered by SellerTray',
    };
  }

  const { data: inserted, error: insertError } = await adminClient
    .from('sellertray_print_jobs')
    .insert({
      tenant_id: tenantId,
      branch_id: printer.branch_id,
      register_id: printer.register_id,
      printer_id: printer.id,
      // The live schema retains the legacy receipt/test audit class. The immutable
      // content snapshot carries the real business identity: Sales Invoice or Payment Receipt.
      job_type: 'receipt',
      order_id: orderId,
      financial_document_id: invoice.id,
      request_key: requestKey,
      status: 'requested',
      transport: 'bluetooth',
      printer_name: printer.display_name,
      hardware_identifier: printer.hardware_identifier,
      paper_width_mm: printer.paper_width_mm,
      content_snapshot: snapshot,
      requested_by_user_id: userId,
      requested_at: new Date().toISOString(),
    })
    .select('id,printer_id,job_type,order_id,financial_document_id,status,transport,printer_name,hardware_identifier,paper_width_mm,content_snapshot,requested_at,started_at,completed_at,failed_at,failure_code,failure_message')
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === '23505') {
      const raced = await loadPrintJobByRequestKey(adminClient, tenantId, requestKey);
      if (!raced.error && raced.job && printRequestMatches(raced.job, printerId, orderId, documentType, paymentId)) {
        return json({ ok: true, action: 'request_business_document_print', ...printJobState(raced.job, true) });
      }
    }
    return json({ error: insertError?.message ?? 'SellerTray could not create this print attempt' }, 400);
  }

  return json({
    ok: true,
    action: 'request_business_document_print',
    ...printJobState(inserted as unknown as PrintJobRow, false),
  });
}

function printRequestMatches(
  job: PrintJobRow,
  printerId: string,
  orderId: string,
  documentType: BusinessDocumentType,
  paymentId: string | null,
): boolean {
  const snapshot = objectOrNull(job.content_snapshot);
  return job.printer_id === printerId
    && job.order_id === orderId
    && job.job_type === 'receipt'
    && snapshot?.documentType === documentType
    && (documentType !== 'payment_receipt' || snapshot?.paymentId === paymentId);
}

async function loadPrintJobByRequestKey(
  adminClient: SupabaseClient,
  tenantId: string,
  requestKey: string,
): Promise<{ job: PrintJobRow | null; error: string | null }> {
  const { data, error } = await adminClient
    .from('sellertray_print_jobs')
    .select('id,printer_id,job_type,order_id,financial_document_id,status,transport,printer_name,hardware_identifier,paper_width_mm,content_snapshot,requested_at,started_at,completed_at,failed_at,failure_code,failure_message')
    .eq('tenant_id', tenantId)
    .eq('request_key', requestKey)
    .maybeSingle();
  return { job: data as unknown as PrintJobRow | null, error: error?.message ?? null };
}

function printJobState(row: PrintJobRow, idempotentReplay: boolean): JsonRecord {
  return {
    jobId: row.id,
    status: row.status,
    jobType: row.job_type,
    orderId: row.order_id,
    financialDocumentId: row.financial_document_id,
    printerId: row.printer_id,
    printerName: row.printer_name,
    transport: row.transport,
    hardwareIdentifier: row.hardware_identifier,
    paperWidthMm: row.paper_width_mm,
    contentSnapshot: row.content_snapshot,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    idempotentReplay,
  };
}

function cleanAction(value: unknown): PrinterAction | null {
  return value === 'save_printer'
    || value === 'request_print'
    || value === 'request_business_document_print'
    || value === 'update_print'
    ? value
    : null;
}

function cleanBusinessDocumentType(value: unknown): BusinessDocumentType | null {
  return value === 'sales_invoice' || value === 'payment_receipt' ? value : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, max) : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function money(value: unknown): number {
  return roundMoney(numberValue(value));
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundNumber(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, ' ').split(' ').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function originalInvoicePaymentLabel(paymentTerms: string, paymentStatus: string): string {
  if (paymentTerms === 'partial') return 'Partial';
  if (paymentTerms === 'pay_later') return 'Pay later';
  return paymentStatusLabel(paymentStatus);
}

function paymentStatusLabel(paymentStatus: string): string {
  return titleCase(paymentStatus || 'unpaid');
}

function printerErrorStatus(message: string): number {
  return /permission|access|role|read-only|authentication/i.test(message)
    ? 403
    : /not found/i.test(message)
      ? 404
      : /already|different facts|unavailable|issued payment receipt|same branch|immutable|must start/i.test(message)
        ? 409
        : 400;
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
}

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
