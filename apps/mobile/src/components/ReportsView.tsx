import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import { loadReportSummary, type ReportSummary } from '../data/reportsRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

export function ReportsView({ business }: { business: MerchantBusiness }) {
  const appearance = useSellerTrayAppearance();
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await loadReportSummary(business.id, days));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load reports.');
    } finally {
      setLoading(false);
    }
  }, [business.id, days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <View style={styles.wrap}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>REPORTS</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Business performance</Text>
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>
          Orders, payments, products and fulfilment in one merchant view.
        </Text>
      </View>

      <View style={[styles.segment, appearance.dark && darkStyles.segment]}>
        {[7, 30].map((value) => (
          <Pressable key={value} onPress={() => setDays(value)} style={[styles.segmentButton, days === value && styles.segmentButtonActive]}>
            <Text style={[styles.segmentText, days === value && styles.segmentTextActive, appearance.dark && days !== value && darkStyles.bodyText]}>
              Last {value} days
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && !summary ? (
        <View style={[styles.loadingCard, appearance.dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>Loading report…</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Report unavailable</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void refresh()}><Text style={styles.retry}>Retry</Text></Pressable>
        </View>
      ) : null}

      {summary ? (
        <>
          <ReportSection title="Orders & sales" dark={appearance.dark}>
            <Metric label="Orders" value={formatNumber(summary.orders.total)} dark={appearance.dark} />
            <Metric label="Completed" value={formatNumber(summary.orders.completed)} dark={appearance.dark} />
            <Metric label="Order value" value={formatMoney(summary.orders.orderValue, business.currency)} dark={appearance.dark} />
            <Metric label="Average order" value={formatMoney(summary.orders.averageOrderValue, business.currency)} dark={appearance.dark} />
            <Metric label="WhatsApp" value={formatNumber(summary.orders.whatsapp)} dark={appearance.dark} />
            <Metric label="Manual" value={formatNumber(summary.orders.manual)} dark={appearance.dark} />
          </ReportSection>

          <ReportSection title="Payments" dark={appearance.dark}>
            <Metric label="Paid value" value={formatMoney(summary.payments.paidValue, business.currency)} dark={appearance.dark} />
            <Metric label="Paid orders" value={formatNumber(summary.payments.paidOrders)} dark={appearance.dark} />
            <Metric label="Awaiting payment" value={formatNumber(summary.payments.awaitingPayment)} attention={summary.payments.awaitingPayment > 0} dark={appearance.dark} />
            <Metric label="Verify now" value={formatNumber(summary.payments.verificationRequired)} attention={summary.payments.verificationRequired > 0} dark={appearance.dark} />
            <Metric label="Failed" value={formatNumber(summary.payments.failed)} attention={summary.payments.failed > 0} dark={appearance.dark} />
            <Metric label="Exceptions" value={formatNumber(summary.payments.exceptions)} attention={summary.payments.exceptions > 0} dark={appearance.dark} />
            <View style={styles.fullWidth}>
              <Text style={[styles.subheading, appearance.dark && darkStyles.titleText]}>Payment methods</Text>
              {Object.keys(summary.payments.methods).length === 0 ? (
                <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>No payment attempts in this period.</Text>
              ) : Object.entries(summary.payments.methods).map(([method, count]) => (
                <View key={method} style={styles.listRow}>
                  <Text style={[styles.listLabel, appearance.dark && darkStyles.bodyText]}>{humanMethod(method)}</Text>
                  <Text style={[styles.listValue, appearance.dark && darkStyles.titleText]}>{formatNumber(count)}</Text>
                </View>
              ))}
            </View>
          </ReportSection>

          <ReportSection title="Fulfilment" dark={appearance.dark}>
            <Metric label="Awaiting fulfilment" value={formatNumber(summary.fulfillment.awaitingFulfillment)} attention={summary.fulfillment.awaitingFulfillment > 0} dark={appearance.dark} />
            <Metric label="Out for delivery" value={formatNumber(summary.fulfillment.outForDelivery)} dark={appearance.dark} />
            <Metric label="Delivered" value={formatNumber(summary.fulfillment.delivered)} dark={appearance.dark} />
            <Metric label="Collected" value={formatNumber(summary.fulfillment.collected)} dark={appearance.dark} />
          </ReportSection>

          <View style={[styles.card, appearance.dark && darkStyles.card]}>
            <Text style={[styles.sectionTitle, appearance.dark && darkStyles.titleText]}>Top products</Text>
            {summary.topItems.length === 0 ? (
              <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>No product sales activity in this period.</Text>
            ) : summary.topItems.map((item, index) => (
              <View key={item.name + index} style={[styles.productRow, appearance.dark && darkStyles.rowBorder]}>
                <View style={styles.rank}><Text style={styles.rankText}>{index + 1}</Text></View>
                <View style={styles.flex}>
                  <Text style={[styles.productName, appearance.dark && darkStyles.titleText]}>{item.name}</Text>
                  <Text style={[styles.productMeta, appearance.dark && darkStyles.bodyText]}>{formatNumber(item.quantity)} units</Text>
                </View>
                <Text style={[styles.productValue, appearance.dark && darkStyles.titleText]}>{formatMoney(item.value, business.currency)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function ReportSection({ title, dark, children }: { title: string; dark: boolean; children: React.ReactNode }) {
  return (
    <View style={[styles.card, dark && darkStyles.card]}>
      <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{title}</Text>
      <View style={styles.metricGrid}>{children}</View>
    </View>
  );
}

function Metric({ label, value, attention = false, dark }: { label: string; value: string; attention?: boolean; dark: boolean }) {
  return (
    <View style={[styles.metric, dark && darkStyles.metric, attention && styles.metricAttention]}>
      <Text numberOfLines={1} style={[styles.metricValue, dark && darkStyles.titleText]}>{value}</Text>
      <Text style={[styles.metricLabel, dark && darkStyles.bodyText]}>{label}</Text>
    </View>
  );
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 1 }).format(value);
}

function humanMethod(value: string) {
  return ({
    bank_transfer: 'Bank transfer',
    paystack: 'Paystack',
    flutterwave: 'Flutterwave',
    cash_on_delivery: 'Cash on delivery',
    pay_on_pickup: 'Pay on pickup',
  } as Record<string, string>)[value] ?? value.replace(/_/g, ' ');
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  flex: { flex: 1 },
  fullWidth: { width: '100%', marginTop: 6 },
  eyebrow: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 27, lineHeight: 33, fontWeight: '900', marginTop: 3 },
  body: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 3 },
  segment: { flexDirection: 'row', padding: 4, backgroundColor: '#F2F4F7', borderRadius: 12 },
  segmentButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  segmentButtonActive: { backgroundColor: '#FFFFFF' },
  segmentText: { color: '#667085', fontSize: 13, fontWeight: '800' },
  segmentTextActive: { color: '#079455' },
  loadingCard: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 16 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, padding: 14, gap: 10 },
  sectionTitle: { color: '#102A43', fontSize: 17, fontWeight: '900' },
  subheading: { color: '#344054', fontSize: 14, fontWeight: '900', marginBottom: 6 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { flexBasis: '47%', flexGrow: 1, minWidth: 130, borderRadius: 12, backgroundColor: '#F9FAFB', padding: 11 },
  metricAttention: { borderWidth: 1, borderColor: '#FEC84B', backgroundColor: '#FFFAEB' },
  metricValue: { color: '#102A43', fontSize: 20, fontWeight: '900' },
  metricLabel: { color: '#667085', fontSize: 13, lineHeight: 18, marginTop: 3, fontWeight: '700' },
  listRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listLabel: { color: '#667085', fontSize: 13 },
  listValue: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E4E7EC' },
  rank: { width: 24, height: 24, borderRadius: 99, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#079455', fontSize: 10, fontWeight: '900' },
  productName: { color: '#102A43', fontSize: 14, fontWeight: '800' },
  productMeta: { color: '#667085', fontSize: 12, marginTop: 2 },
  productValue: { color: '#344054', fontSize: 13, fontWeight: '900' },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 14, padding: 13, gap: 4 },
  errorTitle: { color: '#B42318', fontSize: 14, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 13, lineHeight: 19 },
  retry: { color: '#12B76A', fontSize: 13, fontWeight: '900', marginTop: 4 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  metric: { backgroundColor: '#162F46' },
  segment: { backgroundColor: '#162F46' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  rowBorder: { borderBottomColor: '#344054' },
});
