import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { MerchantBusiness } from '../data/businessRepository';
import { loadCommercialActions, type CommercialAction } from '../data/commercialActionsRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Filter = 'all' | 'high' | 'ai';

export function CommercialActionAuditView({ business }: { business: MerchantBusiness }) {
  const appearance = useSellerTrayAppearance();
  const [actions, setActions] = useState<CommercialAction[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setActions(await loadCommercialActions(business.id, 150));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load commercial audit.');
    } finally {
      setLoading(false);
    }
  }, [business.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => actions.filter((action) => {
    if (filter === 'high') return action.riskClass === 'high';
    if (filter === 'ai') return action.interpretationSource === 'ai';
    return true;
  }), [actions, filter]);

  return (
    <View style={styles.wrap}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>COMMERCIAL AUDIT</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Action ledger</Text>
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>
          Trace how customer language was interpreted, which policy path SellerTray used, and what commercial action followed.
        </Text>
      </View>

      <View style={[styles.filters, appearance.dark && darkStyles.subtleCard]}>
        <FilterButton label="All" active={filter === 'all'} onPress={() => setFilter('all')} dark={appearance.dark} />
        <FilterButton label="High risk" active={filter === 'high'} onPress={() => setFilter('high')} dark={appearance.dark} />
        <FilterButton label="AI interpreted" active={filter === 'ai'} onPress={() => setFilter('ai')} dark={appearance.dark} />
      </View>

      {loading && actions.length === 0 ? (
        <View style={[styles.loadingCard, appearance.dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>Loading action history…</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Audit unavailable</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void refresh()}><Text style={styles.retry}>Retry</Text></Pressable>
        </View>
      ) : null}

      {!loading && !error && visible.length === 0 ? (
        <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
          <Ionicons name="shield-checkmark-outline" size={27} color="#12B76A" />
          <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>No matching commercial actions yet</Text>
          <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>
            New customer-order, payment, delivery and enquiry actions will appear here.
          </Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {visible.map((action) => (
          <View key={action.id} style={[styles.card, appearance.dark && darkStyles.card]}>
            <View style={styles.topRow}>
              <View style={[styles.iconWrap, iconSurface(action.riskClass, appearance.dark)]}>
                <Ionicons name={iconForAction(action.actionType) as never} size={19} color={iconColor(action.riskClass)} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.actionTitle, appearance.dark && darkStyles.titleText]}>{humanAction(action.actionType)}</Text>
                <Text style={[styles.meta, appearance.dark && darkStyles.bodyText]}>
                  {action.customerName}{action.orderRef ? ' · ' + action.orderRef : ''}
                </Text>
              </View>
              <RiskPill risk={action.riskClass} />
            </View>

            <View style={styles.detailGrid}>
              <Detail label="Interpreter" value={humanLabel(action.interpretationSource ?? 'workflow')} dark={appearance.dark} />
              <Detail label="Actor" value={humanLabel(action.requestedBy)} dark={appearance.dark} />
              <Detail label="Policy" value={humanLabel(action.policyResult)} dark={appearance.dark} />
              <Detail label="Result" value={humanLabel(action.actionStatus)} dark={appearance.dark} />
            </View>

            {stateTransition(action) ? (
              <View style={[styles.transitionBox, appearance.dark && darkStyles.subtleCard]}>
                <Text style={[styles.transitionLabel, appearance.dark && darkStyles.bodyText]}>STATE EVIDENCE</Text>
                <Text style={[styles.transitionText, appearance.dark && darkStyles.titleText]}>{stateTransition(action)}</Text>
              </View>
            ) : null}

            {action.financialImpact !== null ? (
              <Text style={[styles.financialImpact, appearance.dark && darkStyles.greenText]}>
                Financial impact: {formatMoney(action.financialImpact, action.currency)}
              </Text>
            ) : null}

            {action.interpretationConfidence !== null ? (
              <Text style={[styles.confidence, appearance.dark && darkStyles.bodyText]}>
                Interpretation confidence {Math.round(action.interpretationConfidence * 100)}%
              </Text>
            ) : null}

            <Text style={[styles.meta, appearance.dark && darkStyles.bodyText]}>
              Channel: {humanLabel(action.channel)}
            </Text>
            <Text style={[styles.timestamp, appearance.dark && darkStyles.bodyText]}>{formatDate(action.createdAt)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FilterButton({ label, active, onPress, dark }: { label: string; active: boolean; onPress: () => void; dark: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.filterButton, dark && darkStyles.filterButton, active && styles.filterActive, dark && active && darkStyles.filterActive]}>
      <Text style={[styles.filterText, dark && darkStyles.bodyText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Detail({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return (
    <View style={[styles.detailBox, dark && darkStyles.subtleCard]}>
      <Text style={[styles.detailLabel, dark && darkStyles.bodyText]}>{label}</Text>
      <Text numberOfLines={2} style={[styles.detailValue, dark && darkStyles.titleText]}>{value}</Text>
    </View>
  );
}

function RiskPill({ risk }: { risk: CommercialAction['riskClass'] }) {
  return (
    <View style={[styles.riskPill, risk === 'high' ? styles.riskHigh : risk === 'medium' ? styles.riskMedium : styles.riskLow]}>
      <Text style={[styles.riskText, risk === 'high' ? styles.riskHighText : risk === 'medium' ? styles.riskMediumText : styles.riskLowText]}>
        {risk.toUpperCase()}
      </Text>
    </View>
  );
}

function humanAction(value: string) {
  return humanLabel(value);
}

function humanLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stateTransition(action: CommercialAction): string | null {
  const beforeStatus = textState(action.beforeState.status);
  const afterStatus = textState(action.afterState.status);
  const beforePayment = textState(action.beforeState.payment_status);
  const afterPayment = textState(action.afterState.payment_status);
  const beforeFulfillment = textState(action.beforeState.fulfillment_status);
  const afterFulfillment = textState(action.afterState.fulfillment_status);

  const parts: string[] = [];
  if (beforeStatus || afterStatus) {
    parts.push('Order: ' + (beforeStatus ?? '—') + ' → ' + (afterStatus ?? '—'));
  }
  if ((beforePayment || afterPayment) && beforePayment !== afterPayment) {
    parts.push('Payment: ' + (beforePayment ?? '—') + ' → ' + (afterPayment ?? '—'));
  }
  if ((beforeFulfillment || afterFulfillment) && beforeFulfillment !== afterFulfillment) {
    parts.push('Fulfilment: ' + (beforeFulfillment ?? '—') + ' → ' + (afterFulfillment ?? '—'));
  }
  return parts.length ? parts.join(' · ') : null;
}

function textState(value: unknown): string | null {
  return typeof value === 'string' && value ? humanLabel(value) : null;
}

function formatMoney(value: number, currency: string | null) {
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : 'NGN';
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return code + ' ' + value.toFixed(2);
  }
}

function iconForAction(action: string) {
  if (action.includes('payment')) return 'card-outline';
  if (action.includes('delivery') || action.includes('pickup')) return 'bicycle-outline';
  if (action.includes('refund')) return 'return-down-back-outline';
  if (action.includes('enquiry')) return 'chatbubble-ellipses-outline';
  if (action.includes('order')) return 'receipt-outline';
  return 'shield-checkmark-outline';
}

function iconColor(risk: CommercialAction['riskClass']) {
  if (risk === 'high') return '#D92D20';
  if (risk === 'medium') return '#B54708';
  return '#079455';
}

function iconSurface(risk: CommercialAction['riskClass'], dark: boolean) {
  if (dark) return styles.iconDark;
  if (risk === 'high') return styles.iconHigh;
  if (risk === 'medium') return styles.iconMedium;
  return styles.iconLow;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  list: { gap: 10 },
  flex: { flex: 1 },
  eyebrow: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 27, lineHeight: 33, fontWeight: '900', marginTop: 3 },
  body: { color: '#667085', fontSize: 13, lineHeight: 20, marginTop: 3 },
  filters: { flexDirection: 'row', gap: 7, backgroundColor: '#F2F4F7', borderRadius: 13, padding: 4 },
  filterButton: { flex: 1, minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  filterActive: { backgroundColor: '#FFFFFF' },
  filterText: { color: '#667085', fontSize: 12, fontWeight: '800' },
  filterTextActive: { color: '#079455' },
  loadingCard: { minHeight: 120, backgroundColor: '#FFFFFF', borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyCard: { minHeight: 150, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 18 },
  emptyTitle: { color: '#102A43', fontSize: 16, fontWeight: '900', marginTop: 7 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, padding: 13, gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconLow: { backgroundColor: '#ECFDF3' },
  iconMedium: { backgroundColor: '#FFFAEB' },
  iconHigh: { backgroundColor: '#FEF3F2' },
  iconDark: { backgroundColor: '#162F46' },
  actionTitle: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  meta: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 2 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  detailBox: { flexBasis: '47%', flexGrow: 1, minWidth: 120, backgroundColor: '#F9FAFB', borderRadius: 10, padding: 9 },
  detailLabel: { color: '#667085', fontSize: 12, fontWeight: '700' },
  detailValue: { color: '#344054', fontSize: 12, lineHeight: 18, fontWeight: '900', marginTop: 2 },
  transitionBox: { backgroundColor: '#F9FAFB', borderRadius: 10, padding: 9, gap: 3 },
  transitionLabel: { color: '#667085', fontSize: 12, fontWeight: '800' },
  transitionText: { color: '#344054', fontSize: 13, lineHeight: 19, fontWeight: '800' },
  financialImpact: { color: '#027A48', fontSize: 13, lineHeight: 19, fontWeight: '900' },
  confidence: { color: '#667085', fontSize: 12, lineHeight: 18 },
  timestamp: { color: '#98A2B3', fontSize: 12 },
  riskPill: { borderRadius: 999, paddingVertical: 5, paddingHorizontal: 7 },
  riskLow: { backgroundColor: '#ECFDF3' },
  riskMedium: { backgroundColor: '#FFFAEB' },
  riskHigh: { backgroundColor: '#FEF3F2' },
  riskText: { fontSize: 12, fontWeight: '900' },
  riskLowText: { color: '#027A48' },
  riskMediumText: { color: '#B54708' },
  riskHighText: { color: '#B42318' },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 14, padding: 13, gap: 4 },
  errorTitle: { color: '#B42318', fontSize: 14, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 13, lineHeight: 19 },
  retry: { color: '#12B76A', fontSize: 13, fontWeight: '900', marginTop: 4 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46' },
  filterButton: { backgroundColor: '#162F46' },
  filterActive: { backgroundColor: '#12372C' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  greenText: { color: '#ABEFC6' },
});
