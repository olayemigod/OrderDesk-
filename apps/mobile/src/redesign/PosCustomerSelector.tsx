import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { loadCustomers, type MerchantCustomer } from '../data/customerRepository';
import { isLikelyConnectivityError, loadCustomerCache, saveCustomerCache } from '../data/offlineSalesRepository';
import { sellerTrayUserMessage } from '../data/userFacingError';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

export type PosCustomerSelection = {
  id: string | null;
  name: string | null;
  phone: string | null;
};

type Props = {
  tenantId: string;
  value: PosCustomerSelection | null;
  onChange: (value: PosCustomerSelection | null) => void;
  disabled?: boolean;
};

export function PosCustomerSelector({ tenantId, value, onChange, disabled = false }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [customers, setCustomers] = useState<MerchantCustomer[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadCustomers(tenantId)
      .then(async (rows) => { const filtered = rows.filter((row) => row.whatsappId !== 'pos:walk-in'); await saveCustomerCache(tenantId, filtered).catch(() => undefined); if (active) setCustomers(filtered); })
      .catch(async (cause) => { if (!active) return; if (isLikelyConnectivityError(cause)) { const cached = await loadCustomerCache(tenantId); if (cached) { setCustomers(cached.data); setError(null); return; } } setError(sellerTrayUserMessage(cause, 'Customer list is unavailable right now.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId]);

  const normalized = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!normalized) return customers.slice(0, 12);
    return customers.filter((customer) => [
      customer.displayName ?? '',
      customer.phone ?? '',
      customer.whatsappId ?? '',
      customer.email ?? '',
    ].join(' ').toLowerCase().includes(normalized)).slice(0, 20);
  }, [customers, normalized]);

  function selectCustomer(customer: MerchantCustomer) {
    onChange({
      id: customer.id,
      name: customer.displayName?.trim() || customer.phone || 'Customer',
      phone: customer.phone,
    });
    setShowSearch(false);
    setShowNew(false);
    setQuery('');
  }

  function useNewCustomer() {
    const name = newName.trim().replace(/\s+/g, ' ');
    const phone = normalizePhone(newPhone);
    if (!name) {
      setError('Enter the customer name.');
      return;
    }
    if (!phone) {
      setError('Enter a valid customer phone number.');
      return;
    }
    setError(null);
    onChange({ id: null, name, phone });
    setShowNew(false);
    setShowSearch(false);
  }

  const label = value
    ? value.name || value.phone || 'Customer'
    : 'Walk-in Customer';
  const detail = value
    ? value.phone || (value.id ? 'Existing customer' : 'New customer')
    : 'No customer details required';

  return (
    <View style={styles.stack}>
      <View style={[styles.selectedCard, dark && darkStyles.card]}>
        <View style={styles.iconWrap}>
          <Ionicons name={value ? 'person-outline' : 'walk-outline'} size={20} color={theme.colors.greenDark} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.name, dark && darkStyles.titleText]}>{label}</Text>
          <Text style={[styles.detail, dark && darkStyles.bodyText]}>{detail}</Text>
        </View>
        {value ? (
          <Pressable disabled={disabled} onPress={() => onChange(null)} style={styles.walkInButton}>
            <Text style={styles.walkInText}>Use walk-in</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        <Pressable
          disabled={disabled}
          onPress={() => { setShowSearch((current) => !current); setShowNew(false); setError(null); }}
          style={[styles.secondaryButton, disabled && styles.disabled]}
        >
          <Ionicons name="search-outline" size={17} color={theme.colors.navy} />
          <Text style={styles.secondaryText}>Find customer</Text>
        </Pressable>
        <Pressable
          disabled={disabled}
          onPress={() => { setShowNew((current) => !current); setShowSearch(false); setError(null); }}
          style={[styles.secondaryButton, disabled && styles.disabled]}
        >
          <Ionicons name="person-add-outline" size={17} color={theme.colors.navy} />
          <Text style={styles.secondaryText}>New customer</Text>
        </Pressable>
      </View>

      {showSearch ? (
        <View style={[styles.panel, dark && darkStyles.card]}>
          <View style={[styles.searchBox, dark && darkStyles.input]}>
            <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search name or phone"
              placeholderTextColor={theme.colors.subtle}
              autoCorrect={false}
              style={[styles.input, dark && darkStyles.inputText]}
            />
          </View>
          {loading ? <ActivityIndicator /> : null}
          {!loading && visible.length === 0 ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>No matching customer.</Text> : null}
          {visible.map((customer) => (
            <Pressable key={customer.id} onPress={() => selectCustomer(customer)} style={[styles.customerRow, dark && darkStyles.subtleCard]}>
              <View style={styles.flex}>
                <Text style={[styles.customerName, dark && darkStyles.titleText]}>{customer.displayName?.trim() || customer.phone || 'Customer'}</Text>
                <Text style={[styles.customerMeta, dark && darkStyles.bodyText]}>{customer.phone || 'No phone saved'}{customer.orderCount ? ` · ${customer.orderCount} order${customer.orderCount === 1 ? '' : 's'}` : ''}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {showNew ? (
        <View style={[styles.panel, dark && darkStyles.card]}>
          <Text style={[styles.panelTitle, dark && darkStyles.titleText]}>Customer details</Text>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Customer name"
            placeholderTextColor={theme.colors.subtle}
            style={[styles.textField, dark && darkStyles.input, dark && darkStyles.inputText]}
          />
          <TextInput
            value={newPhone}
            onChangeText={setNewPhone}
            placeholder="Phone number"
            placeholderTextColor={theme.colors.subtle}
            keyboardType="phone-pad"
            style={[styles.textField, dark && darkStyles.input, dark && darkStyles.inputText]}
          />
          <Text style={[styles.helper, dark && darkStyles.bodyText]}>
            SellerTray creates the customer only when this sale is prepared. If one existing customer already uses the phone, that customer is reused.
          </Text>
          <Pressable disabled={disabled} onPress={useNewCustomer} style={[styles.primaryButton, disabled && styles.disabled]}>
            <Text style={styles.primaryText}>Use this customer</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function normalizePhone(value: string): string | null {
  const clean = value.trim().replace(/[\s()-]/g, '');
  return /^\+?[0-9]{7,15}$/.test(clean) ? clean : null;
}

const styles = StyleSheet.create({
  stack: { gap: 9 },
  flex: { flex: 1, minWidth: 0 },
  selectedCard: { minHeight: 62, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  name: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  detail: { color: theme.colors.muted, fontSize: 10.5, marginTop: 2 },
  walkInButton: { minHeight: 34, paddingHorizontal: 8, justifyContent: 'center' },
  walkInText: { color: theme.colors.greenDark, fontSize: 10.5, fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 8 },
  secondaryButton: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 11, backgroundColor: theme.colors.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  secondaryText: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' },
  panel: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, padding: 10, gap: 8 },
  panelTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  searchBox: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 11, backgroundColor: theme.colors.white, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flex: 1, minHeight: 42, color: theme.colors.navy, fontSize: 12 },
  textField: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 11, backgroundColor: theme.colors.white, paddingHorizontal: 11, color: theme.colors.navy, fontSize: 12 },
  customerRow: { minHeight: 50, borderRadius: 10, backgroundColor: '#F9FAFB', padding: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  customerName: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  customerMeta: { color: theme.colors.muted, fontSize: 10, marginTop: 2 },
  helper: { color: theme.colors.muted, fontSize: 10.5, lineHeight: 16 },
  primaryButton: { minHeight: 42, borderRadius: 11, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  primaryText: { color: theme.colors.white, fontSize: 11, fontWeight: '900' },
  error: { color: theme.colors.danger, fontSize: 10.5, lineHeight: 16, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46' },
  input: { backgroundColor: '#162F46', borderColor: '#475467' },
  inputText: { color: theme.colors.cloud },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});
