import { createClient, type Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // This restricted portal accepts password authentication only. Recovery,
    // magic-link and OAuth URL sessions are not consumed automatically here.
    detectSessionInUrl: false,
  },
});

export async function invokeJson<T>(
  functionName: string,
  body: Record<string, unknown>,
  session?: Session | null,
): Promise<T> {
  const activeSession = session ?? (await supabase.auth.getSession()).data.session;
  if (!activeSession?.access_token) throw new Error('Your admin session has expired. Sign in again.');
  const optionalAuditRequest = functionName === 'platform-admin' && body.action === 'audit';
  const publishRequest = functionName === 'platform-merchant-message';
  const requestBody = { ...body };
  let publishStorageKey: string | null = null;

  if (publishRequest) {
    publishStorageKey = await idempotencyStorageKey(requestBody);
    const existingRequestId = sessionStorage.getItem(publishStorageKey);
    const requestId = existingRequestId || crypto.randomUUID();
    sessionStorage.setItem(publishStorageKey, requestId);
    requestBody.requestId = requestId;
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/${encodeURIComponent(functionName)}`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        apikey: supabasePublishableKey,
        authorization: `Bearer ${activeSession.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    // Keep the publish UUID after an uncertain network failure. A retry of the
    // same payload reuses it and the database returns the original campaign.
    if (optionalAuditRequest) return emptyAuditResponse<T>();
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('SellerTray did not respond in time. Check the operation status before retrying.');
    }
    throw error;
  }

  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    // A definite HTTP failure did not leave us with an ambiguous client-side
    // timeout. Clear the key so a corrected request can start a new operation.
    if (publishStorageKey) sessionStorage.removeItem(publishStorageKey);
    if (optionalAuditRequest) return emptyAuditResponse<T>();
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `SellerTray admin request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  if (publishStorageKey) sessionStorage.removeItem(publishStorageKey);
  return (payload ?? {}) as T;
}

async function idempotencyStorageKey(body: Record<string, unknown>): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sellertray-admin-publish:${hash}`;
}

function emptyAuditResponse<T>(): T {
  return { audit: { events: [] } } as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
