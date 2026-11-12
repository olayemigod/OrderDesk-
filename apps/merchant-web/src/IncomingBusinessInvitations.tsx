import { useEffect, useMemo, useState } from 'react';
import { errorMessage, supabase } from './supabase';

type PendingInvitation = {
  id: string;
  tenantName: string;
  role: 'manager' | 'staff';
  invitedByEmail: string | null;
  expiresAt: string;
};

const PENDING_INVITATION_KEY = 'sellertray.pendingInvitationId';
const INVITATION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function IncomingBusinessInvitations({
  onMembershipChanged,
}: {
  onMembershipChanged?: () => Promise<void> | void;
}) {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focusedInvitationId = pendingInvitationIdFromBrowser();
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
    setLoading(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('team-management', {
        body: { action: 'pending_invites' },
      });
      if (invokeError) throw invokeError;
      setInvitations(parseInvitations(data));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load your Business invitations.'));
    } finally {
      setLoading(false);
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
      if (focusedInvitationId === invitationId) clearInvitationLocator(false);
      await load();
      if (action === 'accept_invite') await onMembershipChanged?.();
    } catch (cause) {
      setError(errorMessage(cause, action === 'accept_invite' ? 'Unable to accept this Business invitation.' : 'Unable to decline this Business invitation.'));
    } finally {
      setBusyId(null);
    }
  }

  if (!loading && !invitations.length && !error && !focusedInvitationId) return null;

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
    {loading && focusedInvitationId && !error ? <div className="invitation-row">
      <span>
        <strong>Loading invitation…</strong>
        <small>Checking the latest invitation status for your SellerTray account.</small>
      </span>
    </div> : null}
    {focusedInvitationId && !focusedInvitationIsPending && !loading && !error ? <div className="invitation-row">
      <span>
        <strong>This invitation is no longer pending</strong>
        <small>It may already have been accepted, declined, expired or cancelled. Your current SellerTray access remains unchanged.</small>
      </span>
      <button type="button" className="secondary-button" onClick={() => clearInvitationLocator(true)}>Continue</button>
    </div> : null}
    {!loading ? orderedInvitations.map((invitation) => {
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
    }) : null}
  </article>;
}

export function pendingInvitationIdFromBrowser(): string | null {
  if (typeof window === 'undefined') return null;
  const queryValue = new URLSearchParams(window.location.search).get('invitation')?.trim().toLowerCase() ?? '';
  if (INVITATION_UUID_RE.test(queryValue)) {
    rememberInvitationLocator(queryValue);
    return queryValue;
  }

  try {
    const storedValue = window.localStorage.getItem(PENDING_INVITATION_KEY)?.trim().toLowerCase() ?? '';
    return INVITATION_UUID_RE.test(storedValue) ? storedValue : null;
  } catch {
    return null;
  }
}

function rememberInvitationLocator(invitationId: string) {
  try {
    window.localStorage.setItem(PENDING_INVITATION_KEY, invitationId);
  } catch {
    // Query-string focus still works when browser storage is unavailable.
  }
}

function clearInvitationLocator(reload: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PENDING_INVITATION_KEY);
  } catch {
    // Storage may be unavailable in hardened browser modes.
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('invitation');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  if (reload) window.location.reload();
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
