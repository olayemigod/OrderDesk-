import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

import { AuthGate } from './components/AuthGate';
import { CreateBusinessView } from './components/CreateBusinessView';
import { LegalAcceptanceGate } from './components/LegalAcceptanceGate';
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
import { supabase } from './lib/supabase';
import RedesignWorkspace from './redesign/RedesignWorkspace';

export default function ProvisionedApp() {
  return (
    <AuthGate>
      <LegalAcceptanceGate>
        <ProvisioningGate />
      </LegalAcceptanceGate>
    </AuthGate>
  );
}

function ProvisioningGate() {
  const {
    activeBusiness,
    loading,
    error,
    refresh,
    createBusiness,
  } = useBusinesses();
  const platformAdmin = usePlatformAdmin();
  const [invitations, setInvitations] = useState<PendingTeamInvitation[]>([]);
  const [invitationLoading, setInvitationLoading] = useState(true);
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
    void refreshInvitations();
  }, [refreshInvitations]);

  const handleInvitation = useCallback(async (invitationId: string, decision: 'accept' | 'decline') => {
    setInvitationBusyId(invitationId);
    try {
      if (decision === 'accept') await acceptTeamInvitation(invitationId);
      else await declineTeamInvitation(invitationId);
      await Promise.all([refreshInvitations(), refresh()]);
      setInvitationError(null);
    } catch (nextError) {
      setInvitationError(errorMessage(nextError, `Unable to ${decision} the Business invitation.`));
    } finally {
      setInvitationBusyId(null);
    }
  }, [refresh, refreshInvitations]);

  if ((loading || platformAdmin.loading || invitationLoading) && !activeBusiness && !platformAdmin.overview) {
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
            onAccept={(id) => void handleInvitation(id, 'accept')}
            onDecline={(id) => void handleInvitation(id, 'decline')}
            onRetry={() => void refreshInvitations()}
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
                onAccept={(id) => void handleInvitation(id, 'accept')}
                onDecline={(id) => void handleInvitation(id, 'decline')}
                onRetry={() => void refreshInvitations()}
              />
              {invitations.length === 0 ? <CreateBusinessView onCreate={createBusiness} /> : null}
            </>
          )}

          <Pressable onPress={() => void supabase.auth.signOut({ scope: 'local' })} style={styles.signOutButton}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (invitations.length > 0 || invitationError) {
    return (
      <View style={styles.workspaceShell}>
        <SafeAreaView style={styles.invitationBannerArea}>
          <PendingInvitationsPanel
            invitations={invitations}
            busyId={invitationBusyId}
            error={invitationError}
            compact
            onAccept={(id) => void handleInvitation(id, 'accept')}
            onDecline={(id) => void handleInvitation(id, 'decline')}
            onRetry={() => void refreshInvitations()}
          />
        </SafeAreaView>
        <View style={styles.workspaceContent}>
          <RedesignWorkspace />
        </View>
      </View>
    );
  }

  return <RedesignWorkspace />;
}

type PendingInvitationsPanelProps = {
  invitations: PendingTeamInvitation[];
  busyId: string | null;
  error: string | null;
  compact?: boolean;
  onAccept: (invitationId: string) => void;
  onDecline: (invitationId: string) => void;
  onRetry: () => void;
};

function PendingInvitationsPanel({
  invitations,
  busyId,
  error,
  compact = false,
  onAccept,
  onDecline,
  onRetry,
}: PendingInvitationsPanelProps) {
  if (invitations.length === 0 && !error) return null;

  return (
    <View style={[styles.invitationPanel, compact && styles.invitationPanelCompact]}>
      <Text style={styles.invitationTitle}>Business invitations</Text>
      <Text style={styles.invitationHelp}>A Business is added to your SellerTray account only after you accept its invitation.</Text>
      {error ? (
        <View style={styles.invitationErrorRow}>
          <Text style={styles.invitationError}>{error}</Text>
          <Pressable onPress={onRetry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {invitations.map((invitation) => {
        const busy = busyId === invitation.id;
        return (
          <View key={invitation.id} style={styles.invitationCard}>
            <View style={styles.invitationCopy}>
              <Text style={styles.invitationBusiness}>{invitation.tenantName}</Text>
              <Text style={styles.invitationMeta}>Role: {titleCase(invitation.role)}</Text>
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

function titleCase(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
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
  invitationCopy: { gap: 2 },
  invitationBusiness: { color: '#101828', fontSize: 13, fontWeight: '800' },
  invitationMeta: { color: '#667085', fontSize: 11, lineHeight: 16 },
  invitationActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  declineButton: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  declineText: { color: '#344054', fontSize: 11, fontWeight: '800' },
  acceptButton: { backgroundColor: '#101828', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  acceptText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  actionPressed: { opacity: 0.6 },
  signOutButton: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  signOutText: { color: '#667085', fontSize: 12, fontWeight: '800' },
});
