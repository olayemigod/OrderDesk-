import type { ReactNode } from 'react';
import { Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { MerchantBusiness } from '../data/businessRepository';
import type { SellerTrayOnboardingStage } from '../data/onboardingActivationRepository';
import { useOnboardingActivation } from '../hooks/useOnboardingActivation';
import { supabase } from '../lib/supabase';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { SellerTrayBrand } from './SellerTrayBrand';
import { SellerTrayLoadingScreen } from './SellerTrayLoadingScreen';

const MERCHANT_WEB_URL = process.env.EXPO_PUBLIC_MERCHANT_WEB_URL?.trim() ?? '';
const STAGES: Array<{ key: SellerTrayOnboardingStage; label: string }> = [
  { key: 'business_setup', label: 'Business & Branches' },
  { key: 'commercial_order', label: 'Plan & purchase' },
  { key: 'agreement', label: 'Agreement' },
  { key: 'payment', label: 'Payment' },
  { key: 'setup', label: 'SellerTray setup' },
  { key: 'activation', label: 'Activation' },
];
const STAGE_INDEX: Record<SellerTrayOnboardingStage, number> = {
  business_setup: 0, commercial_order: 1, agreement: 2, payment: 3, setup: 4, activation: 5, active: 6,
};

export function OnboardingActivationGate({ business, children }: { business: MerchantBusiness; children: ReactNode }) {
  const appearance = useSellerTrayAppearance();
  const onboarding = useOnboardingActivation(business.id);

  if (onboarding.loading && !onboarding.state) return <SellerTrayLoadingScreen message="Checking your SellerTray setup…" />;
  if (onboarding.state?.operationalAccess) return <>{children}</>;

  const state = onboarding.state;
  const dark = appearance.dark;
  const ownerOrManager = business.role === 'owner' || business.role === 'manager';
  const currentIndex = STAGE_INDEX[state?.stage ?? 'commercial_order'];

  async function openMerchantWeb() {
    if (!MERCHANT_WEB_URL) return;
    await Linking.openURL(MERCHANT_WEB_URL);
  }

  return <SafeAreaView style={[styles.screen, dark && darkStyles.screen]}>
    <ScrollView contentContainerStyle={styles.page}>
      <SellerTrayBrand size={42} showTagline />
      <View style={[styles.card, dark && darkStyles.card]}>
        <Text style={[styles.eyebrow, dark && darkStyles.accent]}>SELLERTRAY SETUP</Text>
        <Text style={[styles.title, dark && darkStyles.title]}>Finish activating {business.name}</Text>
        <Text style={[styles.body, dark && darkStyles.body]}>Your Business is created. Operational selling unlocks automatically only after the governed purchase, payment, Branch setup and activation checks are complete.</Text>
      </View>

      {onboarding.error ? <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
        <Text style={[styles.sectionTitle, dark && darkStyles.errorText]}>Setup status unavailable</Text>
        <Text style={[styles.body, dark && darkStyles.body]}>{onboarding.error}</Text>
        <Pressable onPress={() => void onboarding.refresh()}><Text style={styles.retry}>Retry status check</Text></Pressable>
      </View> : null}

      {state ? <>
        <View style={[styles.card, dark && darkStyles.card]}>
          <Text style={[styles.sectionTitle, dark && darkStyles.title]}>What happens next</Text>
          <Text style={[styles.nextAction, dark && darkStyles.title]}>{state.nextAction.label}</Text>
          <Text style={[styles.body, dark && darkStyles.body]}>{stageExplanation(state.stage, ownerOrManager)}</Text>
          <View style={styles.factGrid}>
            <Fact label="Active Branches" value={String(state.activeBranchCount)} dark={dark} />
            {state.commercialOrderReference ? <Fact label="Purchase" value={state.commercialOrderReference} dark={dark} /> : null}
            {state.installmentCount > 0 ? <Fact label="Payments" value={`${state.paidInstallmentCount} of ${state.installmentCount} confirmed`} dark={dark} /> : null}
            {state.setupRequiredCount > 0 ? <Fact label="Branch setup" value={`${state.setupReadyCount} of ${state.setupRequiredCount} ready`} dark={dark} /> : null}
          </View>
          {ownerOrManager && state.nextAction.surface === 'merchant_web' && MERCHANT_WEB_URL ? <Pressable style={styles.primaryButton} onPress={() => void openMerchantWeb()}>
            <Text style={styles.primaryButtonText}>Continue on Merchant Web</Text><Ionicons name="open-outline" size={18} color="#fff" />
          </Pressable> : null}
          {ownerOrManager && state.nextAction.surface === 'merchant_web' && !MERCHANT_WEB_URL ? <View style={[styles.notice, dark && darkStyles.notice]}><Text style={[styles.body, dark && darkStyles.body]}>Open SellerTray Merchant Web in your browser with the same SellerTray account. This build does not yet have its Merchant Web URL configured.</Text></View> : null}
          {!ownerOrManager ? <View style={[styles.notice, dark && darkStyles.notice]}><Text style={[styles.body, dark && darkStyles.body]}>Your Business Owner or Manager is completing SellerTray setup. Refresh after they finish the required step.</Text></View> : null}
          <Pressable style={[styles.secondaryButton, dark && darkStyles.secondaryButton]} onPress={() => void onboarding.refresh()}>
            <Ionicons name="refresh-outline" size={18} color={dark ? theme.dark.text : theme.colors.navy} /><Text style={[styles.secondaryButtonText, dark && darkStyles.title]}>{onboarding.loading ? 'Refreshing…' : 'Refresh status'}</Text>
          </Pressable>
        </View>

        <View style={[styles.card, dark && darkStyles.card]}>
          <Text style={[styles.sectionTitle, dark && darkStyles.title]}>Activation progress</Text>
          {STAGES.map((step,index) => {
            const done = currentIndex > index;
            const current = currentIndex === index;
            return <View key={step.key} style={styles.stepRow}>
              <Ionicons name={done ? 'checkmark-circle' : current ? 'radio-button-on' : 'ellipse-outline'} size={22} color={done || current ? theme.colors.greenDark : theme.colors.subtle} />
              <Text style={[styles.stepLabel, dark && darkStyles.body, (done || current) && styles.stepStrong, dark && (done || current) && darkStyles.title]}>{step.label}</Text>
            </View>;
          })}
        </View>
      </> : null}

      <Pressable style={styles.signOut} onPress={() => void supabase.auth.signOut({ scope: 'local' })}><Text style={[styles.signOutText, dark && darkStyles.body]}>Sign out</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}

function Fact({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return <View style={styles.fact}><Text style={[styles.factLabel, dark && darkStyles.body]}>{label}</Text><Text style={[styles.factValue, dark && darkStyles.title]}>{value}</Text></View>;
}

function stageExplanation(stage: SellerTrayOnboardingStage, ownerOrManager: boolean): string {
  if (!ownerOrManager && stage !== 'activation') return 'SellerTray keeps operational selling locked until the Business setup is complete.';
  if (stage === 'business_setup') return 'Add the Branch or Branches that will use SellerTray.';
  if (stage === 'commercial_order') return 'Choose the governed SellerTray purchase for this Business on Merchant Web.';
  if (stage === 'agreement') return 'Review and accept the current SellerTray commercial agreement.';
  if (stage === 'payment') return 'Complete the required payment on Merchant Web. Only confirmed payment facts count.';
  if (stage === 'setup') return 'Complete the required SellerTray Branch setup before activation.';
  if (stage === 'activation') return 'Setup facts are complete. SellerTray is waiting for automatic activation reconciliation.';
  return 'SellerTray is ready for operational use.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.cloud }, page: { padding: 20, paddingBottom: 40, gap: 16 },
  card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 16, gap: 12 },
  eyebrow: { color: theme.colors.greenDark, fontSize: 14, fontWeight: '900', letterSpacing: 1 }, title: { color: theme.colors.navy, fontSize: 22, lineHeight: 29, fontWeight: '900' },
  body: { color: theme.colors.muted, fontSize: 14, lineHeight: 21 }, sectionTitle: { color: theme.colors.navy, fontSize: 16, fontWeight: '900' },
  nextAction: { color: theme.colors.navy, fontSize: 18, lineHeight: 25, fontWeight: '900' }, factGrid: { gap: 8 }, fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  factLabel: { color: theme.colors.muted, fontSize: 14, flex: 1 }, factValue: { color: theme.colors.navy, fontSize: 14, fontWeight: '800', flex: 1, textAlign: 'right' },
  primaryButton: { minHeight: 50, borderRadius: 14, backgroundColor: theme.colors.greenDark, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '900' }, secondaryButton: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryButtonText: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' }, notice: { backgroundColor: theme.colors.infoSoft, borderRadius: 12, padding: 12 },
  errorCard: { backgroundColor: theme.colors.dangerSoft, borderRadius: 14, padding: 14, gap: 8 }, retry: { color: theme.colors.danger, fontSize: 14, fontWeight: '900' },
  stepRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10 }, stepLabel: { color: theme.colors.muted, fontSize: 14 }, stepStrong: { color: theme.colors.navy, fontWeight: '800' },
  signOut: { alignSelf: 'center', padding: 10 }, signOutText: { color: theme.colors.muted, fontSize: 14, fontWeight: '800' },
});
const darkStyles = StyleSheet.create({
  screen: { backgroundColor: theme.dark.canvas }, card: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border }, title: { color: theme.dark.text }, body: { color: theme.dark.textMuted }, accent: { color: theme.dark.accentText },
  notice: { backgroundColor: theme.dark.surfaceSubtle }, errorCard: { backgroundColor: theme.dark.dangerSurface }, errorText: { color: theme.dark.dangerText }, secondaryButton: { borderColor: theme.dark.borderStrong },
});
