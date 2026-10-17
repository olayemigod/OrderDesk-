import { StyleSheet, Text, View } from 'react-native';

import { type SubscriptionAccess } from '../data/subscriptionRepository';
import type { MerchantRole } from '../data/businessRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  role: MerchantRole;
  subscription: SubscriptionAccess | null;
  loading: boolean;
  error: string | null;
};

export function SubscriptionStatusCard({ role, subscription, loading, error }: Props) {
  const appearance = useSellerTrayAppearance();

  if (loading && !subscription) {
    return (
      <View style={[styles.card, appearance.dark && darkStyles.card]}>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>SUBSCRIPTION</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Checking plan…</Text>
      </View>
    );
  }

  if (error && !subscription) {
    return (
      <View style={[styles.card, styles.warningCard, appearance.dark && darkStyles.warningCard]}>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>SUBSCRIPTION</Text>
        <Text style={[styles.warningTitle, appearance.dark && darkStyles.warningTitle]}>Plan state unavailable</Text>
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>{error}</Text>
      </View>
    );
  }

  if (!subscription) return null;

  const readOnly = subscription.accessMode === 'read_only';
  const trialDays = subscription.trialEndsAt ? daysUntil(subscription.trialEndsAt) : null;
  const periodEnd = subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : null;
  const graceEnd = subscription.graceEndsAt ? formatDate(subscription.graceEndsAt) : null;
  return (
    <View style={[styles.card, appearance.dark && darkStyles.card, readOnly && styles.blockedCard, readOnly && appearance.dark && darkStyles.blockedCard]}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>SUBSCRIPTION</Text>
          <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>{subscription.planName}</Text>
        </View>
        <View style={[styles.pill, readOnly ? styles.pillBlocked : styles.pillActive]}>
          <Text style={[styles.pillText, readOnly ? styles.pillTextBlocked : styles.pillTextActive]}>
            {readOnly ? 'Read only' : statusLabel(subscription.effectiveStatus)}
          </Text>
        </View>
      </View>

      {subscription.baseStatus === 'trial' && subscription.trialEndsAt ? (
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>
          {trialDays !== null && trialDays >= 0
            ? `${trialDays} day${trialDays === 1 ? '' : 's'} left in trial · ends ${formatDate(subscription.trialEndsAt)}`
            : `Trial ended ${formatDate(subscription.trialEndsAt)}`}
        </Text>
      ) : null}

      {subscription.baseStatus === 'active' && periodEnd ? (
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>Current billing period ends {periodEnd}.</Text>
      ) : null}

      {subscription.baseStatus === 'grace' && graceEnd ? (
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>Grace access ends {graceEnd}.</Text>
      ) : null}

      {readOnly ? (
        <View style={[styles.readOnlyBox, appearance.dark && darkStyles.dangerCard]}>
          <Text style={[styles.readOnlyTitle, appearance.dark && darkStyles.dangerTitle]}>Business operations are paused</Text>
          <Text style={[styles.readOnlyText, appearance.dark && darkStyles.dangerText]}>
            Existing orders and history remain visible. New orders, order changes, catalogue changes and customer-notification settings are blocked until the subscription is reactivated.
          </Text>
        </View>
      ) : null}

      <View style={[styles.chargeBox, appearance.dark && darkStyles.subtleCard]}>
        <Text style={[styles.chargeTitle, appearance.dark && darkStyles.titleText]}>Base subscription</Text>
        <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>
          This Android build shows your current SellerTray plan and access state. Subscription purchase and plan changes are not offered inside the app.
        </Text>
      </View>

      <View style={[styles.chargeBox, appearance.dark && darkStyles.subtleCard]}>
        <Text style={[styles.chargeTitle, appearance.dark && darkStyles.titleText]}>AI-assisted order activity</Text>
        <Text style={[styles.usageCount, appearance.dark && darkStyles.bodyText]}>
          {subscription.usageUnitsThisPeriod} {activityLabel(subscription.usageUnitsThisPeriod)} this period
        </Text>
        {subscription.baseStatus === 'trial' ? (
          <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>
            Trial AI-assisted activity is measured but free. Trial activity is not charged later when paid usage starts.
          </Text>
        ) : !subscription.usagePricingActive ? (
          <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>
            Usage is being metered, but the flat activity charge has not been activated. Unpriced activity is not charged retroactively.
          </Text>
        ) : (
          <>
            <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>
              {formatMoney(subscription.usageUnitPrice ?? 0, subscription.currency)} per AI-assisted order activity
              {subscription.usageBillableNow ? '' : ' · not currently billable'}
            </Text>
            <Text style={[styles.chargeValue, appearance.dark && darkStyles.titleText]}>
              Usage so far: {formatMoney(subscription.usageAmountThisPeriod, subscription.currency)}
            </Text>
          </>
        )}
      </View>

      {subscription.checkoutReady && role !== 'owner' && subscription.baseStatus !== 'active' ? (
        <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>Only the business Owner can manage subscription access.</Text>
      ) : null}
    </View>
  );
}

function activityLabel(value: number): string {
  return value === 1 ? 'activity' : 'activities';
}

function daysUntil(value: string): number | null {
  const end = new Date(value).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function statusLabel(value: SubscriptionAccess['effectiveStatus']): string {
  const labels: Record<SubscriptionAccess['effectiveStatus'], string> = {
    trial: 'Trial',
    active: 'Active',
    past_due: 'Past due',
    grace: 'Grace',
    suspended: 'Suspended',
    cancelled: 'Cancelled',
    trial_expired: 'Trial expired',
    grace_expired: 'Grace expired',
  };
  return labels[value];
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E7EC',
    borderRadius: 18,
    padding: 15,
    gap: 9,
  },
  blockedCard: { borderColor: '#FDA29B', backgroundColor: '#FFFBFA' },
  warningCard: { borderColor: '#FEC84B', backgroundColor: '#FFFCF5' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 16, fontWeight: '900', marginTop: 3 },
  warningTitle: { color: '#B54708', fontSize: 15, fontWeight: '900', marginTop: 3 },
  body: { color: '#667085', fontSize: 13, lineHeight: 20 },
  pill: { borderRadius: 999, paddingVertical: 5, paddingHorizontal: 9 },
  pillActive: { backgroundColor: '#ECFDF3' },
  pillBlocked: { backgroundColor: '#FEF3F2' },
  pillText: { fontSize: 12, fontWeight: '900' },
  pillTextActive: { color: '#027A48' },
  pillTextBlocked: { color: '#B42318' },
  readOnlyBox: { backgroundColor: '#FEF3F2', borderRadius: 12, padding: 11, gap: 4 },
  readOnlyTitle: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  readOnlyText: { color: '#912018', fontSize: 12, lineHeight: 18 },
  chargeBox: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 11, gap: 4 },
  chargeTitle: { color: '#344054', fontSize: 13, fontWeight: '900' },
  chargeValue: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  usageCount: { color: '#475467', fontSize: 13, fontWeight: '800' },
  helper: { color: '#667085', fontSize: 12, lineHeight: 18 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46' },
  blockedCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  warningCard: { backgroundColor: '#3D2A12', borderColor: '#B54708' },
  warningTitle: { color: '#FEDF89' },
  dangerCard: { backgroundColor: '#3A1717' },
  dangerTitle: { color: '#FDA29B' },
  dangerText: { color: '#FECDCA' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
});
