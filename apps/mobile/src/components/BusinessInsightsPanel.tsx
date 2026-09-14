import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { MerchantBusiness } from '../data/businessRepository';
import type { SevenDayInsight } from '../data/insightsRepository';
import { useBusinessInsights } from '../hooks/useBusinessInsights';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  business: MerchantBusiness;
};

export function BusinessInsightsPanel({ business }: Props) {
  const appearance = useSellerTrayAppearance();
  const { insights, loading, error, refresh } = useBusinessInsights(business.id);
  const showPerformance = business.role === 'owner' || business.role === 'manager';

  if (loading && !insights) {
    return (
      <View style={[styles.loadingCard, appearance.dark && darkStyles.card]}>
        <ActivityIndicator />
        <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>Loading business activity…</Text>
      </View>
    );
  }

  if (!insights) {
    return (
      <View style={[styles.errorCard, appearance.dark && darkStyles.errorCard]}>
        <Text style={styles.errorTitle}>Business insights unavailable</Text>
        <Text style={styles.errorText}>{error ?? 'SellerTray could not load the business summary.'}</Text>
        <Pressable onPress={() => void refresh()}>
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, appearance.dark && darkStyles.surface]}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>TODAY</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Order activity</Text>
        <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>Calculated on the server using {business.timezone}.</Text>
      </View>

      <View style={styles.metricGrid}>
        <Metric icon="receipt-outline" label="Orders" value={formatNumber(insights.today.orders)} />
        <Metric icon="alert-circle-outline" label="Needs review" value={formatNumber(insights.today.needsReview)} />
        <Metric icon="cube-outline" label="In progress" value={formatNumber(insights.today.inProgress)} />
        <Metric icon="checkmark-circle-outline" label="Completed" value={formatNumber(insights.today.completed)} />
      </View>

      <View style={[styles.valueCard, appearance.dark && darkStyles.mintCard]}>
        <Text style={styles.valueLabel}>TODAY'S KNOWN ORDER VALUE</Text>
        <Text style={[styles.valueAmount, appearance.dark && darkStyles.titleText]}>{formatMoney(insights.today.knownValue, business.currency)}</Text>
        <Text style={[styles.helper, appearance.dark && darkStyles.bodyText]}>Rejected, cancelled and incompletely priced orders are excluded from known value.</Text>
      </View>

      {showPerformance ? (
        <>
          <View style={[styles.divider, appearance.dark && darkStyles.divider]} />
          <View>
            <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>BUSINESS PERFORMANCE</Text>
            <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>7-day and 30-day view</Text>
          </View>

          <View style={styles.periodGrid}>
            <PeriodCard
              title="Last 7 days"
              orders={insights.sevenDays.orders}
              completed={insights.sevenDays.completed}
              closedUnsuccessful={insights.sevenDays.closedUnsuccessful}
              completionRate={insights.sevenDays.completionRate}
              knownValue={insights.sevenDays.knownValue}
              currency={business.currency}
              comparison={sevenDayComparison(insights.sevenDays, business.currency)}
            />
            <PeriodCard
              title="Last 30 days"
              orders={insights.thirtyDays.orders}
              completed={insights.thirtyDays.completed}
              closedUnsuccessful={insights.thirtyDays.closedUnsuccessful}
              completionRate={insights.thirtyDays.completionRate}
              knownValue={insights.thirtyDays.knownValue}
              currency={business.currency}
            />
          </View>

          <View style={[styles.topItemsCard, appearance.dark && darkStyles.card]}>
            <Text style={[styles.cardTitle, appearance.dark && darkStyles.titleText]}>Top products · 30 days</Text>
            {insights.topItems.length === 0 ? (
              <Text style={styles.helper}>No priced product activity yet.</Text>
            ) : (
              insights.topItems.map((item, index) => (
                <View key={`${item.name}-${index}`} style={[styles.topItemRow, appearance.dark && darkStyles.rowBorder]}>
                  <View style={styles.rank}><Text style={styles.rankText}>{index + 1}</Text></View>
                  <View style={styles.topItemCopy}>
                    <Text style={[styles.topItemName, appearance.dark && darkStyles.titleText]}>{item.name}</Text>
                    <Text style={[styles.topItemMeta, appearance.dark && darkStyles.bodyText]}>{formatQuantity(item.quantity)} ordered</Text>
                  </View>
                  <Text style={[styles.topItemValue, appearance.dark && darkStyles.titleText]}>{formatMoney(item.value, business.currency)}</Text>
                </View>
              ))
            )}
          </View>
        </>
      ) : (
        <View style={[styles.staffNote, appearance.dark && darkStyles.subtleCard]}>
          <Text style={[styles.staffTitle, appearance.dark && darkStyles.titleText]}>Operational view</Text>
          <Text style={styles.helper}>Owner/Manager accounts also see longer-period business performance and top-product insights.</Text>
        </View>
      )}

      {error ? <Text style={styles.staleText}>Latest refresh issue: {error}</Text> : null}
    </View>
  );
}

function Metric({ icon, label, value }: { icon: string; label: string; value: string }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.metricCard, appearance.dark && darkStyles.card]}>
      <View style={[styles.metricIcon, appearance.dark && darkStyles.mintCard]}>
        <Ionicons name={icon as never} size={19} color="#079455" />
      </View>
      <Text style={[styles.metricLabel, appearance.dark && darkStyles.bodyText]}>{label}</Text>
      <Text style={[styles.metricValue, appearance.dark && darkStyles.titleText]}>{value}</Text>
    </View>
  );
}

function PeriodCard({
  title,
  orders,
  completed,
  closedUnsuccessful,
  completionRate,
  knownValue,
  currency,
  comparison,
}: {
  title: string;
  orders: number;
  completed: number;
  closedUnsuccessful: number;
  completionRate: number;
  knownValue: number;
  currency: string;
  comparison?: string;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.periodCard, appearance.dark && darkStyles.card]}>
      <Text style={[styles.cardTitle, appearance.dark && darkStyles.titleText]}>{title}</Text>
      <Text style={[styles.periodValue, appearance.dark && darkStyles.titleText]}>{formatMoney(knownValue, currency)}</Text>
      <Text style={[styles.periodMeta, appearance.dark && darkStyles.bodyText]}>{formatNumber(orders)} orders · {completionRate.toFixed(1)}% completion</Text>
      <Text style={[styles.periodMeta, appearance.dark && darkStyles.bodyText]}>{formatNumber(completed)} completed · {formatNumber(closedUnsuccessful)} rejected/cancelled</Text>
      {comparison ? <Text style={styles.comparison}>{comparison}</Text> : null}
    </View>
  );
}

function sevenDayComparison(period: SevenDayInsight, currency: string): string {
  const orderDelta = period.orders - period.previousOrders;
  const valueDelta = period.knownValue - period.previousKnownValue;
  const orderText = deltaText(orderDelta, 'order');
  const valueText = valueDelta === 0
    ? 'same known value'
    : `${valueDelta > 0 ? '+' : '−'}${formatMoney(Math.abs(valueDelta), currency)} known value`;
  return `Vs previous 7 days: ${orderText}, ${valueText}.`;
}

function deltaText(value: number, noun: string): string {
  if (value === 0) return `same ${noun} count`;
  const absolute = Math.abs(value);
  return `${value > 0 ? '+' : '−'}${absolute} ${noun}${absolute === 1 ? '' : 's'}`;
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 1 }).format(value);
}

function formatQuantity(value: number): string {
  return `${formatNumber(value)} unit${value === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  eyebrow: { color: '#667085', fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 20, lineHeight: 26, fontWeight: '900', marginTop: 2 },
  helper: { color: '#667085', fontSize: 13, lineHeight: 18, marginTop: 2 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: { flexGrow: 1, flexBasis: '46%', minWidth: 130, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 12 },
  metricIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  metricLabel: { color: '#667085', fontSize: 13, fontWeight: '800' },
  metricValue: { color: '#102A43', fontSize: 24, fontWeight: '900', marginTop: 3 },
  valueCard: { backgroundColor: '#ECFDF3', borderRadius: 15, padding: 14 },
  valueLabel: { color: '#079455', fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  valueAmount: { color: '#102A43', fontSize: 25, fontWeight: '900', marginTop: 4 },
  divider: { height: 1, backgroundColor: '#E4E7EC', marginVertical: 2 },
  periodGrid: { gap: 9 },
  periodCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 13 },
  cardTitle: { color: '#344054', fontSize: 13, fontWeight: '900' },
  periodValue: { color: '#102A43', fontSize: 20, fontWeight: '900', marginTop: 5 },
  periodMeta: { color: '#667085', fontSize: 13, lineHeight: 18, marginTop: 3 },
  comparison: { color: '#079455', fontSize: 13, lineHeight: 15, fontWeight: '700', marginTop: 7 },
  topItemsCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 13, gap: 3 },
  topItemRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E4E7EC' },
  rank: { width: 23, height: 23, borderRadius: 999, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#079455', fontSize: 13, fontWeight: '900' },
  topItemCopy: { flex: 1 },
  topItemName: { color: '#102A43', fontSize: 13, fontWeight: '800' },
  topItemMeta: { color: '#667085', fontSize: 13, marginTop: 2 },
  topItemValue: { color: '#344054', fontSize: 13, fontWeight: '900' },
  staffNote: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 11 },
  staffTitle: { color: '#344054', fontSize: 13, fontWeight: '900' },
  staleText: { color: '#B54708', fontSize: 13, lineHeight: 14 },
  loadingCard: { minHeight: 110, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E4E7EC', alignItems: 'center', justifyContent: 'center', gap: 7 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 14, padding: 13, gap: 4 },
  errorTitle: { color: '#B42318', fontSize: 13, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 13, lineHeight: 15 },
  retry: { color: '#B42318', fontSize: 13, fontWeight: '900', marginTop: 3 },
});

const darkStyles = StyleSheet.create({
  surface: { backgroundColor: '#081825' },
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46' },
  mintCard: { backgroundColor: '#12372C', borderColor: '#1C6B4A' },
  errorCard: { backgroundColor: '#3A1717' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  rowBorder: { borderBottomColor: '#344054' },
  divider: { backgroundColor: '#344054' },
});
