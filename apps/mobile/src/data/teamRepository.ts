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

export type PendingTeamInvitation = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  email: string;
  role: TeamInviteRole;
  invitedByUserId: string | null;
  invitedByEmail: string | null;
  expiresAt: string;
  createdAt: string;
};

export type TeamMembershipEvent = {
  id: string;
  eventType: string;
  subjectUserId: string | null;
  subjectEmail: string | null;
  invitationId: string | null;
  previousRole: MerchantRole | null;
  newRole: MerchantRole | null;
  actorUserId: string | null;
  actorEmail: string | null;
  actorKind: string;
  reason: string | null;
  detail: Record<string, unknown>;
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

export async function loadPendingTeamInvitations(): Promise<PendingTeamInvitation[]> {
  const data = await invokeTeam({ action: 'pending_invites' });
  return parsePendingInvitations(data.invitations);
}

export async function acceptTeamInvitation(invitationId: string): Promise<void> {
  await invokeTeam({ action: 'accept_invite', invitationId });
}

export async function declineTeamInvitation(invitationId: string): Promise<void> {
  await invokeTeam({ action: 'decline_invite', invitationId });
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

export async function loadTeamMembershipHistory(
  tenantId: string,
  limit = 100,
): Promise<TeamMembershipEvent[]> {
  const data = await invokeTeam({ action: 'history', tenantId, limit });
  return parseMembershipHistory(data.history);
}

export async function inviteTeamMember(
  tenantId: string,
  email: string,
  role: TeamInviteRole,
): Promise<'invited'> {
  const data = await invokeTeam({ action: 'invite', tenantId, email, role });
  const result = isRecord(data.result) ? data.result : null;
  if (result?.outcome !== 'invited') {
    throw new Error('SellerTray did not return a pending team invitation.');
  }
  return 'invited';
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
  throw new Error('SellerTray returned an invalid team role.');
}

function parseNullableRole(value: unknown): MerchantRole | null {
  return value === 'owner' || value === 'manager' || value === 'staff' ? value : null;
}

function parseMembers(value: unknown): TeamMember[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const userId = stringValue(candidate, 'userId', 'user_id');
    const email = stringValue(candidate, 'email');
    const joinedAt = stringValue(candidate, 'joinedAt', 'joined_at');
    const role = candidate.role;
    if (!userId || !email || !joinedAt || (role !== 'owner' && role !== 'manager' && role !== 'staff')) return [];
    return [{ userId, email, joinedAt, role } satisfies TeamMember];
  });
}

function parseInvitations(value: unknown): TeamInvitation[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = stringValue(candidate, 'id', 'invitation_id');
    const email = stringValue(candidate, 'email');
    const expiresAt = stringValue(candidate, 'expiresAt', 'expires_at');
    const createdAt = stringValue(candidate, 'createdAt', 'created_at');
    const role = candidate.role;
    if (!id || !email || !expiresAt || !createdAt || (role !== 'manager' && role !== 'staff')) return [];
    return [{ id, email, expiresAt, createdAt, role, status: 'pending' } satisfies TeamInvitation];
  });
}

function parsePendingInvitations(value: unknown): PendingTeamInvitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = stringValue(candidate, 'invitationId', 'invitation_id');
    const tenantId = stringValue(candidate, 'tenantId', 'tenant_id');
    const tenantName = stringValue(candidate, 'tenantName', 'tenant_name');
    const tenantSlug = stringValue(candidate, 'tenantSlug', 'tenant_slug');
    const email = stringValue(candidate, 'email');
    const expiresAt = stringValue(candidate, 'expiresAt', 'expires_at');
    const createdAt = stringValue(candidate, 'createdAt', 'created_at');
    const role = candidate.role;
    if (!id || !tenantId || !tenantName || !email || !expiresAt || !createdAt || (role !== 'manager' && role !== 'staff')) return [];
    return [{
      id,
      tenantId,
      tenantName,
      tenantSlug,
      email,
      role,
      invitedByUserId: nullableStringValue(candidate, 'invitedByUserId', 'invited_by_user_id'),
      invitedByEmail: nullableStringValue(candidate, 'invitedByEmail', 'invited_by_email'),
      expiresAt,
      createdAt,
    } satisfies PendingTeamInvitation];
  });
}

function parseMembershipHistory(value: unknown): TeamMembershipEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = stringValue(candidate, 'eventId', 'event_id');
    const eventType = stringValue(candidate, 'eventType', 'event_type');
    const actorKind = stringValue(candidate, 'actorKind', 'actor_kind');
    const createdAt = stringValue(candidate, 'createdAt', 'created_at');
    if (!id || !eventType || !actorKind || !createdAt) return [];
    const detailValue = candidate.detail;
    return [{
      id,
      eventType,
      subjectUserId: nullableStringValue(candidate, 'subjectUserId', 'subject_user_id'),
      subjectEmail: nullableStringValue(candidate, 'subjectEmail', 'subject_email'),
      invitationId: nullableStringValue(candidate, 'invitationId', 'invitation_id'),
      previousRole: parseNullableRole(valueAt(candidate, 'previousRole', 'previous_role')),
      newRole: parseNullableRole(valueAt(candidate, 'newRole', 'new_role')),
      actorUserId: nullableStringValue(candidate, 'actorUserId', 'actor_user_id'),
      actorEmail: nullableStringValue(candidate, 'actorEmail', 'actor_email'),
      actorKind,
      reason: nullableStringValue(candidate, 'reason'),
      detail: isRecord(detailValue) ? detailValue : {},
      createdAt,
    } satisfies TeamMembershipEvent];
  });
}

function valueAt(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function stringValue(record: Record<string, unknown>, ...keys: string[]): string {
  const value = valueAt(record, ...keys);
  return typeof value === 'string' ? value : '';
}

function nullableStringValue(record: Record<string, unknown>, ...keys: string[]): string | null {
  const value = valueAt(record, ...keys);
  return typeof value === 'string' && value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
