import { useCallback, useEffect, useState } from 'react';

import {
  cancelTeamInvitation,
  inviteTeamMember,
  loadTeam,
  loadTeamMembershipHistory,
  removeTeamMember,
  setTeamMemberRole,
  type TeamInviteRole,
  type TeamMembershipEvent,
  type TeamSnapshot,
} from '../data/teamRepository';

export function useTeam(tenantId: string | null) {
  const [team, setTeam] = useState<TeamSnapshot | null>(null);
  const [history, setHistory] = useState<TeamMembershipEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setTeam(null);
      setHistory([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const [nextTeam, nextHistory] = await Promise.all([
        loadTeam(tenantId),
        loadTeamMembershipHistory(tenantId),
      ]);
      setTeam(nextTeam);
      setHistory(nextHistory);
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

  const refreshAfterMutation = useCallback(async () => {
    if (!tenantId) return;
    const [nextTeam, nextHistory] = await Promise.all([
      loadTeam(tenantId),
      loadTeamMembershipHistory(tenantId),
    ]);
    setTeam(nextTeam);
    setHistory(nextHistory);
  }, [tenantId]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update the team.');
      throw err;
    } finally {
      setBusy(false);
    }
  }, [refreshAfterMutation]);

  const invite = useCallback(async (email: string, role: TeamInviteRole): Promise<'invited'> => {
    if (!tenantId) throw new Error('No active business selected.');

    setBusy(true);
    setError(null);
    try {
      const outcome = await inviteTeamMember(tenantId, email, role);
      await refreshAfterMutation();
      return outcome;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to invite the team member.');
      throw err;
    } finally {
      setBusy(false);
    }
  }, [refreshAfterMutation, tenantId]);

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

  return {
    team,
    history,
    loading,
    busy,
    error,
    refresh,
    invite,
    setRole,
    remove,
    cancelInvitation,
  };
}
