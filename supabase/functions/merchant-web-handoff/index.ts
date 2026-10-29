import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

const encoder = new TextEncoder();
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const MAX_CREATES_PER_MINUTE = 5;

type CreateBody = { action: 'create'; tenantId?: string };
type ConsumeBody = { action: 'consume'; handoffToken?: string };
type HandoffBody = CreateBody | ConsumeBody;

type HandoffTarget = {
  tenantId: string;
  userId: string;
  role: string;
  actionCode: string;
  actionLabel: string;
  targetPage: 'agreements' | 'sellertray_billing' | 'setup';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await request.json() as HandoffBody;
    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = requiredEnv('SUPABASE_ANON_KEY');
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (body.action === 'create') {
      const authorization = request.headers.get('Authorization') ?? '';
      const accessToken = bearerToken(authorization);
      if (!accessToken) return json({ error: 'Authentication required' }, 401);
      const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
      if (!isUuid(tenantId)) return json({ error: 'A valid Business is required' }, 400);

      const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
      if (userError || !userData.user) return json({ error: 'Authentication required' }, 401);

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: targetData, error: targetError } = await userClient.rpc(
        'get_sellertray_merchant_web_handoff_target',
        { p_tenant_id: tenantId },
      );
      if (targetError) return json({ error: safeMessage(targetError.message, 'No Merchant Web onboarding action is currently available') }, targetError.code === '42501' ? 403 : 409);

      const target = parseTarget(targetData);
      if (!target || target.userId !== userData.user.id || target.tenantId !== tenantId) {
        return json({ error: 'Merchant Web handoff could not be authorized' }, 403);
      }

      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
      const { count } = await admin
        .from('sellertray_merchant_web_handoffs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userData.user.id)
        .gte('created_at', oneMinuteAgo);
      if ((count ?? 0) >= MAX_CREATES_PER_MINUTE) {
        return json({ error: 'Too many continuation requests. Try again shortly.' }, 429);
      }

      const secret = randomSecret();
      const tokenHash = await sha256Hex(secret);
      const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString();
      const { error: insertError } = await admin.from('sellertray_merchant_web_handoffs').insert({
        token_hash: tokenHash,
        tenant_id: tenantId,
        user_id: userData.user.id,
        action_code: target.actionCode,
        target_page: target.targetPage,
        source_surface: 'mobile',
        expires_at: expiresAt,
      });
      if (insertError) throw insertError;

      const merchantWebUrl = (Deno.env.get('SELLERTRAY_MERCHANT_WEB_URL') || 'https://sellertray-merchant.vercel.app').replace(/\/+$/, '');
      return json({
        url: `${merchantWebUrl}/#st_handoff=${encodeURIComponent(secret)}`,
        expiresAt,
        actionCode: target.actionCode,
        actionLabel: target.actionLabel,
      });
    }

    if (body.action === 'consume') {
      const secret = typeof body.handoffToken === 'string' ? body.handoffToken.trim() : '';
      if (!/^[A-Za-z0-9_-]{40,128}$/.test(secret)) return json({ error: 'Invalid or expired handoff' }, 400);
      const tokenHash = await sha256Hex(secret);
      const now = new Date().toISOString();

      const { data: row, error: consumeError } = await admin
        .from('sellertray_merchant_web_handoffs')
        .update({ consumed_at: now })
        .eq('token_hash', tokenHash)
        .is('consumed_at', null)
        .gt('expires_at', now)
        .select('tenant_id,user_id,action_code,target_page')
        .maybeSingle();
      if (consumeError) throw consumeError;
      if (!row) return json({ error: 'This continuation link has expired or was already used' }, 410);

      const { data: membership, error: membershipError } = await admin
        .from('tenant_members')
        .select('role')
        .eq('tenant_id', row.tenant_id)
        .eq('user_id', row.user_id)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership || !['owner', 'manager'].includes(String(membership.role))) {
        return json({ error: 'Merchant Web access is no longer authorized for this Business' }, 403);
      }

      const { data: userData, error: userError } = await admin.auth.admin.getUserById(row.user_id);
      const email = userData.user?.email;
      if (userError || !email) return json({ error: 'SellerTray account could not be verified' }, 403);

      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });
      if (linkError || !linkData.properties?.hashed_token) {
        return json({ error: 'SellerTray could not establish the Merchant Web session' }, 503);
      }

      return json({
        tokenHash: linkData.properties.hashed_token,
        tenantId: row.tenant_id,
        actionCode: row.action_code,
        targetPage: row.target_page,
      });
    }

    return json({ error: 'Unsupported handoff action' }, 400);
  } catch (error) {
    console.error('merchant-web-handoff', error);
    return json({ error: 'SellerTray could not continue securely to Merchant Web' }, 500);
  }
});

function parseTarget(value: unknown): HandoffTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const targetPage = String(row.targetPage ?? '');
  if (!['agreements', 'sellertray_billing', 'setup'].includes(targetPage)) return null;
  const target: HandoffTarget = {
    tenantId: String(row.tenantId ?? ''),
    userId: String(row.userId ?? ''),
    role: String(row.role ?? ''),
    actionCode: String(row.actionCode ?? ''),
    actionLabel: String(row.actionLabel ?? 'Continue onboarding'),
    targetPage: targetPage as HandoffTarget['targetPage'],
  };
  return isUuid(target.tenantId) && isUuid(target.userId) && ['owner', 'manager'].includes(target.role) && target.actionCode
    ? target
    : null;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bearerToken(value: string): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeMessage(value: unknown, fallback: string): string {
  const message = typeof value === 'string' ? value : '';
  if (/Owner|Manager|Merchant Web onboarding action|Authentication/i.test(message)) return message;
  return fallback;
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
