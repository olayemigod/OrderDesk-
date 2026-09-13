import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { supabase } from '../lib/supabase';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Enrollment = { factorId: string; secret: string };

export function MfaSecurityCard() {
  const appearance = useSellerTrayAppearance();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [currentLevel, setCurrentLevel] = useState<string | null>(null);
  const [nextLevel, setNextLevel] = useState<string | null>(null);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aalResult, factorsResult] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      if (aalResult.error) throw aalResult.error;
      if (factorsResult.error) throw factorsResult.error;
      setCurrentLevel(aalResult.data?.currentLevel ?? null);
      setNextLevel(aalResult.data?.nextLevel ?? null);
      const factor = (factorsResult.data?.totp ?? []).find((item) => item.status === 'verified') ?? null;
      setVerifiedFactorId(factor?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load MFA status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function enroll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      for (const factor of factors.data?.totp ?? []) {
        if (factor.status !== 'verified') {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'SellerTray Authenticator',
      });
      if (enrollError) throw enrollError;
      const secret = data.totp?.secret ?? '';
      if (!data.id || !secret) throw new Error('Authenticator enrollment returned incomplete setup data.');
      setEnrollment({ factorId: data.id, secret });
      setCode('');
      setNotice('Add this secret to your authenticator app, then enter the six-digit code below.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start MFA enrollment.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const factorId = enrollment?.factorId ?? verifiedFactorId;
    const cleanCode = code.replace(/\D/g, '').slice(0, 6);
    if (!factorId) return setError('No authenticator factor is available.');
    if (cleanCode.length !== 6) return setError('Enter the six-digit code from your authenticator app.');

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: cleanCode });
      if (verifyError) throw verifyError;
      setEnrollment(null);
      setCode('');
      setNotice('MFA verified for this SellerTray session.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify MFA code.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <View style={[styles.card, appearance.dark && darkStyles.card]}><ActivityIndicator /><Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>Checking multi-factor authentication…</Text></View>;
  }

  const sessionVerified = currentLevel === 'aal2';
  const factorEnrolled = Boolean(verifiedFactorId) || nextLevel === 'aal2';

  return (
    <View style={[styles.card, appearance.dark && darkStyles.card]}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>ACCOUNT SECURITY</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Authenticator MFA</Text>
        <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>Protect sensitive SellerTray access with a six-digit authenticator code. ProcessEdge platform-admin access requires an MFA-verified session.</Text>
      </View>

      <View style={[styles.statusBox, sessionVerified ? styles.statusGood : styles.statusNeutral, appearance.dark && (sessionVerified ? darkStyles.successCard : darkStyles.subtleCard)]}>
        <Text style={[sessionVerified ? styles.statusGoodText : styles.statusNeutralText, appearance.dark && (sessionVerified ? darkStyles.successText : darkStyles.bodyText)]}>
          {sessionVerified ? 'MFA verified for this session' : factorEnrolled ? 'MFA is enrolled — verify this session' : 'MFA is not enrolled'}
        </Text>
      </View>

      {!factorEnrolled && !enrollment ? (
        <Pressable disabled={busy} onPress={() => void enroll()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}>
          <Text style={styles.primaryText}>{busy ? 'Preparing…' : 'Enable authenticator MFA'}</Text>
        </Pressable>
      ) : null}

      {enrollment ? (
        <View style={[styles.enrollmentBox, appearance.dark && darkStyles.subtleCard]}>
          <Text style={[styles.stepTitle, appearance.dark && darkStyles.titleText]}>1. Add SellerTray to your authenticator app</Text>
          <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>Use this setup secret for manual entry:</Text>
          <Text selectable style={[styles.secret, appearance.dark && darkStyles.titleText]}>{enrollment.secret}</Text>
          <Text style={[styles.stepTitle, appearance.dark && darkStyles.titleText]}>2. Enter the current six-digit code</Text>
        </View>
      ) : factorEnrolled && !sessionVerified ? (
        <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>Enter the current code from your enrolled authenticator to unlock high-assurance actions.</Text>
      ) : null}

      {enrollment || (factorEnrolled && !sessionVerified) ? (
        <>
          <TextInput value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} placeholder="123456" autoComplete="one-time-code" placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'} style={[styles.codeInput, appearance.dark && darkStyles.input]} />
          <Pressable disabled={busy} onPress={() => void verify()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}>
            <Text style={styles.primaryText}>{busy ? 'Verifying…' : 'Verify MFA code'}</Text>
          </Pressable>
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={[styles.policy, appearance.dark && darkStyles.bodyText]}>Keep access to your authenticator device. SellerTray does not persist the authenticator setup secret after this screen is dismissed.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 18, padding: 16, gap: 12 },
  eyebrow: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 17, fontWeight: '900', marginTop: 3 },
  helper: { color: '#667085', fontSize: 13, lineHeight: 20, marginTop: 3 },
  statusBox: { borderRadius: 11, padding: 10 },
  statusGood: { backgroundColor: '#ECFDF3' },
  statusNeutral: { backgroundColor: '#F2F4F7' },
  statusGoodText: { color: '#027A48', fontSize: 13, fontWeight: '900' },
  statusNeutralText: { color: '#475467', fontSize: 13, fontWeight: '900' },
  enrollmentBox: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 11, gap: 7 },
  stepTitle: { color: '#344054', fontSize: 13, fontWeight: '900' },
  secret: { color: '#102A43', fontSize: 13, fontWeight: '900', letterSpacing: 1, paddingVertical: 6 },
  codeInput: { minHeight: 48, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, paddingHorizontal: 14, fontSize: 20, letterSpacing: 5, color: '#102A43', backgroundColor: '#FFFFFF' },
  primaryButton: { minHeight: 44, borderRadius: 11, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  error: { color: '#B42318', fontSize: 10, lineHeight: 15 },
  notice: { color: '#027A48', fontSize: 10, fontWeight: '800', lineHeight: 15 },
  policy: { color: '#667085', fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46' },
  successCard: { backgroundColor: '#12372C' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  successText: { color: '#ABEFC6' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#98A2B3', color: '#102A43' },
});
