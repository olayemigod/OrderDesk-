import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

import SaasApp from './SaasApp';
import { AuthGate } from './components/AuthGate';
import { CreateBusinessView } from './components/CreateBusinessView';
import { LegalAcceptanceGate } from './components/LegalAcceptanceGate';
import { PlatformAdminView } from './components/PlatformAdminView';
import { useBusinesses } from './hooks/useBusinesses';
import { usePlatformAdmin } from './hooks/usePlatformAdmin';
import { supabase } from './lib/supabase';

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

  if ((loading || platformAdmin.loading) && !activeBusiness && !platformAdmin.overview) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Preparing your SellerTray account…</Text>
      </SafeAreaView>
    );
  }

  if (!activeBusiness && platformAdmin.isPlatformAdmin) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.adminPage}>
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
    const setupError = error || platformAdmin.error;

    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.page}>
          {setupError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Account setup problem</Text>
              <Text style={styles.errorText}>{setupError}</Text>
              <Pressable onPress={() => void Promise.all([refresh(), platformAdmin.refresh()])}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          <CreateBusinessView onCreate={createBusiness} />

          <Pressable onPress={() => void supabase.auth.signOut({ scope: 'local' })} style={styles.signOutButton}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return <SaasApp />;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0 },
  page: { paddingBottom: 36 },
  adminPage: { padding: 18, paddingBottom: 36, gap: 18 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: '#F8FAFC',
  },
  muted: { color: '#667085', fontSize: 12 },
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
  retryText: { color: '#B42318', fontWeight: '900', fontSize: 11 },
  signOutButton: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  signOutText: { color: '#667085', fontSize: 12, fontWeight: '800' },
});
