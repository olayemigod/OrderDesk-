import { StyleSheet, Text, View } from 'react-native';

import { type SubscriptionAccess } from '../data/subscriptionRepository';
import type { MerchantRole } from '../data/businessRepository';

type Props = {
  tenantId: string;
  role: MerchantRole;
  subscription: SubscriptionAccess | null;
  loading: boolean;
  error: string | null;
};

export function SubscriptionStatusCard({ role, subscription, loading, error }: Props) {

  if (loading && !subscription) {
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>SUBSCRIPTION</Text>
        <Text style={styles.title}>Checking plan…</Text>
      </View>
    );
  }

  if (error && !subscription) {
    return (
      <View style={[styles.card, styles.warningCard]}>
        <Text style={styles.eyebrow}>SUBSCRIPTION</Text>
        <Text style={styles.warningTitle}>Plan state unavailable</Text>
        <Text style={styles.body}>{error}</Text>
      </View>
    );
  }

  if (!subscription) return null;

  const readOnly = subscription.accessMode === 'read_only';
  const trialDays = subscription.trialEndsAt ? daysUntil(subscription.trialEndsAt) : null;
  const periodEnd = subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : null;
  const graceEnd = subscription.graceEndsAt ? formatDate(subscription.graceEndsAt) : null;
  return (
    <View style={[styles.card, readOnly && styles.blockedCard]}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>SUBSCRIPTION</Text>
          <Text style={styles.title}>{subscription.planName}</Text>
        </View>
        <View style={[styles.pill, readOnly ? styles.pillBlocked : styles.pillActive]}>
          <Text style={[styles.pillText, readOnly ? styles.pillTextBlocked : styles.pillTextActive]}>
            {readOnly ? 'Read only' : statusLabel(subscription.effectiveStatus)}
          </Text>
        </View>
      </View>

      {subscription.baseStatus === 'trial' && subscription.trialEndsAt ? (
        <Text style={styles.body}>
          {trialDays !== null && trialDays >= 0
            ? `${trialDays} day${trialDays === 1 ? '' : 's'} left in trial · ends ${formatDate(subscription.trialEndsAt)}`
            : `Trial ended ${formatDate(subscription.trialEndsAt)}`}
        </Text>
      ) : null}

      {subscription.baseStatus === 'active' && periodEnd ? (
        <Text style={styles.body}>Current billing period ends {periodEnd}.</Text>
      ) : null}

      {subscription.baseStatus === 'grace' && graceEnd ? (
        <Text style={styles.body}>Grace access ends {graceEnd}.</Text>
      ) : null}

      {readOnly ? (
        <View style={styles.readOnlyBox}>
          <Text style={styles.readOnlyTitle}>Business operations are paused</Text>
          <Text style={styles.readOnlyText}>
            Existing orders and history remain visible. New orders, order changes, catalogue changes and customer-notification settings are blocked until the subscription is reactivated.
          </Text>
        </View>
      ) : null}

      <View style={styles.chargeBox}>
        <Text style={styles.chargeTitle}>Base subscription</Text>
        <Text style={styles.helper}>
          This Android build shows your current SellerTray plan and access state. Subscription purchase and plan changes are not offered inside the app.
        </Text>
      </View>

      <View style={styles.chargeBox}>
        <Text style={styles.chargeTitle}>AI-assisted order activity</Text>
        <Text style={styles.usageCount}>
          {subscription.usageUnitsThisPeriod} {activityLabel(subscription.usageUnitsThisPeriod)} this period
        </Text>
        {subscription.baseStatus === 'trial' ? (
          <Text style={styles.helper}>
            Trial AI-assisted activity is measured but free. Trial activity is not charged later when paid usage starts.
          </Text>
        ) : !subscription.usagePricingActive ? (
          <Text style={styles.helper}>
            Usage is being metered, but the flat activity charge has not been activated. Unpriced activity is not charged retroactively.
          </Text>
        ) : (
          <>
            <Text style={styles.helper}>
              {formatMoney(subscription.usageUnitPrice ?? 0, subscription.currency)} per AI-assisted order activity
              {subscription.usageBillableNow ? '' : ' · not currently billable'}
            </Text>
            <Text style={styles.chargeValue}>
              Usage so far: {formatMoney(subscription.usageAmountThisPeriod, subscription.currency)}
            </Text>
          </>
        )}
      </View>

      {subscription.checkoutReady && role !== 'owner' && subscription.baseStatus !== 'active' ? (
        <Text style={styles.helper}>Only the business Owner can manage subscription access.</Text>
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
    borderColor: '#EAECF0',
    borderRadius: 18,
    padding: 15,
    gap: 9,
  },
  blockedCard: { borderColor: '#FDA29B', backgroundColor: '#FFFBFA' },
  warningCard: { borderColor: '#FEC84B', backgroundColor: '#FFFCF5' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#98A2B3', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#101828', fontSize: 16, fontWeight: '900', marginTop: 3 },
  warningTitle: { color: '#B54708', fontSize: 15, fontWeight: '900', marginTop: 3 },
  body: { color: '#667085', fontSize: 11, lineHeight: 17 },
  pill: { borderRadius: 999, paddingVertical: 5, paddingHorizontal: 9 },
  pillActive: { backgroundColor: '#ECFDF3' },
  pillBlocked: { backgroundColor: '#FEF3F2' },
  pillText: { fontSize: 9, fontWeight: '900' },
  pillTextActive: { color: '#027A48' },
  pillTextBlocked: { color: '#B42318' },
  readOnlyBox: { backgroundColor: '#FEF3F2', borderRadius: 12, padding: 11, gap: 4 },
  readOnlyTitle: { color: '#B42318', fontSize: 11, fontWeight: '900' },
  readOnlyText: { color: '#912018', fontSize: 10, lineHeight: 16 },
  chargeBox: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 11, gap: 4 },
  chargeTitle: { color: '#344054', fontSize: 10, fontWeight: '900' },
  chargeValue: { color: '#101828', fontSize: 12, fontWeight: '900' },
  usageCount: { color: '#475467', fontSize: 11, fontWeight: '800' },
  helper: { color: '#98A2B3', fontSize: 10, lineHeight: 15 },
});
