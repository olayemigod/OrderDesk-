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

type AuthMode = 'sign-in' | 'forgot-password' | 'reset-password';

const recoveryRedirectUrl =
  Platform.OS === 'web' ? 'http://localhost:3000' : 'orderdesk://reset-password';

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

  useEffect(() => {
    let active = true;

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') {
        setMode('reset-password');
      }
      setBooting(false);
    });

    async function bootstrapAuth() {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const currentUrl = window.location.href;
        const tokens = parseRecoveryTokens(currentUrl);

        if (tokens) {
          await consumeRecoveryUrl(currentUrl);
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
      void consumeRecoveryUrl(url);
    };

    const subscription = Linking.addEventListener('url', handleUrl);
    if (Platform.OS !== 'web') {
      void Linking.getInitialURL().then((url) => {
        if (url?.startsWith('orderdesk://reset-password')) {
          void consumeRecoveryUrl(url);
        }
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

  async function requestPasswordReset() {
    if (!email.trim()) {
      setError('Enter your merchant email first.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: recoveryRedirectUrl,
    });
    setSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setNotice(
      Platform.OS === 'web'
        ? 'Recovery email sent. Open the link on this PC to return to OrderDesk and set a new password.'
        : 'Recovery email sent. Open the link. If Expo Go cannot open OrderDesk automatically, copy the final recovery URL and paste it below.',
    );
  }

  async function consumeRecoveryUrl(url: string) {
    const tokens = parseRecoveryTokens(url);
    if (!tokens) {
      setError('That recovery URL does not contain a valid recovery session. Request a fresh email and try again.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { data, error: sessionError } = await supabase.auth.setSession(tokens);
    setSubmitting(false);

    if (sessionError || !data.session) {
      setError(sessionError?.message ?? 'Could not open the recovery session. Request a fresh recovery email.');
      return;
    }

    setSession(data.session);
    setRecoveryUrl('');
    setPassword('');
    setConfirmPassword('');
    setMode('reset-password');
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

  function showForgotPassword() {
    setMode('forgot-password');
    setPassword('');
    setError(null);
    setNotice(null);
  }

  function showSignIn() {
    setMode('sign-in');
    setPassword('');
    setConfirmPassword('');
    setRecoveryUrl('');
    setError(null);
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Opening OrderDesk…</Text>
      </SafeAreaView>
    );
  }

  if (mode === 'reset-password') {
    return (
      <AuthCard
        title="Set a new password"
        subtitle="Choose the password you will use to sign in to OrderDesk."
      >
        <TextInput
          autoCapitalize="none"
          autoComplete="new-password"
          placeholder="New password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />
        <TextInput
          autoCapitalize="none"
          autoComplete="new-password"
          placeholder="Confirm new password"
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          style={styles.input}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <PrimaryButton
          label="Set password"
          submitting={submitting}
          onPress={() => void updatePassword()}
        />
      </AuthCard>
    );
  }

  if (!session && mode === 'forgot-password') {
    return (
      <AuthCard
        title="Reset password"
        subtitle="We will send a recovery link to your provisioned merchant email."
      >
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <PrimaryButton
          label="Send recovery email"
          submitting={submitting}
          onPress={() => void requestPasswordReset()}
        />

        {Platform.OS !== 'web' ? (
          <View style={styles.manualRecovery}>
            <Text style={styles.manualTitle}>Expo Go fallback</Text>
            <Text style={styles.note}>
              If the recovery link opens in a browser instead of OrderDesk, paste the complete final URL here. It is processed only on this device.
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
              onPress={() => void consumeRecoveryUrl(recoveryUrl.trim())}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryButtonText}>Continue with recovery URL</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={showSignIn} style={styles.linkButton}>
          <Text style={styles.linkText}>Back to sign in</Text>
        </Pressable>
      </AuthCard>
    );
  }

  if (!session) {
    return (
      <AuthCard
        title="Merchant sign in"
        subtitle="Manage WhatsApp orders from one mobile inbox."
      >
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />
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

        <Pressable onPress={showForgotPassword} style={styles.linkButton}>
          <Text style={styles.linkText}>Forgot password?</Text>
        </Pressable>

        <Text style={styles.note}>
          Merchant accounts are provisioned to an OrderDesk business before sign-in.
        </Text>
      </AuthCard>
    );
  }

  return <>{children}</>;
}

function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>ORDERDESK</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {children}
      </View>
    </SafeAreaView>
  );
}

function PrimaryButton({
  label,
  submitting,
  onPress,
}: {
  label: string;
  submitting: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={submitting}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      {submitting ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

function parseRecoveryTokens(url: string): { access_token: string; refresh_token: string } | null {
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return null;

  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const type = params.get('type');

  if (!accessToken || !refreshToken || (type && type !== 'recovery')) return null;

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F7F9',
    justifyContent: 'center',
    padding: 24,
  },
  centered: {
    flex: 1,
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F7F9',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EAECF0',
    padding: 22,
    gap: 12,
  },
  eyebrow: { color: '#246BFD', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#101828', fontSize: 28, fontWeight: '900' },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    color: '#101828',
  },
  urlInput: {
    minHeight: 84,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  button: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: '#246BFD',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  secondaryButtonText: { color: '#344054', fontWeight: '800', fontSize: 14 },
  linkButton: { alignSelf: 'center', paddingVertical: 4 },
  linkText: { color: '#246BFD', fontWeight: '800', fontSize: 13 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18 },
  notice: { color: '#027A48', fontSize: 13, lineHeight: 18 },
  note: { color: '#98A2B3', fontSize: 12, lineHeight: 18, marginTop: 4 },
  manualRecovery: {
    borderTopWidth: 1,
    borderTopColor: '#EAECF0',
    marginTop: 4,
    paddingTop: 12,
    gap: 10,
  },
  manualTitle: { color: '#344054', fontWeight: '800', fontSize: 13 },
  muted: { color: '#667085' },
});
