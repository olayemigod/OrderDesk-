import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import {
  loadCustomers,
  updateCustomerProfile,
  type MerchantCustomer,
} from '../data/customerRepository';

export function CustomersView({ business }: { business: MerchantBusiness }) {
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

  if (selected) {
    return (
      <View style={styles.wrap}>
        <Pressable onPress={() => setSelectedId('')} style={styles.backButton}>
          <Text style={styles.backText}>← Customers</Text>
        </Pressable>

        <View style={styles.profileHero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{customerInitials(selected.displayName || selected.phone || 'Customer')}</Text>
          </View>
          <View style={styles.customerCopy}>
            <Text style={styles.profileName}>{selected.displayName || selected.phone || 'WhatsApp customer'}</Text>
            <Text style={styles.meta}>{selected.phone || selected.whatsappId}</Text>
            {selected.email ? <Text style={styles.meta}>{selected.email}</Text> : null}
          </View>
        </View>

        <View style={styles.metrics}>
          <Metric label="Orders" value={selected.orderCount} />
          <Metric label="Completed value" value={formatMoney(selected.lifetimeValue, business.currency)} compact />
        </View>

        <View style={styles.detailCard}>
          <Text style={styles.sectionTitle}>Customer profile</Text>
          <Text style={styles.identityLabel}>WhatsApp / phone identity</Text>
          <Text style={styles.identityValue}>{selected.phone || selected.whatsappId}</Text>
          <Text style={styles.identityHelp}>Read-only. SellerTray uses this identity to keep WhatsApp order history linked correctly.</Text>

          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput value={displayName} onChangeText={setDisplayName} editable={canEdit && !busy} maxLength={120} style={styles.input} />

          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} editable={canEdit && !busy} autoCapitalize="none" keyboardType="email-address" maxLength={254} style={styles.input} />

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
          <Text style={styles.sectionTitle}>Order history</Text>
          {selected.orders.slice(0, 10).map((order) => (
            <View key={order.id} style={styles.orderRow}>
              <View style={styles.orderCopy}>
                <Text style={styles.orderRef}>{order.publicOrderId}</Text>
                <Text style={styles.meta}>{formatDate(order.createdAt)} · {humanize(order.status)}</Text>
              </View>
              <Text style={styles.orderAmount}>{order.totalAmount === null ? 'Unpriced' : formatMoney(order.totalAmount, business.currency)}</Text>
            </View>
          ))}
          {selected.orders.length === 0 ? <Text style={styles.muted}>No orders recorded for this customer.</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View>
        <Text style={styles.eyebrow}>CUSTOMERS</Text>
        <Text style={styles.title}>Customer directory</Text>
        <Text style={styles.subtitle}>Customer history, spend and contact details built from SellerTray order activity.</Text>
      </View>

      <View style={styles.metrics}>
        <Metric label="Customers" value={customers.length} />
        <Metric label="Repeat customers" value={repeatCustomers} />
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search name, phone, email or order ref"
        autoCorrect={false}
        style={styles.search}
      />

      {loading && customers.length === 0 ? (
        <View style={styles.stateCard}><ActivityIndicator /><Text style={styles.muted}>Loading customers…</Text></View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && visible.length === 0 ? (
        <View style={styles.stateCard}><Text style={styles.emptyTitle}>No customers found</Text><Text style={styles.muted}>Customers appear here after WhatsApp or manual orders are created.</Text></View>
      ) : null}

      <View style={styles.list}>
        {visible.map((customer) => (
          <Pressable
            key={customer.id}
            onPress={() => setSelectedId(customer.id)}
            style={styles.customerCard}
          >
            <View style={styles.avatarSmall}>
              <Text style={styles.avatarSmallText}>{customerInitials(customer.displayName || customer.phone || 'Customer')}</Text>
            </View>
            <View style={styles.customerCopy}>
              <View style={styles.customerNameRow}>
                <Text style={styles.customerName}>{customer.displayName || customer.phone || 'WhatsApp customer'}</Text>
                <Text style={styles.orderCount}>{customer.orderCount} order{customer.orderCount === 1 ? '' : 's'}</Text>
              </View>
              <Text style={styles.meta}>{customer.phone || customer.whatsappId}</Text>
              <Text style={styles.value}>{formatMoney(customer.lifetimeValue, business.currency)} completed value</Text>
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

function Metric({ label, value, compact = false }: { label: string; value: number | string; compact?: boolean }) {
  return (
    <View style={styles.metric}>
      <Text numberOfLines={1} style={[styles.metricValue, compact && styles.metricValueCompact]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
  eyebrow: { color: '#667085', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 24, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 11, lineHeight: 17, marginTop: 4 },
  metrics: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12 },
  metricValue: { color: '#102A43', fontSize: 20, fontWeight: '900' },
  metricValueCompact: { fontSize: 15 },
  metricLabel: { color: '#667085', fontSize: 9, fontWeight: '800', marginTop: 2 },
  search: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 12, color: '#102A43' },
  list: { gap: 8 },
  customerCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 12, gap: 10, flexDirection: 'row', alignItems: 'center' },
  customerCopy: { flex: 1 },
  customerNameRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
  avatarSmall: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#D9FBE8', alignItems: 'center', justifyContent: 'center' },
  avatarSmallText: { color: '#102A43', fontSize: 11, fontWeight: '900' },
  chevron: { color: '#98A2B3', fontSize: 22 },
  backButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', paddingRight: 12 },
  backText: { color: '#079455', fontSize: 13, fontWeight: '900' },
  profileHero: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, padding: 14 },
  avatar: { width: 52, height: 52, borderRadius: 17, backgroundColor: '#D9FBE8', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  profileName: { color: '#102A43', fontSize: 17, fontWeight: '900' },
  customerName: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  meta: { color: '#667085', fontSize: 9, lineHeight: 14, marginTop: 2 },
  orderCount: { color: '#079455', fontSize: 9, fontWeight: '900' },
  value: { color: '#344054', fontSize: 10, fontWeight: '800', marginTop: 4 },
  detailCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, padding: 14, gap: 9 },
  sectionTitle: { color: '#102A43', fontSize: 13, fontWeight: '900', marginTop: 3 },
  identityLabel: { color: '#667085', fontSize: 9, fontWeight: '900' },
  identityValue: { color: '#102A43', fontSize: 11, fontWeight: '800' },
  identityHelp: { color: '#667085', fontSize: 9, lineHeight: 14 },
  fieldLabel: { color: '#344054', fontSize: 9, fontWeight: '900', marginTop: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, paddingHorizontal: 12, color: '#102A43', backgroundColor: '#FFFFFF' },
  primary: { minHeight: 43, borderRadius: 10, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E4E7EC', paddingTop: 8 },
  orderCopy: { flex: 1 },
  orderRef: { color: '#102A43', fontSize: 10, fontWeight: '900' },
  orderAmount: { color: '#344054', fontSize: 10, fontWeight: '900' },
  stateCard: { backgroundColor: '#F8FAFC', borderRadius: 13, padding: 15, gap: 5, alignItems: 'center' },
  emptyTitle: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  muted: { color: '#667085', fontSize: 10, lineHeight: 15 },
  error: { color: '#B42318', fontSize: 10, lineHeight: 15 },
  notice: { color: '#027A48', fontSize: 10, fontWeight: '800' },
  refresh: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  refreshText: { color: '#12B76A', fontSize: 10, fontWeight: '900' },
  disabled: { opacity: 0.5 },
});
