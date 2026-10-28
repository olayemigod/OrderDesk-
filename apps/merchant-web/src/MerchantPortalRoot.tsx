import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import MerchantApp from './MerchantApp';
import MerchantAuth, { merchantAuthModeFromLocation } from './MerchantAuth';
import { SellerTrayMark } from './merchantShell';
import { errorMessage, supabase } from './supabase';

type WorkspaceState = 'checking' | 'ready' | 'none' | 'error';

export default function MerchantPortalRoot() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>('checking');
  const [workspaceError, setWorkspaceError] = useState('');
  const authIntent = merchantAuthModeFromLocation();

  const inspectWorkspace = useCallback(async (nextSession: Session) => {
    setWorkspaceState('checking');
    setWorkspaceError('');
    try {
      const verified = await supabase.auth.getUser(nextSession.access_token);
      if (verified.error || !verified.data.user || verified.data.user.id !== nextSession.user.id) {
        await supabase.auth.signOut({ scope: 'local' });
        setSession(null);
        setWorkspaceState('none');
        return;
      }

      const { data, error } = await supabase.rpc('sellertray_list_businesses_for_current_user');
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      setWorkspaceState(rows.length > 0 ? 'ready' : 'none');
    } catch (cause) {
      setWorkspaceError(errorMessage(cause, 'SellerTray could not open your Business workspace.'));
      setWorkspaceState('error');
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const next = data.session;
        if (!mounted) return;
        setSession(next);
        if (next) await inspectWorkspace(next);
        else setWorkspaceState('none');
      } catch {
        if (mounted) {
          setSession(null);
          setWorkspaceState('none');
        }
      } finally {
        if (mounted) setBooting(false);
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      if (!next) {
        setWorkspaceState('none');
        setWorkspaceError('');
        return;
      }
      void inspectWorkspace(next);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [inspectWorkspace]);

  async function acceptAuthenticated(next: Session) {
    setSession(next);
    await inspectWorkspace(next);
  }

  if (booting) return <PortalStatus title="Opening SellerTray" body="Verifying your merchant session." />;

  if (authIntent === 'reset-password') {
    return <MerchantAuth session={session} initialMode="reset-password" onAuthenticated={(next) => void acceptAuthenticated(next)} />;
  }

  if (authIntent === 'create-business') {
    return <MerchantAuth
      session={session}
      initialMode="create-business"
      onAuthenticated={(next) => void acceptAuthenticated(next)}
      onBusinessCreated={() => session ? inspectWorkspace(session) : undefined}
    />;
  }

  if (!session) {
    return <MerchantAuth session={null} initialMode="sign-in" onAuthenticated={(next) => void acceptAuthenticated(next)} />;
  }

  if (workspaceState === 'checking') {
    return <PortalStatus title="Opening your Business" body="Confirming your SellerTray workspace and access." />;
  }

  if (workspaceState === 'none') {
    return <MerchantAuth
      session={session}
      initialMode="create-business"
      onAuthenticated={(next) => void acceptAuthenticated(next)}
      onBusinessCreated={() => inspectWorkspace(session)}
    />;
  }

  if (workspaceState === 'error') {
    return <PortalStatus
      title="We could not open your Business"
      body={workspaceError}
      action={<div className="auth-status-actions">
        <button className="primary-button" onClick={() => void inspectWorkspace(session)}>Try again</button>
        <button className="secondary-button" onClick={() => void supabase.auth.signOut({ scope: 'local' })}>Sign out</button>
      </div>}
    />;
  }

  return <MerchantApp />;
}

function PortalStatus({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="status-page">
    <div className="status-card">
      <SellerTrayMark large />
      <p className="eyebrow">SellerTray</p>
      <h1>{title}</h1>
      <p>{body}</p>
      {action}
    </div>
  </div>;
}
