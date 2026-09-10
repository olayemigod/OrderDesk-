type JsonRecord = Record<string, unknown>;

type TeamAction = 'claim' | 'list' | 'invite' | 'set_role' | 'remove' | 'cancel_invite';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('SellerTray team management is missing server configuration.');
    return json({ error: 'Server configuration error' }, 500);
  }

  const authorization = request.headers.get('authorization') ?? '';
  const identity = getJwtIdentity(authorization);
  if (!identity.userId) {
    return json({ error: 'Authentication required' }, 401);
  }

  let body: JsonRecord;
  try {
    body = await request.json() as JsonRecord;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = cleanAction(body.action);
  if (!action) {
    return json({ error: 'Unsupported team action' }, 400);
  }

  try {
    if (action === 'claim') {
      if (!identity.email) return json({ error: 'Authenticated email is required' }, 400);
      const claimed = await rpc<number>('claim_orderdesk_team_invitations', {
        p_user_id: identity.userId,
        p_email: identity.email,
      });
      return json({ claimed: typeof claimed === 'number' ? claimed : 0 });
    }

    const tenantId = cleanUuid(body.tenantId);
    if (!tenantId) return json({ error: 'tenantId is required' }, 400);

    if (action === 'list') {
      const team = await rpc<JsonRecord>('list_orderdesk_team', {
        p_tenant_id: tenantId,
        p_actor_user_id: identity.userId,
      });
      return json({ team });
    }

    const canWrite = await rpc<boolean>('orderdesk_subscription_can_write', {
      p_tenant_id: tenantId,
    });
    if (canWrite !== true) {
      return json({ error: 'SellerTray subscription is read-only. Reactivate the business to change team access.' }, 403);
    }

    if (action === 'invite') {
      const email = cleanEmail(body.email);
      const role = cleanTeamRole(body.role);
      if (!email) return json({ error: 'Enter a valid email address' }, 400);
      if (!role) return json({ error: 'Role must be Manager or Staff' }, 400);

      const result = await rpc<JsonRecord>('invite_orderdesk_team_member', {
        p_tenant_id: tenantId,
        p_actor_user_id: identity.userId,
        p_email: email,
        p_role: role,
      });
      return json({ result }, 201);
    }

    if (action === 'set_role') {
      const targetUserId = cleanUuid(body.targetUserId);
      const role = cleanTeamRole(body.role);
      if (!targetUserId) return json({ error: 'targetUserId is required' }, 400);
      if (!role) return json({ error: 'Role must be Manager or Staff' }, 400);

      await rpc<unknown>('change_orderdesk_team_member', {
        p_tenant_id: tenantId,
        p_actor_user_id: identity.userId,
        p_target_user_id: targetUserId,
        p_action: 'set_role',
        p_role: role,
      });
      return json({ ok: true });
    }

    if (action === 'remove') {
      const targetUserId = cleanUuid(body.targetUserId);
      if (!targetUserId) return json({ error: 'targetUserId is required' }, 400);

      await rpc<unknown>('change_orderdesk_team_member', {
        p_tenant_id: tenantId,
        p_actor_user_id: identity.userId,
        p_target_user_id: targetUserId,
        p_action: 'remove',
        p_role: null,
      });
      return json({ ok: true });
    }

    const invitationId = cleanUuid(body.invitationId);
    if (!invitationId) return json({ error: 'invitationId is required' }, 400);

    await rpc<unknown>('cancel_orderdesk_team_invitation', {
      p_tenant_id: tenantId,
      p_actor_user_id: identity.userId,
      p_invitation_id: invitationId,
    });
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Team management request failed';
    const status = /not a member|only an owner|only an Owner|Managers can|protected|cannot change your own|read-only/i.test(message)
      ? 403
      : /already a member|already/i.test(message)
        ? 409
        : /not found/i.test(message)
          ? 404
          : 400;
    return json({ error: message }, status);
  }
});

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
    const payload = await safeJson(response);
    const message =
      (payload && typeof payload.message === 'string' && payload.message) ||
      (payload && typeof payload.error === 'string' && payload.error) ||
      `Team RPC failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

function getJwtIdentity(authorization: string): { userId: string | null; email: string | null } {
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return { userId: null, email: null };

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as JsonRecord;
    return {
      userId: typeof payload.sub === 'string' && payload.sub ? payload.sub : null,
      email: typeof payload.email === 'string' && payload.email ? payload.email.toLowerCase() : null,
    };
  } catch {
    return { userId: null, email: null };
  }
}

function cleanAction(value: unknown): TeamAction | null {
  if (typeof value !== 'string') return null;
  const supported: TeamAction[] = ['claim', 'list', 'invite', 'set_role', 'remove', 'cancel_invite'];
  return supported.includes(value as TeamAction) ? value as TeamAction : null;
}

function cleanTeamRole(value: unknown): 'manager' | 'staff' | null {
  return value === 'manager' || value === 'staff' ? value : null;
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes('@')) return null;
  return email;
}

function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : null;
}

async function safeJson(response: Response): Promise<JsonRecord | null> {
  try {
    return await response.json() as JsonRecord;
  } catch {
    return null;
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
