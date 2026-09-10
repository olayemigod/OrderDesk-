type JsonRecord = Record<string, unknown>;

type TenantResolution = {
  tenantId: string;
  checkoutReference?: string | null;
  usageSettlementReference?: string | null;
  billingEmail?: string | null;
};

const encoder = new TextEncoder();
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
const BILLING_AUTH_ENCRYPTION_KEY = Deno.env.get('BILLING_AUTH_ENCRYPTION_KEY') ?? '';

Deno.serve(withObservability('paystack-webhook', async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PAYSTACK_SECRET_KEY) {
    return new Response('Billing webhook not configured', { status: 503 });
  }

  const bodyRead = await readRequestTextLimited(request, 524_288);
  if (!bodyRead.ok) {
    return new Response('Payload too large', { status: 413 });
  }
  const rawBody = bodyRead.text;
  const signature = request.headers.get('x-paystack-signature') ?? '';
  if (!(await verifySignature(rawBody, signature))) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: JsonRecord;
  try {
    payload = JSON.parse(rawBody) as JsonRecord;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType = asString(payload.event) ?? 'unknown';
  const data = isRecord(payload.data) ? payload.data : {};
  const fingerprint = await sha256Hex(rawBody);

  const existing = await rest<Array<{ processed_at: string | null }>>(
    `/rest/v1/billing_provider_events?select=processed_at&event_fingerprint=eq.${encodeURIComponent(fingerprint)}&limit=1`,
  );
  if (existing[0]?.processed_at) return new Response('OK', { status: 200 });

  try {
    const resolution = await resolveTenant(eventType, data);
    if (resolution) {
      await applyEvent(eventType, data, resolution);
    }

    await recordEvent({
      fingerprint,
      eventType,
      tenantId: resolution?.tenantId ?? null,
      providerReference: eventReference(eventType, data),
      error: null,
    });

    return new Response('OK', { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Billing event processing failed';
    console.error('Paystack webhook processing failed', eventType, message);
    return new Response('Webhook processing failed', { status: 500 });
  }
}));

async function resolveTenant(eventType: string, data: JsonRecord): Promise<TenantResolution | null> {
  const reference = asString(data.reference) ?? nestedString(data, ['transaction', 'reference']);

  if (eventType === 'charge.success' && reference) {
    const sessions = await rest<Array<{ tenant_id: string; reference: string; billing_email: string }>>(
      `/rest/v1/billing_checkout_sessions?select=tenant_id,reference,billing_email&reference=eq.${encodeURIComponent(reference)}&limit=1`,
    );
    if (sessions[0]) {
      return {
        tenantId: sessions[0].tenant_id,
        checkoutReference: sessions[0].reference,
        billingEmail: sessions[0].billing_email,
      };
    }

    const settlements = await rest<Array<{ tenant_id: string; provider_reference: string }>>(
      `/rest/v1/usage_settlements?select=tenant_id,provider_reference&provider_reference=eq.${encodeURIComponent(reference)}&limit=1`,
    );
    if (settlements[0]) {
      return {
        tenantId: settlements[0].tenant_id,
        usageSettlementReference: settlements[0].provider_reference,
      };
    }
    return null;
  }

  const subscriptionCode = subscriptionRef(data);
  if (subscriptionCode) {
    const subscriptions = await rest<Array<{ tenant_id: string }>>(
      `/rest/v1/tenant_subscriptions?select=tenant_id&provider_subscription_ref=eq.${encodeURIComponent(subscriptionCode)}&limit=2`,
    );
    if (subscriptions.length === 1) return { tenantId: subscriptions[0].tenant_id };
  }

  const customerCode = customerRef(data);
  if (customerCode) {
    const subscriptions = await rest<Array<{ tenant_id: string }>>(
      `/rest/v1/tenant_subscriptions?select=tenant_id&provider_customer_ref=eq.${encodeURIComponent(customerCode)}&limit=2`,
    );
    if (subscriptions.length === 1) return { tenantId: subscriptions[0].tenant_id };
  }

  if (eventType === 'subscription.create') {
    const email = customerEmail(data);
    if (email) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const sessions = await rest<Array<{ tenant_id: string; reference: string }>>(
        `/rest/v1/billing_checkout_sessions?select=tenant_id,reference&billing_email=eq.${encodeURIComponent(email.toLowerCase())}&created_at=gte.${encodeURIComponent(cutoff)}&order=created_at.desc&limit=2`,
      );
      if (sessions.length === 1) return { tenantId: sessions[0].tenant_id, checkoutReference: sessions[0].reference };
    }
  }

  return null;
}

async function applyEvent(eventType: string, data: JsonRecord, resolution: TenantResolution): Promise<void> {
  const tenantId = resolution.tenantId;
  const subscriptionCode = subscriptionRef(data);
  const customerCode = customerRef(data);

  if (eventType === 'charge.success') {
    const reference = asString(data.reference);
    if (!reference) return;

    if (resolution.usageSettlementReference && reference === resolution.usageSettlementReference) {
      await applyUsageSettlementSuccess(tenantId, reference, data);
      return;
    }

    if (reference !== resolution.checkoutReference) return;

    await rest(`/rest/v1/billing_checkout_sessions?reference=eq.${encodeURIComponent(reference)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'paid',
        provider_customer_ref: customerCode,
        provider_subscription_ref: subscriptionCode,
        updated_at: new Date().toISOString(),
      }),
    });

    await updateSubscription(tenantId, {
      status: 'active',
      provider: 'paystack',
      provider_customer_ref: customerCode,
      ...(subscriptionCode ? { provider_subscription_ref: subscriptionCode } : {}),
      current_period_start: asString(data.paid_at) ?? new Date().toISOString(),
      grace_ends_at: null,
      cancel_at_period_end: false,
    });

    await captureReusableAuthorization(tenantId, data, resolution.billingEmail ?? null);
    return;
  }

  if (eventType === 'subscription.create') {
    await updateSubscription(tenantId, {
      status: 'active',
      provider: 'paystack',
      provider_customer_ref: customerCode,
      provider_subscription_ref: subscriptionCode,
      current_period_start: asString(data.createdAt) ?? asString(data.created_at) ?? new Date().toISOString(),
      current_period_end: asString(data.next_payment_date),
      grace_ends_at: null,
      cancel_at_period_end: false,
    });

    if (resolution.checkoutReference) {
      await rest(`/rest/v1/billing_checkout_sessions?reference=eq.${encodeURIComponent(resolution.checkoutReference)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          provider_customer_ref: customerCode,
          provider_subscription_ref: subscriptionCode,
          updated_at: new Date().toISOString(),
        }),
      });
    }
    return;
  }

  if (eventType === 'invoice.update') {
    const paid = data.paid === true || asString(data.status) === 'success';
    if (!paid) return;
    await updateSubscription(tenantId, {
      status: 'active',
      provider: 'paystack',
      provider_customer_ref: customerCode,
      provider_subscription_ref: subscriptionCode,
      current_period_start: asString(data.period_start),
      current_period_end: asString(data.period_end),
      grace_ends_at: null,
    });
    return;
  }

  if (eventType === 'invoice.payment_failed') {
    await updateSubscription(tenantId, {
      status: 'past_due',
      provider: 'paystack',
      provider_customer_ref: customerCode,
      provider_subscription_ref: subscriptionCode,
      grace_ends_at: null,
    });
    return;
  }

  if (eventType === 'subscription.not_renew') {
    await updateSubscription(tenantId, {
      provider: 'paystack',
      provider_customer_ref: customerCode,
      provider_subscription_ref: subscriptionCode,
      cancel_at_period_end: true,
    });
    return;
  }

  if (eventType === 'subscription.disable') {
    await updateSubscription(tenantId, {
      status: 'cancelled',
      provider: 'paystack',
      provider_customer_ref: customerCode,
      provider_subscription_ref: subscriptionCode,
      cancel_at_period_end: true,
    });
  }
}

async function applyUsageSettlementSuccess(
  tenantId: string,
  reference: string,
  data: JsonRecord,
): Promise<void> {
  const settlements = await rest<Array<{
    id: string;
    amount: number | string;
    currency: string;
    status: string;
  }>>(
    `/rest/v1/usage_settlements?select=id,amount,currency,status&tenant_id=eq.${encodeURIComponent(tenantId)}&provider_reference=eq.${encodeURIComponent(reference)}&limit=1`,
  );
  const settlement = settlements[0];
  if (!settlement) return;
  if (settlement.status === 'paid') return;

  const expectedAmount = toNumber(settlement.amount);
  const providerAmountSubunit = toNumber(data.amount);
  const providerCurrency = asString(data.currency);
  if (
    expectedAmount === null ||
    providerAmountSubunit === null ||
    Math.round(expectedAmount * 100) !== Math.round(providerAmountSubunit) ||
    providerCurrency !== settlement.currency
  ) {
    throw new Error('Usage settlement charge does not match the prepared amount/currency');
  }

  await rest(`/rest/v1/usage_settlements?id=eq.${encodeURIComponent(settlement.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'paid',
      provider_transaction_ref: providerTransactionRef(data),
      last_error: null,
      paid_at: asString(data.paid_at) ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
}

async function captureReusableAuthorization(
  tenantId: string,
  data: JsonRecord,
  fallbackBillingEmail: string | null,
): Promise<void> {
  const authorization = isRecord(data.authorization)
    ? data.authorization
    : isRecord(data.transaction) && isRecord(data.transaction.authorization)
      ? data.transaction.authorization
      : null;
  if (!authorization) return;

  const authorizationCode = asString(authorization.authorization_code);
  if (!authorizationCode || authorization.reusable !== true) return;

  const billingEmail = (customerEmail(data) ?? fallbackBillingEmail)?.toLowerCase() ?? null;
  if (!billingEmail) {
    console.warn('Reusable Paystack authorization not captured because billing email is unavailable');
    return;
  }

  const key = await importBillingAuthorizationKey();
  if (!key) {
    console.warn('Reusable Paystack authorization not captured because billing encryption key is not configured');
    return;
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(authorizationCode),
  );

  await rest('/rest/v1/billing_payment_authorizations?on_conflict=tenant_id,provider', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      tenant_id: tenantId,
      provider: 'paystack',
      billing_email: billingEmail,
      provider_customer_ref: customerRef(data),
      authorization_ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
      authorization_iv: bytesToBase64(iv),
      encryption_key_version: 1,
      channel: asString(authorization.channel),
      reusable: true,
      status: 'active',
      captured_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
}

async function importBillingAuthorizationKey(): Promise<CryptoKey | null> {
  if (!BILLING_AUTH_ENCRYPTION_KEY) return null;
  try {
    const raw = base64ToBytes(BILLING_AUTH_ENCRYPTION_KEY);
    if (raw.byteLength !== 32) return null;
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  } catch {
    return null;
  }
}

function base64ToBytes(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function providerTransactionRef(data: JsonRecord): string | null {
  const id = data.id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return asString(id) ?? asString(data.reference);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function updateSubscription(tenantId: string, patch: JsonRecord): Promise<void> {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  await rest(`/rest/v1/tenant_subscriptions?tenant_id=eq.${encodeURIComponent(tenantId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...clean, updated_at: new Date().toISOString() }),
  });
}

async function recordEvent(input: {
  fingerprint: string;
  eventType: string;
  tenantId: string | null;
  providerReference: string | null;
  error: string | null;
}): Promise<void> {
  await rest('/rest/v1/billing_provider_events?on_conflict=event_fingerprint', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      provider: 'paystack',
      event_fingerprint: input.fingerprint,
      event_type: input.eventType,
      tenant_id: input.tenantId,
      provider_reference: input.providerReference,
      processed_at: new Date().toISOString(),
      processing_error: input.error,
    }),
  });
}

function subscriptionRef(data: JsonRecord): string | null {
  return asString(data.subscription_code) ?? nestedString(data, ['subscription', 'subscription_code']);
}

function customerRef(data: JsonRecord): string | null {
  return nestedString(data, ['customer', 'customer_code']) ?? asString(data.customer_code);
}

function customerEmail(data: JsonRecord): string | null {
  return nestedString(data, ['customer', 'email']) ?? asString(data.email);
}

function eventReference(eventType: string, data: JsonRecord): string | null {
  return subscriptionRef(data) ?? asString(data.reference) ?? nestedString(data, ['transaction', 'reference']) ?? eventType;
}

function nestedString(record: JsonRecord, path: string[]): string | null {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return asString(current);
}

async function verifySignature(rawBody: string, signature: string): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(PAYSTACK_SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  return constantTimeEqual(toHex(new Uint8Array(digest)), signature.toLowerCase());
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase REST ${response.status}: ${detail.slice(0, 500)}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

type ObservabilityHandler = (request: Request) => Response | Promise<Response>;

function withObservability(service: string, handler: ObservabilityHandler): ObservabilityHandler {
  return async (request: Request) => {
    const requestId = observabilityRequestId(request);
    const startedAt = Date.now();
    const path = observabilityPath(request.url);

    emitObservability('info', {
      service,
      event: 'request_started',
      request_id: requestId,
      method: request.method,
      path,
    });

    try {
      const response = await handler(request);
      const durationMs = Math.max(0, Date.now() - startedAt);
      const level = response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info';

      emitObservability(level, {
        service,
        event: 'request_finished',
        request_id: requestId,
        method: request.method,
        path,
        status: response.status,
        duration_ms: durationMs,
      });

      const headers = new Headers(response.headers);
      headers.set('x-orderdesk-request-id', requestId);
      if (headers.has('access-control-allow-origin')) {
        const existing = headers.get('access-control-expose-headers');
        const exposed = new Set(
          (existing ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        );
        exposed.add('x-orderdesk-request-id');
        headers.set('access-control-expose-headers', [...exposed].join(', '));
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      emitObservability('error', {
        service,
        event: 'request_exception',
        request_id: requestId,
        method: request.method,
        path,
        duration_ms: Math.max(0, Date.now() - startedAt),
        error: sanitizeObservabilityError(error),
      });
      throw error;
    }
  };
}

function observabilityRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id')?.trim() ?? '';
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

function observabilityPath(urlValue: string): string {
  try {
    return new URL(urlValue).pathname;
  } catch {
    return '/';
  }
}

function sanitizeObservabilityError(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { name: 'UnknownError', message: 'Unhandled server error' };

  const message = error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|sb_secret)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);

  return {
    name: error.name || 'Error',
    message: message || 'Unhandled server error',
  };
}

function emitObservability(
  level: 'info' | 'warn' | 'error',
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...fields,
  });

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { ok: false };
    }
  }

  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }

    parts.push(decoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be released after cancellation.
    }
  }
}

