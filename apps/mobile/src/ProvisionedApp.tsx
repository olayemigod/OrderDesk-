import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

import { AuthGate } from './components/AuthGate';
import { CreateBusinessView } from './components/CreateBusinessView';
import { LegalAcceptanceGate } from './components/LegalAcceptanceGate';
import { ProcessEdgeIdentityGate } from './components/ProcessEdgeIdentityGate';
import { PlatformAdminView } from './components/PlatformAdminView';
import { SellerTrayLoadingScreen } from './components/SellerTrayLoadingScreen';
import {
  acceptTeamInvitation,
  declineTeamInvitation,
  loadPendingTeamInvitations,
  type PendingTeamInvitation,
} from './data/teamRepository';
import { useBusinesses } from './hooks/useBusinesses';
import { usePlatformAdmin } from './hooks/usePlatformAdmin';
import { useInvitationLink } from './lib/invitationLink';
import { supabase } from './lib/supabase';
import { BusinessContextSelectionProvider } from './redesign/BusinessContextSelection';
import RedesignWorkspace from './redesign/RedesignWorkspace';

export default function ProvisionedApp() {
  const invitationLink = useInvitationLink();

  return (
    <AuthGate hasPendingInvitation={Boolean(invitationLink.invitationId)}>
      <ProcessEdgeIdentityGate>
        <LegalAcceptanceGate>
          <ProvisioningGate
            focusedInvitationId={invitationLink.invitationId}
            invitationLinkReady={invitationLink.ready}
            onResolveInvitation={invitationLink.clearInvitation}
          />
        </LegalAcceptanceGate>
      </ProcessEdgeIdentityGate>
    </AuthGate>
  );
}

function ProvisioningGate({
  focusedInvitationId,
  invitationLinkReady,
  onResolveInvitation,
}: {
  focusedInvitationId: string | null;
  invitationLinkReady: boolean;
  onResolveInvitation: (invitationId?: string) => Promise<void>;
}) {
  const {
    businesses,
    activeBusiness,
    loading,
    error,
    refresh,
    selectBusiness,
    createBusiness,
  } = useBusinesses();
  const platformAdmin = usePlatformAdmin();
  const [invitations, setInvitations] = useState<PendingTeamInvitation[]>([]);
  const [invitationLoading, setInvitationLoading] = useState(true);
  const [loadedFocusedInvitationId, setLoadedFocusedInvitationId] = useState<string | null>(null);
  const [invitationBusyId, setInvitationBusyId] = useState<string | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);

  const refreshInvitations = useCallback(async () => {
    setInvitationLoading(true);
    try {
      setInvitations(await loadPendingTeamInvitations());
      setInvitationError(null);
    } catch (nextError) {
      setInvitationError(errorMessage(nextError, 'Unable to load your Business invitations.'));
    } finally {
      setInvitationLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoadedFocusedInvitationId(null);
    void refreshInvitations().then(() => {
      if (active) setLoadedFocusedInvitationId(focusedInvitationId);
    });
    return () => {
      active = false;
    };
  }, [focusedInvitationId, refreshInvitations]);

  const handleInvitation = useCallback(async (invitationId: string, decision: 'accept' | 'decline') => {
    const invitation = invitations.find((candidate) => candidate.id === invitationId) ?? null;
    setInvitationBusyId(invitationId);
    try {
      if (decision === 'accept') await acceptTeamInvitation(invitationId);
      else await declineTeamInvitation(invitationId);

      await Promise.all([
        refreshInvitations(),
        refresh(decision === 'accept' ? invitation?.tenantId : undefined),
      ]);
      if (focusedInvitationId === invitationId) await onResolveInvitation(invitationId);
      setInvitationError(null);
    } catch (nextError) {
      setInvitationError(errorMessage(nextError, `Unable to ${decision} the Business invitation.`));
    } finally {
      setInvitationBusyId(null);
    }
  }, [focusedInvitationId, invitations, onResolveInvitation, refresh, refreshInvitations]);

  const focusedInvitationRefreshing = Boolean(
    focusedInvitationId && loadedFocusedInvitationId !== focusedInvitationId,
  );

  if ((!invitationLinkReady || loading || platformAdmin.loading || invitationLoading) && !activeBusiness && !platformAdmin.overview) {
    return <SellerTrayLoadingScreen message="Preparing your SellerTray account…" />;
  }

  if (!activeBusiness && platformAdmin.isPlatformAdmin) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.adminPage}>
          <PendingInvitationsPanel
            invitations={invitations}
            busyId={invitationBusyId}
            error={invitationError}
            focusedInvitationId={focusedInvitationId}
            focusedInvitationRefreshing={focusedInvitationRefreshing}
            onAccept={(id) => void handleInvitation(id, 'accept')}
            onDecline={(id) => void handleInvitation(id, 'decline')}
            onRetry={() => void refreshInvitations()}
            onDismissFocus={() => void onResolveInvitation()}
            onSwitchAccount={() => void supabase.auth.signOut({ scope: 'local' })}
          />
          <PlatformAdminView
            overview={platformAdmin.overview}
            audit={platformAdmin.audit}
            readiness={platformAdmin.readiness}
            probe={platformAdmin.probe}
            loading={platformAdmin.loading}
            busy={platformAdmin.busy}
            error={platformAdmin.error}
            onRefresh={platformAdmin.refresh}
            onRunAiProbe={platformAdmin.runAiProbe}
            onMutate={platformAdmin.mutate}
            standalone
          />
          <Pressable onPress={() => void supabase.auth.signOut({ scope: 'local' })} style={styles.signOutButton}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!activeBusiness) {
    const setupError = error || platformAdmin.error || invitationError;

    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.page}>
          {setupError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Account setup problem</Text>
              <Text style={styles.errorText}>{setupError}</Text>
              <Text style={styles.errorHelp}>Your existing SellerTray access has not been replaced. Retry loading your Businesses and invitations before creating another Business.</Text>
              <Pressable onPress={() => void Promise.all([refresh(), platformAdmin.refresh(), refreshInvitations()])}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <PendingInvitationsPanel
                invitations={invitations}
                busyId={invitationBusyId}
                error={null}
                focusedInvitationId={focusedInvitationId}
                focusedInvitationRefreshing={focusedInvitationRefreshing}
                onAccept={(id) => void handleInvitation(id, 'accept')}
                onDecline={(id) => void handleInvitation(id, 'decline')}
                onRetry={() => void refreshInvitations()}
                onDismissFocus={() => void onResolveInvitation()}
            onSwitchAccount={() => void supabase.auth.signOut({ scope: 'local' })}
              />
              {invitations.length === 0 && !focusedInvitationId ? <CreateBusinessView onCreate={createBusiness} /> : null}
            </>
          )}

          <Pressable onPress={() => void supabase.auth.signOut({ scope: 'local' })} style={styles.signOutButton}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const workspace = (
    <BusinessContextSelectionProvider
      businesses={businesses}
      activeBusinessId={activeBusiness.id}
      onSelectBusiness={selectBusiness}
    >
      <RedesignWorkspace key={activeBusiness.id} />
    </BusinessContextSelectionProvider>
  );

  if (invitations.length > 0 || invitationError || focusedInvitationId) {
    return (
      <View style={styles.workspaceShell}>
        <SafeAreaView style={styles.invitationBannerArea}>
          <PendingInvitationsPanel
            invitations={invitations}
            busyId={invitationBusyId}
            error={invitationError}
            focusedInvitationId={focusedInvitationId}
            focusedInvitationRefreshing={focusedInvitationRefreshing}
            compact
            onAccept={(id) => void handleInvitation(id, 'accept')}
            onDecline={(id) => void handleInvitation(id, 'decline')}
            onRetry={() => void refreshInvitations()}
            onDismissFocus={() => void onResolveInvitation()}
            onSwitchAccount={() => void supabase.auth.signOut({ scope: 'local' })}
          />
        </SafeAreaView>
        <View style={styles.workspaceContent}>{workspace}</View>
      </View>
    );
  }

  return workspace;
}

type PendingInvitationsPanelProps = {
  invitations: PendingTeamInvitation[];
  busyId: string | null;
  error: string | null;
  focusedInvitationId?: string | null;
  focusedInvitationRefreshing?: boolean;
  compact?: boolean;
  onAccept: (invitationId: string) => void;
  onDecline: (invitationId: string) => void;
  onRetry: () => void;
  onDismissFocus: () => void;
  onSwitchAccount: () => void;
};

function PendingInvitationsPanel({
  invitations,
  busyId,
  error,
  focusedInvitationId = null,
  focusedInvitationRefreshing = false,
  compact = false,
  onAccept,
  onDecline,
  onRetry,
  onDismissFocus,
  onSwitchAccount,
}: PendingInvitationsPanelProps) {
  const orderedInvitations = useMemo(() => {
    if (!focusedInvitationId) return invitations;
    return [...invitations].sort((left, right) => {
      if (left.id === focusedInvitationId) return -1;
      if (right.id === focusedInvitationId) return 1;
      return 0;
    });
  }, [focusedInvitationId, invitations]);
  const hasFocusedInvitation = Boolean(focusedInvitationId && invitations.some((invitation) => invitation.id === focusedInvitationId));

  if (invitations.length === 0 && !error && !focusedInvitationId) return null;

  return (
    <View style={[styles.invitationPanel, compact && styles.invitationPanelCompact]}>
      <Text style={styles.invitationTitle}>{hasFocusedInvitation ? 'Review invitation' : 'Business invitations'}</Text>
      <Text style={styles.invitationHelp}>
        {hasFocusedInvitation
          ? 'Accepting adds this Business to your existing SellerTray account. Your other Businesses and sign-in stay unchanged.'
          : 'A Business is added to your SellerTray account only after you accept its invitation.'}
      </Text>
      {error ? (
        <View style={styles.invitationErrorRow}>
          <Text style={styles.invitationError}>{error}</Text>
          <Pressable onPress={onRetry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {focusedInvitationRefreshing && !error ? (
        <View style={styles.invitationResolvedCard}>
          <Text style={styles.invitationBusiness}>Loading invitation…</Text>
          <Text style={styles.invitationMeta}>Checking the latest invitation status for your SellerTray account.</Text>
        </View>
      ) : null}
      {focusedInvitationId && !hasFocusedInvitation && !focusedInvitationRefreshing && !error ? (
        <View style={styles.invitationResolvedCard}>
          <Text style={styles.invitationBusiness}>Invitation not available to this account</Text>
          <Text style={styles.invitationMeta}>
            Make sure you are signed in with the email address that received the invitation.
            It may also have expired, been accepted, declined or cancelled. Your existing
            Business access is unchanged.
          </Text>
          <Pressable onPress={onSwitchAccount} style={styles.resolvedButton}>
            <Text style={styles.resolvedButtonText}>Sign in with invited email</Text>
          </Pressable>
          <Pressable onPress={onDismissFocus} style={styles.resolvedButton}>
            <Text style={styles.resolvedButtonText}>Continue to SellerTray</Text>
          </Pressable>
        </View>
      ) : null}
      {orderedInvitations.map((invitation) => {
        const busy = busyId === invitation.id;
        const focused = invitation.id === focusedInvitationId;
        return (
          <View key={invitation.id} style={[styles.invitationCard, focused && styles.invitationCardFocused]}>
            <View style={styles.invitationCopy}>
              <Text style={styles.invitationBusiness}>{invitation.tenantName}</Text>
              <Text style={styles.invitationMeta}>Role: {roleLabel(invitation.role)}</Text>
              <Text style={styles.invitationMeta}>Expires: {dateOnly(invitation.expiresAt)}</Text>
              {invitation.invitedByEmail ? (
                <Text style={styles.invitationMeta}>Invited by {invitation.invitedByEmail}</Text>
              ) : null}
            </View>
            <View style={styles.invitationActions}>
              <Pressable
                disabled={busy}
                onPress={() => onDecline(invitation.id)}
                style={({ pressed }) => [styles.declineButton, (pressed || busy) && styles.actionPressed]}
              >
                <Text style={styles.declineText}>Decline</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => onAccept(invitation.id)}
                style={({ pressed }) => [styles.acceptButton, (pressed || busy) && styles.actionPressed]}
              >
                <Text style={styles.acceptText}>{busy ? 'Working…' : 'Accept'}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function roleLabel(value: 'manager' | 'staff'): string {
  return value === 'staff' ? 'Cashier' : 'Manager';
}

function dateOnly(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0 },
  page: { paddingBottom: 36 },
  adminPage: { padding: 18, paddingBottom: 36, gap: 18 },
  workspaceShell: { flex: 1, backgroundColor: '#F8FAFC' },
  workspaceContent: { flex: 1 },
  invitationBannerArea: { backgroundColor: '#F8FAFC' },
  errorCard: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: '#FEF3F2',
    borderRadius: 14,
    padding: 14,
    gap: 5,
  },
  errorTitle: { color: '#B42318', fontWeight: '900', fontSize: 12 },
  errorText: { color: '#912018', fontSize: 11, lineHeight: 17 },
  errorHelp: { color: '#7A271A', fontSize: 10.5, lineHeight: 16 },
  retryText: { color: '#B42318', fontWeight: '900', fontSize: 11 },
  invitationPanel: {
    marginHorizontal: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  invitationPanelCompact: { marginTop: 8, marginBottom: 8 },
  invitationTitle: { color: '#101828', fontSize: 14, fontWeight: '900' },
  invitationHelp: { color: '#475467', fontSize: 11, lineHeight: 16 },
  invitationErrorRow: { gap: 6 },
  invitationError: { color: '#B42318', fontSize: 11, lineHeight: 16 },
  invitationCard: { borderTopWidth: 1, borderTopColor: '#EAECF0', paddingTop: 10, gap: 10 },
  invitationCardFocused: { borderLeftWidth: 3, borderLeftColor: '#12B76A', paddingLeft: 10 },
  invitationResolvedCard: { borderTopWidth: 1, borderTopColor: '#EAECF0', paddingTop: 10, gap: 8 },
  invitationCopy: { gap: 2 },
  invitationBusiness: { color: '#101828', fontSize: 13, fontWeight: '800' },
  invitationMeta: { color: '#667085', fontSize: 11, lineHeight: 16 },
  invitationActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  declineButton: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  declineText: { color: '#344054', fontSize: 11, fontWeight: '800' },
  acceptButton: { backgroundColor: '#101828', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  acceptText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  resolvedButton: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  resolvedButtonText: { color: '#344054', fontSize: 11, fontWeight: '800' },
  actionPressed: { opacity: 0.6 },
  signOutButton: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  signOutText: { color: '#667085', fontSize: 12, fontWeight: '800' },
});
