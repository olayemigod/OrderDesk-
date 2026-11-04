import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

type JsonRecord = Record<string, unknown>;
type AdminAction = 'invite' | 'reconcile_invite' | 'link_existing' | 'set_status' | 'assign' | 'revoke_assignment';
type Action = AdminAction | 'mine' | 'devices' | 'submit_handover' | 'handover_list' | 'staff_list' | 'profile';
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
  let body: JsonRecord;
  try { body = await request.json() as JsonRecord; } catch { return json({ error: 'Invalid JSON' }, 400); }
  const action = cleanAction(body.action);
  if (!action) return json({ error: 'Unsupported installer action' }, 400);
  // The first login is AAL1; allow only an own-identity, status-only lookup.
  // All actual appointment reads and privileged operations require AAL2.
  if(action === 'profile') {
    try {
      const profile = await rpc<JsonRecord>('get_sellertray_setup_installer_profile', {
        p_actor_user_id: identity.userId,
      });
      return json({
        isInstaller: profile.isInstaller === true,
        status: typeof profile.status === 'string' ? profile.status : null,
      });
    } catch {
      return json({ error: 'Unable to verify ProcessEdge installation access' }, 400);
    }
  }
  if (identity.aal !== 'aal2') {
    return json({ error: 'Multi-factor verification is required for ProcessEdge installation access' }, 403);
  }

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

  // Read-only, exact-appointment device inspection for assigned ProcessEdge
  // installers. Do not return customer, commerce, or payment data, and never
  // authorize by a Business ID alone.
  if (action === 'devices') {
    const tenantId = cleanUuid(body.tenantId);
    const branchId = cleanUuid(body.branchId);
    const appointmentId = cleanUuid(body.appointmentId);
    if (!tenantId || !branchId || !appointmentId) {
      return json({ error: 'Assigned Business, Branch and appointment are required' }, 400);
    }
    try {
      const entitled = await rpc<boolean>('sellertray_setup_installer_has_assignment', {
        p_actor_user_id: identity.userId,
        p_tenant_id: tenantId, p_branch_id: branchId,
        p_appointment_id: appointmentId,
        p_as_of: new Date().toISOString(),
      });
      if (entitled !== true) return json({ error: 'This installation assignment is no longer available' }, 403);
      const {data: boundJobs,error: bindingError} = await client
        .from('sellertray_installer_test_print_bindings')
        .select('job_id')
        .eq('tenant_id',tenantId).eq('branch_id',branchId)
        .eq('actor_user_id',identity.userId)
        .eq('appointment_id',appointmentId)
        .order('requested_at',{ascending:false}).limit(50);
      if (bindingError) throw new Error('Unable to verify appointment-bound test jobs');
      const boundJobIds=(boundJobs??[]).map(row=>row.job_id);
      const [registerResult, printerResult, testResult] = await Promise.all([
        client.from('sellertray_registers')
          .select('id,code,name,is_active,is_default')
          .eq('tenant_id', tenantId).eq('branch_id', branchId)
          .order('name', { ascending: true }).limit(100),
        client.from('sellertray_printers')
          .select('id,register_id,display_name,transport,hardware_identifier,paper_width_mm,is_active,is_default')
          .eq('tenant_id', tenantId).eq('branch_id', branchId)
          .order('display_name', { ascending: true }).limit(100),
        boundJobIds.length
          ? client.from('sellertray_print_jobs')
              .select('id,printer_id,register_id,status,requested_at,completed_at,requested_by_user_id')
              .eq('tenant_id',tenantId).eq('branch_id',branchId)
              .eq('job_type','test').in('id',boundJobIds)
              .order('requested_at',{ascending:false}).limit(50)
          : Promise.resolve({data: [],error: null}),
      ]);
      if (registerResult.error || printerResult.error || testResult.error) {
        throw new Error('Unable to load the assigned installation device records');
      }
      // A second check closes the window between inspection and revocation.
      const stillEntitled = await rpc<boolean>('sellertray_setup_installer_has_assignment', {
        p_actor_user_id: identity.userId,
        p_tenant_id: tenantId, p_branch_id: branchId,
        p_appointment_id: appointmentId,
        p_as_of: new Date().toISOString(),
      });
      if (stillEntitled !== true) return json({ error: 'This installation assignment has been revoked' }, 403);
      return json({
        appointmentId, branchId,
        registers: registerResult.data ?? [],
        printers: printerResult.data ?? [],
        recentTests: testResult.data ?? [],
      });
    } catch {
      return json({ error: 'Unable to verify assigned installation devices' }, 400);
    }
  }

  if (action === 'submit_handover') {
    // Only the bearer-verified AAL2 identity can submit to the same exact
    // appointment that owns the immutable printed-test binding.
    const tenantId = cleanUuid(body.tenantId);
    const branchId = cleanUuid(body.branchId);
    const appointmentId = cleanUuid(body.appointmentId);
    const printerId = cleanUuid(body.printerId);
    const testJobId = cleanUuid(body.testJobId);
    const condition = cleanField(body.handoverCondition, 2, 500);
    const recipient = cleanField(body.receivedBy, 2, 200);
    const acknowledgement = cleanField(body.acknowledgement, 2, 1000);
    const reason = cleanReason(body.reason);
    const commandKey = cleanField(body.commandKey, 12, 128);
    if (!tenantId || !branchId || !appointmentId || !printerId || !testJobId
      || !condition || !recipient || !acknowledgement || !reason || !commandKey) {
      return json({ error: 'Assigned appointment, successful print and handover details are required' }, 400);
    }
    try {
      const result = await rpc<JsonRecord>('platform_installer_submit_handover', {
        p_actor_user_id: identity.userId,
        p_tenant_id: tenantId, p_branch_id: branchId,
        p_appointment_id: appointmentId, p_printer_id: printerId,
        p_test_job_id: testJobId, p_handover_condition: condition,
        p_received_by: recipient, p_acknowledgement: acknowledgement,
        p_reason: reason, p_command_key: commandKey,
      });
      return json({ ...result, status: 'pending_admin_review' });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Unable to record handover';
      return json({ error }, /authority|access|assignment|permission/i.test(error) ? 403 : 409);
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
        p_tenant_id: action === 'assign' || action === 'handover_list' ? tenantId : null, p_as_of: new Date().toISOString(),
      }),
    ]);
    if (bootstrap.actorRole !== 'admin' || allowed !== true) {
      return json({ error: 'ProcessEdge Platform Admin setup permission required' }, 403);
    }
  } catch {
    return json({ error: 'ProcessEdge Platform Admin setup permission required' }, 403);
  }

  if (action === 'handover_list') {
    if (!tenantId) return json({ error: 'Select the Business for installation handovers' }, 400);
    try {
      const data = await rpc<unknown>('platform_admin_list_installer_handovers', {
        p_actor_user_id: identity.userId, p_tenant_id: tenantId,
      });
      return json({ handovers: Array.isArray(data) ? data : [] });
    } catch {
      return json({ error: 'Unable to review handovers for this Business' }, 400);
    }
  }

  if (action === 'staff_list') {
    try {
      const [roster, reservations] = await Promise.all([
        rpc<JsonRecord>('platform_admin_list_setup_installer_staff', {
          p_actor_user_id: identity.userId, p_tenant_id: tenantId,
        }),
        rpc<unknown>('platform_admin_list_setup_installer_reservations', {
          p_actor_user_id: identity.userId,
        }),
      ]);
      return json({ staff: Array.isArray(roster.staff) ? roster.staff : [],
        assignments: Array.isArray(roster.assignments) ? roster.assignments : [],
        pendingInvitations: Array.isArray(reservations) ? reservations : [] });
    } catch {
      return json({ error: 'Unable to load ProcessEdge installer accounts' }, 400);
    }
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
      if (!INVITE_REDIRECT_URL || !/^https:\/\//.test(INVITE_REDIRECT_URL)) {
        return json({ error: 'ProcessEdge installer invitation destination is not configured' }, 503);
      }
      // Establish a durable internal identity claim before any external mail.
      // A partially delivered invitation must never fall through to Merchant.
      await rpc<string>('platform_admin_reserve_setup_installer_invitation', {
        p_actor_user_id: identity.userId, p_email: email, p_worker_id: workerId,
        p_command_id: commandId, p_reason: reason,
      });

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

      // Mark once *before* requesting Auth delivery. A timeout or partial
      // failure requires explicit reconciliation, not an automatic resend.
      const maySend = await rpc<boolean>('platform_admin_begin_setup_installer_delivery', {
        p_actor_user_id: identity.userId, p_command_id: commandId,
      });
      if (!maySend) return json({
        error: 'This installer invitation has already been attempted. Reconcile the reserved staff identity before trying again.',
      }, 409);

      const { data: invitation, error: inviteError } = await client.auth.admin.inviteUserByEmail(email, {
        redirectTo: INVITE_REDIRECT_URL,
      });
      if (inviteError || !invitation.user?.id) {
        return json({
          error: 'Installer invitation delivery could not be confirmed. The internal identity is reserved; review it before another attempt.',
        }, 409);
      }
      try {
        // Preserve the Auth user ID even if account/worker linking fails.
        await rpc<boolean>('platform_admin_bind_setup_installer_invitation', {
          p_actor_user_id: identity.userId,
          p_command_id: commandId, p_auth_user_id: invitation.user.id,
        });
        const userId = await rpc<string>('platform_admin_link_setup_installer', {
          p_actor_user_id: identity.userId,
          p_staff_user_id: invitation.user.id,
          p_worker_id: workerId,
          p_command_id: commandId,
          p_reason: reason,
        });
        await rpc<string>('platform_admin_reconcile_setup_installer_invitation', {
          p_actor_user_id: identity.userId, p_reservation_command_id: commandId,
          p_command_id: commandId, p_reason: reason,
        });
        return json({ staffUserId: userId, status: 'pending', invitationSent: true });
      } catch {
        return json({
          error: 'Invitation may have been delivered. Installer identity remains reserved pending Admin reconciliation; do not resend.',
        }, 409);
      }
    }
    if (action === 'reconcile_invite') {
      const reservationCommandId = cleanUuid(body.reservationCommandId);
      if (!reservationCommandId) return json({ error: 'Invitation reservation ID required' }, 400);
      const userId = await rpc<string>('platform_admin_reconcile_setup_installer_invitation', {
        p_actor_user_id: identity.userId, p_reservation_command_id: reservationCommandId,
        p_command_id: commandId, p_reason: reason,
      });
      return json({ staffUserId: userId, reconciled: true });
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
  const allowed: Action[] = ['invite','reconcile_invite','link_existing','set_status','assign','revoke_assignment','mine','devices','submit_handover','handover_list','staff_list','profile'];
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
function cleanField(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= minimum && trimmed.length <= maximum ? trimmed : null;
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
