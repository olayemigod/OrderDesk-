import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { SellerTrayText as Text } from '../components/SellerTrayText';
import { createSellerTrayMerchantWebHandoff } from '../data/merchantWebHandoff';
import type { SellerTrayOnboardingState } from '../data/onboardingRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  state: SellerTrayOnboardingState | null;
  loading: boolean;
  error?: string | null;
  onRefresh?: () => void | Promise<void>;
};

const STAGE_LABELS: Record<SellerTrayOnboardingState['currentStage'], string> = {
  business_setup: 'Prepare your Business',
  commercial_order: 'Choose your SellerTray plan',
  agreement: 'Review your agreement',
  settlement: 'Complete the required payment',
  setup: 'Complete Branch setup',
  activation: 'Setup complete — preparing SellerTray',
  active: 'SellerTray is activated',
};

const STAGE_ORDER: SellerTrayOnboardingState['currentStage'][] = [
  'business_setup',
  'commercial_order',
  'agreement',
  'settlement',
  'setup',
  'activation',
  'active',
];

export function OnboardingPreparationCard({ state, loading, error = null, onRefresh }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [continuing, setContinuing] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  async function continueInMerchantWeb() {
    if (!state || continuing || state.nextAction.surface !== 'merchant_web') return;
    setContinuing(true);
    setHandoffError(null);
    try {
      const handoff = await createSellerTrayMerchantWebHandoff(state.tenantId);
      await Linking.openURL(handoff.url);
    } catch {
      setHandoffError('Unable to open Merchant Web securely. Check your connection and try again.');
    } finally {
      setContinuing(false);
    }
  }

  if (loading && !state) {
    return (
      <View style={[styles.card, dark && darkStyles.card]}>
        <View style={styles.headingRow}>
          <View style={[styles.iconWrap, dark && darkStyles.iconWrap]}>
            <Ionicons name="sparkles-outline" size={20} color={dark ? theme.colors.green : theme.colors.greenDark} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SETUP & ACTIVATION</Text>
            <Text style={[styles.title, dark && darkStyles.titleText]}>Checking onboarding status</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!state && error) {
    return (
      <View style={[styles.card, styles.errorCard, dark && darkStyles.card, dark && darkStyles.errorCard]}>
        <View style={styles.headingRow}>
          <View style={[styles.iconWrap, dark && darkStyles.iconWrap]}>
            <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SETUP & ACTIVATION</Text>
            <Text style={[styles.title, dark && darkStyles.titleText]}>Setup status could not refresh</Text>
            <Text style={[styles.errorText, dark && darkStyles.bodyText]}>Your selling workspace has not been changed. Retry the onboarding status check.</Text>
          </View>
        </View>
        {onRefresh ? (
          <Pressable disabled={loading} onPress={() => void onRefresh()} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <Ionicons name="refresh-outline" size={16} color={theme.colors.white} />
            <Text style={styles.retryText}>{loading ? 'Refreshing' : 'Retry status'}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (!state || (state.currentStage === 'active' && state.activation.operationallyActive)) {
    return null;
  }

  const stageIndex = Math.max(0, STAGE_ORDER.indexOf(state.currentStage));
  const progressWidth = `${Math.round(((stageIndex + 1) / STAGE_ORDER.length) * 100)}%` as `${number}%`;
  const blocker = state.blockers[0] ?? null;
  const merchantWebNext = state.nextAction.surface === 'merchant_web';
  const adminNext = state.nextAction.surface === 'admin_web';
  const sharedNext = state.nextAction.surface === 'shared_core';

  return (
    <View style={[styles.card, dark && darkStyles.card]}>
      <View style={styles.headingRow}>
        <View style={[styles.iconWrap, dark && darkStyles.iconWrap]}>
          <Ionicons name="rocket-outline" size={20} color={dark ? theme.colors.green : theme.colors.greenDark} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SETUP & ACTIVATION</Text>
          <Text style={[styles.title, dark && darkStyles.titleText]}>{STAGE_LABELS[state.currentStage]}</Text>
        </View>
        <View style={[styles.modePill, dark && darkStyles.modePill]}>
          <Text style={[styles.modeText, dark && darkStyles.modeText]}>Preparation</Text>
        </View>
      </View>

      <View style={styles.progressRow}>
        <View style={[styles.progressTrack, dark && darkStyles.progressTrack]}>
          <View style={[styles.progressFill, { width: progressWidth }]} />
        </View>
        <Text style={[styles.progressText, dark && darkStyles.bodyText]}>{stageIndex + 1}/{STAGE_ORDER.length}</Text>
      </View>

      {blocker ? (
        <View style={[styles.blockerBox, dark && darkStyles.blockerBox]}>
          <Ionicons name="information-circle-outline" size={18} color={dark ? theme.dark.warningText : '#B54708'} />
          <Text style={[styles.blockerText, dark && darkStyles.blockerText]}>{blocker.message}</Text>
        </View>
      ) : null}

      {state.branchSetup.branches.map((branch) => <Text key={branch.branchId} style={[styles.blockerText, dark && darkStyles.bodyText]}>{branch.branchName} — {branch.setupStatus}</Text>)}
      {onRefresh ? <Pressable accessibilityRole="button" onPress={() => void onRefresh()} disabled={loading} style={styles.retryButton}><Text style={styles.retryText}>{loading ? 'Refreshing…' : 'Refresh setup status'}</Text></Pressable> : null}
      <View style={[styles.nextBox, dark && darkStyles.nextBox]}>
        <Text style={[styles.nextLabel, dark && darkStyles.bodyText]}>NEXT</Text>
        <Text style={[styles.nextTitle, dark && darkStyles.titleText]}>{state.nextAction.label}</Text>
        <Text style={[styles.nextHint, dark && darkStyles.bodyText]}>
          {merchantWebNext
            ? 'Continue this step in Merchant Web. Mobile remains in preparation mode.'
            : adminNext
              ? 'ProcessEdge Admin needs to resolve this setup exception.'
              : sharedNext
                ? 'SellerTray will check setup, agreement and payment automatically. Contact ProcessEdge if this status does not change.'
                : 'Continue preparing the Business and Branch details in SellerTray mobile.'}
        </Text>
        {merchantWebNext ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Continue to Merchant Web: ${state.nextAction.label}`}
              disabled={continuing}
              onPress={() => void continueInMerchantWeb()}
              style={({ pressed }) => [styles.continueButton, (pressed || continuing) && styles.pressed]}
            >
              <Text style={styles.continueText}>{continuing ? 'Opening Merchant Web…' : 'Continue in Merchant Web'}</Text>
              <Ionicons name="arrow-forward-outline" size={18} color={theme.colors.white} />
            </Pressable>
            {handoffError ? <Text style={[styles.handoffError, dark && darkStyles.handoffError]}>{handoffError}</Text> : null}
          </>
        ) : null}
      </View>

      {state.commercialOrder ? (
        <View style={styles.summaryRow}>
          <Summary label="Purchase" value={formatMoney(state.commercialOrder.grossAmount, state.commercialOrder.currency)} dark={dark} />
          <Summary label="Outstanding" value={formatMoney(state.settlement.outstandingAmount, state.settlement.currency)} dark={dark} />
          <Summary label="Branch setup" value={`${state.branchSetup.readyCount}/${state.branchSetup.requiredCount}`} dark={dark} />
        </View>
      ) : (
        <View style={styles.summaryRow}>
          <Summary label="Active Branches" value={String(state.branchPreparation.activeBranchCount)} dark={dark} />
          <Summary label="Purchase" value="Not created" dark={dark} />
        </View>
      )}

      {state.legacyRuntime.compatibilityAccess ? (
        <View style={[styles.compatibilityNote, dark && darkStyles.compatibilityNote]}>
          <Ionicons name="shield-checkmark-outline" size={17} color={dark ? theme.dark.accentText : theme.colors.greenDark} />
          <Text style={[styles.compatibilityText, dark && darkStyles.bodyText]}>
            Current selling access remains available while governed onboarding is completed. This preparation status does not pause operations.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Summary({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return (
    <View style={[styles.summaryItem, dark && darkStyles.summaryItem]}>
      <Text style={[styles.summaryLabel, dark && darkStyles.bodyText]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.summaryValue, dark && darkStyles.titleText]}>{value}</Text>
    </View>
  );
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en-NG')}`;
  }
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: '#ABEFC6',
    backgroundColor: '#F6FEF9',
    padding: 14,
    gap: 12,
  },
  errorCard: { borderColor: '#FDA29B', backgroundColor: '#FEF3F2' },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: theme.colors.white,
    borderWidth: 1,
    borderColor: '#ABEFC6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  eyebrow: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900', letterSpacing: 0.9 },
  title: { color: theme.colors.navy, fontSize: 17, lineHeight: 22, fontWeight: '900', marginTop: 2 },
  errorText: { color: theme.colors.slate, fontSize: 12, lineHeight: 18, marginTop: 4 },
  retryButton: { alignSelf: 'flex-start', minHeight: 40, borderRadius: 11, backgroundColor: theme.colors.green, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  retryText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  modePill: { borderRadius: theme.radius.pill, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 9, paddingVertical: 6 },
  modeText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressTrack: { flex: 1, height: 7, borderRadius: 999, backgroundColor: '#D1FADF', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: theme.colors.green },
  progressText: { color: theme.colors.muted, fontSize: 12, fontWeight: '800' },
  blockerBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderRadius: theme.radius.md, backgroundColor: '#FFFAEB', padding: 10 },
  blockerText: { flex: 1, color: '#7A2E0E', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  nextBox: { borderRadius: theme.radius.md, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, padding: 11, gap: 7 },
  nextLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  nextTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  nextHint: { color: theme.colors.slate, fontSize: 12, lineHeight: 18 },
  continueButton: { width: '100%', minHeight: 48, borderRadius: 12, backgroundColor: theme.colors.green, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  continueText: { color: theme.colors.white, fontSize: 13, fontWeight: '900', textAlign: 'center' },
  handoffError: { color: theme.colors.danger, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  summaryItem: { flexGrow: 1, flexBasis: '30%', minWidth: 96, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.72)', padding: 9, gap: 2 },
  summaryLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '800' },
  summaryValue: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  compatibilityNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, padding: 10 },
  compatibilityText: { flex: 1, color: theme.colors.slate, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.dark.surface, borderColor: theme.dark.borderStrong },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  iconWrap: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.borderStrong },
  titleText: { color: theme.dark.text },
  bodyText: { color: theme.dark.textMuted },
  modePill: { backgroundColor: theme.dark.accentSoft },
  modeText: { color: theme.dark.accentText },
  progressTrack: { backgroundColor: theme.dark.surfaceSubtle },
  blockerBox: { backgroundColor: theme.dark.warningSurface },
  blockerText: { color: theme.dark.warningText },
  nextBox: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.border },
  handoffError: { color: theme.dark.warningText },
  summaryItem: { backgroundColor: theme.dark.surfaceSubtle },
  compatibilityNote: { backgroundColor: theme.dark.accentSoft },
});
