import { useCallback, useEffect, useState } from 'react';

import {
  cancelTeamInvitation,
  inviteTeamMember,
  loadTeam,
  removeTeamMember,
  setTeamMemberRole,
  type TeamInviteRole,
  type TeamSnapshot,
} from '../data/teamRepository';

export function useTeam(tenantId: string | null) {
  const [team, setTeam] = useState<TeamSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setTeam(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      setTeam(await loadTeam(tenantId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load team members.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      if (tenantId) setTeam(await loadTeam(tenantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update the team.');
      throw err;
    } finally {
      setBusy(false);
    }
  }, [tenantId]);

  const invite = useCallback(async (email: string, role: TeamInviteRole): Promise<'joined' | 'invited'> => {
    if (!tenantId) throw new Error('No active business selected.');

    setBusy(true);
    setError(null);
    try {
      const outcome = await inviteTeamMember(tenantId, email, role);
      setTeam(await loadTeam(tenantId));
      return outcome;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to invite the team member.');
      throw err;
    } finally {
      setBusy(false);
    }
  }, [tenantId]);

  const setRole = useCallback(async (targetUserId: string, role: TeamInviteRole) => {
    if (!tenantId) throw new Error('No active business selected.');
    await run(() => setTeamMemberRole(tenantId, targetUserId, role));
  }, [run, tenantId]);

  const remove = useCallback(async (targetUserId: string) => {
    if (!tenantId) throw new Error('No active business selected.');
    await run(() => removeTeamMember(tenantId, targetUserId));
  }, [run, tenantId]);

  const cancelInvitation = useCallback(async (invitationId: string) => {
    if (!tenantId) throw new Error('No active business selected.');
    await run(() => cancelTeamInvitation(tenantId, invitationId));
  }, [run, tenantId]);

  return { team, loading, busy, error, refresh, invite, setRole, remove, cancelInvitation };
}
