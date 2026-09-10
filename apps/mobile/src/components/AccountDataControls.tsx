import { useState } from 'react';
import {
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
  deleteOrderDeskAccount,
  exportBusinessData,
} from '../data/accountLifecycleRepository';
import { supabase } from '../lib/supabase';

type Props = {
  business?: MerchantBusiness | null;
};

const DELETE_PHRASE = 'DELETE MY ORDERDESK ACCOUNT';

export function AccountDataControls({ business = null }: Props) {
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canExport = business?.role === 'owner';

  async function exportData() {
    if (!business || !canExport) return;
    setExporting(true);
    setError(null);
    setNotice(null);

    try {
      const payload = await exportBusinessData(business.id);
      const content = JSON.stringify(payload, null, 2);
      const filename = `orderdesk-${safeFilename(business.slug || business.name)}-${new Date().toISOString().slice(0, 10)}.json`;

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
      await deleteOrderDeskAccount(password);
      setPassword('');
      setPhrase('');
      await supabase.auth.signOut({ scope: 'local' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete this OrderDesk account.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>DATA & ACCOUNT</Text>
        <Text style={styles.title}>Your data and account</Text>
        <Text style={styles.description}>
          Export business records or permanently close your OrderDesk account.
        </Text>
      </View>

      {business ? (
        <View style={styles.actionBlock}>
          <Text style={styles.actionTitle}>Business data export</Text>
          <Text style={styles.actionText}>
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
              <Text style={styles.secondaryButtonText}>
                {exporting ? 'Preparing export…' : 'Export business data'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.dangerBlock}>
        <Text style={styles.dangerTitle}>Delete my account</Text>
        <Text style={styles.actionText}>
          This permanently deletes businesses you own and their OrderDesk operational data. Memberships in businesses you do not own are removed. Active paid subscriptions must be cancelled first.
        </Text>

        {!showDelete ? (
          <Pressable
            disabled={exporting}
            onPress={() => {
              setShowDelete(true);
              setError(null);
              setNotice(null);
            }}
            style={({ pressed }) => [styles.dangerOutlineButton, pressed && styles.pressed]}
          >
            <Text style={styles.dangerOutlineText}>Start account deletion</Text>
          </Pressable>
        ) : (
          <View style={styles.confirmation}>
            <Text style={styles.confirmTitle}>Permanent action</Text>
            <Text style={styles.actionText}>
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
              style={styles.input}
            />
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={DELETE_PHRASE}
              value={phrase}
              onChangeText={setPhrase}
              editable={!deleting}
              style={styles.input}
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
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
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

function safeFilename(value: string): string {
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'business';
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 18, padding: 16, gap: 16 },
  heading: { gap: 4 },
  eyebrow: { color: '#98A2B3', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#101828', fontSize: 18, fontWeight: '900' },
  description: { color: '#667085', fontSize: 12, lineHeight: 18 },
  actionBlock: { gap: 10 },
  actionTitle: { color: '#101828', fontSize: 14, fontWeight: '900' },
  actionText: { color: '#667085', fontSize: 12, lineHeight: 18 },
  secondaryButton: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryButtonText: { color: '#344054', fontSize: 13, fontWeight: '800' },
  dangerBlock: { gap: 10, borderTopWidth: 1, borderTopColor: '#EAECF0', paddingTop: 16 },
  dangerTitle: { color: '#B42318', fontSize: 14, fontWeight: '900' },
  dangerOutlineButton: { minHeight: 44, borderWidth: 1, borderColor: '#FDA29B', borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  dangerOutlineText: { color: '#B42318', fontSize: 13, fontWeight: '900' },
  confirmation: { backgroundColor: '#FFF5F4', borderRadius: 12, padding: 12, gap: 10 },
  confirmTitle: { color: '#B42318', fontSize: 13, fontWeight: '900' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#FDA29B', borderRadius: 11, paddingHorizontal: 12, backgroundColor: '#FFFFFF', color: '#101828' },
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
