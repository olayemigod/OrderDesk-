import { useEffect, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';
import { SellerTrayBrand } from './SellerTrayBrand';

type AuthMode = 'welcome' | 'sign-in' | 'sign-up' | 'forgot-password' | 'reset-password';

const SELLERTRAY_PRIVACY_URL = 'https://processedge.com.ng/sellertray/privacy';
const SELLERTRAY_TERMS_URL = 'https://processedge.com.ng/sellertray/terms';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [mode, setMode] = useState<AuthMode>('welcome');
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
        : __DEV__
          ? 'Recovery email sent. Open the link. If Expo Go cannot open SellerTray automatically, copy the final recovery URL and paste it below.'
          : 'Recovery email sent. Open the link to return to SellerTray and set a new password.',
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

    await supabase.auth.signOut({ scope: 'local' });
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

  if (!session && mode === 'welcome') {
    return (
      <SafeAreaView style={styles.welcomeScreen}>
        <ScrollView contentContainerStyle={styles.welcomeScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.welcomeBrand}>
            <SellerTrayBrand size={62} showTagline inverted />
          </View>

          <View style={styles.welcomeHero}>
            <Text style={styles.welcomeEyebrow}>SMARTER MERCHANT COMMERCE</Text>
            <Text style={styles.welcomeTitle}>Orders. Conversations. Growth.</Text>
            <Text style={styles.welcomeText}>
              Manage customer conversations, orders, payments and fulfilment from one simple merchant app.
            </Text>
          </View>

          <View style={styles.welcomeBenefits}>
            <WelcomeBenefit icon="receipt-outline" title="Manage orders" text="Keep every customer order organised." />
            <WelcomeBenefit icon="chatbubbles-outline" title="Sell through WhatsApp" text="Turn supported conversations into commerce." />
            <WelcomeBenefit icon="card-outline" title="Get paid faster" text="Track payment choices and verification." />
            <WelcomeBenefit icon="trending-up-outline" title="Grow with clarity" text="See the activity that matters to your business." />
          </View>

          <View style={styles.welcomeActions}>
            <Pressable onPress={() => showMode('sign-up')} style={styles.welcomePrimary}>
              <Text style={styles.welcomePrimaryText}>Get Started</Text>
              <Ionicons name="arrow-forward" size={19} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={() => showMode('sign-in')} style={styles.welcomeSecondary}>
              <Text style={styles.welcomeSecondaryText}>Sign In</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!session && mode === 'forgot-password') {
    return (
      <AuthCard title="Reset password" subtitle="We will send a recovery link to your merchant email.">
        <EmailInput email={email} onChange={setEmail} />
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Send recovery email" submitting={submitting} onPress={() => void requestPasswordReset()} />

        {__DEV__ && Platform.OS !== 'web' ? (
          <View style={styles.manualRecovery}>
            <Text style={styles.manualTitle}>Expo Go fallback</Text>
            <Text style={styles.note}>
              If the recovery link opens in a browser instead of SellerTray, paste the complete final URL here. It is processed only on this device.
            </Text>
            <AuthField label="Recovery URL" hint="Paste the complete URL only when using the development fallback.">
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                placeholder="Paste recovery URL"
                value={recoveryUrl}
                onChangeText={setRecoveryUrl}
                style={[styles.input, styles.urlInput]}
              />
            </AuthField>
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
      <AuthCard title="Sign In" subtitle="Secure access for every merchant.">
        <EmailInput email={email} onChange={setEmail} />
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="password"
          placeholder="Enter your password"
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

        <View style={styles.signInHelp}>
          <Text style={styles.signInHelpTitle}>Need help signing in?</Text>
          <Text style={styles.signInHelpText}>Reach ProcessEdge support by WhatsApp, phone or email.</Text>
          <View style={styles.supportRow}>
            <SupportAction icon="logo-whatsapp" label="WhatsApp" url="https://wa.me/2348096086857" />
            <SupportAction icon="call-outline" label="Call" url="tel:+2348096086857" />
            <SupportAction icon="mail-outline" label="Email" url="mailto:processedgeng@gmail.com?subject=SellerTray%20Support" />
          </View>
        </View>
      </AuthCard>
    );
  }

  return <>{children}</>;
}

function WelcomeBenefit({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <View style={styles.welcomeBenefit}>
      <View style={styles.welcomeBenefitIcon}>
        <Ionicons name={icon as never} size={22} color="#12B76A" />
      </View>
      <View style={styles.welcomeBenefitCopy}>
        <Text style={styles.welcomeBenefitTitle}>{title}</Text>
        <Text style={styles.welcomeBenefitText}>{text}</Text>
      </View>
    </View>
  );
}

function SupportAction({ icon, label, url }: { icon: string; label: string; url: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => [styles.supportAction, pressed && styles.buttonPressed]}
    >
      <Ionicons name={icon as never} size={20} color="#079455" />
      <Text style={styles.supportActionText}>{label}</Text>
    </Pressable>
  );
}

function EmailInput({ email, onChange }: { email: string; onChange: (value: string) => void }) {
  return (
    <AuthField label="Email address" hint="Use the email address for your SellerTray merchant account.">
      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@business.com"
        value={email}
        onChangeText={onChange}
        style={styles.input}
      />
    </AuthField>
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
      <PasswordField
        label="Password"
        hint="Use at least 8 characters."
        value={password}
        onChange={onPassword}
        autoComplete="new-password"
        placeholder="Create a password"
      />
      <PasswordField
        label="Confirm password"
        value={confirmPassword}
        onChange={onConfirmPassword}
        autoComplete="new-password"
        placeholder="Re-enter your password"
      />
    </>
  );
}

function PasswordField({
  label,
  hint,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'password' | 'new-password';
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <AuthField
      label={label}
      hint={hint}
      action={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onPress={() => setVisible((current) => !current)}
          style={({ pressed }) => [styles.fieldAction, pressed && styles.buttonPressed]}
        >
          <Text style={styles.fieldActionText}>{visible ? 'Hide' : 'Show'}</Text>
        </Pressable>
      }
    >
      <TextInput
        autoCapitalize="none"
        autoComplete={autoComplete}
        placeholder={placeholder}
        secureTextEntry={!visible}
        value={value}
        onChangeText={onChange}
        style={styles.input}
      />
    </AuthField>
  );
}

function AuthField({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {action}
      </View>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardArea}
      >
        <ScrollView
          contentContainerStyle={styles.authScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.brandHeader}>
              <SellerTrayBrand size={52} showTagline />
            </View>
            <Text style={styles.eyebrow}>MERCHANT APP</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  screen: { flex: 1, backgroundColor: '#102A43' },
  welcomeScreen: { flex: 1, backgroundColor: '#102A43' },
  welcomeScroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 28 : 20, paddingBottom: 34, justifyContent: 'center', gap: 24 },
  welcomeBrand: { alignItems: 'flex-start' },
  welcomeHero: { gap: 8 },
  welcomeEyebrow: { color: '#6CE9A6', fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  welcomeTitle: { color: '#FFFFFF', fontSize: 34, lineHeight: 40, fontWeight: '900' },
  welcomeText: { color: '#D9FBE8', fontSize: 16, lineHeight: 24 },
  welcomeBenefits: { gap: 10 },
  welcomeBenefit: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 13 },
  welcomeBenefitIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  welcomeBenefitCopy: { flex: 1 },
  welcomeBenefitTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  welcomeBenefitText: { color: '#D0D5DD', fontSize: 12, lineHeight: 18, marginTop: 2 },
  welcomeActions: { gap: 10, marginTop: 4 },
  welcomePrimary: { minHeight: 54, borderRadius: 14, backgroundColor: '#12B76A', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  welcomePrimaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  welcomeSecondary: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: '#6CE9A6', alignItems: 'center', justifyContent: 'center' },
  welcomeSecondaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  keyboardArea: { flex: 1 },
  authScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingTop: 24, paddingBottom: Platform.OS === 'android' ? 48 : 24 },
  centered: { flex: 1, gap: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#102A43' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 1, borderColor: '#E4E7EC', padding: 22, gap: 12, shadowColor: '#102A43', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.08, shadowRadius: 22, elevation: 3 },
  brandHeader: { marginBottom: 8 },
  eyebrow: { color: '#12B76A', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#102A43', fontSize: 28, fontWeight: '900' },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  field: { gap: 6 },
  fieldHeader: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  fieldLabel: { color: '#344054', fontSize: 13, fontWeight: '900' },
  fieldHint: { color: '#667085', fontSize: 12, lineHeight: 18 },
  fieldAction: { minHeight: 32, minWidth: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  fieldActionText: { color: '#12B76A', fontSize: 11, fontWeight: '900' },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: '#D0D5DD', paddingHorizontal: 14, backgroundColor: '#FFFFFF', color: '#102A43' },
  urlInput: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },
  button: { minHeight: 50, borderRadius: 12, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  secondaryButtonText: { color: '#344054', fontWeight: '800', fontSize: 14 },
  authLinks: { gap: 2, marginTop: 2 },
  linkButton: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  linkText: { color: '#12B76A', fontWeight: '800', fontSize: 13 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18 },
  notice: { color: '#027A48', fontSize: 13, lineHeight: 18 },
  note: { color: '#667085', fontSize: 13, lineHeight: 19, marginTop: 4 },
  signInHelp: { marginTop: 4, borderTopWidth: 1, borderTopColor: '#E4E7EC', paddingTop: 14, gap: 6 },
  signInHelpTitle: { color: '#102A43', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  signInHelpText: { color: '#667085', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  supportRow: { flexDirection: 'row', gap: 7, marginTop: 4 },
  supportAction: { flex: 1, minHeight: 52, borderRadius: 12, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 5 },
  supportActionText: { color: '#079455', fontSize: 10, fontWeight: '900' },
  manualRecovery: { borderTopWidth: 1, borderTopColor: '#E4E7EC', marginTop: 4, paddingTop: 12, gap: 10 },
  manualTitle: { color: '#344054', fontWeight: '800', fontSize: 13 },
  legalConsentRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 2 },
  checkboxButton: { paddingTop: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#667085', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  checkboxChecked: { backgroundColor: '#12B76A', borderColor: '#12B76A' },
  checkboxMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  legalConsentText: { flex: 1, color: '#667085', fontSize: 12, lineHeight: 18 },
  inlineLink: { color: '#12B76A', fontWeight: '800' },
  muted: { color: '#667085' },
});
