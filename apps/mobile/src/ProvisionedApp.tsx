import { Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

import { AuthGate } from './components/AuthGate';
import { CreateBusinessView } from './components/CreateBusinessView';
import { LegalAcceptanceGate } from './components/LegalAcceptanceGate';
import { OnboardingActivationGate } from './components/OnboardingActivationGate';
import { PlatformAdminView } from './components/PlatformAdminView';
import { SellerTrayLoadingScreen } from './components/SellerTrayLoadingScreen';
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
  const { activeBusiness, loading, error, refresh, createBusiness } = useBusinesses();
  const platformAdmin = usePlatformAdmin();

  if ((loading || platformAdmin.loading) && !activeBusiness && !platformAdmin.overview) {
    return <SellerTrayLoadingScreen message="Preparing your SellerTray account…" />;
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
          <Pressable onPress={() => void supabase.auth.signOut({ scope: 'local' })} style={styles.signOutButton}><Text style={styles.signOutText}>Sign out</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!activeBusiness) {
    const setupError = error || platformAdmin.error;
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.page}>
          {setupError ? <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Account setup problem</Text>
            <Text style={styles.errorText}>{setupError}</Text>
            <Text style={styles.errorHelp}>Your existing SellerTray workspace has not been replaced. Retry loading it before creating another business.</Text>
            <Pressable onPress={() => void Promise.all([refresh(), platformAdmin.refresh()])}><Text style={styles.retryText}>Retry</Text></Pressable>
          </View> : <CreateBusinessView onCreate={createBusiness} />}
          <Pressable onPress={() => void supabase.auth.signOut({ scope: 'local' })} style={styles.signOutButton}><Text style={styles.signOutText}>Sign out</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return <OnboardingActivationGate business={activeBusiness}><RedesignWorkspace /></OnboardingActivationGate>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0 },
  page: { paddingBottom: 36 }, adminPage: { padding: 18, paddingBottom: 36, gap: 18 },
  errorCard: { marginHorizontal: 20, marginTop: 16, backgroundColor: '#FEF3F2', borderRadius: 14, padding: 14, gap: 5 },
  errorTitle: { color: '#B42318', fontWeight: '900', fontSize: 12 }, errorText: { color: '#912018', fontSize: 11, lineHeight: 17 },
  errorHelp: { color: '#7A271A', fontSize: 10.5, lineHeight: 16 }, retryText: { color: '#B42318', fontWeight: '900', fontSize: 11 },
  signOutButton: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 14 }, signOutText: { color: '#667085', fontSize: 12, fontWeight: '800' },
});
