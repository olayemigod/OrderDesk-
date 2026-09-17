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
      body: JSON.stringify(body),
    });
  } catch (error) {
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
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `SellerTray admin request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  return (payload ?? {}) as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
