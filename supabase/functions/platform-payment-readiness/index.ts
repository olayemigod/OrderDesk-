type JsonRecord = Record<string, unknown>;

type VerifiedIdentity = {
  userId: string;
  aal: 'aal1' | 'aal2';
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MERCHANT_WEB_URL = Deno.env.get('SELLERTRAY_MERCHANT_WEB_URL')?.trim() || 'https://sellertray-merchant.vercel.app/';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Server configuration error' }, 500);

  const identity = await verifiedIdentity(request.headers.get('authorization') ?? '');
  if (!identity) return json({ error: 'Authentication required' }, 401);
  if (identity.aal !== 'aal2') {
    return json({ error: 'MFA verification is required for ProcessEdge administrator access' }, 403);
  }

  try {
    const bootstrap = await rpc<JsonRecord>('platform_admin_bootstrap', {
      p_actor_user_id: identity.userId,
    });
    if (bootstrap.actorRole !== 'admin' && bootstrap.actorRole !== 'support') {
      return json({ error: 'ProcessEdge platform administrator access required' }, 403);
    }

    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')?.trim() ?? '';
    const billingEncryptionKey = Deno.env.get('BILLING_AUTH_ENCRYPTION_KEY')?.trim() ?? '';
    const billingEncryptionValid = validBillingEncryptionKey(billingEncryptionKey);
    const paystackMode = !paystackSecret
      ? 'not_configured'
      : paystackSecret.startsWith('sk_live_')
        ? 'live'
        : paystackSecret.startsWith('sk_test_')
          ? 'test'
          : 'unknown';

    return json({
      readiness: {
        provider: 'paystack',
        paystackConfigured: Boolean(paystackSecret),
        paystackMode,
        billingAuthorizationEncryptionConfigured: Boolean(billingEncryptionKey),
        billingAuthorizationEncryptionValid: billingEncryptionValid,
        checkoutFunction: 'billing-checkout',
        webhookFunction: 'paystack-webhook',
        webhookUrl: `${SUPABASE_URL}/functions/v1/paystack-webhook`,
        merchantCallbackUrl: MERCHANT_WEB_URL,
        readyForLiveCheckout:
          paystackMode === 'live' && Boolean(billingEncryptionKey) && billingEncryptionValid,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment infrastructure readiness failed';
    const status = /administrator access|required/i.test(message) ? 403 : 400;
    return json({ error: message }, status);
  }
});

async function verifiedIdentity(authorization: string): Promise<VerifiedIdentity | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  if (!token) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization },
  });
  if (!response.ok) return null;

  let user: JsonRecord;
  try {
    user = await response.json() as JsonRecord;
  } catch {
    return null;
  }

  const userId = cleanUuid(user.id);
  const aal = getJwtAal(token);
  return userId && aal ? { userId, aal } : null;
}

async function rpc<T>(name: string, body: JsonRecord): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Platform admin RPC failed with HTTP ${response.status}`;
    try {
      const payload = await response.json() as JsonRecord;
      if (typeof payload.message === 'string' && payload.message) message = payload.message;
      else if (typeof payload.error === 'string' && payload.error) message = payload.error;
    } catch {
      // Keep bounded fallback message.
    }
    throw new Error(message);
  }

  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

function validBillingEncryptionKey(value: string): boolean {
  if (!value) return false;
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return bytes.length === 32;
  } catch {
    return false;
  }
}

function getJwtAal(token: string): 'aal1' | 'aal2' | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as JsonRecord;
    return payload.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return null;
  }
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
