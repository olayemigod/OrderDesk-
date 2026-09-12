type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ENCRYPTION_KEY = Deno.env.get('SELLERTRAY_PAYMENT_ENCRYPTION_KEY') || '';
const PAYMENT_RETURN_URL = Deno.env.get('SELLERTRAY_PAYMENT_RETURN_URL') || 'https://processedge.com.ng';
const decoder = new TextDecoder();

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Server configuration error' }, 500);

  const authorization = req.headers.get('authorization') || '';
  if (!constantTimeEqual(authorization, 'Bearer ' + SERVICE_KEY)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: J;
  try { body = await req.json() as J; }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const action = body.action === 'initialize' || body.action === 'verify' ? String(body.action) : null;
  const paymentId = uuid(body.paymentId);
  if (!action || !paymentId) return json({ error: 'action and paymentId are required' }, 400);

  try {
    const payment = await loadPayment(paymentId);
    if (!payment) return json({ error: 'Payment not found' }, 404);

    if (action === 'initialize') {
      if (payment.status !== 'initiated') {
        if (typeof payment.checkout_url === 'string' && payment.checkout_url) {
          return json({
            paymentId,
            checkoutUrl: payment.checkout_url,
            provider: payment.provider,
            providerReference: payment.provider_reference,
            duplicateInitializationPrevented: true,
          });
        }
        return json({ error: 'Payment is not eligible for checkout initialization' }, 409);
      }

      if (payment.provider !== 'paystack' && payment.provider !== 'flutterwave') {
        return json({ error: 'Payment method is not an online gateway' }, 409);
      }

      const credentials = await loadCredentials(
        String(payment.tenant_id),
        String(payment.payment_method_id),
      );
      if (!credentials || credentials.provider !== payment.provider) {
        return json({ error: 'Merchant gateway credentials are unavailable' }, 409);
      }

      const secrets = await decryptCredentials(credentials);
      const secretKey = stringValue(secrets.secretKey);
      if (!secretKey) return json({ error: 'Merchant gateway credential is invalid' }, 503);
      const modeError = gatewayModeMismatch(payment, credentials, secrets, secretKey);
      if (modeError) return json({ error: modeError }, 409);

      const email = customerEmail(payment);
      const amount = numberValue(payment.amount);
      const currency = stringValue(payment.currency);
      const reference = stringValue(payment.provider_reference);

      if (!email || amount === null || amount <= 0 || !currency || !reference) {
        return json({ error: 'Payment checkout data is incomplete' }, 409);
      }

      if (payment.provider === 'paystack') {
        const response = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + secretKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email,
            amount: String(Math.round(amount * 100)),
            currency,
            reference,
            metadata: {
              sellertrayPaymentId: payment.id,
              sellertrayOrderId: payment.order_id,
              sellertrayOrderRef: payment.public_order_id,
              sellertrayTenantId: payment.tenant_id,
            },
          }),
        });

        const payload = await safeJson(response);
        const data = isRecord(payload?.data) ? payload.data : null;
        const checkoutUrl = stringValue(data?.authorization_url);
        const returnedRef = stringValue(data?.reference);

        if (!response.ok || payload?.status !== true || !checkoutUrl || returnedRef !== reference) {
          return json({ error: 'Paystack checkout initialization failed' }, 502);
        }

        await rpc('set_sellertray_payment_checkout', {
          p_payment_id: paymentId,
          p_checkout_url: checkoutUrl,
          p_provider_transaction_id: null,
        });

        return json({
          paymentId,
          checkoutUrl,
          provider: 'paystack',
          providerReference: reference,
          providerMode: payment.provider_mode,
        }, 201);
      }

      const response = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + secretKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tx_ref: reference,
          amount: String(amount.toFixed(2)),
          currency,
          redirect_url: PAYMENT_RETURN_URL,
          customer: {
            email,
            name: stringValue(payment.customer_name) || 'SellerTray customer',
            phonenumber: normalizedPhone(payment.customer_phone || payment.customer_wa_id),
          },
          customizations: {
            title: 'SellerTray payment',
            description: 'Payment for order ' + String(payment.public_order_id || ''),
          },
          meta: {
            sellertrayPaymentId: payment.id,
            sellertrayOrderId: payment.order_id,
            sellertrayOrderRef: payment.public_order_id,
            sellertrayTenantId: payment.tenant_id,
          },
        }),
      });

      const payload = await safeJson(response);
      const data = isRecord(payload?.data) ? payload.data : null;
      const checkoutUrl = stringValue(data?.link);

      if (!response.ok || payload?.status !== 'success' || !checkoutUrl) {
        return json({ error: 'Flutterwave checkout initialization failed' }, 502);
      }

      await rpc('set_sellertray_payment_checkout', {
        p_payment_id: paymentId,
        p_checkout_url: checkoutUrl,
        p_provider_transaction_id: null,
      });

      return json({
        paymentId,
        checkoutUrl,
        provider: 'flutterwave',
        providerReference: reference,
        providerMode: payment.provider_mode,
      }, 201);
    }

    if (payment.provider !== 'paystack' && payment.provider !== 'flutterwave') {
      return json({ error: 'Payment method is not an online gateway' }, 409);
    }

    const credentials = await loadCredentials(
      String(payment.tenant_id),
      String(payment.payment_method_id),
    );
    if (!credentials || credentials.provider !== payment.provider) {
      return json({ error: 'Merchant gateway credentials are unavailable' }, 409);
    }
    const secrets = await decryptCredentials(credentials);
    const secretKey = stringValue(secrets.secretKey);
    if (!secretKey) return json({ error: 'Merchant gateway credential is invalid' }, 503);
    const modeError = gatewayModeMismatch(payment, credentials, secrets, secretKey);
    if (modeError) return json({ error: modeError }, 409);

    if (payment.provider === 'paystack') {
      const reference = stringValue(payment.provider_reference);
      if (!reference) return json({ error: 'Payment reference is missing' }, 409);

      const response = await fetch(
        'https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference),
        { headers: { authorization: 'Bearer ' + secretKey } },
      );
      const payload = await safeJson(response);
      const data = isRecord(payload?.data) ? payload.data : null;
      const providerStatus = stringValue(data?.status) || 'unknown';

      if (!response.ok || payload?.status !== true || !data) {
        return json({ paymentId, status: payment.status, providerStatus: 'unverified' }, 200);
      }

      const mismatch = paystackMismatch(payment, data);
      if (mismatch) return json({ error: mismatch, providerStatus }, 409);

      const transactionId = transactionIdValue(data.id);
      await rpc('mark_sellertray_payment_verified', {
        p_payment_id: paymentId,
        p_provider_transaction_id: transactionId,
      });

      await rpc('record_sellertray_payment_event', {
        p_tenant_id: payment.tenant_id,
        p_order_id: payment.order_id,
        p_payment_id: payment.id,
        p_provider: 'paystack',
        p_event_key: 'verify:' + reference,
        p_event_type: 'transaction.verify',
        p_source: 'verify',
        p_verification_status: providerStatus === 'success' ? 'verified' : 'ignored',
        p_provider_event_id: null,
        p_provider_transaction_id: transactionId,
        p_payload_sha256: null,
        p_verification_result: {
          providerStatus,
          amountMatched: true,
          currencyMatched: true,
          referenceMatched: true,
          providerMode: payment.provider_mode,
          providerDomain: data.domain ?? null,
          environmentMatched: true,
        },
      });

      if (providerStatus === 'success') {
        if (payment.status === 'confirmed') {
          return json({
            paymentId,
            status: payment.exception_state === 'none' ? 'confirmed' : 'payment_issue',
            providerStatus,
            exceptionState: payment.exception_state,
            alreadyConfirmed: true,
          });
        }

        if (
          ['failed', 'cancelled', 'expired'].includes(String(payment.status)) ||
          payment.order_payment_status === 'paid' ||
          payment.order_payment_status === 'payment_issue'
        ) {
          await rpc('apply_sellertray_payment_exception', {
            p_payment_id: paymentId,
            p_state: 'duplicate_payment',
            p_provider_event_ref: transactionId,
            p_reason: 'Provider verified funds after another payment had already settled or this attempt was closed',
          });
          return json({ paymentId, status: 'payment_issue', providerStatus, exceptionState: 'duplicate_payment' });
        }

        await rpc('transition_sellertray_order_payment', {
          p_payment_id: paymentId,
          p_status: 'confirmed',
          p_confirmation_source: 'provider_verify',
          p_confirmed_by_user_id: null,
          p_provider_reference: reference,
          p_failure_reason: null,
        });
        return json({ paymentId, status: 'confirmed', providerStatus });
      }

      if (providerStatus === 'reversed') {
        if (payment.status === 'confirmed') {
          await rpc('apply_sellertray_payment_exception', {
            p_payment_id: paymentId,
            p_state: 'reversed',
            p_provider_event_ref: transactionId,
            p_reason: 'Paystack verified transaction status: reversed',
          });
          return json({ paymentId, status: 'payment_issue', providerStatus, exceptionState: 'reversed' });
        }
        if (payment.status === 'initiated' || payment.status === 'pending_verification') {
          await rpc('transition_sellertray_order_payment', {
            p_payment_id: paymentId,
            p_status: 'failed',
            p_confirmation_source: null,
            p_confirmed_by_user_id: null,
            p_provider_reference: reference,
            p_failure_reason: 'Paystack verified transaction status: reversed',
          });
          return json({ paymentId, status: 'failed', providerStatus });
        }
      }

      if (isReversalPending(providerStatus) && payment.status === 'confirmed') {
        await rpc('apply_sellertray_payment_exception', {
          p_payment_id: paymentId,
          p_state: 'refund_pending',
          p_provider_event_ref: transactionId,
          p_reason: 'Paystack transaction is awaiting reversal/refund completion',
        });
        return json({ paymentId, status: 'payment_issue', providerStatus, exceptionState: 'refund_pending' });
      }

      if (['failed', 'abandoned'].includes(providerStatus) && (payment.status === 'initiated' || payment.status === 'pending_verification')) {
        await rpc('transition_sellertray_order_payment', {
          p_payment_id: paymentId,
          p_status: 'failed',
          p_confirmation_source: null,
          p_confirmed_by_user_id: null,
          p_provider_reference: reference,
          p_failure_reason: 'Paystack verified transaction status: ' + providerStatus,
        });
        return json({ paymentId, status: 'failed', providerStatus });
      }

      return json({ paymentId, status: payment.status, providerStatus });
    }

    const transactionId = stringValue(body.providerTransactionId)
      || stringValue(payment.provider_transaction_id);
    if (!transactionId) {
      return json({ paymentId, status: payment.status, providerStatus: 'transaction_id_required' }, 200);
    }

    const response = await fetch(
      'https://api.flutterwave.com/v3/transactions/' + encodeURIComponent(transactionId) + '/verify',
      { headers: { authorization: 'Bearer ' + secretKey } },
    );
    const payload = await safeJson(response);
    const data = isRecord(payload?.data) ? payload.data : null;
    const providerStatus = stringValue(data?.status) || 'unknown';

    if (!response.ok || payload?.status !== 'success' || !data) {
      return json({ paymentId, status: payment.status, providerStatus: 'unverified' }, 200);
    }

    const mismatch = flutterwaveMismatch(payment, data);
    if (mismatch) return json({ error: mismatch, providerStatus }, 409);

    await rpc('mark_sellertray_payment_verified', {
      p_payment_id: paymentId,
      p_provider_transaction_id: transactionId,
    });
    const flutterwaveNetworkRef = stringValue(data.flw_ref);
    if (flutterwaveNetworkRef) {
      await rpc('set_sellertray_payment_secondary_reference', {
        p_payment_id: paymentId,
        p_reference: flutterwaveNetworkRef,
      });
    }
    await rpc('record_sellertray_payment_event', {
      p_tenant_id: payment.tenant_id,
      p_order_id: payment.order_id,
      p_payment_id: payment.id,
      p_provider: 'flutterwave',
      p_event_key: 'verify:' + String(payment.provider_reference),
      p_event_type: 'transaction.verify',
      p_source: 'verify',
      p_verification_status: providerStatus === 'successful' ? 'verified' : 'ignored',
      p_provider_event_id: null,
      p_provider_transaction_id: transactionId,
      p_payload_sha256: null,
      p_verification_result: {
        providerStatus,
        amountMatched: true,
        currencyMatched: true,
        referenceMatched: true,
      },
    });

    if (providerStatus === 'successful') {
      if (payment.status === 'confirmed') {
        return json({
          paymentId,
          status: payment.exception_state === 'none' ? 'confirmed' : 'payment_issue',
          providerStatus,
          exceptionState: payment.exception_state,
          alreadyConfirmed: true,
        });
      }

      if (
        ['failed', 'cancelled', 'expired'].includes(String(payment.status)) ||
        payment.order_payment_status === 'paid' ||
        payment.order_payment_status === 'payment_issue'
      ) {
        await rpc('apply_sellertray_payment_exception', {
          p_payment_id: paymentId,
          p_state: 'duplicate_payment',
          p_provider_event_ref: transactionId,
          p_reason: 'Provider verified funds after another payment had already settled or this attempt was closed',
        });
        return json({ paymentId, status: 'payment_issue', providerStatus, exceptionState: 'duplicate_payment' });
      }

      await rpc('transition_sellertray_order_payment', {
        p_payment_id: paymentId,
        p_status: 'confirmed',
        p_confirmation_source: 'provider_verify',
        p_confirmed_by_user_id: null,
        p_provider_reference: payment.provider_reference,
        p_failure_reason: null,
      });
      return json({ paymentId, status: 'confirmed', providerStatus });
    }

    return json({ paymentId, status: payment.status, providerStatus });
  } catch (e) {
    const message = sanitize(e instanceof Error ? e.message : 'Payment runtime failed');
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'payment-runtime',
      event: 'request_failed',
      payment_id: paymentId,
      error: message,
    }));
    return json({ error: message }, 400);
  }
});

async function loadPayment(id: string): Promise<J | null> {
  const rows = await rest<J[]>(
    '/rest/v1/order_payments?select=id,tenant_id,order_id,payment_method_id,method_type,provider,provider_mode,status,exception_state,amount,currency,provider_reference,provider_transaction_id,provider_secondary_reference,checkout_url,' +
    'orders(public_order_id,customer_id,payment_status,customers(display_name,phone,wa_id,email))' +
    '&id=eq.' + encodeURIComponent(id) + '&limit=1',
  );
  const row = rows[0];
  if (!row) return null;
  const order = oneRecord(row.orders);
  const customer = order ? oneRecord(order.customers) : null;
  return {
    ...row,
    public_order_id: order?.public_order_id ?? null,
    customer_id: order?.customer_id ?? null,
    order_payment_status: order?.payment_status ?? null,
    customer_name: customer?.display_name ?? null,
    customer_phone: customer?.phone ?? null,
    customer_wa_id: customer?.wa_id ?? null,
    customer_email: customer?.email ?? null,
  };
}

async function loadCredentials(tenantId: string, methodId: string): Promise<J | null> {
  const rows = await rpc<J[]>('get_sellertray_gateway_credentials', {
    p_tenant_id: tenantId,
    p_payment_method_id: methodId,
  });
  return rows[0] ?? null;
}

async function decryptCredentials(row: J): Promise<J> {
  if (!ENCRYPTION_KEY) throw new Error('Gateway credential encryption is not configured');
  const keyBytes = fromBase64(ENCRYPTION_KEY);
  if (keyBytes.byteLength !== 32) throw new Error('Gateway credential encryption key is invalid');
  const ciphertext = stringValue(row.credentials_ciphertext);
  const ivValue = stringValue(row.credentials_iv);
  if (!ciphertext || !ivValue || Number(row.encryption_key_version) !== 1) {
    throw new Error('Stored gateway credential is invalid');
  }

  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivValue) },
    key,
    fromBase64(ciphertext),
  );
  return JSON.parse(decoder.decode(plain)) as J;
}

function customerEmail(payment: J): string | null {
  const configured = stringValue(payment.customer_email);
  if (configured) return configured.toLowerCase();
  const phone = normalizedPhone(payment.customer_phone || payment.customer_wa_id).replace(/\D/g, '');
  if (!phone) return null;
  return 'wa-' + phone.slice(-15) + '@processedge.com.ng';
}

function gatewayModeMismatch(payment: J, credentials: J, secrets: J, secretKey: string): string | null {
  const paymentMode = stringValue(payment.provider_mode);
  const credentialMode = stringValue(credentials.credential_mode);
  const encryptedMode = stringValue(secrets.mode);
  const provider = stringValue(payment.provider);

  if (!paymentMode || (paymentMode !== 'test' && paymentMode !== 'live')) {
    return 'SellerTray payment has no valid provider mode snapshot';
  }
  if (credentialMode !== paymentMode || encryptedMode !== paymentMode) {
    return 'SellerTray gateway credential mode does not match payment mode';
  }
  if (!provider || !gatewayKeyMatchesMode(provider, secretKey, paymentMode)) {
    return 'SellerTray gateway secret key does not match payment mode';
  }
  return null;
}

function gatewayKeyMatchesMode(provider: string, secretKey: string, mode: string): boolean {
  if (provider === 'paystack') {
    return mode === 'test' ? secretKey.startsWith('sk_test_') : secretKey.startsWith('sk_live_');
  }
  if (provider === 'flutterwave') {
    const upper = secretKey.toUpperCase();
    return mode === 'test'
      ? upper.startsWith('FLWSECK_TEST-')
      : upper.startsWith('FLWSECK-') && !upper.startsWith('FLWSECK_TEST-');
  }
  return false;
}

function normalizedPhone(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const digits = raw.replace(/\D/g, '');
  return digits ? '+' + digits : '';
}

function paystackMismatch(payment: J, data: J): string | null {
  const expectedAmount = numberValue(payment.amount);
  const actualAmount = numberValue(data.amount);
  const expectedCurrency = stringValue(payment.currency);
  const actualCurrency = stringValue(data.currency);
  const expectedRef = stringValue(payment.provider_reference);
  const actualRef = stringValue(data.reference);
  const expectedMode = stringValue(payment.provider_mode);
  const actualDomain = stringValue(data.domain);

  if (!expectedMode || actualDomain !== expectedMode) {
    return 'Verified Paystack environment does not match SellerTray payment mode';
  }
  if (expectedAmount === null || actualAmount === null || Math.round(expectedAmount * 100) !== Math.round(actualAmount)) {
    return 'Verified Paystack amount does not match SellerTray payment';
  }
  if (!expectedCurrency || actualCurrency !== expectedCurrency) {
    return 'Verified Paystack currency does not match SellerTray payment';
  }
  if (!expectedRef || actualRef !== expectedRef) {
    return 'Verified Paystack reference does not match SellerTray payment';
  }
  return null;
}

function flutterwaveMismatch(payment: J, data: J): string | null {
  const expectedAmount = numberValue(payment.amount);
  const actualAmount = numberValue(data.amount);
  const expectedCurrency = stringValue(payment.currency);
  const actualCurrency = stringValue(data.currency);
  const expectedRef = stringValue(payment.provider_reference);
  const actualRef = stringValue(data.tx_ref);

  if (
    expectedAmount === null ||
    actualAmount === null ||
    Math.round(actualAmount * 100) !== Math.round(expectedAmount * 100)
  ) {
    return 'Verified Flutterwave amount does not exactly match SellerTray payment';
  }
  if (!expectedCurrency || actualCurrency !== expectedCurrency) {
    return 'Verified Flutterwave currency does not match SellerTray payment';
  }
  if (!expectedRef || actualRef !== expectedRef) {
    return 'Verified Flutterwave reference does not match SellerTray payment';
  }
  return null;
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
    throw new Error('SellerTray data request failed with HTTP ' + response.status + ': ' + detail.slice(0, 240));
  }
  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

function oneRecord(value: unknown): J | null {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : null;
  return isRecord(value) ? value : null;
}
function isRecord(v: unknown): v is J { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function stringValue(v: unknown): string | null { return typeof v === 'string' && v ? v : null; }
function numberValue(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function isReversalPending(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized === 'reversal pending';
}

function transactionIdValue(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return stringValue(v);
}
function uuid(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const x = v.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x) ? x : null;
}
function fromBase64(v: string): Uint8Array {
  try { return Uint8Array.from(atob(v), (c) => c.charCodeAt(0)); }
  catch { return new Uint8Array(); }
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i += 1) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function sanitize(v: string): string {
  return v
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|FLWSECK|sb_secret)[-_][A-Za-z0-9_-]+\b/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}
async function safeJson(response: Response): Promise<J | null> {
  try { return await response.json() as J; } catch { return null; }
}
function json(payload: J, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
