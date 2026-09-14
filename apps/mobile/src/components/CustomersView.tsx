import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { MerchantBusiness } from '../data/businessRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import {
  loadCustomers,
  updateCustomerProfile,
  type MerchantCustomer,
} from '../data/customerRepository';

export function CustomersView({ business }: { business: MerchantBusiness }) {
  const appearance = useSellerTrayAppearance();
  const [customers, setCustomers] = useState<MerchantCustomer[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadCustomers(business.id);
      setCustomers(rows);
      setSelectedId((current) => rows.some((item) => item.id === current) ? current : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customers.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [business.id]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => [
      customer.displayName ?? '',
      customer.phone ?? '',
      customer.email ?? '',
      customer.whatsappId,
      ...customer.orders.map((order) => order.publicOrderId),
    ].join(' ').toLowerCase().includes(needle));
  }, [customers, query]);

  const selected = customers.find((customer) => customer.id === selectedId) ?? null;

  useEffect(() => {
    setDisplayName(selected?.displayName ?? '');
    setEmail(selected?.email ?? '');
    setNotice(null);
  }, [selected?.id, selected?.displayName, selected?.email]);

  const canEdit =
    business.role !== 'staff' &&
    ['trial', 'active', 'grace'].includes(business.subscriptionStatus);

  async function save() {
    if (!selected || !canEdit || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateCustomerProfile(business.id, selected.id, {
        displayName: displayName || null,
        email: email || null,
      });
      setNotice('Customer profile updated.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update customer.');
    } finally {
      setBusy(false);
    }
  }

  const repeatCustomers = customers.filter((customer) => customer.orderCount > 1).length;
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const newCustomers = customers.filter((customer) => {
    const created = new Date(customer.createdAt).getTime();
    return Number.isFinite(created) && created >= thirtyDaysAgo;
  }).length;

  if (selected) {
    return (
      <View style={[styles.wrap, appearance.dark && darkStyles.surface]}>
        <Pressable onPress={() => setSelectedId('')} style={styles.backButton}>
          <Text style={[styles.backText, appearance.dark && darkStyles.greenText]}>← Customers</Text>
        </Pressable>

        <View style={[styles.profileHero, appearance.dark && darkStyles.card]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{customerInitials(selected.displayName || selected.phone || 'Customer')}</Text>
          </View>
          <View style={styles.customerCopy}>
            <Text style={[styles.profileName, appearance.dark && darkStyles.titleText]}>{selected.displayName || selected.phone || 'WhatsApp customer'}</Text>
            <Text style={[styles.meta, appearance.dark && darkStyles.bodyText]}>{selected.phone || selected.whatsappId}</Text>
            {selected.email ? <Text style={[styles.meta, appearance.dark && darkStyles.bodyText]}>{selected.email}</Text> : null}
          </View>
        </View>

        <View style={styles.metrics}>
          <Metric label="Orders" value={selected.orderCount} />
          <Metric label="Completed value" value={formatMoney(selected.lifetimeValue, business.currency)} compact />
        </View>

        <View style={[styles.detailCard, appearance.dark && darkStyles.card]}>
          <Text style={[styles.sectionTitle, appearance.dark && darkStyles.titleText]}>Customer profile</Text>
          <Text style={styles.identityLabel}>WhatsApp / phone identity</Text>
          <Text style={[styles.identityValue, appearance.dark && darkStyles.titleText]}>{selected.phone || selected.whatsappId}</Text>
          <Text style={[styles.identityHelp, appearance.dark && darkStyles.bodyText]}>Read-only. SellerTray uses this identity to keep WhatsApp order history linked correctly.</Text>

          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput value={displayName} onChangeText={setDisplayName} editable={canEdit && !busy} maxLength={120} style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]} />

          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} editable={canEdit && !busy} autoCapitalize="none" keyboardType="email-address" maxLength={254} style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]} />

          {canEdit ? (
            <Pressable disabled={busy} onPress={() => void save()} style={[styles.primary, busy && styles.disabled]}>
              <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save profile'}</Text>
            </Pressable>
          ) : (
            <Text style={styles.identityHelp}>Owner or Manager access with writable subscription status is required to edit customer profile metadata.</Text>
          )}

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        </View>

        <View style={styles.detailCard}>
          <Text style={[styles.sectionTitle, appearance.dark && darkStyles.titleText]}>Order history</Text>
          {selected.orders.slice(0, 10).map((order) => (
            <View key={order.id} style={[styles.orderRow, appearance.dark && darkStyles.rowBorder]}>
              <View style={styles.orderCopy}>
                <Text style={styles.orderRef}>{order.publicOrderId}</Text>
                <Text style={styles.meta}>{formatDate(order.createdAt)} · {humanize(order.status)}</Text>
              </View>
              <Text style={[styles.orderAmount, appearance.dark && darkStyles.titleText]}>{order.totalAmount === null ? 'Unpriced' : formatMoney(order.totalAmount, business.currency)}</Text>
            </View>
          ))}
          {selected.orders.length === 0 ? <Text style={styles.muted}>No orders recorded for this customer.</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, appearance.dark && darkStyles.surface]}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>CUSTOMERS</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText, appearance.textSize === 'large' && styles.titleLarge]}>Customer directory</Text>
        <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>Customer history, spend and contact details built from SellerTray order activity.</Text>
      </View>

      <View style={styles.metrics}>
        <Metric icon="people-outline" label="Customers" value={customers.length} />
        <Metric icon="repeat-outline" label="Repeat buyers" value={repeatCustomers} />
        <Metric icon="person-add-outline" label="New · 30 days" value={newCustomers} />
      </View>

      <View style={[styles.searchBox, appearance.dark && darkStyles.input]}>
        <Ionicons name="search-outline" size={19} color={appearance.dark ? '#98A2B3' : '#667085'} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, phone, email or order ref"
          placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
          autoCorrect={false}
          style={[styles.searchInput, appearance.dark && darkStyles.inputText]}
        />
      </View>

      {loading && customers.length === 0 ? (
        <View style={[styles.stateCard, appearance.dark && darkStyles.card]}><ActivityIndicator /><Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Loading customers…</Text></View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && visible.length === 0 ? (
        <View style={[styles.stateCard, appearance.dark && darkStyles.card]}><Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>No customers found</Text><Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Customers appear here after WhatsApp or manual orders are created.</Text></View>
      ) : null}

      <View style={styles.list}>
        {visible.map((customer) => (
          <Pressable
            key={customer.id}
            onPress={() => setSelectedId(customer.id)}
            style={[styles.customerCard, appearance.dark && darkStyles.card]}
          >
            <View style={styles.avatarSmall}>
              <Text style={styles.avatarSmallText}>{customerInitials(customer.displayName || customer.phone || 'Customer')}</Text>
            </View>
            <View style={styles.customerCopy}>
              <View style={styles.customerNameRow}>
                <Text style={[styles.customerName, appearance.dark && darkStyles.titleText]}>{customer.displayName || customer.phone || 'WhatsApp customer'}</Text>
                <Text style={[styles.orderCount, appearance.dark && darkStyles.bodyText]}>{customer.orderCount} order{customer.orderCount === 1 ? '' : 's'}</Text>
              </View>
              <Text style={styles.meta}>{customer.phone || customer.whatsappId}</Text>
              <Text style={[styles.value, appearance.dark && darkStyles.greenText]}>{formatMoney(customer.lifetimeValue, business.currency)} completed value</Text>
              <Text style={styles.meta}>Last order: {customer.lastOrderAt ? formatDate(customer.lastOrderAt) : 'No orders yet'}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={() => void refresh()} disabled={loading} style={styles.refresh}>
        <Text style={styles.refreshText}>{loading ? 'Refreshing…' : 'Refresh customers'}</Text>
      </Pressable>
    </View>
  );
}

function Metric({ icon, label, value, compact = false }: { icon?: string; label: string; value: number | string; compact?: boolean }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.metric, appearance.dark && darkStyles.card]}>
      {icon ? (
        <View style={[styles.metricIcon, appearance.dark && darkStyles.mintCard]}>
          <Ionicons name={icon as never} size={19} color="#079455" />
        </View>
      ) : null}
      <Text numberOfLines={1} style={[styles.metricValue, appearance.dark && darkStyles.titleText, compact && styles.metricValueCompact]}>{value}</Text>
      <Text style={[styles.metricLabel, appearance.dark && darkStyles.bodyText]}>{label}</Text>
    </View>
  );
}

function customerInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ST';
  if (parts.length === 1) return (parts[0] ?? 'ST').slice(0, 2).toUpperCase();
  return `${parts[0]?.charAt(0) ?? ''}${parts[1]?.charAt(0) ?? ''}`.toUpperCase();
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
function humanize(value: string): string {
  return value.split('_').map((part) => part.charAt(0).toUpperCase()+part.slice(1)).join(' ');
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  eyebrow: { color: '#667085', fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 27, lineHeight: 33, fontWeight: '900', marginTop: 3 },
  titleLarge: { fontSize: 30, lineHeight: 37 },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 4 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { flexGrow: 1, flexBasis: '30%', minWidth: 96, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 12 },
  metricIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  metricValue: { color: '#102A43', fontSize: 22, fontWeight: '900' },
  metricValueCompact: { fontSize: 15 },
  metricLabel: { color: '#667085', fontSize: 13, fontWeight: '800', marginTop: 2 },
  searchBox: { minHeight: 50, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 48, color: '#102A43', fontSize: 14, paddingVertical: 0 },
  list: { gap: 8 },
  customerCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 12, gap: 10, flexDirection: 'row', alignItems: 'center' },
  customerCopy: { flex: 1 },
  customerNameRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
  avatarSmall: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#D9FBE8', alignItems: 'center', justifyContent: 'center' },
  avatarSmallText: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  chevron: { color: '#98A2B3', fontSize: 22 },
  backButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', paddingRight: 12 },
  backText: { color: '#079455', fontSize: 13, fontWeight: '900' },
  profileHero: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, padding: 14 },
  avatar: { width: 52, height: 52, borderRadius: 17, backgroundColor: '#D9FBE8', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  profileName: { color: '#102A43', fontSize: 17, fontWeight: '900' },
  customerName: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  meta: { color: '#667085', fontSize: 13, lineHeight: 16, marginTop: 2 },
  orderCount: { color: '#079455', fontSize: 12, fontWeight: '900' },
  value: { color: '#344054', fontSize: 12, fontWeight: '800', marginTop: 4 },
  detailCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, padding: 14, gap: 9 },
  sectionTitle: { color: '#102A43', fontSize: 13, fontWeight: '900', marginTop: 3 },
  identityLabel: { color: '#667085', fontSize: 12, fontWeight: '900' },
  identityValue: { color: '#102A43', fontSize: 13, fontWeight: '800' },
  identityHelp: { color: '#667085', fontSize: 12, lineHeight: 14 },
  fieldLabel: { color: '#344054', fontSize: 12, fontWeight: '900', marginTop: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, paddingHorizontal: 12, color: '#102A43', backgroundColor: '#FFFFFF' },
  primary: { minHeight: 43, borderRadius: 10, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E4E7EC', paddingTop: 8 },
  orderCopy: { flex: 1 },
  orderRef: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  orderAmount: { color: '#344054', fontSize: 12, fontWeight: '900' },
  stateCard: { backgroundColor: '#F8FAFC', borderRadius: 13, padding: 15, gap: 5, alignItems: 'center' },
  emptyTitle: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  muted: { color: '#667085', fontSize: 12, lineHeight: 15 },
  error: { color: '#B42318', fontSize: 12, lineHeight: 15 },
  notice: { color: '#027A48', fontSize: 12, fontWeight: '800' },
  refresh: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  refreshText: { color: '#12B76A', fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  surface: { backgroundColor: '#081825' },
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  mintCard: { backgroundColor: '#12372C' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  greenText: { color: '#6CE9A6' },
  input: { backgroundColor: '#102A43', borderColor: '#475467' },
  inputText: { color: '#F8FAFC' },
  rowBorder: { borderBottomColor: '#344054' },
});
