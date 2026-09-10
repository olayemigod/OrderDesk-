import type { MerchantRole } from './businessRepository';
import { supabase } from '../lib/supabase';

export type TeamInviteRole = 'manager' | 'staff';

export type TeamMember = {
  userId: string;
  email: string;
  role: MerchantRole;
  joinedAt: string;
};

export type TeamInvitation = {
  id: string;
  email: string;
  role: TeamInviteRole;
  status: 'pending';
  expiresAt: string;
  createdAt: string;
};

export type TeamSnapshot = {
  actorRole: MerchantRole;
  actorUserId: string;
  members: TeamMember[];
  invitations: TeamInvitation[];
};

type RawTeam = {
  actorRole?: unknown;
  members?: unknown;
  invitations?: unknown;
};

export async function claimTeamInvitations(): Promise<number> {
  const data = await invokeTeam({ action: 'claim' });
  return typeof data.claimed === 'number' ? data.claimed : 0;
}

export async function loadTeam(tenantId: string): Promise<TeamSnapshot> {
  const data = await invokeTeam({ action: 'list', tenantId });
  const raw = isRecord(data.team) ? data.team as RawTeam : {};
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const actorUserId = userData.user?.id ?? '';
  if (!actorUserId) throw new Error('Unable to resolve the signed-in team member.');

  return {
    actorRole: parseRole(raw.actorRole),
    actorUserId,
    members: parseMembers(raw.members),
    invitations: parseInvitations(raw.invitations),
  };
}

export async function inviteTeamMember(
  tenantId: string,
  email: string,
  role: TeamInviteRole,
): Promise<'joined' | 'invited'> {
  const data = await invokeTeam({ action: 'invite', tenantId, email, role });
  const result = isRecord(data.result) ? data.result : null;
  return result?.outcome === 'joined' ? 'joined' : 'invited';
}

export async function setTeamMemberRole(
  tenantId: string,
  targetUserId: string,
  role: TeamInviteRole,
): Promise<void> {
  await invokeTeam({ action: 'set_role', tenantId, targetUserId, role });
}

export async function removeTeamMember(tenantId: string, targetUserId: string): Promise<void> {
  await invokeTeam({ action: 'remove', tenantId, targetUserId });
}

export async function cancelTeamInvitation(tenantId: string, invitationId: string): Promise<void> {
  await invokeTeam({ action: 'cancel_invite', tenantId, invitationId });
}

async function invokeTeam(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('team-management', { body });
  if (error) throw error;
  return isRecord(data) ? data : {};
}

function parseRole(value: unknown): MerchantRole {
  if (value === 'owner' || value === 'manager' || value === 'staff') return value;
  throw new Error('OrderDesk returned an invalid team role.');
}

function parseMembers(value: unknown): TeamMember[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const userId = typeof candidate.userId === 'string' ? candidate.userId : '';
    const email = typeof candidate.email === 'string' ? candidate.email : '';
    const joinedAt = typeof candidate.joinedAt === 'string' ? candidate.joinedAt : '';
    const role = candidate.role;
    if (!userId || !email || !joinedAt || (role !== 'owner' && role !== 'manager' && role !== 'staff')) return [];
    return [{ userId, email, joinedAt, role } satisfies TeamMember];
  });
}

function parseInvitations(value: unknown): TeamInvitation[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = typeof candidate.id === 'string' ? candidate.id : '';
    const email = typeof candidate.email === 'string' ? candidate.email : '';
    const expiresAt = typeof candidate.expiresAt === 'string' ? candidate.expiresAt : '';
    const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : '';
    const role = candidate.role;
    if (!id || !email || !expiresAt || !createdAt || (role !== 'manager' && role !== 'staff')) return [];
    return [{ id, email, expiresAt, createdAt, role, status: 'pending' } satisfies TeamInvitation];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
