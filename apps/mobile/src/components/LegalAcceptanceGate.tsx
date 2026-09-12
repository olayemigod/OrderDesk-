import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  acceptSellerTrayLegal,
  getSellerTrayLegalAcceptance,
} from '../data/accountLifecycleRepository';
import { supabase } from '../lib/supabase';

const PRIVACY_URL = 'https://processedge.com.ng/sellertray/privacy';
const TERMS_URL = 'https://processedge.com.ng/sellertray/terms';

export function LegalAcceptanceGate({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setChecking(true);
    setError(null);
    try {
      const status = await getSellerTrayLegalAcceptance();
      setAccepted(status.accepted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to check SellerTray legal acceptance.');
    } finally {
      setChecking(false);
    }
  }

  async function accept() {
    if (!confirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const status = await acceptSellerTrayLegal();
      if (!status.accepted) throw new Error('SellerTray did not confirm legal acceptance.');
      setAccepted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record SellerTray legal acceptance.');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Checking SellerTray account terms…</Text>
      </SafeAreaView>
    );
  }

  if (accepted) return <>{children}</>;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>SELLERTRAY</Text>
        <Text style={styles.title}>Review the service terms</Text>
        <Text style={styles.subtitle}>
          Before using your SellerTray workspace, review the current Terms of Service and Privacy Policy.
        </Text>

        <View style={styles.linkRow}>
          <Pressable onPress={() => void Linking.openURL(TERMS_URL)} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
            <Text style={styles.linkText}>Terms of Service</Text>
          </Pressable>
          <Pressable onPress={() => void Linking.openURL(PRIVACY_URL)} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
            <Text style={styles.linkText}>Privacy Policy</Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmed }}
          onPress={() => setConfirmed((value) => !value)}
          style={({ pressed }) => [styles.confirmRow, pressed && styles.pressed]}
        >
          <View style={[styles.checkbox, confirmed && styles.checkboxChecked]}>
            <Text style={styles.checkboxMark}>{confirmed ? '✓' : ''}</Text>
          </View>
          <Text style={styles.confirmText}>
            I agree to the SellerTray Terms of Service and acknowledge the Privacy Policy.
          </Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          disabled={!confirmed || submitting}
          onPress={() => void accept()}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
            (!confirmed || submitting) && styles.disabled,
          ]}
        >
          {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Continue to SellerTray</Text>}
        </Pressable>

        {error ? (
          <Pressable onPress={() => void refresh()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>Retry status check</Text>
          </Pressable>
        ) : null}

        <Pressable onPress={() => void supabase.auth.signOut()} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', padding: 24 },
  centered: { flex: 1, gap: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#E4E7EC', padding: 22, gap: 14 },
  eyebrow: { color: '#12B76A', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: '#102A43', fontSize: 25, fontWeight: '900' },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 20 },
  linkRow: { flexDirection: 'row', gap: 10 },
  linkButton: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  linkText: { color: '#12B76A', fontSize: 12, fontWeight: '900' },
  confirmRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#667085', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  checkboxChecked: { backgroundColor: '#12B76A', borderColor: '#12B76A' },
  checkboxMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  confirmText: { flex: 1, color: '#475467', fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 49, borderRadius: 12, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  secondaryButton: { minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#344054', fontSize: 12, fontWeight: '800' },
  signOut: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 10 },
  signOutText: { color: '#667085', fontSize: 12, fontWeight: '800' },
  error: { color: '#B42318', fontSize: 12, lineHeight: 18 },
  muted: { color: '#667085', fontSize: 12 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
