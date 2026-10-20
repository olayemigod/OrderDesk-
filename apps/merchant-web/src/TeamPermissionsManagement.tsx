import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, supabase } from './supabase';

type MerchantRole = 'owner' | 'manager' | 'staff';
type InviteRole = 'manager' | 'staff';
type Branch = { id: string; code: string; name: string; isDefault: boolean; isActive: boolean };
type TeamMember = { userId: string; email: string; role: MerchantRole; joinedAt: string };
type Invitation = { id: string; email: string; role: InviteRole; expiresAt: string; createdAt: string };
type TeamPayload = { actorRole: MerchantRole; members: TeamMember[]; invitations: Invitation[] };
type Capability =
  | 'can_manage_orders'
  | 'can_refund_sale'
  | 'can_manage_products'
  | 'can_receive_stock'
  | 'can_adjust_stock'
  | 'can_count_stock'
  | 'can_apply_stock_count'
  | 'can_transfer_stock'
  | 'can_manage_purchasing'
  | 'can_manage_payments'
  | 'can_open_shift'
  | 'can_record_cash_movement'
  | 'can_record_expense'
  | 'can_close_shift'
  | 'can_review_shift'
  | 'can_print_receipt'
  | 'can_manage_devices'
  | 'can_view_reports'
  | 'can_accept_commercial_agreements';
type AccessState = {
  userId: string;
  role: MerchantRole;
  usesDefaultBranchFallback: boolean;
  branchAccess: Record<string, boolean>;
  capabilities: Record<Capability, boolean>;
};
type CapabilityGroup = {
  title: string;
  items: Array<{ id: Capability; label: string }>;
  roles?: MerchantRole[];
  ownerOnly?: boolean;
};

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  { title: 'Sales & orders', items: [{ id: 'can_manage_orders', label: 'Manage orders' }, { id: 'can_refund_sale', label: 'Refund completed sales' }] },
  { title: 'Products', items: [{ id: 'can_manage_products', label: 'Manage products' }] },
  { title: 'Inventory', items: [{ id: 'can_receive_stock', label: 'Receive purchased stock' }, { id: 'can_adjust_stock', label: 'Adjust stock' }, { id: 'can_count_stock', label: 'Count stock' }, { id: 'can_apply_stock_count', label: 'Apply stock count' }, { id: 'can_transfer_stock', label: 'Transfer stock' }] },
  { title: 'Purchasing', items: [{ id: 'can_manage_purchasing', label: 'Manage purchasing' }] },
  { title: 'Payments', items: [{ id: 'can_manage_payments', label: 'Manage payments' }] },
  { title: 'Cash & shifts', items: [{ id: 'can_open_shift', label: 'Open shift' }, { id: 'can_record_cash_movement', label: 'Record cash movement' }, { id: 'can_record_expense', label: 'Record expense' }, { id: 'can_close_shift', label: 'Close shift' }, { id: 'can_review_shift', label: 'Review shift' }] },
  { title: 'Devices', items: [{ id: 'can_print_receipt', label: 'Print receipts' }, { id: 'can_manage_devices', label: 'Manage devices' }] },
  { title: 'Reports', items: [{ id: 'can_view_reports', label: 'View reports' }] },
  { title: 'Commercial authority', roles: ['manager'], ownerOnly: true, items: [{ id: 'can_accept_commercial_agreements', label: 'Accept SellerTray commercial agreements' }] },
];

export default function TeamPermissionsManagement({ tenantId }: { tenantId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [team, setTeam] = useState<TeamPayload>({ actorRole: 'staff', members: [], invitations: [] });
  const [access, setAccess] = useState<AccessState[]>([]);
  const [actorUserId, setActorUserId] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('staff');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedMember = team.members.find((member) => member.userId === selectedMemberId) ?? null;
  const selectedAccess = access.find((row) => row.userId === selectedMemberId) ?? null;
  const activeBranches = useMemo(() => branches.filter((branch) => branch.isActive), [branches]);
  const managers = useMemo(() => team.members.filter((member) => member.role === 'manager').length, [team.members]);
  const cashiers = useMemo(() => team.members.filter((member) => member.role === 'staff').length, [team.members]);

  useEffect(() => { void loadAll(); }, [tenantId]);

  async function loadAll(preferredMemberId?: string | null) {
    setLoading(true); setError(null);
    try {
      const [branchResult, teamResult, accessResult, userResult] = await Promise.all([
        supabase.rpc('get_sellertray_manageable_branches', { p_tenant_id: tenantId }),
        supabase.functions.invoke('team-management', { body: { action: 'list', tenantId } }),
        supabase.rpc('get_sellertray_team_access_matrix', { p_tenant_id: tenantId }),
        supabase.auth.getUser(),
      ]);
      if (branchResult.error) throw branchResult.error;
      if (teamResult.error) throw teamResult.error;
      if (accessResult.error) throw accessResult.error;
      if (userResult.error) throw userResult.error;

      const nextBranches = ((branchResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''), code: String(row.code ?? ''), name: String(row.name ?? 'Branch'),
        isDefault: row.is_default === true, isActive: row.is_active === true,
      } satisfies Branch)).filter((row) => row.id);
      const nextTeam = parseTeam(teamResult.data);
      const nextAccess = parseAccess(accessResult.data);
      const userId = userResult.data.user?.id ?? '';
      setBranches(nextBranches); setTeam(nextTeam); setAccess(nextAccess); setActorUserId(userId);
      if (nextTeam.actorRole === 'manager') setInviteRole('staff');
      const wanted = preferredMemberId ?? selectedMemberId;
      const nextId = wanted && nextTeam.members.some((row) => row.userId === wanted)
        ? wanted
        : nextTeam.members.find((row) => row.role === 'staff')?.userId
          ?? nextTeam.members.find((row) => row.role === 'manager')?.userId
          ?? nextTeam.members[0]?.userId
          ?? null;
      setSelectedMemberId(nextId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load Team & Permissions.'));
    } finally { setLoading(false); }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) { setError('Enter a valid email address.'); return; }
    setSaving(true); clearNotice();
    try {
      const result = await invokeTeam({ action: 'invite', tenantId, email, role: team.actorRole === 'manager' ? 'staff' : inviteRole });
      const outcome = isRecord(result.result) && result.result.outcome === 'joined' ? 'joined' : 'invited';
      setInviteEmail('');
      await loadAll(selectedMemberId);
      setMessage(outcome === 'joined' ? 'Team member added.' : 'Invitation sent.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to invite this team member.')); }
    finally { setSaving(false); }
  }

  async function changeRole(member: TeamMember, nextRole: InviteRole) {
    if (team.actorRole !== 'owner' || member.role === 'owner' || member.userId === actorUserId) return;
    setSaving(true); clearNotice();
    try {
      await invokeTeam({ action: 'set_role', tenantId, targetUserId: member.userId, role: nextRole });
      await loadAll(member.userId); setMessage('Team role updated.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to change this team role.')); }
    finally { setSaving(false); }
  }

  async function removeMember(member: TeamMember) {
    if (!canManageMember(member) || !window.confirm(`Remove ${member.email} from this business?`)) return;
    setSaving(true); clearNotice();
    try {
      await invokeTeam({ action: 'remove', tenantId, targetUserId: member.userId });
      await loadAll(null); setMessage('Team member removed.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to remove this team member.')); }
    finally { setSaving(false); }
  }

  async function cancelInvitation(invitation: Invitation) {
    setSaving(true); clearNotice();
    try {
      await invokeTeam({ action: 'cancel_invite', tenantId, invitationId: invitation.id });
      await loadAll(selectedMemberId); setMessage('Invitation cancelled.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to cancel this invitation.')); }
    finally { setSaving(false); }
  }

  async function setBranchAccess(member: TeamMember, branch: Branch, allowed: boolean) {
    if (member.role !== 'staff' || !canManageMember(member)) return;
    setSaving(true); clearNotice();
    try {
      const { error: rpcError } = await supabase.rpc('set_sellertray_member_branch_access', {
        p_tenant_id: tenantId, p_target_user_id: member.userId, p_branch_id: branch.id, p_can_operate: allowed,
      });
      if (rpcError) throw rpcError;
      await loadAll(member.userId); setMessage('Cashier Branch access updated.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to change Cashier Branch access.')); }
    finally { setSaving(false); }
  }

  async function resetBranchAccess(member: TeamMember) {
    if (member.role !== 'staff' || !canManageMember(member)) return;
    setSaving(true); clearNotice();
    try {
      const { error: rpcError } = await supabase.rpc('reset_sellertray_member_branch_access', { p_tenant_id: tenantId, p_target_user_id: member.userId });
      if (rpcError) throw rpcError;
      await loadAll(member.userId); setMessage('Cashier access reset to the default Branch.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to reset Cashier Branch access.')); }
    finally { setSaving(false); }
  }

  async function setCapability(member: TeamMember, capability: Capability, allowed: boolean) {
    if (!canManageMember(member)) return;
    setSaving(true); clearNotice();
    try {
      const { error: rpcError } = await supabase.rpc('set_sellertray_member_capability_for_current_user', {
        p_tenant_id: tenantId, p_target_user_id: member.userId, p_capability: capability, p_allowed: allowed,
      });
      if (rpcError) throw rpcError;
      await loadAll(member.userId); setMessage('Team permission updated.');
    } catch (cause) { setError(errorMessage(cause, 'Unable to change this team permission.')); }
    finally { setSaving(false); }
  }

  function canManageMember(member: TeamMember): boolean {
    if (member.userId === actorUserId || member.role === 'owner') return false;
    if (team.actorRole === 'owner') return true;
    return team.actorRole === 'manager' && member.role === 'staff';
  }
  function clearNotice() { setError(null); setMessage(null); }

  if (loading && team.members.length === 0) return <div className="panel team-loading">Loading Team & Permissions…</div>;

  return <div className="page-stack">
    <div className="section-heading">
      <div><p className="eyebrow">Business access</p><h2>Team & Permissions</h2></div>
      <p className="muted">Invite Managers and Cashiers, assign Cashier Branch access, control operational permissions and explicitly delegate commercial agreement authority. Manage Branch identity separately under Branches.</p>
    </div>
    {error ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button type="button" onClick={() => setMessage(null)}>Dismiss</button></div> : null}

    <div className="metric-grid team-role-metrics">
      <Metric label="Managers" value={managers} note="Business-wide management role" />
      <Metric label="Cashiers" value={cashiers} note="Branch-aware operational role" />
      <Metric label="Active Branches" value={activeBranches.length} note="Available for Cashier assignment" />
      <Metric label="Pending invites" value={team.invitations.length} note="Invitations not yet accepted" />
    </div>

    <section className="management-block">
      <div className="management-heading"><div><p className="eyebrow">People</p><h3>Invite team member</h3></div></div>
      <form className="panel invite-form" onSubmit={invite}>
        <Field label="Email address"><input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="person@example.com" /></Field>
        {team.actorRole === 'owner' ? <label className="field"><span>Role</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InviteRole)}><option value="staff">Cashier</option><option value="manager">Manager</option></select></label> : <div className="role-lock"><span>Role</span><strong>Cashier</strong></div>}
        <button className="primary-button" disabled={saving}>{saving ? 'Working…' : 'Invite team member'}</button>
      </form>
    </section>

    {team.invitations.length ? <article className="panel invitation-panel"><div className="panel-head"><div><p className="eyebrow">Pending</p><h3>Invitations</h3></div></div>{team.invitations.map((invitation) => <div className="invitation-row" key={invitation.id}><span><strong>{invitation.email}</strong><small>{roleLabel(invitation.role)} · expires {dateOnly(invitation.expiresAt)}</small></span><button className="text-button" type="button" disabled={saving || (team.actorRole === 'manager' && invitation.role !== 'staff')} onClick={() => void cancelInvitation(invitation)}>Cancel</button></div>)}</article> : null}

    <div className="team-management-grid">
      <div className="panel member-list">
        {team.members.map((member) => <button type="button" key={member.userId} className={selectedMemberId === member.userId ? 'member-row active' : 'member-row'} onClick={() => setSelectedMemberId(member.userId)}>
          <span className="member-avatar">{member.email.slice(0, 1).toUpperCase() || 'S'}</span>
          <span><strong>{member.email || 'Team member'}</strong><small>{roleLabel(member.role)} · joined {dateOnly(member.joinedAt)}</small></span>
          {member.userId === actorUserId ? <em>You</em> : null}
        </button>)}
        {!team.members.length ? <div className="empty-state compact"><strong>No team members</strong><p>Invite the first Cashier or Manager.</p></div> : null}
      </div>

      <div className="member-editor-stack">
        {selectedMember && selectedAccess ? <>
          <article className="panel member-editor">
            <div className="panel-head"><div><p className="eyebrow">Team member</p><h3>{selectedMember.email}</h3><p className="muted">{roleLabel(selectedMember.role)}</p></div>{canManageMember(selectedMember) ? <button type="button" className="danger-button" disabled={saving} onClick={() => void removeMember(selectedMember)}>Remove</button> : null}</div>
            {team.actorRole === 'owner' && selectedMember.role !== 'owner' && selectedMember.userId !== actorUserId ? <label className="field role-field"><span>Role</span><select value={selectedMember.role} disabled={saving} onChange={(event) => void changeRole(selectedMember, event.target.value as InviteRole)}><option value="staff">Cashier</option><option value="manager">Manager</option></select></label> : null}
            {selectedMember.role === 'owner' ? <p className="governance-note">Owner authority is business-wide and protected.</p> : selectedMember.role === 'manager' ? <p className="governance-note">Managers operate across active Branches, but Manager status does not grant authority to accept SellerTray commercial agreements. Only an Owner can explicitly delegate that authority below.</p> : <p className="governance-note">Cashiers operate only the Branches allowed here. With no custom assignment, the Cashier uses the default Branch.</p>}
          </article>

          {selectedMember.role === 'staff' ? <article className="panel">
            <div className="panel-head"><div><p className="eyebrow">Branch access</p><h3>Where this Cashier can work</h3></div>{!selectedAccess.usesDefaultBranchFallback && canManageMember(selectedMember) ? <button type="button" className="secondary-button" disabled={saving} onClick={() => void resetBranchAccess(selectedMember)}>Use default Branch only</button> : null}</div>
            {selectedAccess.usesDefaultBranchFallback ? <div className="access-mode-note">Using the active default Branch. Grant another Branch to create a custom assignment while preserving current default access.</div> : null}
            <div className="access-grid">{branches.map((branch) => {
              const checked = selectedAccess.usesDefaultBranchFallback ? branch.isDefault && branch.isActive : selectedAccess.branchAccess[branch.id] === true;
              const disabled = !canManageMember(selectedMember) || saving || (!branch.isActive && !checked);
              return <label className={checked ? 'access-card checked' : 'access-card'} key={branch.id}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => void setBranchAccess(selectedMember, branch, event.target.checked)} /><span><strong>{branch.name}</strong><small>{branch.code}{branch.isDefault ? ' · Default' : ''}{!branch.isActive ? ' · Archived' : ''}</small></span></label>;
            })}</div>
          </article> : null}

          <article className="panel">
            <div className="panel-head"><div><p className="eyebrow">Permissions</p><h3>Operational & commercial access</h3></div></div>
            <div className="capability-groups">{CAPABILITY_GROUPS.filter((group) => (!group.roles || group.roles.includes(selectedMember.role)) && (!group.ownerOnly || team.actorRole === 'owner')).map((group) => <section key={group.title}><h4>{group.title}</h4><div className="capability-grid">{group.items.map((item) => <label className={selectedAccess.capabilities[item.id] ? 'capability-card checked' : 'capability-card'} key={item.id}><input type="checkbox" checked={selectedAccess.capabilities[item.id] === true} disabled={!canManageMember(selectedMember) || saving} onChange={(event) => void setCapability(selectedMember, item.id, event.target.checked)} /><span>{item.label}</span></label>)}</div></section>)}</div>
          </article>
        </> : <div className="panel empty-state"><strong>Select a team member</strong><p>Review their role, Branch access and operational permissions.</p></div>}
      </div>
    </div>
  </div>;
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) { return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
async function invokeTeam(body: Record<string, unknown>): Promise<Record<string, unknown>> { const { data, error } = await supabase.functions.invoke('team-management', { body }); if (error) throw error; return isRecord(data) ? data : {}; }

function parseTeam(value: unknown): TeamPayload {
  const root = isRecord(value) && isRecord(value.team) ? value.team : {};
  const actorRole = parseRole(root.actorRole);
  const members = Array.isArray(root.members) ? root.members.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const userId = typeof candidate.userId === 'string' ? candidate.userId : '';
    if (!userId) return [];
    return [{ userId, email: typeof candidate.email === 'string' ? candidate.email : '', role: parseRole(candidate.role), joinedAt: typeof candidate.joinedAt === 'string' ? candidate.joinedAt : '' } satisfies TeamMember];
  }) : [];
  const invitations = Array.isArray(root.invitations) ? root.invitations.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = typeof candidate.id === 'string' ? candidate.id : '';
    const role = candidate.role === 'manager' ? 'manager' : candidate.role === 'staff' ? 'staff' : null;
    if (!id || !role) return [];
    return [{ id, email: typeof candidate.email === 'string' ? candidate.email : '', role, expiresAt: typeof candidate.expiresAt === 'string' ? candidate.expiresAt : '', createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '' } satisfies Invitation];
  }) : [];
  return { actorRole, members, invitations };
}

function parseAccess(value: unknown): AccessState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.userId !== 'string') return [];
    const rawCapabilities = isRecord(candidate.capabilities) ? candidate.capabilities : {};
    const capabilities = Object.fromEntries(CAPABILITY_GROUPS.flatMap((group) => group.items).map((item) => [item.id, rawCapabilities[item.id] === true])) as Record<Capability, boolean>;
    const rawBranches = isRecord(candidate.branchAccess) ? candidate.branchAccess : {};
    const branchAccess = Object.fromEntries(Object.entries(rawBranches).map(([id, allowed]) => [id, allowed === true]));
    return [{ userId: candidate.userId, role: parseRole(candidate.role), usesDefaultBranchFallback: candidate.usesDefaultBranchFallback === true, branchAccess, capabilities } satisfies AccessState];
  });
}
function parseRole(value: unknown): MerchantRole { return value === 'owner' || value === 'manager' || value === 'staff' ? value : 'staff'; }
function roleLabel(value: MerchantRole | InviteRole): string { return value === 'staff' ? 'Cashier' : value === 'manager' ? 'Manager' : 'Owner'; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function dateOnly(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date); }
