import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

type Worker = { id: string; name: string; active: boolean };
type Appointment = {
  id: string;
  workerId: string;
  branchName: string;
  scheduledEndAt: string;
  status: string;
};
type StaffAccount = {
  userId: string;
  email: string | null;
  workerId: string;
  workerName: string;
  role: 'setup_installer';
  status: 'pending' | 'active' | 'suspended' | 'revoked';
  registeredAt: string;
  activatedAt: string | null;
};
type Assignment = {
  assignmentId: string;
  userId: string;
  workerId: string;
  appointmentId: string;
  branchId: string;
  validFrom: string;
  validUntil: string;
  revokedAt: string | null;
};
type InvitationReservation = {
  commandId: string;
  email: string;
  workerId: string;
  deliveryStartedAt: string | null;
  authUserId: string | null;
  linkedAt: string | null;
  createdAt: string;
};
type StaffResponse = {
  staff?: StaffAccount[];
  assignments?: Assignment[];
  pendingInvitations?: InvitationReservation[];
};

// datetime-local must receive the browser's local wall-clock time, not UTC.
function toLocalDateTimeInput(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [value.getFullYear(), '-', pad(value.getMonth() + 1), '-', pad(value.getDate()),
    'T', pad(value.getHours()), ':', pad(value.getMinutes())].join('');
}

export default function ProcessEdgeInstallerStaffManagement({
  session, tenantId, workers, appointments,
}: {
  session: Session;
  tenantId: string;
  workers: Worker[];
  appointments: Appointment[];
}) {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<InvitationReservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteWorkerId, setInviteWorkerId] = useState('');
  const [inviteReason, setInviteReason] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [assignmentExpiresAt, setAssignmentExpiresAt] = useState('');
  const [assignmentReason, setAssignmentReason] = useState('');
  const tenantRef = useRef(tenantId);
  tenantRef.current = tenantId;

  const availableWorkers = useMemo(() => workers.filter((w) => w.active), [workers]);
  const activeStaff = useMemo(() => staff.filter((s) => s.status === 'active'), [staff]);
  const assignableAppointments = useMemo(() => appointments.filter((a) =>
    (a.status === 'scheduled' || a.status === 'in_progress')
    && !assignments.some((x) => x.appointmentId === a.id && x.revokedAt === null),
  ), [appointments, assignments]);
  const selectedAppointment = assignableAppointments.find((a) => a.id === selectedAppointmentId) ?? null;
  const selectedStaff = activeStaff.find((s) => s.userId === selectedStaffId) ?? null;
  const matchingAssignment = Boolean(selectedAppointment && selectedStaff
    && selectedAppointment.workerId === selectedStaff.workerId);

  useEffect(() => {
    setStaff([]);
    setAssignments([]);
    setPendingInvitations([]);
    setSelectedStaffId('');
    setSelectedAppointmentId('');
    setError(null);
    setMessage(null);
    if (tenantId) void load(tenantId);
    // The loaded roster is always bound to the selected Admin Business.
  }, [tenantId, session.access_token]);

  async function load(requestTenant: string) {
    if (!requestTenant) return;
    setLoading(true);
    try {
      const result = await invokeJson<StaffResponse>('platform-setup-installer', {
        action: 'staff_list', tenantId: requestTenant,
      }, session);
      if (tenantRef.current !== requestTenant) return;
      setStaff(Array.isArray(result.staff) ? result.staff : []);
      setAssignments(Array.isArray(result.assignments) ? result.assignments : []);
      setPendingInvitations(Array.isArray(result.pendingInvitations) ? result.pendingInvitations : []);
    } catch (cause) {
      if (tenantRef.current === requestTenant) {
        setError(cause instanceof Error ? cause.message : 'Unable to load ProcessEdge installers.');
      }
    } finally {
      if (tenantRef.current === requestTenant) setLoading(false);
    }
  }

  async function mutate(
    action: string,
    payload: Record<string, unknown>,
    description: string,
  ) {
    if (saving || !tenantId) return;
    const requestTenant = tenantId;
    const fingerprint = JSON.stringify({ action, tenantId: requestTenant, ...payload });
    const storageKey = `sellertray.setupInstaller.command.v1:${action}:${requestTenant}`;
    let pending: { fingerprint: string; commandId: string } | null = null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      pending = raw ? JSON.parse(raw) as { fingerprint: string; commandId: string } : null;
    } catch { pending = null; }
    const commandId = pending?.fingerprint === fingerprint ? pending.commandId : crypto.randomUUID();
    sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, commandId }));
    setSaving(action);setError(null);setMessage(null);
    try {
      await invokeJson('platform-setup-installer', {
        action, tenantId: requestTenant, ...payload, commandId,
      }, session);
      sessionStorage.removeItem(storageKey);
      if (tenantRef.current !== requestTenant) return;
      setMessage(description);
      await load(requestTenant);
    } catch (cause) {
      if (tenantRef.current === requestTenant) {
        setError(cause instanceof Error ? cause.message : 'Installer request failed.');
      }
    } finally {
      if (tenantRef.current === requestTenant) setSaving(null);
    }
  }

  const canInvite = inviteEmail.includes('@') && inviteWorkerId
    && inviteReason.trim().length >= 6 && !saving;
  const canAssign = matchingAssignment && assignmentReason.trim().length >= 6
    && assignmentExpiresAt && Date.parse(assignmentExpiresAt) > Date.now() && !saving;

  return <section className="workspace-panel" aria-label="ProcessEdge installation staff">
    <div className="workspace-panel-heading">
      <div>
        <p className="workspace-eyebrow">ProcessEdge staff access</p>
        <h3>Installation accounts & assignments</h3>
        <p>Invite a ProcessEdge installer, verify their account, and assign only the Branch appointment they will work on. Merchant Team roles are separate.</p>
      </div>
      <button className="workspace-button subtle" type="button" disabled={loading || Boolean(saving)}
        onClick={() => void load(tenantId)}>Refresh</button>
    </div>
    {error ? <div className="workspace-banner error" role="alert">{error}</div> : null}
    {message ? <div className="workspace-banner success" role="status">{message}</div> : null}
    {loading ? <p className="muted">Loading installation accounts…</p> : null}

    <div className="workspace-field-grid two">
      <div className="workspace-form-stack">
        <h4>Invite installer</h4>
        <label>Work email
          <input type="email" autoComplete="email" value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)} placeholder="staff@example.com" />
        </label>
        <label>Setup worker
          <select value={inviteWorkerId} onChange={(e) => setInviteWorkerId(e.target.value)}>
            <option value="">Choose a setup worker</option>
            {availableWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
          </select>
        </label>
        <label>Reason / approval reference
          <input value={inviteReason} maxLength={1000}
            onChange={(e) => setInviteReason(e.target.value)} placeholder="Approved ProcessEdge staff assignment" />
        </label>
        <button className="workspace-button primary" type="button" disabled={!canInvite}
          onClick={() => void mutate('invite',{
            email: inviteEmail.trim(), workerId: inviteWorkerId, reason: inviteReason.trim(),
          },'Invitation request recorded. The installer must verify their account before activation.')}>
          Invite ProcessEdge installer
        </button>
        <p className="muted">An invitation remains pending until the staff member verifies their email and a ProcessEdge Admin activates access. MFA is required.</p>
      </div>
      <div className="workspace-form-stack">
        <h4>Assign an active installer</h4>
        <label>Installer account
          <select value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)}>
            <option value="">Choose an active installer</option>
            {activeStaff.map((s) => <option key={s.userId} value={s.userId}>
              {s.email ?? s.workerName} — {s.workerName}
            </option>)}
          </select>
        </label>
        <label>Purchased Branch appointment
          <select value={selectedAppointmentId} onChange={(e) => {
            setSelectedAppointmentId(e.target.value);
            const appointment = assignableAppointments.find((a) => a.id === e.target.value);
            if (appointment) {
              const end = new Date(Date.parse(appointment.scheduledEndAt) + 24 * 60 * 60 * 1000);
              setAssignmentExpiresAt(toLocalDateTimeInput(end));
            }
          }}>
            <option value="">Choose a scheduled appointment</option>
            {assignableAppointments.map((a) => <option key={a.id} value={a.id}>
              {a.branchName} — {new Date(a.scheduledEndAt).toLocaleString()}
            </option>)}
          </select>
        </label>
        {selectedAppointment && selectedStaff && !matchingAssignment
          ? <p className="muted">This installer must match the appointment's assigned setup worker.</p> : null}
        <label>Assignment expires
          <input type="datetime-local" value={assignmentExpiresAt}
            onChange={(e) => setAssignmentExpiresAt(e.target.value)} />
        </label>
        <label>Reason / approval reference
          <input value={assignmentReason} maxLength={1000}
            onChange={(e) => setAssignmentReason(e.target.value)} />
        </label>
        <button className="workspace-button primary" type="button" disabled={!canAssign}
          onClick={() => void mutate('assign',{
            staffUserId: selectedStaffId, appointmentId: selectedAppointmentId,
            validUntil: new Date(assignmentExpiresAt).toISOString(),
            reason: assignmentReason.trim(),
          },'This installer has been assigned to the selected Branch appointment.')}>
          Assign installer to appointment
        </button>
      </div>
    </div>

    <h4>Installer invitations and reconciliation</h4>
    <p className="muted">Invitation records are internal ProcessEdge staff identities, even if email delivery or account linkage needs review. Reconciliation never sends another invitation.</p>
    {pendingInvitations.length === 0 && !loading
      ? <p className="muted">No installer invitation records yet.</p>
      : <div className="workspace-table-wrap"><table className="workspace-table compact-table">
        <thead><tr><th>Installer email</th><th>Setup worker</th><th>Delivery/linkage</th><th>Action</th></tr></thead>
        <tbody>{pendingInvitations.map((invite) => <tr key={invite.commandId}>
          <td><strong>{invite.email}</strong></td>
          <td>{workers.find((w) => w.id === invite.workerId)?.name ?? 'Assigned ProcessEdge worker'}</td>
          <td>{invite.linkedAt ? 'Linked'
            : invite.deliveryStartedAt ? 'Delivery attempted — verify identity' : 'Reserved — delivery not attempted'}</td>
          <td>{invite.deliveryStartedAt && !invite.linkedAt
            ? <button type="button" className="workspace-button subtle" disabled={Boolean(saving)}
              onClick={() => {
                const reason = window.prompt('Approval reference or reason for reconciling this installer identity?')?.trim();
                if (reason && reason.length >= 6) void mutate('reconcile_invite',{
                  reservationCommandId:invite.commandId, reason,
                },'Reserved installer identity reconciled. Activate only after email verification.');
              }}>Reconcile account</button> : null}</td>
        </tr>)}</tbody>
      </table></div>}

    <h4>ProcessEdge installation accounts</h4>
    {staff.length === 0 && !loading ? <p className="muted">No ProcessEdge installer accounts have been registered yet.</p>
      : <div className="workspace-table-wrap"><table className="workspace-table compact-table">
        <thead><tr><th>Staff account</th><th>Role</th><th>Worker</th><th>Status</th><th>Access</th></tr></thead>
        <tbody>{staff.map((s) => <tr key={s.userId}>
          <td><strong>{s.email ?? 'Verified staff account'}</strong></td>
          <td>Setup Installer</td>
          <td>{s.workerName}</td>
          <td>{s.status === 'pending' ? 'Awaiting verification' : s.status === 'active' ? 'Active' : s.status === 'suspended' ? 'Suspended' : 'Revoked'}</td>
          <td>
            {s.status === 'pending' || s.status === 'suspended'
              ? <button type="button" className="workspace-button subtle" disabled={Boolean(saving)}
                onClick={() => void mutate('set_status',{
                  staffUserId:s.userId,status:'active',
                  reason:'Verified ProcessEdge installer account and role activation',
                },'Installer account activation checked.')}>Activate</button> : null}
            {s.status === 'active' ? <button type="button" className="workspace-button subtle" disabled={Boolean(saving)}
              onClick={() => void mutate('set_status',{
                staffUserId:s.userId,status:'suspended',
                reason:'ProcessEdge installer access temporarily suspended',
              },'Installer account suspended.')}>Suspend</button> : null}
            {s.status !== 'revoked' ? <button type="button" className="workspace-button subtle" disabled={Boolean(saving)}
              onClick={() => {
                if(window.confirm('Permanently revoke this installer account?')) void mutate('set_status',{
                  staffUserId:s.userId,status:'revoked',
                  reason:'ProcessEdge installer account permanently revoked',
                },'Installer account permanently revoked.');
              }}>Revoke account</button> : null}
          </td>
        </tr>)}</tbody>
      </table></div>}

    <h4>Assignments for the selected Business</h4>
    {assignments.length === 0 ? <p className="muted">No installer assignments recorded for this Business.</p>
      : <div className="workspace-table-wrap"><table className="workspace-table compact-table">
        <thead><tr><th>Installer</th><th>Appointment</th><th>Expiry</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{assignments.map((a) => <tr key={a.assignmentId}>
          <td>{staff.find((s) => s.userId === a.userId)?.email ?? 'ProcessEdge installer'}</td>
          <td>{appointments.find((ap) => ap.id === a.appointmentId)?.branchName ?? 'Assigned Branch'}</td>
          <td>{new Date(a.validUntil).toLocaleString()}</td>
          <td>{a.revokedAt ? 'Revoked' : Date.parse(a.validUntil) <= Date.now() ? 'Expired' : 'Assigned'}</td>
          <td>{!a.revokedAt ? <button type="button" className="workspace-button subtle" disabled={Boolean(saving)}
            onClick={() => {
              if(window.confirm('Revoke this appointment assignment now?')) void mutate('revoke_assignment',{
                assignmentId:a.assignmentId,
                reason:'Approved removal of ProcessEdge Branch installation assignment',
              },'Installer appointment access revoked.');
            }}>Revoke assignment</button> : null}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
