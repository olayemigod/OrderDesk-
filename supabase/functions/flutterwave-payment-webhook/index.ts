type J = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ENCRYPTION_KEY = Deno.env.get('SELLERTRAY_PAYMENT_ENCRYPTION_KEY') || '';
const decoder = new TextDecoder();
const encoder = new TextEncoder();

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return response('Method not allowed', 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !ENCRYPTION_KEY) return response('Server configuration error', 503);

  const raw = await limitedBody(req, 1048576);
  if (raw === null) return response('Payload too large', 413);

  let payload: J;
  try { payload = JSON.parse(raw) as J; }
  catch { return response('Invalid JSON', 400); }

  const data = isRecord(payload.data) ? payload.data : null;
  const references = flutterwaveReferences(data);
  const eventType = stringValue(payload.type) || stringValue(payload.event) || 'unknown';
  const eventId = stringValue(payload.id);
  if (!references.primary && !references.secondary) return response('OK', 200);

  try {
    const payment = await loadPayment(references);
    if (!payment) return response('OK', 200);

    const credential = await loadCredential(String(payment.tenant_id), String(payment.payment_method_id));
    if (!credential) return response('Gateway unavailable', 503);
    const secrets = await decryptCredential(credential);
    const secretHash = stringValue(secrets.secretHash);
    const secretKey = stringValue(secrets.secretKey);
    if (!secretHash || !secretKey) return response('Gateway unavailable', 503);
    const paymentMode = stringValue(payment.provider_mode);
    if (
      !paymentMode ||
      stringValue(credential.credential_mode) !== paymentMode ||
      stringValue(secrets.mode) !== paymentMode ||
      !gatewayKeyMatchesMode(secretKey, paymentMode)
    ) {
      return response('Gateway environment mismatch', 409);
    }

    const signature = req.headers.get('flutterwave-signature') || '';
    const legacyHash = req.headers.get('verif-hash') || '';
    const validModern = signature
      ? constantTimeEqual(signature, await hmacBase64('SHA-256', secretHash, raw))
      : false;
    const validLegacy = legacyHash ? constantTimeEqual(legacyHash, secretHash) : false;

    if (!validModern && !validLegacy) return response('Invalid signature', 401);

    const providerTransactionId = transactionIdValue(data?.id);
    const reference = references.primary || references.secondary || String(payment.provider_reference || payment.id);
    const stableEventKey = 'webhook:' + (eventId || eventType + ':' + (providerTransactionId || reference));
    const payloadHash = await sha256Hex(raw);

    await rpc('record_sellertray_payment_event', {
      p_tenant_id: payment.tenant_id,
      p_order_id: payment.order_id,
      p_payment_id: payment.id,
      p_provider: 'flutterwave',
      p_event_key: stableEventKey,
      p_event_type: eventType,
      p_source: 'webhook',
      p_verification_status: 'received',
      p_provider_event_id: eventId,
      p_provider_transaction_id: providerTransactionId,
      p_payload_sha256: payloadHash,
      p_verification_result: {
        signatureVerified: true,
        signatureMode: validModern ? 'hmac_sha256' : 'legacy_secret_hash',
      },
    });

    const successLike =
      eventType === 'charge.completed' ||
      eventType === 'charge.completed.successful' ||
      stringValue(data?.status) === 'successful' ||
      stringValue(data?.status) === 'succeeded';

    if (!successLike) {
      const exception = flutterwaveException(eventType, data, payment);
      if (exception) {
        await rpc('apply_sellertray_payment_exception', {
          p_payment_id: payment.id,
          p_state: exception.state,
          p_provider_event_ref: exception.providerRef,
          p_reason: exception.reason,
        });

        await rpc('record_sellertray_payment_event', {
          p_tenant_id: payment.tenant_id,
          p_order_id: payment.order_id,
          p_payment_id: payment.id,
          p_provider: 'flutterwave',
          p_event_key: stableEventKey,
          p_event_type: eventType,
          p_source: 'webhook',
          p_verification_status: 'verified',
          p_provider_event_id: eventId,
          p_provider_transaction_id: providerTransactionId,
          p_payload_sha256: payloadHash,
          p_verification_result: {
            signatureVerified: true,
            signatureMode: validModern ? 'hmac_sha256' : 'legacy_secret_hash',
            exceptionState: exception.state,
          },
        });
        return response('OK', 200);
      }

      await rpc('record_sellertray_payment_event', {
        p_tenant_id: payment.tenant_id,
        p_order_id: payment.order_id,
        p_payment_id: payment.id,
        p_provider: 'flutterwave',
        p_event_key: stableEventKey,
        p_event_type: eventType,
        p_source: 'webhook',
        p_verification_status: 'ignored',
        p_provider_event_id: eventId,
        p_provider_transaction_id: providerTransactionId,
        p_payload_sha256: payloadHash,
        p_verification_result: {
          signatureVerified: true,
          reason: 'unsupported_event',
        },
      });
      return response('OK', 200);
    }

    if (!providerTransactionId) {
      await rpc('record_sellertray_payment_event', {
        p_tenant_id: payment.tenant_id,
        p_order_id: payment.order_id,
        p_payment_id: payment.id,
        p_provider: 'flutterwave',
        p_event_key: stableEventKey,
        p_event_type: eventType,
        p_source: 'webhook',
        p_verification_status: 'rejected',
        p_provider_event_id: eventId,
        p_provider_transaction_id: null,
        p_payload_sha256: payloadHash,
        p_verification_result: {
          signatureVerified: true,
          reason: 'missing_transaction_id',
        },
      });
      return response('Missing transaction id', 409);
    }

    const verified = await paymentRuntimeVerify(String(payment.id), providerTransactionId);
    const sellertrayStatus = stringValue(verified.status) || 'unknown';

    await rpc('record_sellertray_payment_event', {
      p_tenant_id: payment.tenant_id,
      p_order_id: payment.order_id,
      p_payment_id: payment.id,
      p_provider: 'flutterwave',
      p_event_key: stableEventKey,
      p_event_type: eventType,
      p_source: 'webhook',
      p_verification_status: sellertrayStatus === 'confirmed' || sellertrayStatus === 'payment_issue' ? 'verified' : 'rejected',
      p_provider_event_id: eventId,
      p_provider_transaction_id: providerTransactionId,
      p_payload_sha256: payloadHash,
      p_verification_result: {
        signatureVerified: true,
        providerVerifyStatus: verified.providerStatus || null,
        sellertrayStatus,
      },
    });

    return sellertrayStatus === 'confirmed' || sellertrayStatus === 'payment_issue'
      ? response('OK', 200)
      : response('Verification incomplete', 409);
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'flutterwave-payment-webhook',
      event: 'processing_failed',
      reference,
      error: sanitize(error instanceof Error ? error.message : 'Webhook processing failed'),
    }));
    return response('Webhook processing failed', 500);
  }
});

async function loadPayment(
  refs: { primary: string | null; secondary: string | null },
): Promise<J | null> {
  if (refs.primary) {
    const rows = await rest<J[]>(
      '/rest/v1/order_payments?select=id,tenant_id,order_id,payment_method_id,status,exception_state,provider_mode,provider_reference,provider_secondary_reference' +
      '&provider=eq.flutterwave&provider_reference=eq.' + encodeURIComponent(refs.primary) + '&limit=1',
    );
    if (rows[0]) return rows[0];
  }

  if (refs.secondary) {
    const rows = await rest<J[]>(
      '/rest/v1/order_payments?select=id,tenant_id,order_id,payment_method_id,status,exception_state,provider_mode,provider_reference,provider_secondary_reference' +
      '&provider=eq.flutterwave&provider_secondary_reference=eq.' + encodeURIComponent(refs.secondary) + '&limit=1',
    );
    if (rows[0]) return rows[0];
  }

  return null;
}

async function loadCredential(tenantId: string, methodId: string): Promise<J | null> {
  const rows = await rpc<J[]>('get_sellertray_gateway_credentials', {
    p_tenant_id: tenantId,
    p_payment_method_id: methodId,
  });
  return rows[0] || null;
}

async function decryptCredential(row: J): Promise<J> {
  const keyBytes = fromBase64(ENCRYPTION_KEY);
  if (keyBytes.byteLength !== 32) throw new Error('Payment encryption key is invalid');
  const ciphertext = stringValue(row.credentials_ciphertext);
  const iv = stringValue(row.credentials_iv);
  if (!ciphertext || !iv || Number(row.encryption_key_version) !== 1) throw new Error('Stored gateway credential is invalid');

  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext),
  );
  return JSON.parse(decoder.decode(plain)) as J;
}

async function paymentRuntimeVerify(paymentId: string, providerTransactionId: string): Promise<J> {
  const r = await fetch(SUPABASE_URL + '/functions/v1/payment-runtime', {
    method: 'POST',
    signal: AbortSignal.timeout(12000),
    headers: {
      apikey: SERVICE_KEY,
      authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: 'verify', paymentId, providerTransactionId }),
  });
  const payload = await safeJson(r) || {};
  if (!r.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Flutterwave re-verification failed');
  return payload;
}

async function rpc<T = unknown>(name: string, body: J): Promise<T> {
  return rest<T>('/rest/v1/rpc/' + encodeURIComponent(name), {
    method: 'POST',
    body: JSON.stringify(body),
  });
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

async function hmacBase64(hash: 'SHA-256', secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  let raw = '';
  for (const b of digest) raw += String.fromCharCode(b);
  return btoa(raw);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function flutterwaveReferences(data: J | null): { primary: string | null; secondary: string | null } {
  if (!data) return { primary: null, secondary: null };
  const charge = isRecord(data.charge) ? data.charge : null;
  const transaction = isRecord(data.transaction) ? data.transaction : null;
  return {
    primary:
      stringValue(data.tx_ref) ||
      stringValue(data.reference) ||
      stringValue(charge?.tx_ref) ||
      stringValue(transaction?.tx_ref),
    secondary:
      stringValue(data.flw_ref) ||
      stringValue(charge?.flw_ref) ||
      stringValue(transaction?.flw_ref),
  };
}

function flutterwaveException(
  eventType: string,
  data: J | null,
  payment: J,
): { state: string; providerRef: string | null; reason: string } | null {
  if (!data) return null;
  const refs = flutterwaveReferences(data);
  const providerRef = refs.secondary || refs.primary || transactionIdValue(data.id);

  if (eventType === 'refund.completed') {
    if (payment.status === 'confirmed') {
      return { state: 'refunded', providerRef, reason: 'Flutterwave refund completed' };
    }
    if (payment.exception_state === 'duplicate_payment') {
      return { state: 'none', providerRef: null, reason: 'Duplicate Flutterwave payment was refunded' };
    }
    return null;
  }

  if (eventType === 'chargeback.initiated' || eventType === 'chargeback.pending' || eventType === 'chargeback.declined') {
    return { state: 'disputed', providerRef, reason: 'Flutterwave chargeback is open or awaiting final resolution' };
  }
  if (eventType === 'chargeback.accepted' || eventType === 'chargeback.lost') {
    return { state: 'chargeback', providerRef, reason: 'Flutterwave chargeback removed or may remove the payment value' };
  }
  if (eventType === 'chargeback.won' || eventType === 'chargeback.reversed') {
    return { state: 'none', providerRef: null, reason: 'Flutterwave chargeback resolved in the merchant payment path' };
  }
  return null;
}

function gatewayKeyMatchesMode(secretKey: string, mode: string): boolean {
  const upper = secretKey.toUpperCase();
  return mode === 'test'
    ? upper.startsWith('FLWSECK_TEST-')
    : mode === 'live' && upper.startsWith('FLWSECK-') && !upper.startsWith('FLWSECK_TEST-');
}

function fromBase64(v: string): Uint8Array {
  try { return Uint8Array.from(atob(v), (c) => c.charCodeAt(0)); }
  catch { return new Uint8Array(); }
}
function isRecord(v: unknown): v is J { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function stringValue(v: unknown): string | null { return typeof v === 'string' && v ? v : null; }
function transactionIdValue(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : stringValue(v);
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i += 1) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function sanitize(v: string): string {
  return v.replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:FLWSECK|sk|sb_secret)[-_][A-Za-z0-9_-]+\b/gi, '[redacted]')
    .replace(/\s+/g, ' ').slice(0, 300);
}
async function safeJson(r: Response): Promise<J | null> { try { return await r.json() as J; } catch { return null; } }
async function limitedBody(req: Request, max: number): Promise<string | null> {
  const raw = await req.text();
  return new TextEncoder().encode(raw).byteLength <= max ? raw : null;
}
function response(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
