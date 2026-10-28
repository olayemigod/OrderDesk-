import { useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { SellerTrayInput } from './SellerTrayElements';
import { errorMessage, supabase } from './supabase';
import './merchant-auth.css';

export type MerchantAuthMode = 'sign-in' | 'forgot-password' | 'reset-password' | 'create-business';

export function merchantAuthModeFromLocation(): MerchantAuthMode | null {
  if (typeof window === 'undefined') return null;
  const value = new URL(window.location.href).searchParams.get('auth');
  if (value === 'reset-password' || value === 'create-business') return value;
  return null;
}

function merchantPortalUrl(mode?: 'reset-password' | 'create-business'): string {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  if (mode) url.searchParams.set('auth', mode);
  return url.toString();
}

function clearAuthIntent(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('auth');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function MerchantAuth({
  session,
  initialMode,
  onAuthenticated,
  onBusinessCreated,
}: {
  session: Session | null;
  initialMode?: MerchantAuthMode;
  onAuthenticated?: (session: Session) => void;
  onBusinessCreated?: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<MerchantAuthMode>(initialMode ?? (session ? 'create-business' : 'sign-in'));
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [merchantCode, setMerchantCode] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  function changeMode(next: MerchantAuthMode) {
    setMode(next);
    setMessage('');
    setSuccess(false);
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setSuccess(false);
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (!result.data.session) throw new Error('SellerTray did not receive a valid session. Please try again.');

      // Confirm the identity with Supabase Auth rather than trusting browser storage alone.
      const verified = await supabase.auth.getUser(result.data.session.access_token);
      if (verified.error || !verified.data.user || verified.data.user.id !== result.data.session.user.id) {
        await supabase.auth.signOut({ scope: 'local' });
        throw verified.error ?? new Error('SellerTray could not verify this session. Please sign in again.');
      }

      onAuthenticated?.(result.data.session);
    } catch (cause) {
      setMessage(errorMessage(cause, 'Unable to sign in.'));
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setSuccess(false);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: merchantPortalUrl('reset-password'),
      });
      if (error) throw error;
      setSuccess(true);
      setMessage('If an account exists for that email, SellerTray has sent password-reset instructions.');
    } catch (cause) {
      setMessage(errorMessage(cause, 'SellerTray could not start password recovery. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setMessage('Use at least 8 characters for your new password.');
      setSuccess(false);
      return;
    }
    if (password !== confirmPassword) {
      setMessage('The new passwords do not match.');
      setSuccess(false);
      return;
    }

    setBusy(true);
    setMessage('');
    setSuccess(false);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw new Error('This reset link is invalid or has expired. Request a new password-reset email.');
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut({ scope: 'local' });
      clearAuthIntent();
      setPassword('');
      setConfirmPassword('');
      setSuccess(true);
      setMessage('Password updated. Sign in with your new password.');
      setMode('sign-in');
    } catch (cause) {
      setMessage(errorMessage(cause, 'Unable to reset your password.'));
    } finally {
      setBusy(false);
    }
  }

  async function createBusiness(event: FormEvent) {
    event.preventDefault();
    if (!businessName.trim()) {
      setMessage('Business name is required.');
      setSuccess(false);
      return;
    }
    if (merchantCode.trim() && !/^[A-Za-z0-9]{3}$/.test(merchantCode.trim())) {
      setMessage('Merchant ID must be exactly 3 letters or numbers.');
      setSuccess(false);
      return;
    }

    setBusy(true);
    setMessage('');
    setSuccess(false);
    try {
      let activeSession = session;
      if (!activeSession) {
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        if (password !== confirmPassword) throw new Error('The passwords do not match.');

        const signup = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: merchantPortalUrl('create-business') },
        });
        if (signup.error) throw signup.error;
        activeSession = signup.data.session;
        if (!activeSession) {
          setSuccess(true);
          setMessage('Check your email to confirm your SellerTray account. After confirmation, return here to finish creating your Business.');
          return;
        }
      }

      const verified = await supabase.auth.getUser(activeSession.access_token);
      if (verified.error || !verified.data.user || verified.data.user.id !== activeSession.user.id) {
        throw verified.error ?? new Error('SellerTray could not verify this account. Please sign in again.');
      }

      const { data, error } = await supabase.functions.invoke('provision-business', {
        body: {
          name: businessName.trim(),
          businessEmail: verified.data.user.email ?? email.trim(),
          businessPhone: businessPhone.trim() || null,
          merchantCode: merchantCode.trim() ? merchantCode.trim().toUpperCase() : undefined,
        },
      });
      if (error) throw error;
      const tenantId = data && typeof data === 'object' && 'tenantId' in data ? String(data.tenantId ?? '') : '';
      if (!tenantId) throw new Error('SellerTray could not confirm the new Business workspace.');

      clearAuthIntent();
      onAuthenticated?.(activeSession);
      await onBusinessCreated?.();
    } catch (cause) {
      setMessage(errorMessage(cause, 'Unable to create your SellerTray Business.'));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'forgot-password'
    ? 'Forgot password'
    : mode === 'reset-password'
      ? 'Reset password'
      : mode === 'create-business'
        ? 'Create My Business'
        : 'Sign in';

  return <div className="login-shell">
    <section className="login-brand">
      <div className="brand-mark large">S</div>
      <p className="eyebrow">SellerTray</p>
      <h1>Run the business. Keep selling on mobile.</h1>
      <p>Manage orders, stock, Branch performance, cash controls, WhatsApp and reporting from one merchant workspace.</p>
    </section>

    <form className="login-card auth-card" onSubmit={mode === 'sign-in' ? signIn : mode === 'forgot-password' ? requestPasswordReset : mode === 'reset-password' ? resetPassword : createBusiness}>
      <div>
        <p className="eyebrow">Merchant Management</p>
        <h2>{title}</h2>
        <p className="muted">{mode === 'forgot-password'
          ? 'Enter your account email and SellerTray will send recovery instructions.'
          : mode === 'reset-password'
            ? 'Choose a new password for your SellerTray account.'
            : mode === 'create-business'
              ? session ? 'Create the first governed Business workspace for this account.' : 'Create your SellerTray account and first Business workspace.'
              : 'Use the same SellerTray account you use for your business.'}</p>
      </div>

      {(mode === 'sign-in' || mode === 'forgot-password' || (mode === 'create-business' && !session)) && <label>
        Email
        <SellerTrayInput type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>}

      {(mode === 'sign-in' || (mode === 'create-business' && !session)) && <PasswordField
        label="Password"
        value={password}
        onChange={setPassword}
        visible={showPassword}
        onToggle={() => setShowPassword((value) => !value)}
        autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
      />}

      {(mode === 'reset-password' || (mode === 'create-business' && !session)) && <>
        {mode === 'reset-password' && <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          visible={showPassword}
          onToggle={() => setShowPassword((value) => !value)}
          autoComplete="new-password"
        />}
        <PasswordField
          label={mode === 'reset-password' ? 'Confirm new password' : 'Confirm password'}
          value={confirmPassword}
          onChange={setConfirmPassword}
          visible={showConfirmPassword}
          onToggle={() => setShowConfirmPassword((value) => !value)}
          autoComplete="new-password"
        />
      </>}

      {mode === 'create-business' && <>
        <label>Business name<SellerTrayInput autoComplete="organization" required value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></label>
        <label>Merchant ID <span className="auth-optional">Optional · 3 letters or numbers</span><SellerTrayInput maxLength={3} autoCapitalize="characters" value={merchantCode} onChange={(event) => setMerchantCode(event.target.value.toUpperCase())} /></label>
        <label>Business phone <span className="auth-optional">Optional</span><SellerTrayInput type="tel" autoComplete="tel" inputMode="tel" value={businessPhone} onChange={(event) => setBusinessPhone(event.target.value)} /></label>
      </>}

      {message ? <div className={success ? 'auth-message success' : 'error-banner compact'} role="status">{message}</div> : null}

      <button className="primary-button" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'sign-in' ? 'Continue' : mode === 'forgot-password' ? 'Send reset instructions' : mode === 'reset-password' ? 'Update password' : 'Create My Business'}
      </button>

      <div className="auth-links">
        {mode === 'sign-in' && <>
          <button type="button" className="text-button" onClick={() => changeMode('forgot-password')}>Forgot password?</button>
          <button type="button" className="text-button" onClick={() => changeMode('create-business')}>Create My Business</button>
        </>}
        {mode !== 'sign-in' && mode !== 'reset-password' && <button type="button" className="text-button" onClick={() => changeMode('sign-in')}>Back to sign in</button>}
        {mode === 'reset-password' && <button type="button" className="text-button" onClick={() => { clearAuthIntent(); void supabase.auth.signOut({ scope: 'local' }); changeMode('sign-in'); }}>Back to sign in</button>}
        {mode === 'create-business' && session && <button type="button" className="text-button" onClick={() => void supabase.auth.signOut({ scope: 'local' })}>Use another account</button>}
      </div>
    </form>
  </div>;
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete: string;
}) {
  return <label>
    {label}
    <span className="password-field">
      <SellerTrayInput
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        minLength={8}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        aria-pressed={visible}
        onClick={onToggle}
      >{visible ? 'Hide' : 'Show'}</button>
    </span>
  </label>;
}
