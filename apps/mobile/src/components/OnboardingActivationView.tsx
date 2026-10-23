import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import {
  createSellerTrayOnboardingHandoff,
  type OnboardingStage,
  type SellerTrayOnboardingState,
} from '../data/onboardingRepository';
import { supabase } from '../lib/supabase';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { SellerTrayBrand } from './SellerTrayBrand';

const STEPS: Array<{ key: OnboardingStage | 'branch'; label: string }> = [
  { key: 'branch', label: 'Business' },
  { key: 'commercial_purchase', label: 'Purchase' },
  { key: 'agreement', label: 'Agreement' },
  { key: 'payment', label: 'Payment' },
  { key: 'setup', label: 'Setup' },
  { key: 'active', label: 'Active' },
];

export function OnboardingActivationView({
  business,
  state,
  error,
  refreshing,
  onRefresh,
}: {
  business: MerchantBusiness;
  state: SellerTrayOnboardingState | null;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  const appearance = useSellerTrayAppearance();
  const [openingWeb, setOpeningWeb] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const dark = appearance.dark;

  async function continueOnWeb() {
    if (!state?.canManageCommercial || openingWeb) return;
    setOpeningWeb(true);
    setHandoffError(null);
    try {
      const url = await createSellerTrayOnboardingHandoff(business.id);
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('No browser is available to open SellerTray Merchant Web.');
      await Linking.openURL(url);
    } catch (cause) {
      setHandoffError(cause instanceof Error && cause.message
        ? cause.message
        : 'Unable to open SellerTray Merchant Web.');
    } finally {
      setOpeningWeb(false);
    }
  }

  const stage = state?.stage ?? 'commercial_purchase';
  const currentIndex = stageIndex(stage);
  const primaryNeedsWeb = state?.nextAction.surface === 'merchant_web';
  const canOpenWeb = Boolean(primaryNeedsWeb && state?.canManageCommercial);

  return (
    <SafeAreaView style={[styles.safeArea, dark && styles.safeAreaDark]}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.brandRow}>
          <SellerTrayBrand size={44} inverted={dark} />
          <Pressable
            style={styles.signOutButton}
            onPress={() => void supabase.auth.signOut({ scope: 'local' })}
          >
            <Text style={[styles.signOutText, dark && styles.mutedDark]}>Sign out</Text>
          </Pressable>
        </View>

        <View style={[styles.hero, dark && styles.cardDark]}>
          <Text style={styles.eyebrow}>SETUP & ACTIVATION</Text>
          <Text style={[styles.title, dark && styles.textDark]}>{business.name}</Text>
          <Text style={[styles.subtitle, dark && styles.mutedDark]}>
            {state ? stageHeadline(state) : 'Checking your SellerTray setup status.'}
          </Text>
          {state ? (
            <View style={styles.progressRow}>
              <Text style={[styles.progressText, dark && styles.textDark]}>
                Step {state.progress.current} of {state.progress.total}
              </Text>
              <Text style={styles.progressPercent}>
                {Math.round((state.progress.current / Math.max(1, state.progress.total)) * 100)}%
              </Text>
            </View>
          ) : null}
          <View style={[styles.progressTrack, dark && styles.progressTrackDark]}>
            <View
              style={[
                styles.progressFill,
                { width: `${state ? Math.round((state.progress.current / Math.max(1, state.progress.total)) * 100) : 8}%` },
              ]}
            />
          </View>
        </View>

        <View style={[styles.card, dark && styles.cardDark]}>
          <Text style={[styles.sectionTitle, dark && styles.textDark]}>Your activation journey</Text>
          <View style={styles.steps}>
            {STEPS.map((item, index) => {
              const done = index < currentIndex || stage === 'active';
              const active = index === currentIndex && stage !== 'active';
              return (
                <View key={item.key} style={styles.stepRow}>
                  <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>
                    {done ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : <Text style={styles.stepNumber}>{index + 1}</Text>}
                  </View>
                  <View style={styles.stepCopy}>
                    <Text style={[styles.stepLabel, dark && styles.textDark, active && styles.stepLabelActive]}>{item.label}</Text>
                    {active ? <Text style={[styles.stepHint, dark && styles.mutedDark]}>Current step</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {error ? (
          <View style={[styles.alert, styles.alertError, dark && styles.alertErrorDark]}>
            <Ionicons name="alert-circle-outline" size={20} color={dark ? '#FDA29B' : theme.colors.danger} />
            <View style={styles.alertCopy}>
              <Text style={[styles.alertTitle, dark && styles.textDark]}>Setup status unavailable</Text>
              <Text style={[styles.alertText, dark && styles.mutedDark]}>{error}</Text>
              <Text style={[styles.alertText, dark && styles.mutedDark]}>Live operations stay locked until SellerTray can verify activation.</Text>
            </View>
          </View>
        ) : null}

        {state?.blockers.map((blocker) => (
          <View key={blocker.code} style={[styles.alert, dark && styles.alertDark]}>
            <Ionicons name="information-circle-outline" size={20} color={theme.colors.greenDark} />
            <View style={styles.alertCopy}>
              <Text style={[styles.alertTitle, dark && styles.textDark]}>{blockerTitle(blocker.code)}</Text>
              <Text style={[styles.alertText, dark && styles.mutedDark]}>{blocker.message}</Text>
              {blocker.requiredCount !== null && blocker.readyCount !== null ? (
                <Text style={[styles.alertMeta, dark && styles.mutedDark]}>{blocker.readyCount} of {blocker.requiredCount} Branch setups complete</Text>
              ) : null}
            </View>
          </View>
        ))}

        <View style={[styles.card, dark && styles.cardDark]}>
          <Text style={styles.eyebrow}>NEXT ACTION</Text>
          <Text style={[styles.actionTitle, dark && styles.textDark]}>{state?.nextAction.label ?? 'Check setup status'}</Text>
          <Text style={[styles.actionText, dark && styles.mutedDark]}>{nextActionHelp(state)}</Text>

          {canOpenWeb ? (
            <Pressable
              disabled={openingWeb}
              onPress={() => void continueOnWeb()}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, openingWeb && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>{openingWeb ? 'Opening Merchant Web…' : 'Continue setup securely'}</Text>
              <Ionicons name="open-outline" size={18} color="#FFFFFF" />
            </Pressable>
          ) : null}

          {primaryNeedsWeb && state && !state.canManageCommercial ? (
            <View style={[styles.roleNotice, dark && styles.roleNoticeDark]}>
              <Text style={[styles.roleNoticeText, dark && styles.mutedDark]}>
                The Business Owner or authorised Manager must continue the commercial setup in SellerTray Merchant Web.
              </Text>
            </View>
          ) : null}

          {handoffError ? <Text style={styles.inlineError}>{handoffError}</Text> : null}

          <Pressable
            disabled={refreshing}
            onPress={() => void onRefresh()}
            style={({ pressed }) => [styles.secondaryButton, dark && styles.secondaryButtonDark, pressed && styles.pressed]}
          >
            <Ionicons name="refresh" size={17} color={dark ? '#D0D5DD' : theme.colors.slate} />
            <Text style={[styles.secondaryButtonText, dark && styles.textDark]}>{refreshing ? 'Checking…' : 'Refresh status'}</Text>
          </Pressable>
        </View>

        <View style={[styles.preparationCard, dark && styles.preparationCardDark]}>
          <Ionicons name="construct-outline" size={20} color={theme.colors.greenDark} />
          <View style={styles.alertCopy}>
            <Text style={[styles.alertTitle, dark && styles.textDark]}>Preparation mode</Text>
            <Text style={[styles.alertText, dark && styles.mutedDark]}>
              Your Business is created, but live POS sales, purchasing, stock movements, cashier shifts, operational payment collection and live money movement remain locked until authoritative activation.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function stageIndex(stage: OnboardingStage): number {
  if (stage === 'business_setup') return 0;
  if (stage === 'commercial_purchase') return 1;
  if (stage === 'agreement') return 2;
  if (stage === 'payment') return 3;
  if (stage === 'setup' || stage === 'activating') return 4;
  return 5;
}

function stageHeadline(state: SellerTrayOnboardingState): string {
  if (state.stage === 'business_setup') return 'Finish preparing your Business for activation.';
  if (state.stage === 'commercial_purchase') return 'Choose your SellerTray plan and complete the first purchase.';
  if (state.stage === 'agreement') return 'Review the current SellerTray agreement.';
  if (state.stage === 'payment') return 'Complete the required payment for this purchase.';
  if (state.stage === 'setup') return 'Your commercial setup is ready for Branch setup.';
  if (state.stage === 'activating') return 'Setup is complete. SellerTray is confirming activation.';
  return 'SellerTray is ready for live operations.';
}

function nextActionHelp(state: SellerTrayOnboardingState | null): string {
  if (!state) return 'Refresh to read the current governed onboarding state.';
  if (state.nextAction.surface === 'merchant_web') {
    return 'SellerTray will open Merchant Web using your existing account and Business context. You do not need to register again.';
  }
  if (state.stage === 'activating') return 'Refresh after the activation checks complete.';
  return 'SellerTray will unlock live operations only from authoritative entitlement.';
}

function blockerTitle(code: string): string {
  if (code === 'branch_required') return 'Branch required';
  if (code === 'commercial_order_required') return 'Purchase required';
  if (code === 'agreement_required') return 'Agreement required';
  if (code === 'payment_required') return 'Payment required';
  if (code === 'setup_required') return 'Branch setup required';
  if (code === 'activation_reconciliation') return 'Activation in progress';
  return 'Setup action required';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.cloud },
  safeAreaDark: { backgroundColor: theme.dark.canvas },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 18, paddingBottom: 36, gap: 14 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  signOutButton: { paddingHorizontal: 8, paddingVertical: 8 },
  signOutText: { color: theme.colors.muted, fontSize: 14, fontWeight: '800' },
  hero: { backgroundColor: theme.colors.navy, borderRadius: 22, padding: 20, gap: 8 },
  card: { backgroundColor: theme.colors.white, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: theme.colors.border, gap: 12 },
  cardDark: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  eyebrow: { color: theme.colors.green, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  title: { color: '#FFFFFF', fontSize: 24, lineHeight: 30, fontWeight: '900' },
  subtitle: { color: '#D0D5DD', fontSize: 15, lineHeight: 22 },
  textDark: { color: theme.dark.text },
  mutedDark: { color: theme.dark.textMuted },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  progressText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  progressPercent: { color: theme.colors.mint, fontSize: 14, fontWeight: '900' },
  progressTrack: { height: 8, backgroundColor: 'rgba(255,255,255,.18)', borderRadius: 999, overflow: 'hidden' },
  progressTrackDark: { backgroundColor: '#344054' },
  progressFill: { height: '100%', backgroundColor: theme.colors.green, borderRadius: 999 },
  sectionTitle: { color: theme.colors.navy, fontSize: 18, fontWeight: '900' },
  steps: { gap: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 38 },
  stepDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.cloud },
  stepDotDone: { backgroundColor: theme.colors.greenDark, borderColor: theme.colors.greenDark },
  stepDotActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  stepNumber: { color: theme.colors.slate, fontSize: 14, fontWeight: '900' },
  stepCopy: { flex: 1 },
  stepLabel: { color: theme.colors.slate, fontSize: 15, fontWeight: '800' },
  stepLabelActive: { color: theme.colors.greenDark },
  stepHint: { color: theme.colors.muted, fontSize: 14, marginTop: 1 },
  alert: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: theme.colors.infoSoft, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#B2DDFF' },
  alertDark: { backgroundColor: '#122B43', borderColor: '#175CD3' },
  alertError: { backgroundColor: theme.colors.dangerSoft, borderColor: '#FECDCA' },
  alertErrorDark: { backgroundColor: theme.dark.dangerSurface, borderColor: theme.dark.dangerBorder },
  alertCopy: { flex: 1, gap: 3 },
  alertTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  alertText: { color: theme.colors.slate, fontSize: 14, lineHeight: 21 },
  alertMeta: { color: theme.colors.muted, fontSize: 14, fontWeight: '800', marginTop: 3 },
  actionTitle: { color: theme.colors.navy, fontSize: 20, fontWeight: '900' },
  actionText: { color: theme.colors.slate, fontSize: 14, lineHeight: 21 },
  primaryButton: { minHeight: 50, borderRadius: 14, backgroundColor: theme.colors.greenDark, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  secondaryButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.colors.white },
  secondaryButtonDark: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.border },
  secondaryButtonText: { color: theme.colors.slate, fontSize: 14, fontWeight: '900' },
  roleNotice: { backgroundColor: theme.colors.warningSoft, borderRadius: 12, padding: 12 },
  roleNoticeDark: { backgroundColor: theme.dark.warningSurface },
  roleNoticeText: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
  inlineError: { color: theme.colors.danger, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  preparationCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 16, backgroundColor: theme.colors.mintSoft, borderWidth: 1, borderColor: '#ABEFC6' },
  preparationCardDark: { backgroundColor: theme.dark.accentSoft, borderColor: '#1C6B4A' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.58 },
});
