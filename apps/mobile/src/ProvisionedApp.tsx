import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import SaasApp from './SaasApp';
import { AuthGate } from './components/AuthGate';
import { CreateBusinessView } from './components/CreateBusinessView';
import { useBusinesses } from './hooks/useBusinesses';
import { supabase } from './lib/supabase';

export default function ProvisionedApp() {
  return (
    <AuthGate>
      <ProvisioningGate />
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

  if (loading && !activeBusiness) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Preparing your OrderDesk account…</Text>
      </SafeAreaView>
    );
  }

  if (!activeBusiness) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.page}>
          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Account setup problem</Text>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => void refresh()}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          <CreateBusinessView onCreate={createBusiness} />

          <Pressable onPress={() => void supabase.auth.signOut()} style={styles.signOutButton}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // SaasApp currently owns the established-workspace shell and auth-aware recovery behavior.
  // S2B will collapse this into one root once public signup/onboarding is introduced.
  return <SaasApp />;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F7F9' },
  page: { paddingBottom: 36 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: '#F6F7F9',
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
