type J = Record<string, unknown>;

type PaymentMethod = {
  id: string;
  method_type: 'bank_transfer' | 'paystack' | 'flutterwave' | 'cash_on_delivery' | 'pay_on_pickup';
  display_name: string;
  is_default: boolean;
  sort_order: number;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  instructions: string | null;
};

type PaymentAttempt = {
  id: string;
  method_type: string;
  provider: string;
  status: string;
  amount: number | string;
  currency: string;
  checkout_url: string | null;
  provider_reference: string | null;
  created_at: string;
};

type OrderRow = {
  id: string;
  customer_id: string;
  public_order_id: string;
  status: string;
  payment_status: string;
};

type Command =
  | { kind: 'list' }
  | { kind: 'select'; token: string }
  | { kind: 'claim' }
  | { kind: 'status' }
  | { kind: 'invoice' }
  | { kind: 'financial_receipt' };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export async function handleCustomerPaymentSelfService(input: {
  tenantId: string;
  businessName: string;
  customerId: string;
  customerWaId: string;
  sourceMessageId: string;
  fromPhoneNumberId: string;
  text: string;
}): Promise<boolean> {
  const command = detectCommand(input.text);
  if (!command) return false;

  const orderRef = extractOrderRef(input.text);
  if (!orderRef) return false;

  const customerIds = await resolveCustomerIds(input.tenantId, input.customerId, input.customerWaId);
  const order = await findOrder(input.tenantId, customerIds, orderRef);
  if (!order) {
    console.info(JSON.stringify({
      event: 'customer_payment_self_service_no_order',
      tenantId: input.tenantId,
      orderRef,
      kind: command.kind,
    }));
    return true;
  }

  if (command.kind === 'list') {
    await sendOptions(input, order);
    return true;
  }
  if (command.kind === 'select') {
    await selectMethod(input, order, command.token);
    return true;
  }
  if (command.kind === 'claim') {
    await recordPaidClaim(input, order);
    return true;
  }
  if (command.kind === 'status') {
    await sendStatus(input, order);
    return true;
  }
  if (command.kind === 'invoice') {
    await sendInvoiceDocument(input, order);
    return true;
  }

  await sendFinancialReceiptReference(input, order);
  return true;
}

function detectCommand(value: string): Command | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!extractOrderRef(normalized)) return null;

  if (/^(?:payment\s+receipt|receipt\s+for\s+payment)\b/i.test(normalized)) {
    return { kind: 'financial_receipt' };
  }
  if (/^invoice\b/i.test(normalized)) return { kind: 'invoice' };
  if (
    /^payment\s+status\b/i.test(normalized) ||
    /\b(?:has|did)\s+(?:my\s+)?payment\s+(?:go\s+through|reflect|enter|arrive)\b/i.test(normalized)
  ) {
    return { kind: 'status' };
  }

  if (
    /^(?:paid|i\s+have\s+paid|i['’]?ve\s+paid|payment\s+made|payment\s+done|transfer\s+done|transferred|i\s+transferred|i\s+sent\s+(?:the\s+)?money)\b/i.test(normalized)
  ) {
    return { kind: 'claim' };
  }

  const select = normalized.match(/^pay\s+[A-Z0-9]{3}\/[0-9]{6,}\s+(.+)$/i);
  if (select && select[1]) return { kind: 'select', token: select[1].trim().toUpperCase() };

  if (
    /^pay\s+[A-Z0-9]{3}\/[0-9]{6,}$/i.test(normalized) ||
    /^payment\s+[A-Z0-9]{3}\/[0-9]{6,}$/i.test(normalized) ||
    /\b(?:payment\s+(?:options?|details?|methods?)|bank\s+details)\b/i.test(normalized) ||
    /\b(?:how|where)\s+(?:do|can)\s+i\s+pay\b/i.test(normalized) ||
    /\bi\s+(?:want|need|would\s+like)\s+to\s+pay\b/i.test(normalized) ||
    /\bsend\s+(?:me\s+)?(?:payment|bank)\s+(?:details?|options?)\b/i.test(normalized)
  ) {
    return { kind: 'list' };
  }
  return null;
}

function extractOrderRef(value: string): string | null {
  const match = value.match(/\b[A-Z0-9]{3}\/[0-9]{6,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

async function resolveCustomerIds(tenantId: string, customerId: string, waId: string): Promise<string[]> {
  const rows = await rest<Array<{ id: string }>>(
    '/rest/v1/customers?select=id&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&or=(wa_id.eq.' + encodeURIComponent(waId) +
    ',phone.eq.' + encodeURIComponent(waId) +
    ',phone.eq.' + encodeURIComponent('+' + waId) +
    ',wa_id.eq.' + encodeURIComponent('manual:' + waId) +
    ',wa_id.eq.' + encodeURIComponent('manual:+' + waId) + ')' +
    '&limit=20',
  );
  return Array.from(new Set([customerId].concat(rows.map((row) => row.id))));
}

async function findOrder(tenantId: string, customerIds: string[], orderRef: string): Promise<OrderRow | null> {
  if (customerIds.length === 0) return null;
  const rows = await rest<OrderRow[]>(
    '/rest/v1/orders?select=id,customer_id,public_order_id,status,payment_status' +
    '&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&customer_id=in.(' + customerIds.join(',') + ')' +
    '&public_order_id=eq.' + encodeURIComponent(orderRef) +
    '&limit=1',
  );
  return rows[0] || null;
}

async function sendOptions(input: HandlerInput, order: OrderRow): Promise<void> {
  const financial = await financialSnapshot(input.tenantId, order.id);
  if (!financial.invoice) {
    await queueReply(input, order, 'payment_options',
      'Order ' + order.public_order_id + ' is not ready for payment yet. Payment options become available after the merchant accepts the order.');
    return;
  }

  if (financial.paymentStatus === 'paid') {
    await queueReply(
      input,
      order,
      'payment_options',
      'Order ' + order.public_order_id + ' is already paid. Financial Receipt: ' +
      (financial.receipt ? financial.receipt.document_reference : 'available') +
      '. Reply "PAYMENT RECEIPT ' + order.public_order_id + '" for the payment receipt reference.',
    );
    return;
  }

  const methods = await loadMethods(input.tenantId);
  if (methods.length === 0) {
    await queueReply(input, order, 'payment_options',
      'No customer payment method is currently enabled for ' + input.businessName + '. Please contact the merchant.');
    return;
  }

  const lines = [
    'Payment options — ' + input.businessName,
    'Order Ref: ' + order.public_order_id,
    'Invoice: ' + financial.invoice.document_reference,
    'Total: ' + formatMoney(Number(financial.invoice.amount) || 0, financial.invoice.currency),
    '',
  ];

  let bankNo = 0;
  for (const method of methods) {
    if (method.method_type === 'bank_transfer') bankNo += 1;
    lines.push(methodToken(method, bankNo) + ' — ' + method.display_name + (method.is_default ? ' · default' : ''));
  }
  lines.push('');
  lines.push('Reply with the option you prefer, for example "' + methods[0].display_name +
    '". You can also ask naturally, such as "send account details" or "cash on delivery".');

  await queueReply(input, order, 'payment_options', lines.join('\n'));
}

async function selectMethod(input: HandlerInput, order: OrderRow, token: string): Promise<void> {
  const financial = await financialSnapshot(input.tenantId, order.id);
  if (!financial.invoice || financial.paymentStatus === 'paid') {
    await sendOptions(input, order);
    return;
  }

  const methods = await loadMethods(input.tenantId);
  const method = resolveMethod(methods, token);
  if (!method) {
    await queueReply(input, order, 'payment_instructions',
      'I could not match "' + token + '" to an enabled payment method. Reply "PAY ' +
      order.public_order_id + '" to see the current options.');
    return;
  }

  const reference =
    method.method_type === 'paystack' || method.method_type === 'flutterwave'
      ? paymentReference(order.public_order_id)
      : null;

  const paymentId = await rpc<string>('create_sellertray_order_payment_for_method', {
    p_tenant_id: input.tenantId,
    p_order_id: order.id,
    p_payment_method_id: method.id,
    p_status: 'initiated',
    p_provider_reference: reference,
    p_idempotency_key: 'wa:' + input.sourceMessageId,
    p_customer_claimed_at: null,
  });

  if (method.method_type === 'bank_transfer') {
    const lines = [
      input.businessName + ' bank transfer',
      'Order Ref: ' + order.public_order_id,
      'Invoice: ' + financial.invoice.document_reference,
      'Amount: ' + formatMoney(Number(financial.invoice.amount) || 0, financial.invoice.currency),
      '',
      method.bank_name || '',
      method.bank_account_name || '',
      method.bank_account_number || '',
    ];
    if (method.instructions) lines.push('', method.instructions);
    lines.push('', 'After transferring, tell us "I have paid" or "I have transferred". ' +
      'Payment remains unconfirmed until the merchant verifies it.');
    await queueReply(input, order, 'payment_instructions', lines.filter((x, i) => x !== '' || i === 4).join('\n'));
    return;
  }

  if (method.method_type === 'cash_on_delivery' || method.method_type === 'pay_on_pickup') {
    const when = method.method_type === 'cash_on_delivery' ? 'on delivery' : 'when you collect the order';
    await queueReply(
      input,
      order,
      'payment_instructions',
      method.display_name + ' selected for order ' + order.public_order_id + '. Amount due: ' +
      formatMoney(Number(financial.invoice.amount) || 0, financial.invoice.currency) +
      '. You will pay ' + when + '. SellerTray issues a financial receipt only after payment is confirmed.',
    );
    return;
  }

  try {
    const runtime = await paymentRuntime('initialize', paymentId);
    const checkoutUrl = typeof runtime.checkoutUrl === 'string' ? runtime.checkoutUrl : null;
    if (!checkoutUrl) throw new Error('Gateway returned no checkout link');

    await queueReply(
      input,
      order,
      'payment_instructions',
      method.display_name + ' payment for order ' + order.public_order_id + '\n' +
      'Invoice: ' + financial.invoice.document_reference + '\n' +
      'Amount: ' + formatMoney(Number(financial.invoice.amount) || 0, financial.invoice.currency) + '\n\n' +
      'Secure checkout: ' + checkoutUrl + '\n\n' +
      'SellerTray confirms payment only after server-side verification. You can ask "has my payment gone through?" afterwards.',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gateway checkout initialization failed';
    try {
      await rpc('transition_sellertray_order_payment', {
        p_payment_id: paymentId,
        p_status: 'failed',
        p_confirmation_source: null,
        p_confirmed_by_user_id: null,
        p_provider_reference: reference,
        p_failure_reason: message.slice(0, 500),
      });
    } catch {}
    await queueReply(
      input,
      order,
      'payment_instructions',
      method.display_name + ' checkout is temporarily unavailable for order ' + order.public_order_id +
      '. Tell us another payment option you would like to use.',
    );
  }
}

async function recordPaidClaim(input: HandlerInput, order: OrderRow): Promise<void> {
  const attempts = await rest<PaymentAttempt[]>(
    '/rest/v1/order_payments?select=id,method_type,provider,status,amount,currency,checkout_url,provider_reference,created_at' +
    '&tenant_id=eq.' + encodeURIComponent(input.tenantId) +
    '&order_id=eq.' + encodeURIComponent(order.id) +
    '&method_type=eq.bank_transfer' +
    '&status=in.(initiated,pending_verification)' +
    '&order=created_at.desc&limit=1',
  );
  const payment = attempts[0];

  if (!payment) {
    await queueReply(input, order, 'payment_claim_received',
      'No open bank-transfer payment was found for order ' + order.public_order_id +
      '. Ask for bank transfer details first, then tell us after you have transferred.');
    return;
  }

  if (payment.status === 'initiated') {
    await rpc('transition_sellertray_order_payment', {
      p_payment_id: payment.id,
      p_status: 'pending_verification',
      p_confirmation_source: null,
      p_confirmed_by_user_id: null,
      p_provider_reference: payment.provider_reference,
      p_failure_reason: null,
    });
  }

  await rpc('record_sellertray_payment_event', {
    p_tenant_id: input.tenantId,
    p_order_id: order.id,
    p_payment_id: payment.id,
    p_provider: payment.provider,
    p_event_key: 'wa-claim:' + input.sourceMessageId,
    p_event_type: 'customer_paid_claim',
    p_source: 'system',
    p_verification_status: 'received',
    p_provider_event_id: input.sourceMessageId,
    p_provider_transaction_id: null,
    p_payload_sha256: null,
    p_verification_result: { channel: 'whatsapp' },
  });

  await queueReply(
    input,
    order,
    'payment_claim_received',
    input.businessName + ' has received your payment claim for order ' + order.public_order_id +
    '. The transfer is awaiting merchant verification. This message is not a financial receipt.',
  );
}

async function sendStatus(input: HandlerInput, order: OrderRow): Promise<void> {
  let snapshot = await financialSnapshot(input.tenantId, order.id);
  const latest = await latestPayment(input.tenantId, order.id);

  if (snapshot.paymentStatus !== 'paid' && latest && latest.provider === 'paystack' && latest.status === 'initiated') {
    try {
      await paymentRuntime('verify', latest.id);
      snapshot = await financialSnapshot(input.tenantId, order.id);
    } catch (error) {
      console.warn('SellerTray Paystack verification did not complete', error);
    }
  }

  const labels: Record<string, string> = {
    unpaid: 'Unpaid',
    pending: 'Payment started',
    verification_required: 'Awaiting merchant verification',
    paid: 'Paid',
  };

  const lines = [
    'Payment status — ' + input.businessName,
    'Order Ref: ' + order.public_order_id,
    'Status: ' + (labels[snapshot.paymentStatus] || snapshot.paymentStatus),
  ];
  if (snapshot.invoice) lines.push('Invoice: ' + snapshot.invoice.document_reference);
  if (snapshot.receipt) lines.push('Financial Receipt: ' + snapshot.receipt.document_reference);
  if (latest) lines.push('Latest method: ' + humanMethod(latest.method_type) + ' · ' + humanAttemptStatus(latest.status));

  await queueReply(input, order, 'payment_status_reply', lines.join('\n'));
}

async function sendInvoiceDocument(input: HandlerInput, order: OrderRow): Promise<void> {
  const snapshot = await financialSnapshot(input.tenantId, order.id);
  if (!snapshot.invoice) {
    await queueReply(
      input,
      order,
      'financial_document',
      'No invoice is available yet for order ' + order.public_order_id + '. The invoice is issued when the merchant accepts the order.',
    );
    return;
  }

  let attachment: FinancialAttachment | null = null;
  try {
    attachment = await renderFinancialDocument(snapshot.invoice.id);
  } catch (error) {
    console.error('SellerTray invoice PDF rendering failed; sending reference fallback.', error);
  }

  await queueReply(
    input,
    order,
    'financial_document',
    input.businessName + ' invoice\nOrder Ref: ' + order.public_order_id +
      '\nInvoice: ' + snapshot.invoice.document_reference +
      '\nAmount due: ' + formatMoney(Number(snapshot.invoice.amount) || 0, snapshot.invoice.currency) +
      '\nThis invoice is not proof of payment.',
    attachment,
  );
}

async function sendFinancialReceiptReference(input: HandlerInput, order: OrderRow): Promise<void> {
  const snapshot = await financialSnapshot(input.tenantId, order.id);
  if (snapshot.paymentStatus !== 'paid' || !snapshot.receipt) {
    await queueReply(
      input,
      order,
      'financial_document',
      'No financial payment receipt is available yet for order ' + order.public_order_id +
        '. A financial receipt is issued only after payment is confirmed.',
    );
    return;
  }

  let attachment: FinancialAttachment | null = null;
  try {
    attachment = await renderFinancialDocument(snapshot.receipt.id);
  } catch (error) {
    console.error('SellerTray payment receipt PDF rendering failed; sending reference fallback.', error);
  }

  await queueReply(
    input,
    order,
    'financial_document',
    input.businessName + ' financial receipt\nOrder Ref: ' + order.public_order_id +
      '\nFinancial Receipt: ' + snapshot.receipt.document_reference +
      '\nAmount: ' + formatMoney(Number(snapshot.receipt.amount) || 0, snapshot.receipt.currency),
    attachment,
  );
}

type FinancialAttachment = {
  storageBucket: string;
  storagePath: string;
  filename: string;
  mimeType: string;
};

async function renderFinancialDocument(documentId: string): Promise<FinancialAttachment> {
  const response = await fetch(SUPABASE_URL + '/functions/v1/financial-document', {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ documentId }),
  });
  const payload = await safeJson(response) || {};
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Financial document rendering failed');
  }
  if (
    typeof payload.storageBucket !== 'string' ||
    typeof payload.storagePath !== 'string' ||
    typeof payload.filename !== 'string' ||
    typeof payload.mimeType !== 'string'
  ) {
    throw new Error('Financial document renderer returned an invalid attachment');
  }
  return {
    storageBucket: payload.storageBucket,
    storagePath: payload.storagePath,
    filename: payload.filename,
    mimeType: payload.mimeType,
  };
}

type HandlerInput = {
  tenantId: string;
  businessName: string;
  customerId: string;
  customerWaId: string;
  sourceMessageId: string;
  fromPhoneNumberId: string;
  text: string;
};

async function financialSnapshot(tenantId: string, orderId: string): Promise<{
  paymentStatus: string;
  invoice: { id: string; document_reference: string; currency: string; amount: number | string } | null;
  receipt: { id: string; document_reference: string; currency: string; amount: number | string } | null;
}> {
  const orders = await rest<Array<{ payment_status: string }>>(
    '/rest/v1/orders?select=payment_status&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&id=eq.' + encodeURIComponent(orderId) + '&limit=1',
  );
  const docs = await rest<Array<{
    id: string;
    document_type: string;
    document_reference: string;
    currency: string;
    amount: number | string;
  }>>(
    '/rest/v1/order_financial_documents?select=id,document_type,document_reference,currency,amount' +
    '&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&order_id=eq.' + encodeURIComponent(orderId) +
    '&status=eq.issued',
  );
  return {
    paymentStatus: orders[0]?.payment_status || 'unpaid',
    invoice: docs.find((row) => row.document_type === 'invoice') || null,
    receipt: docs.find((row) => row.document_type === 'receipt') || null,
  };
}

async function loadMethods(tenantId: string): Promise<PaymentMethod[]> {
  return rest<PaymentMethod[]>(
    '/rest/v1/merchant_payment_methods?select=id,method_type,display_name,is_default,sort_order,bank_name,bank_account_name,bank_account_number,instructions' +
    '&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&is_enabled=eq.true&order=is_default.desc,sort_order.asc,created_at.asc',
  );
}

async function latestPayment(tenantId: string, orderId: string): Promise<PaymentAttempt | null> {
  const rows = await rest<PaymentAttempt[]>(
    '/rest/v1/order_payments?select=id,method_type,provider,status,amount,currency,checkout_url,provider_reference,created_at' +
    '&tenant_id=eq.' + encodeURIComponent(tenantId) +
    '&order_id=eq.' + encodeURIComponent(orderId) +
    '&order=created_at.desc&limit=1',
  );
  return rows[0] || null;
}

function methodToken(method: PaymentMethod, bankNo: number): string {
  if (method.method_type === 'bank_transfer') return 'BANK' + Math.max(1, bankNo);
  if (method.method_type === 'paystack') return 'PAYSTACK';
  if (method.method_type === 'flutterwave') return 'FLUTTERWAVE';
  if (method.method_type === 'cash_on_delivery') return 'COD';
  return 'PICKUP';
}

function resolveMethod(methods: PaymentMethod[], raw: string): PaymentMethod | null {
  const token = normalizeMethodToken(raw);

  const numeric = token.match(/^([1-9][0-9]?)$/);
  if (numeric) {
    return methods[Number(numeric[1]) - 1] || null;
  }

  if (token === 'BANK' || token === 'TRANSFER' || token === 'BANK_TRANSFER') {
    return methods.find((m) => m.method_type === 'bank_transfer' && m.is_default) ||
      methods.find((m) => m.method_type === 'bank_transfer') || null;
  }
  const bankMatch = token.match(/^BANK([0-9]+)$/);
  if (bankMatch) {
    const banks = methods.filter((m) => m.method_type === 'bank_transfer');
    return banks[Number(bankMatch[1]) - 1] || null;
  }

  const exactNamed = methods.find((method) =>
    normalizeMethodToken(method.display_name) === token ||
    (method.bank_name ? normalizeMethodToken(method.bank_name) === token : false)
  );
  if (exactNamed) return exactNamed;

  const containedNamed = methods.find((method) => {
    const display = normalizeMethodToken(method.display_name);
    const bank = method.bank_name ? normalizeMethodToken(method.bank_name) : '';
    return token.includes(display) || display.includes(token) ||
      (bank ? token.includes(bank) || bank.includes(token) : false);
  });
  if (containedNamed && token.length >= 4) return containedNamed;

  const map: Record<string, PaymentMethod['method_type']> = {
    PAYSTACK: 'paystack',
    FLUTTERWAVE: 'flutterwave',
    FLW: 'flutterwave',
    COD: 'cash_on_delivery',
    CASH_ON_DELIVERY: 'cash_on_delivery',
    PAY_ON_DELIVERY: 'cash_on_delivery',
    PAYING_ON_DELIVERY: 'cash_on_delivery',
    PICKUP: 'pay_on_pickup',
    PAY_ON_PICKUP: 'pay_on_pickup',
    PAY_ON_COLLECTION: 'pay_on_pickup',
  };
  const kind = map[token];
  return kind ? methods.find((m) => m.method_type === kind) || null : null;
}

function normalizeMethodToken(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function paymentReference(orderRef: string): string {
  const safe = orderRef.replace(/[^A-Z0-9]/gi, '').slice(0, 24);
  return 'stp-' + safe + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 18);
}

function humanMethod(value: string): string {
  return ({
    bank_transfer: 'Bank transfer',
    paystack: 'Paystack',
    flutterwave: 'Flutterwave',
    cash_on_delivery: 'Cash on delivery',
    pay_on_pickup: 'Pay on pickup',
  } as Record<string, string>)[value] || value.replace(/_/g, ' ');
}

function humanAttemptStatus(value: string): string {
  return ({
    initiated: 'started',
    pending_verification: 'awaiting verification',
    confirmed: 'confirmed',
    failed: 'failed',
    cancelled: 'cancelled',
    expired: 'expired',
  } as Record<string, string>)[value] || value.replace(/_/g, ' ');
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: /^[A-Z]{3}$/.test(currency) ? currency : 'NGN',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return currency + ' ' + value.toFixed(2);
  }
}

async function queueReply(
  input: HandlerInput,
  order: OrderRow,
  eventKey: string,
  message: string,
  attachment: FinancialAttachment | null = null,
): Promise<void> {
  await rest('/rest/v1/outbound_notifications', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      order_id: order.id,
      customer_id: order.customer_id,
      source_inbound_message_id: input.sourceMessageId,
      event_key: eventKey,
      delivery_status: 'pending',
      from_phone_number_id: input.fromPhoneNumberId,
      to_wa_id: input.customerWaId,
      message_body: message.slice(0, 2000),
      media_type: attachment ? 'document' : null,
      storage_bucket: attachment ? attachment.storageBucket : null,
      storage_path: attachment ? attachment.storagePath : null,
      media_filename: attachment ? attachment.filename : null,
      media_mime_type: attachment ? attachment.mimeType : null,
      conversation_window_expires_at: new Date(Date.now() + 86400000).toISOString(),
    }),
  });

  await kickNotificationWorker();
}

async function kickNotificationWorker(): Promise<void> {
  try {
    await rest('/rest/v1/rpc/sellertray_kick_notification_worker', {
      method: 'POST',
      body: '{}',
    });
  } catch (error) {
    console.warn('SellerTray notification worker kick failed; cron retry remains available.', error);
  }
}

async function paymentRuntime(action: 'initialize' | 'verify', paymentId: string): Promise<J> {
  const response = await fetch(SUPABASE_URL + '/functions/v1/payment-runtime', {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action, paymentId }),
  });
  const payload = await safeJson(response) || {};
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Payment runtime failed');
  }
  return payload;
}

async function rpc<T = unknown>(name: string, body: J): Promise<T> {
  return rest<T>('/rest/v1/rpc/' + encodeURIComponent(name), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(SUPABASE_URL + path, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error('SellerTray payment self-service data request failed with HTTP ' +
      response.status + ': ' + detail.slice(0, 240));
  }
  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

async function safeJson(response: Response): Promise<J | null> {
  try { return await response.json() as J; } catch { return null; }
}
