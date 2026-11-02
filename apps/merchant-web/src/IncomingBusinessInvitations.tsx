import { useEffect, useMemo, useState } from 'react';
import { errorMessage, supabase } from './supabase';

type PendingInvitation = {
  id: string;
  tenantName: string;
  role: 'manager' | 'staff';
  invitedByEmail: string | null;
  expiresAt: string;
};

export default function IncomingBusinessInvitations({
  onMembershipChanged,
}: {
  onMembershipChanged?: () => Promise<void> | void;
}) {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focusedInvitationId = invitationIdFromLocation();
  const orderedInvitations = useMemo(() => {
    if (!focusedInvitationId) return invitations;
    return [...invitations].sort((left, right) => {
      if (left.id === focusedInvitationId) return -1;
      if (right.id === focusedInvitationId) return 1;
      return 0;
    });
  }, [focusedInvitationId, invitations]);
  const focusedInvitationIsPending = Boolean(
    focusedInvitationId && invitations.some((invitation) => invitation.id === focusedInvitationId),
  );

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('team-management', {
        body: { action: 'pending_invites' },
      });
      if (invokeError) throw invokeError;
      setInvitations(parseInvitations(data));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load your Business invitations.'));
    }
  }

  async function decide(invitationId: string, action: 'accept_invite' | 'decline_invite') {
    setBusyId(invitationId);
    setError(null);
    try {
      const { error: invokeError } = await supabase.functions.invoke('team-management', {
        body: { action, invitationId },
      });
      if (invokeError) throw invokeError;
      await load();
      if (action === 'accept_invite') await onMembershipChanged?.();
    } catch (cause) {
      setError(errorMessage(cause, action === 'accept_invite' ? 'Unable to accept this Business invitation.' : 'Unable to decline this Business invitation.'));
    } finally {
      setBusyId(null);
    }
  }

  if (!invitations.length && !error && !focusedInvitationId) return null;

  return <article className="panel invitation-panel">
    <div className="panel-head">
      <div>
        <p className="eyebrow">Business invitations</p>
        <h3>{focusedInvitationIsPending ? 'Review invitation' : 'Pending access'}</h3>
        <p className="muted">
          {focusedInvitationIsPending
            ? 'Accepting adds this Business to your existing SellerTray account. Your other Businesses and sign-in stay unchanged.'
            : 'A Business is added to your SellerTray account only after you accept its invitation.'}
        </p>
      </div>
    </div>
    {error ? <div className="error-banner compact">{error}<button type="button" onClick={() => void load()}>Retry</button></div> : null}
    {focusedInvitationId && !focusedInvitationIsPending && !error ? <div className="invitation-row">
      <span>
        <strong>This invitation is no longer pending</strong>
        <small>It may already have been accepted, declined, expired or cancelled. Your current SellerTray access remains unchanged.</small>
      </span>
      <button type="button" className="secondary-button" onClick={clearInvitationFocus}>Continue</button>
    </div> : null}
    {orderedInvitations.map((invitation) => {
      const busy = busyId === invitation.id;
      const focused = focusedInvitationId === invitation.id;
      return <div className={focused ? 'invitation-row invitation-row-focused' : 'invitation-row'} key={invitation.id}>
        <span>
          <strong>{invitation.tenantName}</strong>
          <small>{roleLabel(invitation.role)} · expires {dateOnly(invitation.expiresAt)}{invitation.invitedByEmail ? ` · invited by ${invitation.invitedByEmail}` : ''}</small>
        </span>
        <span className="topbar-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void decide(invitation.id, 'decline_invite')}>Decline</button>
          <button type="button" className="primary-button" disabled={busy} onClick={() => void decide(invitation.id, 'accept_invite')}>{busy ? 'Working…' : 'Accept'}</button>
        </span>
      </div>;
    })}
  </article>;
}

function invitationIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('invitation')?.trim().toLowerCase() ?? '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function clearInvitationFocus() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('invitation');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  window.location.reload();
}

function parseInvitations(value: unknown): PendingInvitation[] {
  const root = isRecord(value) && Array.isArray(value.invitations) ? value.invitations : [];
  return root.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = stringValue(candidate, 'invitationId', 'invitation_id');
    const tenantName = stringValue(candidate, 'tenantName', 'tenant_name');
    const expiresAt = stringValue(candidate, 'expiresAt', 'expires_at');
    const role = candidate.role === 'manager' ? 'manager' : candidate.role === 'staff' ? 'staff' : null;
    if (!id || !tenantName || !expiresAt || !role) return [];
    return [{
      id,
      tenantName,
      role,
      invitedByEmail: nullableStringValue(candidate, 'invitedByEmail', 'invited_by_email'),
      expiresAt,
    } satisfies PendingInvitation];
  });
}

function roleLabel(value: 'manager' | 'staff'): string {
  return value === 'staff' ? 'Cashier' : 'Manager';
}

function dateOnly(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date);
}

function valueAt(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (key in record) return record[key];
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
