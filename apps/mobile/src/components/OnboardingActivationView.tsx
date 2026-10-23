import { Ionicons } from '@expo/vector-icons';
import {
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import type { SellerTrayOnboardingState } from '../data/onboardingRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { SellerTrayBrand } from './SellerTrayBrand';

const MERCHANT_WEB_URL = process.env.EXPO_PUBLIC_MERCHANT_WEB_URL?.trim()
  || 'https://sellertray-merchant.vercel.app';

type Props = {
  business: MerchantBusiness;
  state: SellerTrayOnboardingState | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
};

export function OnboardingActivationView({
  business,
  state,
  loading,
  error,
  onRefresh,
  onSignOut,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const canManageCommercial = business.role === 'owner' || business.role === 'manager';
  const dark = appearance.dark;
  const steps = state ? onboardingSteps(state) : [];
  const completed = steps.filter((step) => step.done).length;

  async function openMerchantWeb() {
    if (!canManageCommercial) return;
    await Linking.openURL(MERCHANT_WEB_URL);
  }

  return (
    <SafeAreaView style={[styles.safeArea, dark && darkStyles.safeArea]}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.brandRow}>
          <SellerTrayBrand size={40} inverted={dark} />
          <Pressable onPress={() => void onSignOut()} style={styles.signOutButton}>
            <Text style={[styles.signOutText, dark && darkStyles.mutedText]}>Sign out</Text>
          </Pressable>
        </View>

        <View style={[styles.hero, dark && darkStyles.hero]}>
          <Text style={styles.eyebrow}>SELLERTRAY SETUP & ACTIVATION</Text>
          <Text style={[styles.title, dark && darkStyles.title]}>{stageTitle(state?.stage)}</Text>
          <Text style={[styles.businessName, dark && darkStyles.mutedText]}>{business.name}</Text>
          <Text style={[styles.message, dark && darkStyles.body]}>
            {error
              ? 'SellerTray could not confirm your activation status. Operational selling stays protected until the governed status can be verified.'
              : state?.merchantMessage ?? 'Checking what your business needs next.'}
          </Text>
          {state ? (
            <View style={styles.progressRow}>
              <View style={[styles.progressTrack, dark && darkStyles.progressTrack]}>
                <View style={[styles.progressFill, { width: `${Math.round((completed / Math.max(steps.length, 1)) * 100)}%` }]} />
              </View>
              <Text style={[styles.progressText, dark && darkStyles.mutedText]}>{completed}/{steps.length}</Text>
            </View>
          ) : null}
        </View>

        {error ? (
          <View style={[styles.alert, styles.errorAlert, dark && darkStyles.errorAlert]}>
            <Ionicons name="alert-circle-outline" size={22} color={dark ? '#FDA29B' : theme.colors.danger} />
            <View style={styles.alertCopy}>
              <Text style={[styles.alertTitle, dark && darkStyles.title]}>Activation status unavailable</Text>
              <Text style={[styles.alertText, dark && darkStyles.body]}>{error}</Text>
            </View>
          </View>
        ) : null}

        {state ? (
          <View style={[styles.card, dark && darkStyles.card]}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardEyebrow}>YOUR PROGRESS</Text>
                <Text style={[styles.cardTitle, dark && darkStyles.title]}>One clear path to activation</Text>
              </View>
              {loading ? <Text style={[styles.refreshing, dark && darkStyles.mutedText]}>Refreshing…</Text> : null}
            </View>
            <View style={styles.steps}>
              {steps.map((step) => (
                <View key={step.key} style={[styles.step, dark && darkStyles.step]}>
                  <View style={[styles.stepIcon, step.done && styles.stepIconDone, dark && darkStyles.stepIcon]}>
                    <Ionicons
                      name={step.done ? 'checkmark' : step.current ? 'ellipse' : 'ellipse-outline'}
                      size={18}
                      color={step.done ? theme.colors.greenDark : step.current ? theme.colors.green : theme.colors.subtle}
                    />
                  </View>
                  <View style={styles.stepCopy}>
                    <Text style={[styles.stepTitle, dark && darkStyles.title]}>{step.title}</Text>
                    <Text style={[styles.stepText, dark && darkStyles.body]}>{step.text}</Text>
                  </View>
                  <Text style={[styles.stepStatus, step.done && styles.stepStatusDone]}>
                    {step.done ? 'Done' : step.current ? 'Now' : 'Next'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={[styles.actionCard, dark && darkStyles.card]}>
          <Text style={[styles.actionTitle, dark && darkStyles.title]}>What happens next</Text>
          <Text style={[styles.actionText, dark && darkStyles.body]}>
            {canManageCommercial
              ? actionHelp(state?.stage)
              : 'Your Business Owner or Manager completes commercial setup and activation. You can return here to see the current status.'}
          </Text>

          {canManageCommercial && state && merchantWebAction(state.stage) ? (
            <Pressable
              disabled={loading}
              onPress={() => void openMerchantWeb()}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, loading && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>{state.nextActionLabel || 'Continue on Merchant Web'}</Text>
              <Ionicons name="open-outline" size={18} color="#FFFFFF" />
            </Pressable>
          ) : null}

          <Pressable
            disabled={loading}
            onPress={() => void onRefresh()}
            style={({ pressed }) => [styles.secondaryButton, dark && darkStyles.secondaryButton, pressed && styles.pressed, loading && styles.disabled]}
          >
            <Ionicons name="refresh-outline" size={18} color={dark ? '#F8FAFC' : theme.colors.navy} />
            <Text style={[styles.secondaryButtonText, dark && darkStyles.title]}>{loading ? 'Checking status…' : 'Refresh status'}</Text>
          </Pressable>
        </View>

        <Text style={[styles.footer, dark && darkStyles.mutedText]}>
          Payment, agreement acceptance, Branch setup and activation are verified by SellerTray before operational selling is enabled.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function onboardingSteps(state: SellerTrayOnboardingState) {
  const current = state.stage;
  return [
    {
      key: 'business',
      title: 'Business profile',
      text: 'Your SellerTray business workspace has been created.',
      done: true,
      current: false,
    },
    {
      key: 'branch',
      title: 'Branch details',
      text: state.activeBranchCount > 0 ? `${state.activeBranchCount} active Branch${state.activeBranchCount === 1 ? '' : 'es'} ready for setup.` : 'Add the Branch or Branches you want to activate.',
      done: state.activeBranchCount > 0,
      current: current === 'business_setup',
    },
    {
      key: 'commercial',
      title: 'Plan & commercial purchase',
      text: state.commercialOrderId ? 'Your governed SellerTray purchase has been prepared.' : 'Review your SellerTray plan, Branch setup and commercial amount on Merchant Web.',
      done: Boolean(state.commercialOrderId),
      current: current === 'commercial_purchase' || current === 'commercial_review',
    },
    {
      key: 'agreement',
      title: 'Agreement',
      text: state.agreementAccepted ? 'The current required agreement is accepted.' : 'Review and accept the current agreement where required.',
      done: state.agreementAccepted === true,
      current: current === 'agreement',
    },
    {
      key: 'payment',
      title: 'Payment',
      text: state.firstPaymentConfirmed ? 'The qualifying payment has been confirmed.' : 'Complete the required payment on Merchant Web.',
      done: state.firstPaymentConfirmed === true,
      current: current === 'payment',
    },
    {
      key: 'setup',
      title: 'Branch setup',
      text: state.setupReady
        ? 'All required Branch setup items are complete.'
        : state.setupRequiredCount > 0
          ? `${state.setupReadyCount} of ${state.setupRequiredCount} required Branch setups complete.`
          : 'ProcessEdge completes the required SellerTray Branch setup before activation.',
      done: state.setupReady === true,
      current: current === 'setup',
    },
    {
      key: 'activation',
      title: 'Activation',
      text: state.activationComplete ? 'SellerTray is activated.' : 'SellerTray activates automatically when every governed prerequisite is complete.',
      done: state.activationComplete,
      current: current === 'activation',
    },
  ];
}

function stageTitle(stage: SellerTrayOnboardingState['stage'] | undefined): string {
  switch (stage) {
    case 'business_setup': return 'Add your Branch details';
    case 'commercial_purchase': return 'Continue your SellerTray setup';
    case 'commercial_review': return 'Commercial setup needs review';
    case 'agreement': return 'Review your agreement';
    case 'payment': return 'Complete your payment';
    case 'setup': return 'Prepare for Branch setup';
    case 'activation': return 'Activation is being finalised';
    case 'active': return 'SellerTray is ready';
    default: return 'Preparing SellerTray';
  }
}

function actionHelp(stage: SellerTrayOnboardingState['stage'] | undefined): string {
  switch (stage) {
    case 'business_setup': return 'Open Merchant Web to add the Branch or Branches you want ProcessEdge to set up.';
    case 'commercial_purchase': return 'Continue on Merchant Web for the governed plan, setup and payment process.';
    case 'commercial_review': return 'ProcessEdge needs to review the commercial setup before payment or activation can continue.';
    case 'agreement': return 'Open Merchant Web to review and accept the current commercial agreement.';
    case 'payment': return 'Payments are completed through the secure Merchant Web billing flow.';
    case 'setup': return 'Your payment is confirmed. SellerTray will show scheduling and setup progress here as the setup service is completed.';
    case 'activation': return 'No additional payment or manual activation is required here. Refresh to receive the reconciled activation state.';
    default: return 'SellerTray will always show the next required action from the governed onboarding state.';
  }
}

function merchantWebAction(stage: SellerTrayOnboardingState['stage']): boolean {
  return stage === 'business_setup'
    || stage === 'commercial_purchase'
    || stage === 'commercial_review'
    || stage === 'agreement'
    || stage === 'payment'
    || stage === 'setup';
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.cloud,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0,
  },
  page: { padding: 20, paddingBottom: 40, gap: 16 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  signOutButton: { paddingHorizontal: 10, paddingVertical: 8 },
  signOutText: { color: theme.colors.muted, fontSize: 14, fontWeight: '800' },
  hero: { backgroundColor: theme.colors.navy, borderRadius: 22, padding: 20, gap: 7 },
  eyebrow: { color: theme.colors.green, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  title: { color: '#FFFFFF', fontSize: 26, lineHeight: 32, fontWeight: '900' },
  businessName: { color: theme.colors.mint, fontSize: 15, fontWeight: '800' },
  message: { color: '#E4E7EC', fontSize: 15, lineHeight: 22 },
  progressRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressTrack: { flex: 1, height: 8, borderRadius: 99, overflow: 'hidden', backgroundColor: '#344054' },
  progressFill: { height: '100%', borderRadius: 99, backgroundColor: theme.colors.green },
  progressText: { color: '#D0D5DD', fontSize: 14, fontWeight: '800' },
  alert: { borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: 'row', gap: 10 },
  errorAlert: { backgroundColor: theme.colors.dangerSoft, borderColor: '#FDA29B' },
  alertCopy: { flex: 1, gap: 3 },
  alertTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  alertText: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: theme.colors.border, gap: 13 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  cardEyebrow: { color: theme.colors.greenDark, fontSize: 14, fontWeight: '900', letterSpacing: .8 },
  cardTitle: { color: theme.colors.navy, fontSize: 20, fontWeight: '900', marginTop: 3 },
  refreshing: { color: theme.colors.muted, fontSize: 14, fontWeight: '700' },
  steps: { gap: 8 },
  step: { minHeight: 70, borderRadius: 14, backgroundColor: '#F9FAFB', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepIcon: { width: 34, height: 34, borderRadius: 99, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  stepIconDone: { backgroundColor: theme.colors.mintSoft },
  stepCopy: { flex: 1 },
  stepTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  stepText: { color: theme.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 2 },
  stepStatus: { color: theme.colors.subtle, fontSize: 14, fontWeight: '800' },
  stepStatusDone: { color: theme.colors.greenDark },
  actionCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: theme.colors.border, gap: 11 },
  actionTitle: { color: theme.colors.navy, fontSize: 18, fontWeight: '900' },
  actionText: { color: theme.colors.slate, fontSize: 15, lineHeight: 22 },
  primaryButton: { minHeight: 50, borderRadius: 13, paddingHorizontal: 16, backgroundColor: theme.colors.greenDark, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  secondaryButton: { minHeight: 50, borderRadius: 13, paddingHorizontal: 16, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  secondaryButtonText: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  pressed: { opacity: .75 },
  disabled: { opacity: .55 },
  footer: { color: theme.colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 8 },
});

const darkStyles = StyleSheet.create({
  safeArea: { backgroundColor: theme.dark.canvas },
  hero: { backgroundColor: theme.dark.surfaceRaised, borderWidth: 1, borderColor: theme.dark.border },
  card: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  step: { backgroundColor: theme.dark.surfaceSubtle },
  stepIcon: { backgroundColor: theme.dark.surfaceRaised },
  title: { color: theme.dark.text },
  body: { color: theme.dark.textMuted },
  mutedText: { color: theme.dark.textMuted },
  progressTrack: { backgroundColor: theme.dark.border },
  errorAlert: { backgroundColor: theme.dark.dangerSurface, borderColor: theme.dark.dangerBorder },
  secondaryButton: { borderColor: theme.dark.borderStrong },
});
