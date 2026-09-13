import { useEffect, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import {
  deleteSellerTrayAccount,
  exportBusinessData,
} from '../data/accountLifecycleRepository';
import { supabase } from '../lib/supabase';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  business?: MerchantBusiness | null;
};

const DELETE_PHRASE = 'DELETE MY SELLERTRAY ACCOUNT';
const PRIVACY_URL = 'https://processedge.com.ng/sellertray/privacy';
const TERMS_URL = 'https://processedge.com.ng/sellertray/terms';

export function AccountDataControls({ business = null }: Props) {
  const appearance = useSellerTrayAppearance();
  const [profileName, setProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canExport = business?.role === 'owner';

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      const metadata = data.user?.user_metadata ?? {};
      const name =
        (typeof metadata.full_name === 'string' && metadata.full_name) ||
        (typeof metadata.name === 'string' && metadata.name) ||
        '';
      setProfileName(name);
    });
    return () => { active = false; };
  }, []);

  async function saveProfileName() {
    const clean = normalisePersonName(profileName);
    if (clean.length < 2) {
      setError('Enter the name you want SellerTray to use for greetings.');
      return;
    }

    setSavingProfile(true);
    setError(null);
    setNotice(null);
    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        full_name: clean,
        name: clean,
      },
    });
    setSavingProfile(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setProfileName(clean);
    setNotice('Personal name updated. Your Home greeting will use it.');
  }

  async function exportData() {
    if (!business || !canExport) return;
    setExporting(true);
    setError(null);
    setNotice(null);

    try {
      const payload = await exportBusinessData(business.id);
      const content = JSON.stringify(payload, null, 2);
      const filename = `sellertray-${safeFilename(business.slug || business.name)}-${new Date().toISOString().slice(0, 10)}.json`;

      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ title: filename, message: content });
      }

      setNotice('Business data export prepared.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export business data.');
    } finally {
      setExporting(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setError(null);
    setNotice(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign out of SellerTray.');
      setSigningOut(false);
    }
  }

  async function deleteAccount() {
    if (!password) {
      setError('Enter your current password.');
      return;
    }
    if (phrase.trim() !== DELETE_PHRASE) {
      setError(`Type ${DELETE_PHRASE} exactly.`);
      return;
    }

    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      await deleteSellerTrayAccount(password);
      setPassword('');
      setPhrase('');
      await supabase.auth.signOut({ scope: 'local' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete this SellerTray account.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View style={[styles.card, appearance.dark && darkStyles.card]}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>DATA & ACCOUNT</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Your data and account</Text>
        <Text style={[styles.description, appearance.dark && darkStyles.bodyText]}>
          Export business records or permanently close your SellerTray account.
        </Text>
      </View>

      <View style={styles.profileBlock}>
        <Text style={[styles.actionTitle, appearance.dark && darkStyles.titleText]}>Your name</Text>
        <Text style={[styles.actionText, appearance.dark && darkStyles.bodyText]}>
          Used for personal greetings such as “Good morning, Alex”. This does not change the business name.
        </Text>
        <TextInput
          autoCapitalize="words"
          autoComplete="name"
          placeholder="Your name"
          value={profileName}
          onChangeText={setProfileName}
          editable={!savingProfile}
          placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
          style={[styles.profileInput, appearance.dark && darkStyles.input]}
        />
        <Pressable
          disabled={savingProfile || profileName.trim().length < 2}
          onPress={() => void saveProfileName()}
          style={({ pressed }) => [
            styles.profileSaveButton,
            pressed && styles.pressed,
            (savingProfile || profileName.trim().length < 2) && styles.disabled,
          ]}
        >
          <Text style={styles.profileSaveText}>{savingProfile ? 'Saving…' : 'Save name'}</Text>
        </Pressable>
      </View>

      {business ? (
        <View style={[styles.actionBlock, appearance.dark && darkStyles.borderTop]}>
          <Text style={[styles.actionTitle, appearance.dark && darkStyles.titleText]}>Business data export</Text>
          <Text style={[styles.actionText, appearance.dark && darkStyles.bodyText]}>
            {canExport
              ? 'Download a JSON copy of this business profile, catalogue, customers, WhatsApp order records, notification history, team records and subscription state.'
              : 'Only the business Owner can export the complete workspace dataset.'}
          </Text>
          {canExport ? (
            <Pressable
              disabled={exporting || deleting}
              onPress={() => void exportData()}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
                (exporting || deleting) && styles.disabled,
              ]}
            >
              <Text style={[styles.secondaryButtonText, appearance.dark && darkStyles.titleText]}>
                {exporting ? 'Preparing export…' : 'Export business data'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.sessionBlock, appearance.dark && darkStyles.borderTop]}>
        <Text style={[styles.actionTitle, appearance.dark && darkStyles.titleText]}>Signed-in session</Text>
        <Text style={[styles.actionText, appearance.dark && darkStyles.bodyText]}>
          Sign out of SellerTray on this device. Your business and order data remain safely stored.
        </Text>
        <Pressable
          disabled={signingOut || deleting || exporting}
          onPress={() => void signOut()}
          style={({ pressed }) => [
            styles.signOutButton,
            pressed && styles.pressed,
            (signingOut || deleting || exporting) && styles.disabled,
          ]}
        >
          <Text style={[styles.signOutButtonText, appearance.dark && darkStyles.titleText]}>{signingOut ? 'Signing out…' : 'Sign out of this device'}</Text>
        </Pressable>
      </View>

      <View style={[styles.legalBlock, appearance.dark && darkStyles.borderTop]}>
        <Text style={[styles.actionTitle, appearance.dark && darkStyles.titleText]}>Legal & privacy</Text>
        <Text style={[styles.actionText, appearance.dark && darkStyles.bodyText]}>
          Review how SellerTray handles merchant and customer order data and the terms that govern the service.
        </Text>
        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => void Linking.openURL(PRIVACY_URL)}
            style={({ pressed }) => [styles.legalButton, appearance.dark && darkStyles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={[styles.secondaryButtonText, appearance.dark && darkStyles.titleText]}>Privacy Policy</Text>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(TERMS_URL)}
            style={({ pressed }) => [styles.legalButton, appearance.dark && darkStyles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={[styles.secondaryButtonText, appearance.dark && darkStyles.titleText]}>Terms</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.dangerBlock, appearance.dark && darkStyles.borderTop]}>
        <Text style={[styles.actionTitle, appearance.dark && darkStyles.titleText]}>Danger zone</Text>
        <Text style={[styles.actionText, appearance.dark && darkStyles.bodyText]}>
          Account closure is intentionally kept here, away from everyday settings. Closing the account permanently deletes businesses you own and removes memberships in other businesses. Active paid subscriptions must be cancelled first.
        </Text>

        {!showDelete ? (
          <Pressable
            disabled={exporting}
            onPress={() => {
              setShowDelete(true);
              setError(null);
              setNotice(null);
            }}
            style={({ pressed }) => [styles.dangerOutlineButton, appearance.dark && darkStyles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={[styles.secondaryButtonText, appearance.dark && darkStyles.titleText]}>Account closure options</Text>
          </Pressable>
        ) : (
          <View style={[styles.confirmation, appearance.dark && darkStyles.dangerCard]}>
            <Text style={[styles.confirmTitle, appearance.dark && darkStyles.dangerTitle]}>Permanent action</Text>
            <Text style={[styles.actionText, appearance.dark && darkStyles.bodyText]}>
              Enter your current password, then type {DELETE_PHRASE}. This cannot be undone.
            </Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="password"
              placeholder="Current password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              editable={!deleting}
              placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
              style={[styles.input, appearance.dark && darkStyles.input]}
            />
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={DELETE_PHRASE}
              value={phrase}
              onChangeText={setPhrase}
              editable={!deleting}
              placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
              style={[styles.input, appearance.dark && darkStyles.input]}
            />
            <View style={styles.buttonRow}>
              <Pressable
                disabled={deleting}
                onPress={() => {
                  setShowDelete(false);
                  setPassword('');
                  setPhrase('');
                  setError(null);
                }}
                style={({ pressed }) => [styles.cancelButton, appearance.dark && darkStyles.secondaryButton, pressed && styles.pressed]}
              >
                <Text style={[styles.cancelButtonText, appearance.dark && darkStyles.titleText]}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={deleting}
                onPress={() => void deleteAccount()}
                style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed, deleting && styles.disabled]}
              >
                <Text style={styles.dangerButtonText}>{deleting ? 'Deleting…' : 'Delete account permanently'}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

function normalisePersonName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
    .join(' ');
}

function safeFilename(value: string): string {
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'business';
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 18, padding: 16, gap: 16 },
  heading: { gap: 4 },
  eyebrow: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#102A43', fontSize: 18, fontWeight: '900' },
  description: { color: '#667085', fontSize: 13, lineHeight: 20 },
  profileBlock: { gap: 10 },
  profileInput: { minHeight: 46, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, paddingHorizontal: 12, backgroundColor: '#FFFFFF', color: '#102A43', fontSize: 14 },
  profileSaveButton: { minHeight: 44, borderRadius: 11, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  profileSaveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  actionBlock: { gap: 10, borderTopWidth: 1, borderTopColor: '#E4E7EC', paddingTop: 16 },
  actionTitle: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  actionText: { color: '#667085', fontSize: 13, lineHeight: 20 },
  secondaryButton: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryButtonText: { color: '#344054', fontSize: 13, fontWeight: '800' },
  sessionBlock: { gap: 10, borderTopWidth: 1, borderTopColor: '#E4E7EC', paddingTop: 16 },
  signOutButton: { minHeight: 46, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  signOutButtonText: { color: '#344054', fontSize: 13, fontWeight: '900' },
  legalBlock: { gap: 10, borderTopWidth: 1, borderTopColor: '#E4E7EC', paddingTop: 16 },
  legalButton: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  dangerBlock: { gap: 10, borderTopWidth: 1, borderTopColor: '#E4E7EC', paddingTop: 16 },
  dangerTitle: { color: '#B42318', fontSize: 14, fontWeight: '900' },
  dangerOutlineButton: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  dangerOutlineText: { color: '#B42318', fontSize: 13, fontWeight: '900' },
  confirmation: { backgroundColor: '#FFF5F4', borderRadius: 12, padding: 12, gap: 10 },
  confirmTitle: { color: '#B42318', fontSize: 13, fontWeight: '900' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#FDA29B', borderRadius: 11, paddingHorizontal: 12, backgroundColor: '#FFFFFF', color: '#102A43' },
  buttonRow: { flexDirection: 'row', gap: 8 },
  cancelButton: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  cancelButtonText: { color: '#344054', fontSize: 12, fontWeight: '800' },
  dangerButton: { flex: 1.5, minHeight: 44, borderRadius: 11, backgroundColor: '#D92D20', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  dangerButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  error: { color: '#B42318', fontSize: 12, lineHeight: 17 },
  notice: { color: '#027A48', fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  borderTop: { borderTopColor: '#344054' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#98A2B3', color: '#102A43' },
  secondaryButton: { backgroundColor: '#162F46', borderColor: '#667085' },
  dangerCard: { backgroundColor: '#3A1717' },
  dangerTitle: { color: '#FDA29B' },
});
