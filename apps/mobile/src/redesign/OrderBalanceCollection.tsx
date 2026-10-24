import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { loadBranchPosPaymentMethods, type PosPaymentMethod } from '../data/commerceRepository';
import { collectCustomerBalance } from '../data/receivablesRepository';
import type { MerchantOrder } from '../domain/order';
import { orderOutstanding } from '../domain/order';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  order: MerchantOrder;
  currency: string;
  onChanged: () => Promise<void>;
};

export function OrderBalanceCollection({ tenantId, order, currency, onChanged }: Props) {
  const dark = useSellerTrayAppearance().dark;
  const outstanding = orderOutstanding(order) ?? 0;
  const collectible = order.source === 'pos'
    && order.status === 'completed'
    && Boolean(order.customerId)
    && outstanding > 0.005;
  const [open, setOpen] = useState(false);
  const [methods, setMethods] = useState<PosPaymentMethod[]>([]);
  const [methodKey, setMethodKey] = useState('cash');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (order.status !== 'completed' || order.source !== 'pos') return null;
  if (outstanding <= 0.005 && order.amountPaid <= 0.005) return null;

  async function begin() {
    if (!collectible || loading) return;
    setOpen(true);
    setLoading(true);
    setError(null);
    setNotice(null);
    setAmount(formatEditableAmount(outstanding));
    setMethodKey('cash');
    try {
      const rows = await loadBranchPosPaymentMethods(tenantId, order.branchId);
      setMethods(withCash(rows));
    } catch (cause) {
      setMethods(withCash([]));
      setError(cause instanceof Error ? cause.message : 'Unable to load Branch payment methods.');
    } finally {
      setLoading(false);
    }
  }

  async function collect() {
    if (!collectible || saving) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > outstanding + 0.005) {
      setError(`Enter an amount from 0.01 to ${formatMoney(outstanding, currency)}.`);
      return;
    }
    const method = methods.find((row) => paymentKey(row) === methodKey) ?? methods.find((row) => row.methodType === 'cash');
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await collectCustomerBalance({
        tenantId,
        orderId: order.id,
        paymentMethodId: method?.paymentMethodId ?? null,
        amount: value,
      });
      setNotice(result.status === 'pending_verification'
        ? 'Bank payment recorded for verification. A Payment Receipt is available only after confirmation.'
        : 'Customer payment collected. Its Payment Receipt is available under Sale documents.');
      setOpen(false);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to collect this customer payment.');
    } finally {
      setSaving(false);
    }
  }

  return <View style={[styles.panel, dark && darkStyles.panel]}>
    <View style={styles.summaryRow}>
      <View style={styles.summaryItem}><Text style={[styles.label, dark && darkStyles.muted]}>Paid</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={[styles.value, dark && darkStyles.text]}>{formatMoney(order.amountPaid, currency)}</Text></View>
      <View style={[styles.summaryItem, styles.summaryRight]}><Text style={[styles.label, dark && darkStyles.muted]}>Outstanding</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={[styles.value, outstanding > 0.005 && styles.warning, dark && darkStyles.text]}>{formatMoney(outstanding, currency)}</Text></View>
    </View>

    {!order.customerId && outstanding > 0.005 ? <Text style={[styles.helper, dark && darkStyles.muted]}>This legacy balance has no named Customer. Use Merchant Web review before collecting money.</Text> : null}
    {collectible && !open ? <Pressable onPress={() => void begin()} style={[styles.collectButton, dark && darkStyles.outline]}><Ionicons name="cash-outline" size={17} color={theme.colors.greenDark} /><Text style={styles.collectText}>Collect balance</Text></Pressable> : null}
    {notice ? <Text style={[styles.notice, dark && darkStyles.text]}>{notice}</Text> : null}

    {open ? <View style={styles.form}>
      <Text style={[styles.helper, dark && darkStyles.muted]}>Collect against {order.customerName}. Cash confirms immediately; Bank follows the configured verification authority.</Text>
      {loading ? <ActivityIndicator color={theme.colors.greenDark} /> : <>
        <Text style={[styles.label, dark && darkStyles.muted]}>Amount</Text>
        <TextInput value={amount} onChangeText={(value) => setAmount(cleanDecimalInput(value))} keyboardType="decimal-pad" editable={!saving} style={[styles.input, dark && darkStyles.input]} />
        <Text style={[styles.label, dark && darkStyles.muted]}>Payment method</Text>
        <View style={styles.methodRow}>{methods.map((method) => {
          const key = paymentKey(method);
          const selected = key === methodKey;
          return <Pressable key={key} disabled={saving} onPress={() => setMethodKey(key)} style={[styles.methodButton, dark && darkStyles.outline, selected && styles.methodSelected]}><Text style={[styles.methodText, dark && darkStyles.text, selected && styles.methodSelectedText]}>{method.displayName}</Text></Pressable>;
        })}</View>
      </>}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}><Pressable disabled={saving} onPress={() => { setOpen(false); setError(null); }} style={[styles.cancelButton, dark && darkStyles.outline]}><Text style={[styles.cancelText, dark && darkStyles.text]}>Cancel</Text></Pressable><Pressable disabled={saving || loading || methods.length === 0} onPress={() => void collect()} style={[styles.primaryButton, (saving || loading || methods.length === 0) && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.white} /> : null}<Text style={styles.primaryText}>{saving ? 'Recording…' : 'Record payment'}</Text></Pressable></View>
    </View> : null}
  </View>;
}

function withCash(rows: PosPaymentMethod[]): PosPaymentMethod[] {
  return rows.some((row) => row.methodType === 'cash') ? rows : [cashFallback(), ...rows];
}
function cashFallback(): PosPaymentMethod {
  return { paymentMethodId: null, methodType: 'cash', displayName: 'Cash', sortOrder: -1, isDefault: true, bankName: null, bankAccountName: null, bankAccountNumber: null, instructions: null };
}
function paymentKey(method: PosPaymentMethod): string { return method.paymentMethodId ?? 'cash'; }
function formatEditableAmount(value: number): string { return Number(value.toFixed(2)).toString(); }
function cleanDecimalInput(value: string): string { const clean = value.replace(/[^0-9.]/g, ''); const [whole = '', ...rest] = clean.split('.'); return rest.length === 0 ? whole : `${whole}.${rest.join('')}`; }
function formatMoney(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }

const styles = StyleSheet.create({
  panel: { backgroundColor: theme.colors.mint, borderRadius: 14, gap: 10, padding: 11 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, summaryItem: { flex: 1, gap: 2, minWidth: 0 }, summaryRight: { alignItems: 'flex-end' },
  label: { color: theme.colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }, value: { color: theme.colors.navy, flexShrink: 1, fontSize: 14, fontWeight: '900', maxWidth: '100%' }, warning: { color: theme.colors.warning }, helper: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  collectButton: { alignItems: 'center', alignSelf: 'flex-start', borderColor: theme.colors.greenDark, borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingVertical: 9 }, collectText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' }, notice: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '800' },
  form: { gap: 8 }, input: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 10, borderWidth: 1, color: theme.colors.navy, fontSize: 15, fontWeight: '800', minHeight: 44, paddingHorizontal: 11 }, methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, methodButton: { borderColor: theme.colors.border, borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 9 }, methodSelected: { backgroundColor: theme.colors.mintSoft, borderColor: theme.colors.greenDark }, methodText: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' }, methodSelectedText: { color: theme.colors.greenDark },
  error: { color: theme.colors.danger, fontSize: 12, fontWeight: '700', lineHeight: 17 }, actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }, cancelButton: { borderColor: theme.colors.border, borderRadius: 11, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }, cancelText: { color: theme.colors.slate, fontSize: 12, fontWeight: '900' }, primaryButton: { alignItems: 'center', backgroundColor: theme.colors.green, borderRadius: 11, flexDirection: 'row', gap: 6, paddingHorizontal: 13, paddingVertical: 9 }, primaryText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' }, disabled: { opacity: 0.55 },
});
const darkStyles = StyleSheet.create({ panel: { backgroundColor: '#162F46' }, input: { backgroundColor: '#081825', borderColor: '#344054', color: theme.colors.white }, outline: { borderColor: '#344054' }, text: { color: theme.colors.white }, muted: { color: '#D0D5DD' } });
