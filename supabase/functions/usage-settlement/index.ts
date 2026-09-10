type JsonRecord = Record<string, unknown>;
type SettlementAction = 'prepare' | 'status' | 'reconcile' | 'charge';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WORKER_TOKEN = Deno.env.get('USAGE_SETTLEMENT_TOKEN') ?? '';
const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
const BILLING_AUTH_ENCRYPTION_KEY = Deno.env.get('BILLING_AUTH_ENCRYPTION_KEY') ?? '';
const USAGE_BILLING_LIVE = Deno.env.get('USAGE_BILLING_LIVE') === 'true';
const MAX_BODY_BYTES = 65_536;

Deno.serve(withObservability('usage-settlement', async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !WORKER_TOKEN) {
    return json({ error: 'Usage settlement worker not configured' }, 503);
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (!constantTimeEqual(authorization, `Bearer ${WORKER_TOKEN}`)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const bodyRead = await readRequestTextLimited(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'Payload too large' }, 413);

  let body: JsonRecord;
  try {
    body = JSON.parse(bodyRead.text) as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported usage settlement action' }, 400);

  try {
    if (action === 'prepare') {
      const tenantId = cleanUuid(body.tenantId);
      const periodStart = cleanTimestamp(body.periodStart);
      const periodEnd = cleanTimestamp(body.periodEnd);
      if (!tenantId || !periodStart || !periodEnd || new Date(periodEnd) <= new Date(periodStart)) {
        return json({ error: 'tenantId, periodStart and periodEnd are required' }, 400);
      }

      const settlement = await rpc<JsonRecord>('prepare_orderdesk_usage_settlement', {
        p_tenant_id: tenantId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      return json({ settlement, liveChargingEnabled: USAGE_BILLING_LIVE });
    }

    const settlementId = cleanUuid(body.settlementId);
    if (!settlementId) return json({ error: 'settlementId is required' }, 400);

    if (action === 'status') {
      const settlement = await loadSettlement(settlementId);
      if (!settlement) return json({ error: 'Usage settlement not found' }, 404);
      return json({ settlement: sanitizeSettlement(settlement), liveChargingEnabled: USAGE_BILLING_LIVE });
    }

    if (action === 'reconcile') {
      if (!PAYSTACK_SECRET_KEY) {
        return json({ error: 'Paystack secret is not configured for settlement reconciliation' }, 503);
      }

      const settlement = await loadSettlement(settlementId);
      if (!settlement) return json({ error: 'Usage settlement not found' }, 404);
      if (settlement.status === 'paid') {
        return json({ settlement: sanitizeSettlement(settlement), providerStatus: 'success', alreadyPaid: true });
      }

      const verifyResponse = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(String(settlement.provider_reference ?? ''))}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        },
      );

      let verifyPayload: JsonRecord | null = null;
      try {
        verifyPayload = await verifyResponse.json() as JsonRecord;
      } catch {
        verifyPayload = null;
      }

      if (!verifyResponse.ok || verifyPayload?.status !== true || !isRecord(verifyPayload.data)) {
        return json({
          settlement: sanitizeSettlement(settlement),
          providerStatus: 'unverified',
          verificationHttpStatus: verifyResponse.status,
        }, verifyResponse.status === 404 ? 200 : 502);
      }

      const providerStatus = asString(verifyPayload.data.status) ?? 'unknown';
      if (providerStatus === 'success') {
        const mismatch = settlementProviderMismatch(settlement, verifyPayload.data);
        if (mismatch) {
          return json({ error: mismatch, providerStatus }, 409);
        }

        await rest(`/rest/v1/usage_settlements?id=eq.${encodeURIComponent(settlement.id)}&status=neq.paid`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            status: 'paid',
            provider_transaction_ref: providerTransactionRef(verifyPayload.data),
            last_error: null,
            paid_at: asString(verifyPayload.data.paid_at) ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
      } else if (['failed', 'abandoned', 'reversed'].includes(providerStatus)) {
        await rest(`/rest/v1/usage_settlements?id=eq.${encodeURIComponent(settlement.id)}&status=neq.paid`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            status: 'failed',
            last_error: `Paystack verified transaction status: ${providerStatus}`,
            updated_at: new Date().toISOString(),
          }),
        });
      }

      const refreshed = await loadSettlement(settlement.id);
      return json({
        settlement: refreshed ? sanitizeSettlement(refreshed) : sanitizeSettlement(settlement),
        providerStatus,
      });
    }

    if (!USAGE_BILLING_LIVE) {
      return json({ error: 'Usage billing live charging is disabled' }, 409);
    }

    const settlement = await loadSettlement(settlementId);
    if (!settlement) return json({ error: 'Usage settlement not found' }, 404);
    if (settlement.status === 'paid' || settlement.status === 'submitted') {
      return json({ settlement: sanitizeSettlement(settlement), duplicateChargePrevented: true });
    }
    const settlementPeriodEnd = cleanTimestamp(settlement.period_end);
    if (!settlementPeriodEnd || new Date(settlementPeriodEnd) > new Date()) {
      return json({ error: 'Usage settlement period is not closed' }, 409);
    }
    if (settlement.status !== 'pending') {
      return json({ error: 'Only a pending usage settlement can be charged' }, 409);
    }

    const databaseChargingEnabled = await rpc<boolean>('orderdesk_usage_charging_enabled', {
      p_tenant_id: settlement.tenant_id,
    });
    if (databaseChargingEnabled !== true) {
      return json({ error: 'Usage billing database charging gate is disabled' }, 409);
    }
    if (!PAYSTACK_SECRET_KEY || !BILLING_AUTH_ENCRYPTION_KEY) {
      return json({ error: 'Usage billing provider secrets are not configured' }, 503);
    }

    const paymentAuthorization = await loadPaymentAuthorization(settlement.tenant_id);
    if (!paymentAuthorization) {
      return json({ error: 'No active reusable Paystack authorization is available for this tenant' }, 409);
    }

    const authorizationCode = await decryptAuthorization(paymentAuthorization);
    if (!authorizationCode) {
      return json({ error: 'Stored Paystack authorization could not be decrypted' }, 503);
    }

    const amount = toNumber(settlement.amount);
    if (amount === null || amount <= 0) return json({ error: 'Settlement amount is invalid' }, 409);

    const claimedAt = new Date().toISOString();
    const claimRows = await rest<JsonRecord[]>(
      `/rest/v1/usage_settlements?id=eq.${encodeURIComponent(settlement.id)}&status=eq.pending&select=id,status`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          status: 'submitted',
          submitted_at: claimedAt,
          updated_at: claimedAt,
        }),
      },
    );
    if (!claimRows[0]) {
      const claimedSettlement = await loadSettlement(settlement.id);
      return json({
        settlement: claimedSettlement ? sanitizeSettlement(claimedSettlement) : sanitizeSettlement(settlement),
        duplicateChargePrevented: true,
        chargeClaimedByAnotherRequest: true,
      });
    }

    const paystackResponse = await fetch('https://api.paystack.co/transaction/charge_authorization', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        authorization_code: authorizationCode,
        email: paymentAuthorization.billing_email,
        amount: String(Math.round(amount * 100)),
        currency: settlement.currency,
        reference: settlement.provider_reference,
        metadata: JSON.stringify({
          sellertrayTenantId: settlement.tenant_id,
          sellertrayUsageSettlementId: settlement.id,
          sellertrayUsageEventCode: settlement.event_code,
          sellertrayUsageUnits: settlement.units,
        }),
      }),
    });

    let providerPayload: JsonRecord | null = null;
    try {
      providerPayload = await paystackResponse.json() as JsonRecord;
    } catch {
      providerPayload = null;
    }

    if (!paystackResponse.ok || providerPayload?.status !== true || !isRecord(providerPayload.data)) {
      await markSettlementFailure(
        settlement.id,
        `Paystack usage charge failed with HTTP ${paystackResponse.status}`,
      );
      return json({ error: 'Usage charge was not accepted by Paystack; automatic retry is disabled' }, 502);
    }

    const providerStatus = asString(providerPayload.data.status);
    if (providerStatus !== 'success') {
      await markSettlementFailure(
        settlement.id,
        `Paystack usage charge returned status ${providerStatus ?? 'unknown'}`,
      );
      return json({ error: 'Usage charge did not complete successfully; automatic retry is disabled' }, 502);
    }

    await rest(
      `/rest/v1/usage_settlements?id=eq.${encodeURIComponent(settlement.id)}&status=eq.submitted`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          provider_transaction_ref: providerTransactionRef(providerPayload.data),
          last_error: null,
          updated_at: new Date().toISOString(),
        }),
      },
    );

    const refreshed = await loadSettlement(settlement.id);
    return json({
      settlement: refreshed ? sanitizeSettlement(refreshed) : sanitizeSettlement(settlement),
      awaitingWebhookReconciliation: refreshed?.status !== 'paid',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Usage settlement request failed';
    console.error('Usage settlement request failed', message);
    return json({ error: message.slice(0, 300) }, 400);
  }
}));

async function loadSettlement(id: string): Promise<JsonRecord | null> {
  const rows = await rest<JsonRecord[]>(
    `/rest/v1/usage_settlements?select=id,tenant_id,event_code,period_start,period_end,currency,units,amount,status,provider,provider_reference,provider_transaction_ref,last_error,prepared_at,submitted_at,paid_at,updated_at&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] ?? null;
}

async function loadPaymentAuthorization(tenantId: string): Promise<JsonRecord | null> {
  const rows = await rest<JsonRecord[]>(
    `/rest/v1/billing_payment_authorizations?select=id,tenant_id,billing_email,authorization_ciphertext,authorization_iv,encryption_key_version,reusable,status&tenant_id=eq.${encodeURIComponent(tenantId)}&provider=eq.paystack&status=eq.active&reusable=eq.true&limit=1`,
  );
  return rows[0] ?? null;
}

async function decryptAuthorization(row: JsonRecord): Promise<string | null> {
  const ciphertext = asString(row.authorization_ciphertext);
  const ivValue = asString(row.authorization_iv);
  if (!ciphertext || !ivValue || row.encryption_key_version !== 1) return null;

  const key = await importBillingAuthorizationKey();
  if (!key) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivValue) },
      key,
      base64ToBytes(ciphertext),
    );
    return decoder.decode(plaintext);
  } catch {
    return null;
  }
}

async function importBillingAuthorizationKey(): Promise<CryptoKey | null> {
  if (!BILLING_AUTH_ENCRYPTION_KEY) return null;
  try {
    const raw = base64ToBytes(BILLING_AUTH_ENCRYPTION_KEY);
    if (raw.byteLength !== 32) return null;
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  } catch {
    return null;
  }
}

async function markSettlementFailure(id: string, error: string): Promise<void> {
  await rest(`/rest/v1/usage_settlements?id=eq.${encodeURIComponent(id)}&status=eq.submitted`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'failed',
      last_error: error.slice(0, 500),
      updated_at: new Date().toISOString(),
    }),
  });
}

function sanitizeSettlement(row: JsonRecord): JsonRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventCode: row.event_code,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: row.currency,
    units: row.units,
    amount: row.amount,
    status: row.status,
    provider: row.provider,
    providerReference: row.provider_reference,
    providerTransactionRef: row.provider_transaction_ref,
    lastError: row.last_error,
    preparedAt: row.prepared_at,
    submittedAt: row.submitted_at,
    paidAt: row.paid_at,
    updatedAt: row.updated_at,
  };
}

async function rpc<T>(name: string, body: JsonRecord): Promise<T> {
  return rest<T>(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
  const raw = await response.text();
  return (raw ? JSON.parse(raw) : undefined) as T;
}

function cleanAction(value: unknown): SettlementAction | null {
  return value === 'prepare' || value === 'status' || value === 'reconcile' || value === 'charge'
    ? value
    : null;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

function cleanTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function settlementProviderMismatch(settlement: JsonRecord, providerData: JsonRecord): string | null {
  const expectedAmount = toNumber(settlement.amount);
  const providerAmountSubunit = toNumber(providerData.amount);
  const expectedCurrency = asString(settlement.currency);
  const providerCurrency = asString(providerData.currency);

  if (expectedAmount === null || providerAmountSubunit === null) {
    return 'Usage settlement amount could not be verified';
  }
  if (Math.round(expectedAmount * 100) !== Math.round(providerAmountSubunit)) {
    return 'Verified Paystack transaction amount does not match the prepared usage settlement';
  }
  if (!expectedCurrency || !providerCurrency || expectedCurrency !== providerCurrency) {
    return 'Verified Paystack transaction currency does not match the prepared usage settlement';
  }
  return null;
}

function providerTransactionRef(data: JsonRecord): string | null {
  const id = data.id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return asString(id) ?? asString(data.reference);
}

function base64ToBytes(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
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

async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) return { ok: false };
  }

  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const bodyDecoder = new TextDecoder();
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
      parts.push(bodyDecoder.decode(value, { stream: true }));
    }
    parts.push(bodyDecoder.decode());
    return { ok: true, text: parts.join('') };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released after cancellation.
    }
  }
}

type ObservabilityHandler = (request: Request) => Response | Promise<Response>;

function withObservability(service: string, handler: ObservabilityHandler): ObservabilityHandler {
  return async (request: Request) => {
    const requestId = observabilityRequestId(request);
    const startedAt = Date.now();
    const path = observabilityPath(request.url);
    emitObservability('info', { service, event: 'request_started', request_id: requestId, method: request.method, path });

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
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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

function sanitizeObservabilityError(error: unknown): JsonRecord {
  if (!(error instanceof Error)) return { name: 'UnknownError', message: 'Unhandled server error' };
  const message = error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-=]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|sb_secret)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
  return { name: error.name || 'Error', message: message || 'Unhandled server error' };
}

function emitObservability(level: 'info' | 'warn' | 'error', fields: JsonRecord): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
