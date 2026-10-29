import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SellerTrayText as Text } from '../components/SellerTrayText';
import {
  loadSellerTrayFeedbackState,
  submitSellerTrayFeedback,
  type SellerTrayFeedbackState,
  type SellerTrayFeedbackType,
} from '../data/feedbackRepository';
import type { CommerceBranch } from '../data/commerceRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  onClose: () => void;
  onStateChanged?: (state: SellerTrayFeedbackState) => void;
};

const TYPES: Array<{ value: SellerTrayFeedbackType; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { value: 'experience', label: 'Experience', icon: 'sparkles-outline' },
  { value: 'feature_request', label: 'Suggestion', icon: 'bulb-outline' },
  { value: 'problem', label: 'Problem', icon: 'alert-circle-outline' },
  { value: 'general', label: 'Other', icon: 'chatbox-ellipses-outline' },
];

export function FeedbackWorkspace({ tenantId, branch, onClose, onStateChanged }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [state, setState] = useState<SellerTrayFeedbackState | null>(null);
  const [feedbackType, setFeedbackType] = useState<SellerTrayFeedbackType>('experience');
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadSellerTrayFeedbackState(tenantId)
      .then((next) => {
        if (!active) return;
        setState(next);
        onStateChanged?.(next);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load your feedback status.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [tenantId]);

  async function submit() {
    if (saving) return;
    if (!message.trim()) {
      setError('Tell us what is working, what is difficult, or what SellerTray should improve.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await submitSellerTrayFeedback({
        tenantId,
        branchId: branch.id,
        feedbackType,
        rating,
        message,
        appVersion: '1.0.0',
        platform: Platform.OS,
        context: { surface: 'mobile_more', branchCode: branch.code },
      });
      const next = await loadSellerTrayFeedbackState(tenantId);
      setState(next);
      onStateChanged?.(next);
      setMessage('');
      setRating(null);
      setNotice('Feedback sent. Thank you for helping improve SellerTray.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send feedback.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.stack}>
      <Pressable onPress={onClose} style={styles.backButton}>
        <Ionicons name="chevron-back" size={19} color={dark ? theme.colors.white : theme.colors.navy} />
        <Text style={[styles.backText, dark && darkStyles.titleText]}>More</Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>FEEDBACK</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>Help improve SellerTray</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>Share what is working, what is difficult, or what would make daily selling easier.</Text>
      </View>

      <View style={[styles.statusCard, dark && darkStyles.card]}>
        {loading ? <ActivityIndicator /> : <Ionicons name={state?.hasSubmitted ? 'checkmark-circle' : 'chatbubble-ellipses-outline'} size={25} color={state?.hasSubmitted ? theme.colors.green : theme.colors.greenDark} />}
        <View style={styles.flexOne}>
          <Text style={[styles.statusTitle, dark && darkStyles.titleText]}>{state?.hasSubmitted ? 'Feedback shared' : 'No feedback shared yet'}</Text>
          <Text style={[styles.statusText, dark && darkStyles.bodyText]}>
            {state?.hasSubmitted
              ? `${state.submissionCount} submission${state.submissionCount === 1 ? '' : 's'}${state.latestSubmittedAt ? ` · Last sent ${formatDate(state.latestSubmittedAt)}` : ''}. You can send another update at any time.`
              : 'Your feedback status is tied to your signed-in SellerTray account.'}
          </Text>
        </View>
      </View>

      {error ? <Message text={error} error dark={dark} /> : null}
      {notice ? <Message text={notice} dark={dark} /> : null}

      <View style={[styles.card, dark && darkStyles.card]}>
        <Text style={[styles.label, dark && darkStyles.bodyText]}>What is this about?</Text>
        <View style={styles.choiceWrap}>
          {TYPES.map((option) => {
            const active = option.value === feedbackType;
            return <Pressable key={option.value} onPress={() => setFeedbackType(option.value)} style={[styles.choice, dark && darkStyles.choice, active && styles.choiceActive]}>
              <Ionicons name={option.icon} size={16} color={active ? theme.colors.greenDark : theme.colors.muted} />
              <Text style={[styles.choiceText, dark && darkStyles.bodyText, active && styles.choiceTextActive]}>{option.label}</Text>
            </Pressable>;
          })}
        </View>

        <Text style={[styles.label, dark && darkStyles.bodyText]}>How would you rate your experience?</Text>
        <View style={styles.ratingRow}>
          {[1, 2, 3, 4, 5].map((value) => <Pressable key={value} accessibilityLabel={`Rate SellerTray ${value} out of 5`} onPress={() => setRating(value)} style={[styles.ratingButton, dark && darkStyles.choice, rating === value && styles.ratingActive]}>
            <Ionicons name={rating !== null && value <= rating ? 'star' : 'star-outline'} size={22} color={rating !== null && value <= rating ? theme.colors.green : theme.colors.muted} />
            <Text style={[styles.ratingText, dark && darkStyles.bodyText]}>{value}</Text>
          </Pressable>)}
        </View>

        <Text style={[styles.label, dark && darkStyles.bodyText]}>Your feedback</Text>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="What should we keep, change or improve?"
          placeholderTextColor={theme.colors.subtle}
          multiline
          maxLength={4000}
          style={[styles.input, dark && darkStyles.input]}
        />
        <Text style={[styles.counter, dark && darkStyles.bodyText]}>{message.length}/4000</Text>

        <Pressable disabled={saving || !message.trim()} onPress={() => void submit()} style={[styles.primaryButton, (saving || !message.trim()) && styles.disabled]}>
          {saving ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="send-outline" size={18} color={theme.colors.white} />}
          <Text style={styles.primaryText}>{saving ? 'Sending…' : 'Send feedback'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Message({ text, error = false, dark }: { text: string; error?: boolean; dark: boolean }) {
  return <View style={[styles.message, error ? styles.errorMessage : styles.noticeMessage, dark && darkStyles.card]}><Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={18} color={error ? theme.colors.danger : theme.colors.greenDark} /><Text style={[styles.messageText, dark && darkStyles.bodyText]}>{text}</Text></View>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-NG', { dateStyle: 'medium' });
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  backButton: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 4, paddingVertical: 4 },
  backText: { color: theme.colors.navy, fontSize: 13, fontWeight: '800' },
  heading: { gap: 4 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  title: { color: theme.colors.navy, fontSize: 26, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 13, lineHeight: 19 },
  statusCard: { alignItems: 'flex-start', backgroundColor: theme.colors.mintSoft, borderColor: theme.colors.border, borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 13 },
  statusTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  statusText: { color: theme.colors.slate, fontSize: 12, lineHeight: 18, marginTop: 2 },
  flexOne: { flex: 1 },
  card: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 18, borderWidth: 1, gap: 10, padding: 14 },
  label: { color: theme.colors.slate, fontSize: 12, fontWeight: '900', marginTop: 2 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingVertical: 9 },
  choiceActive: { backgroundColor: theme.colors.mintSoft, borderColor: theme.colors.green },
  choiceText: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  choiceTextActive: { color: theme.colors.greenDark },
  ratingRow: { flexDirection: 'row', gap: 7 },
  ratingButton: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, flex: 1, gap: 2, paddingVertical: 8 },
  ratingActive: { backgroundColor: theme.colors.mintSoft, borderColor: theme.colors.green },
  ratingText: { color: theme.colors.slate, fontSize: 10, fontWeight: '800' },
  input: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, color: theme.colors.navy, fontSize: 14, minHeight: 130, padding: 11, textAlignVertical: 'top' },
  counter: { color: theme.colors.muted, fontSize: 10, textAlign: 'right' },
  primaryButton: { alignItems: 'center', backgroundColor: theme.colors.green, borderRadius: 12, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46, paddingHorizontal: 14 },
  primaryText: { color: theme.colors.white, fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  message: { alignItems: 'flex-start', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 11 },
  errorMessage: { backgroundColor: theme.colors.dangerSoft },
  noticeMessage: { backgroundColor: theme.colors.mintSoft },
  messageText: { color: theme.colors.slate, flex: 1, fontSize: 12, lineHeight: 17 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  choice: { borderColor: '#344054' },
  input: { backgroundColor: '#162F46', borderColor: '#344054', color: theme.colors.white },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});
