import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';

type AuthMode = 'sign-in' | 'sign-up' | 'forgot-password' | 'reset-password';

const SELLERTRAY_PRIVACY_URL = 'https://processedge.com.ng/sellertray/privacy';
const SELLERTRAY_TERMS_URL = 'https://processedge.com.ng/sellertray/terms';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryUrl, setRecoveryUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signupLegalAccepted, setSignupLegalAccepted] = useState(false);

  useEffect(() => {
    let active = true;

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setMode('reset-password');
      setBooting(false);
    });

    async function bootstrapAuth() {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const currentUrl = window.location.href;
        if (parseAuthTokens(currentUrl)) {
          await consumeAuthUrl(currentUrl);
          if (active) {
            window.history.replaceState(null, '', window.location.pathname || '/');
            setBooting(false);
          }
          return;
        }
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!active) return;
      setSession(sessionData.session);
      setBooting(false);
    }

    void bootstrapAuth();

    const handleUrl = ({ url }: { url: string }) => {
      if (isSellerTrayAuthUrl(url)) void consumeAuthUrl(url);
    };

    const subscription = Linking.addEventListener('url', handleUrl);
    if (Platform.OS !== 'web') {
      void Linking.getInitialURL().then((url) => {
        if (url && isSellerTrayAuthUrl(url)) void consumeAuthUrl(url);
      });
    }

    return () => {
      active = false;
      data.subscription.unsubscribe();
      subscription.remove();
    };
  }, []);

  async function signIn() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);

    if (signInError) setError(signInError.message);
  }

  async function signUp() {
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    if (!signupLegalAccepted) {
      setError('Review and accept the SellerTray Terms of Service and acknowledge the Privacy Policy.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: authRedirectUrl('auth-confirm'),
      },
    });

    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      setSession(data.session);
      return;
    }

    setPassword('');
    setConfirmPassword('');
    setSignupLegalAccepted(false);
    setMode('sign-in');
    setNotice(
      'Account created. Check your email and confirm your address, then return to SellerTray and sign in with the password you chose.',
    );
  }

  async function requestPasswordReset() {
    if (!email.trim()) {
      setError('Enter your merchant email first.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: authRedirectUrl('reset-password'),
    });
    setSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setNotice(
      Platform.OS === 'web'
        ? 'Recovery email sent. Open the link in this browser to return to SellerTray and set a new password.'
        : 'Recovery email sent. Open the link. If Expo Go cannot open SellerTray automatically, copy the final recovery URL and paste it below.',
    );
  }

  async function consumeAuthUrl(url: string) {
    const parsed = parseAuthTokens(url);
    if (!parsed) {
      setError('That authentication URL does not contain a valid SellerTray session. Request a fresh email and try again.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { data, error: sessionError } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    });
    setSubmitting(false);

    if (sessionError || !data.session) {
      setError(sessionError?.message ?? 'Could not open the authentication session. Request a fresh email.');
      return;
    }

    setSession(data.session);
    setRecoveryUrl('');

    if (parsed.type === 'recovery') {
      setPassword('');
      setConfirmPassword('');
      setMode('reset-password');
    }
  }

  async function updatePassword() {
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setSubmitting(false);
      setError(updateError.message);
      return;
    }

    await supabase.auth.signOut();
    setSubmitting(false);
    setSession(null);
    setPassword('');
    setConfirmPassword('');
    setMode('sign-in');
    setNotice('Password set successfully. Sign in with your new password.');
  }

  function showMode(nextMode: AuthMode) {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setRecoveryUrl('');
    setSignupLegalAccepted(false);
    setError(null);
    setNotice(null);
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Opening SellerTray…</Text>
      </SafeAreaView>
    );
  }

  if (mode === 'reset-password') {
    return (
      <AuthCard title="Set a new password" subtitle="Choose the password you will use to sign in to SellerTray.">
        <PasswordInputs
          password={password}
          confirmPassword={confirmPassword}
          onPassword={setPassword}
          onConfirmPassword={setConfirmPassword}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Set password" submitting={submitting} onPress={() => void updatePassword()} />
      </AuthCard>
    );
  }

  if (!session && mode === 'forgot-password') {
    return (
      <AuthCard title="Reset password" subtitle="We will send a recovery link to your merchant email.">
        <EmailInput email={email} onChange={setEmail} />
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Send recovery email" submitting={submitting} onPress={() => void requestPasswordReset()} />

        {Platform.OS !== 'web' ? (
          <View style={styles.manualRecovery}>
            <Text style={styles.manualTitle}>Expo Go fallback</Text>
            <Text style={styles.note}>
              If the recovery link opens in a browser instead of SellerTray, paste the complete final URL here. It is processed only on this device.
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              placeholder="Paste recovery URL"
              value={recoveryUrl}
              onChangeText={setRecoveryUrl}
              style={[styles.input, styles.urlInput]}
            />
            <Pressable
              disabled={submitting || !recoveryUrl.trim()}
              onPress={() => void consumeAuthUrl(recoveryUrl.trim())}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryButtonText}>Continue with recovery URL</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={() => showMode('sign-in')} style={styles.linkButton}>
          <Text style={styles.linkText}>Back to sign in</Text>
        </Pressable>
      </AuthCard>
    );
  }

  if (!session && mode === 'sign-up') {
    return (
      <AuthCard title="Create your SellerTray account" subtitle="Start with your email. Your business workspace comes next.">
        <EmailInput email={email} onChange={setEmail} />
        <PasswordInputs
          password={password}
          confirmPassword={confirmPassword}
          onPassword={setPassword}
          onConfirmPassword={setConfirmPassword}
        />
        <View style={styles.legalConsentRow}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: signupLegalAccepted }}
            onPress={() => setSignupLegalAccepted((value) => !value)}
            style={({ pressed }) => [styles.checkboxButton, pressed && styles.buttonPressed]}
          >
            <View style={[styles.checkbox, signupLegalAccepted && styles.checkboxChecked]}>
              <Text style={styles.checkboxMark}>{signupLegalAccepted ? '✓' : ''}</Text>
            </View>
          </Pressable>
          <Text style={styles.legalConsentText}>
            I agree to the{' '}
            <Text style={styles.inlineLink} onPress={() => void Linking.openURL(SELLERTRAY_TERMS_URL)}>
              SellerTray Terms of Service
            </Text>{' '}
            and acknowledge the{' '}
            <Text style={styles.inlineLink} onPress={() => void Linking.openURL(SELLERTRAY_PRIVACY_URL)}>
              Privacy Policy
            </Text>.
          </Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Create account" submitting={submitting} onPress={() => void signUp()} />
        <Text style={styles.note}>You may need to confirm your email before your first sign in.</Text>
        <Pressable onPress={() => showMode('sign-in')} style={styles.linkButton}>
          <Text style={styles.linkText}>Already have an account? Sign in</Text>
        </Pressable>
      </AuthCard>
    );
  }

  if (!session) {
    return (
      <AuthCard title="Merchant sign in" subtitle="Turn WhatsApp messages into organised orders.">
        <EmailInput email={email} onChange={setEmail} />
        <TextInput
          autoCapitalize="none"
          autoComplete="password"
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Sign in" submitting={submitting} onPress={() => void signIn()} />

        <View style={styles.authLinks}>
          <Pressable onPress={() => showMode('forgot-password')} style={styles.linkButton}>
            <Text style={styles.linkText}>Forgot password?</Text>
          </Pressable>
          <Pressable onPress={() => showMode('sign-up')} style={styles.linkButton}>
            <Text style={styles.linkText}>Create a SellerTray account</Text>
          </Pressable>
        </View>
      </AuthCard>
    );
  }

  return <>{children}</>;
}

function EmailInput({ email, onChange }: { email: string; onChange: (value: string) => void }) {
  return (
    <TextInput
      autoCapitalize="none"
      autoComplete="email"
      keyboardType="email-address"
      placeholder="Email"
      value={email}
      onChangeText={onChange}
      style={styles.input}
    />
  );
}

function PasswordInputs({
  password,
  confirmPassword,
  onPassword,
  onConfirmPassword,
}: {
  password: string;
  confirmPassword: string;
  onPassword: (value: string) => void;
  onConfirmPassword: (value: string) => void;
}) {
  return (
    <>
      <TextInput
        autoCapitalize="none"
        autoComplete="new-password"
        placeholder="Password (8+ characters)"
        secureTextEntry
        value={password}
        onChangeText={onPassword}
        style={styles.input}
      />
      <TextInput
        autoCapitalize="none"
        autoComplete="new-password"
        placeholder="Confirm password"
        secureTextEntry
        value={confirmPassword}
        onChangeText={onConfirmPassword}
        style={styles.input}
      />
    </>
  );
}

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>SELLERTRAY</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {children}
      </View>
    </SafeAreaView>
  );
}

function PrimaryButton({ label, submitting, onPress }: { label: string; submitting: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={submitting}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, submitting && styles.buttonDisabled]}
    >
      {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

function isSellerTrayAuthUrl(url: string): boolean {
  return url.startsWith('sellertray://') || url.startsWith('orderdesk://');
}

function authRedirectUrl(path: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return `sellertray://${path}`;
}

function parseAuthTokens(url: string): {
  accessToken: string;
  refreshToken: string;
  type: string | null;
} | null {
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return null;

  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  return {
    accessToken,
    refreshToken,
    type: params.get('type'),
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F7F9', justifyContent: 'center', padding: 24 },
  centered: { flex: 1, gap: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F7F9' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#EAECF0', padding: 22, gap: 12 },
  eyebrow: { color: '#246BFD', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#101828', fontSize: 28, fontWeight: '900' },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: '#D0D5DD', paddingHorizontal: 14, backgroundColor: '#FFFFFF', color: '#101828' },
  urlInput: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },
  button: { minHeight: 50, borderRadius: 12, backgroundColor: '#246BFD', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  secondaryButtonText: { color: '#344054', fontWeight: '800', fontSize: 14 },
  authLinks: { gap: 2, marginTop: 2 },
  linkButton: { alignSelf: 'center', paddingVertical: 4 },
  linkText: { color: '#246BFD', fontWeight: '800', fontSize: 13 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18 },
  notice: { color: '#027A48', fontSize: 13, lineHeight: 18 },
  note: { color: '#98A2B3', fontSize: 12, lineHeight: 18, marginTop: 4 },
  manualRecovery: { borderTopWidth: 1, borderTopColor: '#EAECF0', marginTop: 4, paddingTop: 12, gap: 10 },
  manualTitle: { color: '#344054', fontWeight: '800', fontSize: 13 },
  legalConsentRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 2 },
  checkboxButton: { paddingTop: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#98A2B3', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  checkboxChecked: { backgroundColor: '#246BFD', borderColor: '#246BFD' },
  checkboxMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  legalConsentText: { flex: 1, color: '#667085', fontSize: 12, lineHeight: 18 },
  inlineLink: { color: '#246BFD', fontWeight: '800' },
  muted: { color: '#667085' },
});
