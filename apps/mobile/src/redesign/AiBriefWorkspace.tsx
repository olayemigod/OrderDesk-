import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { generateAiBrief, type AiBriefItem, type AiBriefResult } from '../data/aiBriefRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  onClose: () => void;
};

export function AiBriefWorkspace({ tenantId, onClose }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AiBriefResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const next = await generateAiBrief({ tenantId, days, question });
      setResult(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to generate the AI Brief.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.stack}>
      <View style={styles.topRow}>
        <Pressable onPress={onClose} style={({ pressed }) => [styles.backButton, dark && darkStyles.card, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={20} color={dark ? theme.colors.cloud : theme.colors.navy} />
        </Pressable>
        <View style={styles.headingCopy}>
          <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>BUSINESS-WIDE</Text>
          <Text style={[styles.title, dark && darkStyles.titleText]}>AI Brief</Text>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
            Source-backed decision support from SellerTray reports. AI cannot create, edit or approve business records.
          </Text>
        </View>
      </View>

      <View style={[styles.card, dark && darkStyles.card]}>
        <Text style={[styles.label, dark && darkStyles.titleText]}>Report period</Text>
        <View style={styles.periodRow}>
          {([7, 30, 90] as const).map((value) => (
            <Pressable
              key={value}
              onPress={() => setDays(value)}
              style={({ pressed }) => [
                styles.periodButton,
                days === value && styles.periodButtonSelected,
                dark && darkStyles.secondary,
                days === value && dark && darkStyles.selected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.periodText, days === value && styles.periodTextSelected, dark && darkStyles.bodyText]}>{value} days</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, dark && darkStyles.titleText]}>Optional question</Text>
        <TextInput
          multiline
          maxLength={500}
          value={question}
          onChangeText={setQuestion}
          placeholder="Which part of the business needs management attention?"
          placeholderTextColor={dark ? '#98A2B3' : theme.colors.subtle}
          style={[styles.input, dark && darkStyles.input]}
        />
        <Text style={[styles.helper, dark && darkStyles.bodyText]}>
          Ask about SellerTray business metrics. Do not enter customer personal data, passwords or secret keys.
        </Text>

        <Pressable
          disabled={loading}
          onPress={() => void generate()}
          style={({ pressed }) => [styles.generateButton, loading && styles.disabled, pressed && !loading && styles.pressed]}
        >
          {loading ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="sparkles-outline" size={18} color={theme.colors.white} />}
          <Text style={styles.generateText}>{loading ? 'Generating brief' : 'Generate AI Brief'}</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
          <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{error}</Text>
        </View>
      ) : null}

      {result ? <BriefResultView result={result} dark={dark} /> : (
        <View style={[styles.card, dark && darkStyles.card]}>
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No brief generated yet</Text>
          <Text style={[styles.helper, dark && darkStyles.bodyText]}>
            SellerTray sends only bounded management metrics to the AI provider, with top-customer identities removed.
          </Text>
        </View>
      )}
    </View>
  );
}

function BriefResultView({ result, dark }: { result: AiBriefResult; dark: boolean }) {
  const sourceLabels = new Map(result.sources.map((source) => [source.key, source.label]));
  const attention = result.brief.attention.slice(0, 3);
  const opportunities = result.brief.opportunities.slice(0, 2);

  return (
    <View style={styles.stack}>
      {result.mode === 'deterministic' ? (
        <View style={[styles.fallbackCard, dark && darkStyles.fallbackCard]}>
          <Text style={styles.fallbackTitle}>Verified metrics fallback</Text>
          <Text style={[styles.helper, dark && darkStyles.bodyText]}>{result.fallbackReason || 'AI generation was unavailable, so SellerTray used verified report metrics.'}</Text>
        </View>
      ) : null}

      <View style={[styles.card, dark && darkStyles.card]}>
        <View style={styles.metaRow}>
          <View style={[styles.modePill, result.mode === 'ai' && styles.modePillAi]}>
            <Text style={[styles.modeText, result.mode === 'ai' && styles.modeTextAi]}>{result.mode === 'ai' ? 'AI generated' : 'Verified metrics'}</Text>
          </View>
          <Text style={[styles.metaText, dark && darkStyles.bodyText]}>{result.periodDays} days</Text>
        </View>
        <Text style={[styles.resultTitle, dark && darkStyles.titleText]}>{result.brief.headline}</Text>
        <Text style={[styles.resultBody, dark && darkStyles.bodyText]}>{result.brief.summary}</Text>
        {result.brief.answer ? (
          <View style={[styles.answerBox, dark && darkStyles.secondary]}>
            <Text style={[styles.label, dark && darkStyles.titleText]}>Answer</Text>
            <Text style={[styles.resultBody, dark && darkStyles.bodyText]}>{result.brief.answer}</Text>
          </View>
        ) : null}
      </View>

      <BriefItems title="Needs attention" items={attention} sourceLabels={sourceLabels} dark={dark} />
      <BriefItems title="Opportunities" items={opportunities} sourceLabels={sourceLabels} dark={dark} />

      <View style={[styles.card, dark && darkStyles.card]}>
        <Text style={[styles.label, dark && darkStyles.titleText]}>Evidence used</Text>
        <View style={styles.sourceRow}>
          {result.sources.map((source) => (
            <View key={source.key} style={[styles.sourceChip, dark && darkStyles.secondary]}>
              <Text style={[styles.sourceText, dark && darkStyles.bodyText]}>{source.label}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.helper, dark && darkStyles.bodyText]}>
          {result.budget.remainingProviderCalls} of {result.budget.dailyLimit} daily AI provider calls remain.
        </Text>
      </View>
    </View>
  );
}

function BriefItems({
  title,
  items,
  sourceLabels,
  dark,
}: {
  title: string;
  items: AiBriefItem[];
  sourceLabels: Map<string, string>;
  dark: boolean;
}) {
  if (!items.length) return null;
  return (
    <View style={[styles.card, dark && darkStyles.card]}>
      <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{title}</Text>
      {items.map((item, index) => (
        <View key={`${item.title}-${index}`} style={[styles.briefItem, index > 0 && styles.briefItemBorder]}>
          <View style={styles.itemTitleRow}>
            <View style={[styles.priorityPill, item.priority === 'high' && styles.priorityHigh, item.priority === 'medium' && styles.priorityMedium]}>
              <Text style={styles.priorityText}>{item.priority.toUpperCase()}</Text>
            </View>
            <Text style={[styles.itemTitle, dark && darkStyles.titleText]}>{item.title}</Text>
          </View>
          <Text style={[styles.resultBody, dark && darkStyles.bodyText]}>{item.detail}</Text>
          <Text style={[styles.sourceLine, dark && darkStyles.bodyText]}>
            {item.sourceKeys.map((key) => sourceLabels.get(key) ?? key).join(' · ')}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  topRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  headingCopy: { flex: 1, gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { color: theme.colors.navy, fontSize: 26, lineHeight: 31, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 12, lineHeight: 18 },
  card: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 10 },
  label: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  periodRow: { flexDirection: 'row', gap: 8 },
  periodButton: { flex: 1, borderRadius: 12, backgroundColor: theme.colors.cloud, paddingVertical: 10, alignItems: 'center' },
  periodButtonSelected: { backgroundColor: theme.colors.mintSoft, borderWidth: 1, borderColor: theme.colors.green },
  periodText: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  periodTextSelected: { color: theme.colors.greenDark },
  input: { minHeight: 86, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.cloud, color: theme.colors.navy, fontSize: 13, lineHeight: 19, padding: 11, textAlignVertical: 'top' },
  helper: { color: theme.colors.slate, fontSize: 11, lineHeight: 16 },
  generateButton: { minHeight: 46, borderRadius: 13, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  generateText: { color: theme.colors.white, fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.76 },
  errorCard: { borderRadius: 14, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: '#FEF3F2', padding: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  errorText: { flex: 1, color: '#B42318', fontSize: 12, lineHeight: 17 },
  emptyTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  fallbackCard: { borderRadius: 14, borderWidth: 1, borderColor: '#FEDF89', backgroundColor: '#FFFAEB', padding: 12, gap: 4 },
  fallbackTitle: { color: '#B54708', fontSize: 12, fontWeight: '900' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modePill: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: theme.colors.cloud },
  modePillAi: { backgroundColor: theme.colors.mintSoft },
  modeText: { color: theme.colors.slate, fontSize: 10, fontWeight: '900' },
  modeTextAi: { color: theme.colors.greenDark },
  metaText: { color: theme.colors.muted, fontSize: 10, fontWeight: '700' },
  resultTitle: { color: theme.colors.navy, fontSize: 19, lineHeight: 24, fontWeight: '900' },
  resultBody: { color: theme.colors.slate, fontSize: 12, lineHeight: 18 },
  answerBox: { borderRadius: 12, backgroundColor: theme.colors.cloud, padding: 11, gap: 4 },
  sectionTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  briefItem: { gap: 5, paddingVertical: 4 },
  briefItemBorder: { borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 10, marginTop: 4 },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  itemTitle: { flex: 1, color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  priorityPill: { borderRadius: 12, backgroundColor: theme.colors.cloud, paddingHorizontal: 6, paddingVertical: 3 },
  priorityHigh: { backgroundColor: '#FEE4E2' },
  priorityMedium: { backgroundColor: '#FEF0C7' },
  priorityText: { color: theme.colors.slate, fontSize: 8, fontWeight: '900' },
  sourceLine: { color: theme.colors.muted, fontSize: 9, lineHeight: 13 },
  sourceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sourceChip: { borderRadius: 12, backgroundColor: theme.colors.cloud, paddingHorizontal: 8, paddingVertical: 5 },
  sourceText: { color: theme.colors.slate, fontSize: 9, fontWeight: '800' },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  secondary: { backgroundColor: '#1D2939' },
  selected: { borderColor: theme.colors.green },
  input: { backgroundColor: '#1D2939', borderColor: '#475467', color: theme.colors.cloud },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
  errorCard: { backgroundColor: '#451A1A', borderColor: '#B42318' },
  fallbackCard: { backgroundColor: '#3A2A0A', borderColor: '#B54708' },
});
