import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type AdminAction = 'invite' | 'link_existing' | 'set_status' | 'assign' | 'revoke_assignment';
type Action = AdminAction | 'mine';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const INVITE_REDIRECT_URL = Deno.env.get('SETUP_INSTALLER_INVITE_REDIRECT_URL') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (payload: JsonRecord, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const client = SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!client) return json({ error: 'Installer service is unavailable' }, 503);

  const identity = await verifiedIdentity(request.headers.get('authorization') ?? '');
  if (!identity) return json({ error: 'Authentication required' }, 401);
  if (identity.aal !== 'aal2') {
    return json({ error: 'Multi-factor verification is required for ProcessEdge installation access' }, 403);
  }
  let body: JsonRecord;
  try { body = await request.json() as JsonRecord; } catch { return json({ error: 'Invalid JSON' }, 400); }
  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported installer action' }, 400);

  // Installer users can only see their own exact, active appointments. There
  // is no Merchant Team, platform portfolio or unrelated Branch read.
  if (action === 'mine') {
    try {
      const work = await rpc<unknown>('get_sellertray_setup_installer_work', {
        p_actor_user_id: identity.userId,
      });
      return json({ appointments: Array.isArray(work) ? work : [] });
    } catch {
      return json({ error: 'Unable to load assigned installations' }, 400);
    }
  }

  // A merchant user or an installer must never be able to grant themselves
  // an internal identity/role or assign/revoke their own appointment.
  const tenantId = cleanUuid(body.tenantId);
  try {
    const [bootstrap, allowed] = await Promise.all([
      rpc<JsonRecord>('platform_admin_bootstrap', { p_actor_user_id: identity.userId }),
      rpc<boolean>('platform_admin_has_capability', {
        p_actor_user_id: identity.userId, p_capability_code: 'admin.branch_setup.manage',
        p_tenant_id: action === 'assign' ? tenantId : null, p_as_of: new Date().toISOString(),
      }),
    ]);
    if (bootstrap.actorRole !== 'admin' || allowed !== true) {
      return json({ error: 'ProcessEdge Platform Admin setup permission required' }, 403);
    }
  } catch {
    return json({ error: 'ProcessEdge Platform Admin setup permission required' }, 403);
  }

  const commandId = cleanUuid(body.commandId);
  const reason = cleanReason(body.reason);
  if (!commandId || !reason) return json({ error: 'A command ID and reason are required' }, 400);

  const staffUserId = cleanUuid(body.staffUserId);
  const workerId = cleanUuid(body.workerId);
  const appointmentId = cleanUuid(body.appointmentId);
  const assignmentId = cleanUuid(body.assignmentId);
  const validUntil = cleanDate(body.validUntil);

  try {
    if (action === 'invite') {
      const email = cleanEmail(body.email);
      if (!email || !workerId) return json({ error: 'Installer email and setup worker are required' }, 400);
      // Do not silently send ProcessEdge invitations to the merchant portal.
      if (!INVITE_REDIRECT_URL || !/^https:\/\//.test(INVITE_REDIRECT_URL)) {
        return json({ error: 'ProcessEdge installer invitation destination is not configured' }, 503);
      }
      // A retry of an already completed invite must not send a second email.
      const { data: event, error: eventError } = await client
        .from('sellertray_internal_setup_staff_events')
        .select('staff_user_id,actor_user_id,event_type,reason,details')
        .eq('command_id', commandId).maybeSingle();
      if (eventError) throw eventError;
      if (event) {
        if (event.actor_user_id !== identity.userId || event.event_type !== 'registered'
          || event.reason !== reason || event.details?.workerId !== workerId) {
          return json({ error: 'Installer invite command already used for different facts' }, 409);
        }
        return json({ staffUserId: event.staff_user_id, idempotentReplay: true });
      }

      const { data: invitation, error: inviteError } = await client.auth.admin.inviteUserByEmail(email, {
        redirectTo: INVITE_REDIRECT_URL,
      });
      if (inviteError || !invitation.user?.id) {
        return json({ error: 'Unable to send invitation. Check the staff email or reconcile an existing account.' }, 400);
      }
      try {
        const userId = await rpc<string>('platform_admin_link_setup_installer', {
          p_actor_user_id: identity.userId,
          p_staff_user_id: invitation.user.id,
          p_worker_id: workerId,
          p_command_id: commandId,
          p_reason: reason,
        });
        return json({ staffUserId: userId, status: 'pending', invitationSent: true });
      } catch {
        // External email is not rolled back if linkage fails. Do not retry
        // invitation blindly; require an administrator to reconcile the user.
        return json({ error: 'Invitation may have been delivered; staff account linkage requires review. Do not resend without checking.' }, 409);
      }
    }
    if (action === 'link_existing') {
      if (!workerId || !staffUserId) return json({ error: 'Setup worker and existing user ID required' }, 400);
      const id = await rpc<string>('platform_admin_link_setup_installer', {
        p_actor_user_id: identity.userId,p_staff_user_id: staffUserId,
        p_worker_id: workerId,p_command_id: commandId,p_reason: reason,
      });
      return json({ staffUserId: id,status: 'pending' });
    }
    if (action === 'set_status') {
      const status = body.status;
      if (!staffUserId || (status !== 'active' && status !== 'suspended' && status !== 'revoked')) {
        return json({ error: 'Installer user and valid status are required' }, 400);
      }
      const applied = await rpc<string>('platform_admin_set_setup_installer_status', {
        p_actor_user_id: identity.userId,p_staff_user_id: staffUserId,
        p_status: status,p_command_id: commandId,p_reason: reason,
      });
      return json({ staffUserId,status: applied });
    }
    if (action === 'assign') {
      if (!staffUserId || !tenantId || !appointmentId || !validUntil) {
        return json({ error: 'Installer, Business, appointment and assignment expiry are required' }, 400);
      }
      const id = await rpc<string>('platform_admin_assign_setup_installer', {
        p_actor_user_id: identity.userId,p_staff_user_id: staffUserId,
        p_tenant_id: tenantId,p_appointment_id: appointmentId,
        p_valid_until: validUntil,p_command_id: commandId,p_reason: reason,
      });
      return json({ assignmentId: id });
    }
    if (action === 'revoke_assignment') {
      if (!assignmentId) return json({ error: 'Installer assignment ID required' }, 400);
      await rpc<boolean>('platform_admin_revoke_setup_installer_assignment', {
        p_actor_user_id: identity.userId,p_assignment_id: assignmentId,
        p_command_id: commandId,p_reason: reason,
      });
      return json({ assignmentId, revoked: true });
    }
    return json({ error: 'Unsupported installer action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ProcessEdge installer command failed';
    const status = /permission|capability|required for|unauthorized/i.test(message) ? 403
      : /already|duplicate|conflict|revoked/i.test(message) ? 409 : 400;
    return json({ error: message }, status);
  }
});

async function rpc<T>(name: string, args: JsonRecord): Promise<T> {
  if (!client) throw new Error('Installer server configuration unavailable');
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

async function verifiedIdentity(authorization: string):
  Promise<{ userId: string; aal: 'aal1' | 'aal2' } | null> {
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  if (!token || !SERVICE_ROLE_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization },
  });
  if (!response.ok) return null;
  let body: JsonRecord;
  try { body = await response.json() as JsonRecord; } catch { return null; }
  const userId = cleanUuid(body.id);
  const segment = token.split('.')[1];
  if (!userId || !segment) return null;
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as JsonRecord;
    return { userId, aal: payload.aal === 'aal2' ? 'aal2' : 'aal1' };
  } catch { return null; }
}
function cleanAction(value: unknown): Action | null {
  const allowed: Action[] = ['invite','link_existing','set_status','assign','revoke_assignment','mine'];
  return allowed.find(action => action === value) ?? null;
}
function cleanUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length >= 5 && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function cleanReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason.length >= 6 && reason.length <= 1000 ? reason : null;
}
function cleanDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
