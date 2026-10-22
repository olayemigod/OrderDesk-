import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { PosPaymentMethod } from '../data/commerceRepository';
import type { OfflinePaymentPlan } from '../data/offlineSalesRepository';
import { createPosPaymentCommandId, type PosPaymentPolicy } from '../data/posPaymentRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

const REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/;

type Props = {
  amountDue: number;
  currency: string;
  paymentMethods: PosPaymentMethod[];
  policy: PosPaymentPolicy;
  disabled?: boolean;
  onQueue: (plan: OfflinePaymentPlan) => Promise<void> | void;
  onCancel: () => void;
  onError: (message: string | null) => void;
};

export function OfflinePosPaymentAllocator({
  amountDue,
  currency,
  paymentMethods,
  policy,
  disabled = false,
  onQueue,
  onCancel,
  onError,
}: Props) {
  const dark = useSellerTrayAppearance().dark;
  const methods = useMemo(() => {
    const rows = [...paymentMethods];
    if (!rows.some((method) => method.methodType === 'cash')) {
      rows.unshift({
        paymentMethodId: null,
        methodType: 'cash',
        displayName: 'Cash',
        sortOrder: -1,
        isDefault: rows.length === 0,
        bankName: null,
        bankAccountName: null,
        bankAccountNumber: null,
        instructions: null,
      });
    }
    return rows.sort((left, right) => left.sortOrder - right.sortOrder);
  }, [paymentMethods]);
  const defaultMethod = methods.find((method) => method.isDefault) ?? methods[0];
  const [amounts, setAmounts] = useState<Record<string, string>>(() => defaultMethod ? { [methodKey(defaultMethod)]: editableMoney(amountDue) } : {});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [payLater, setPayLater] = useState(false);
  const [busy, setBusy] = useState(false);

  const parsedAllocations = methods.flatMap((method) => {
    const amount = Number(amounts[methodKey(method)] ?? 0);
    return Number.isFinite(amount) && amount > 0 ? [{ method, amount: roundMoney(amount) }] : [];
  });
  const allocated = roundMoney(parsedAllocations.reduce((sum, row) => sum + row.amount, 0));
  const outstanding = roundMoney(Math.max(0, amountDue - allocated));

  function setMethodAmount(method: PosPaymentMethod, raw: string) {
    const key = methodKey(method);
    const clean = raw.replace(/[^0-9.]/g, '');
    setAmounts((current) => {
      if (policy.allowSplitPayments) return { ...current, [key]: clean };
      const next: Record<string, string> = {};
      for (const candidate of methods) next[methodKey(candidate)] = candidate === method ? clean : '';
      return next;
    });
    onError(null);
  }

  function useBalance(method: PosPaymentMethod) {
    const key = methodKey(method);
    const others = policy.allowSplitPayments
      ? parsedAllocations.filter((row) => methodKey(row.method) !== key).reduce((sum, row) => sum + row.amount, 0)
      : 0;
    setMethodAmount(method, editableMoney(Math.max(0, amountDue - others)));
  }

  async function queue() {
    if (disabled || busy) return;
    onError(null);
    if (allocated > amountDue + 0.005) {
      onError('Payment allocations exceed the amount due.');
      return;
    }
    if (parsedAllocations.length > 1 && !policy.allowSplitPayments) {
      onError('Split payment is disabled in SellerTray settings.');
      return;
    }
    if (allocated < amountDue - 0.005) {
      if (allocated <= 0.005) {
        if (!payLater || !policy.allowPayLater) {
          onError('Add a payment or choose Pay later.');
          return;
        }
      } else if (!policy.allowPartialPayments) {
        onError('Partial payment is disabled in SellerTray settings.');
        return;
      } else if (payLater && !policy.allowPayLater) {
        onError('Pay later is disabled in SellerTray settings.');
        return;
      }
    }
    if (payLater && allocated >= amountDue - 0.005) {
      onError('Pay later is unnecessary when the sale is fully allocated.');
      return;
    }

    const capturedAt = new Date().toISOString();
    const allocations = parsedAllocations.map(({ method, amount }) => {
      const key = methodKey(method);
      const providerReference = method.methodType === 'cash' ? null : (references[key] ?? '').trim();
      if (method.methodType !== 'cash' && (!providerReference || providerReference.length > 128 || !REFERENCE_PATTERN.test(providerReference))) {
        throw new Error(`Enter the ${method.methodType === 'bank_transfer' ? 'Bank transfer' : 'Card/terminal'} reference for ${method.displayName}.`);
      }
      return {
        paymentMethodId: method.paymentMethodId,
        amount,
        confirmNow: method.methodType === 'cash'
          ? true
          : method.methodType === 'bank_transfer'
            ? false
            : policy.manualConfirmationMode === 'branch_operator',
        providerReference,
        capturedAt,
        methodSnapshot: {
          paymentMethodId: method.paymentMethodId,
          methodType: method.methodType,
          displayName: method.displayName,
          bankName: method.bankName,
          bankAccountName: method.bankAccountName,
          bankAccountNumber: method.bankAccountNumber,
          instructions: method.instructions,
        },
      };
    });

    setBusy(true);
    try {
      await onQueue({
        checkoutCommandId: createPosPaymentCommandId(),
        payLater,
        allocations,
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'This offline payment could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, dark && darkStyles.card]}>
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <Text style={[styles.title, dark && darkStyles.title]}>Offline payment</Text>
          <Text style={[styles.body, dark && darkStyles.body]}>Use the same cached payment methods and SellerTray payment policy. Non-cash references are preserved for governed replay.</Text>
        </View>
        <Ionicons name="cloud-offline-outline" size={24} color={dark ? theme.dark.warningText : theme.colors.warning} />
      </View>

      {methods.map((method) => {
        const key = methodKey(method);
        const active = Number(amounts[key] ?? 0) > 0;
        const nonCash = method.methodType !== 'cash';
        return (
          <View key={key} style={[styles.methodCard, dark && darkStyles.methodCard, active && (dark ? darkStyles.methodActive : styles.methodActive)]}>
            <View style={styles.headerRow}>
              <View style={styles.flex}>
                <Text style={[styles.methodName, dark && darkStyles.title]}>{method.displayName}</Text>
                <Text style={[styles.body, dark && darkStyles.body]}>{methodLabel(method)}</Text>
              </View>
              <Pressable onPress={() => useBalance(method)} style={[styles.balanceButton, dark && darkStyles.balanceButton]}>
                <Text style={[styles.balanceText, dark && darkStyles.accentText]}>Use balance</Text>
              </Pressable>
            </View>
            {method.methodType === 'bank_transfer' && (method.bankName || method.bankAccountNumber) ? (
              <View style={[styles.details, dark && darkStyles.details]}>
                {method.bankName ? <Text style={[styles.methodName, dark && darkStyles.title]}>{method.bankName}</Text> : null}
                {method.bankAccountName ? <Text style={[styles.body, dark && darkStyles.body]}>{method.bankAccountName}</Text> : null}
                {method.bankAccountNumber ? <Text selectable style={[styles.account, dark && darkStyles.title]}>{method.bankAccountNumber}</Text> : null}
              </View>
            ) : null}
            <View>
              <Text style={[styles.label, dark && darkStyles.body]}>Amount</Text>
              <TextInput
                keyboardType="decimal-pad"
                value={amounts[key] ?? ''}
                onChangeText={(value) => setMethodAmount(method, value)}
                placeholder="0.00"
                placeholderTextColor={theme.colors.subtle}
                style={[styles.input, dark && darkStyles.input]}
              />
            </View>
            {nonCash && active ? (
              <View>
                <Text style={[styles.label, dark && darkStyles.body]}>{method.methodType === 'bank_transfer' ? 'Transfer reference' : 'Terminal / approval reference'}</Text>
                <TextInput
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={references[key] ?? ''}
                  onChangeText={(value) => setReferences((current) => ({ ...current, [key]: value.replace(/\s/g, '') }))}
                  placeholder={method.methodType === 'bank_transfer' ? 'e.g. NIP123456789' : 'e.g. POS987654321'}
                  placeholderTextColor={theme.colors.subtle}
                  maxLength={128}
                  style={[styles.input, dark && darkStyles.input]}
                />
                <Text style={[styles.helper, dark && darkStyles.body]}>
                  {method.methodType === 'bank_transfer'
                    ? 'The transfer remains verification-required when SellerTray reconnects.'
                    : policy.manualConfirmationMode === 'branch_operator'
                      ? 'SellerTray will replay the terminal evidence under the configured Branch-operator confirmation policy.'
                      : 'SellerTray will replay this as pending until an authorised payment manager confirms it.'}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}

      <View style={[styles.summary, dark && darkStyles.details]}>
        <View><Text style={[styles.body, dark && darkStyles.body]}>Allocated</Text><Text style={[styles.summaryValue, dark && darkStyles.title]}>{formatMoney(allocated, currency)}</Text></View>
        <View><Text style={[styles.body, dark && darkStyles.body]}>Outstanding</Text><Text style={[styles.summaryValue, dark && darkStyles.title]}>{formatMoney(outstanding, currency)}</Text></View>
      </View>

      {policy.allowPayLater ? (
        <Pressable onPress={() => setPayLater((value) => !value)} style={[styles.payLater, dark && darkStyles.methodCard, payLater && (dark ? darkStyles.methodActive : styles.methodActive)]}>
          <Ionicons name={payLater ? 'checkbox' : 'square-outline'} size={22} color={dark ? theme.dark.accentText : theme.colors.greenDark} />
          <View style={styles.flex}>
            <Text style={[styles.methodName, dark && darkStyles.title]}>Pay later</Text>
            <Text style={[styles.body, dark && darkStyles.body]}>Keep the remaining balance outstanding when this sale syncs.</Text>
          </View>
        </Pressable>
      ) : null}

      {!policy.allowSplitPayments ? <Text style={[styles.helper, dark && darkStyles.body]}>Split payment is disabled by the merchant POS policy.</Text> : null}
      {!policy.allowPartialPayments ? <Text style={[styles.helper, dark && darkStyles.body]}>Partial payment is disabled by the merchant POS policy.</Text> : null}

      <Pressable disabled={disabled || busy} onPress={() => void queue()} style={[styles.primary, (disabled || busy) && styles.disabled]}>
        {busy ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="save-outline" size={19} color={theme.colors.white} />}
        <Text style={styles.primaryText}>{busy ? 'Saving payment…' : 'Record offline sale'}</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={onCancel} style={[styles.secondary, dark && darkStyles.secondary]}>
        <Text style={[styles.secondaryText, dark && darkStyles.accentText]}>Keep cart</Text>
      </Pressable>
    </View>
  );
}

function methodKey(method: PosPaymentMethod): string { return method.paymentMethodId ?? 'cash'; }
function methodLabel(method: PosPaymentMethod): string {
  if (method.methodType === 'cash') return 'Physical cash';
  if (method.methodType === 'bank_transfer') return 'Bank transfer';
  return 'Card / terminal';
}
function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function editableMoney(value: number): string { return Number(roundMoney(value).toFixed(2)).toString(); }
function formatMoney(value: number, currency: string): string { try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }

const styles = StyleSheet.create({
  card: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 12 },
  headerRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.navy, fontSize: 17, fontWeight: '900' },
  body: { color: theme.colors.muted, fontSize: 11, lineHeight: 17 },
  methodCard: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 11, gap: 9, backgroundColor: theme.colors.white },
  methodActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  methodName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  balanceButton: { minHeight: 32, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.pill, paddingHorizontal: 10, justifyContent: 'center' },
  balanceText: { color: theme.colors.greenDark, fontSize: 10, fontWeight: '900' },
  details: { borderRadius: 10, padding: 9, gap: 2, backgroundColor: theme.colors.cloud },
  account: { color: theme.colors.navy, fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  label: { color: theme.colors.muted, fontSize: 10, fontWeight: '800', marginBottom: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, backgroundColor: theme.colors.white, color: theme.colors.navy, paddingHorizontal: 11 },
  helper: { color: theme.colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  summary: { borderRadius: theme.radius.md, padding: 11, flexDirection: 'row', justifyContent: 'space-between', gap: 12, backgroundColor: theme.colors.cloud },
  summaryValue: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  payLater: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  primary: { minHeight: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  primaryText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  secondary: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  methodCard: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.borderStrong },
  methodActive: { backgroundColor: theme.dark.accentSoft, borderColor: theme.dark.accentText },
  title: { color: theme.dark.text },
  body: { color: theme.dark.textMuted },
  accentText: { color: theme.dark.accentText },
  balanceButton: { borderColor: theme.dark.borderStrong },
  details: { backgroundColor: theme.dark.surfaceRaised },
  input: { backgroundColor: theme.dark.surfaceRaised, borderColor: theme.dark.borderStrong, color: theme.dark.text },
  secondary: { borderColor: theme.dark.borderStrong },
});
