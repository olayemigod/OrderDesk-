import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { PosPaymentMethod } from '../data/commerceRepository';
import {
  checkoutPosPaymentAllocations,
  createPosPaymentCommandId,
  type PosAllocationCheckoutResult,
  type PosPaymentPolicy,
} from '../data/posPaymentRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  orderId: string;
  amountDue: number;
  currency: string;
  paymentMethods: PosPaymentMethod[];
  policy: PosPaymentPolicy;
  disabled?: boolean;
  onResult: (result: PosAllocationCheckoutResult) => void;
  onError: (message: string) => void;
};

export function PosPaymentAllocator({
  tenantId,
  orderId,
  amountDue,
  currency,
  paymentMethods,
  policy,
  disabled = false,
  onResult,
  onError,
}: Props) {
  const dark = useSellerTrayAppearance().dark;
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [payLater, setPayLater] = useState(false);
  const [commandId, setCommandId] = useState(() => createPosPaymentCommandId());
  const [submitting, setSubmitting] = useState(false);

  const methods = useMemo(() => {
    const hasCash = paymentMethods.some((method) => method.methodType === 'cash');
    return hasCash ? paymentMethods : [cashFallback(), ...paymentMethods];
  }, [paymentMethods]);

  useEffect(() => {
    const defaultMethod = methods.find((method) => method.isDefault) ?? methods[0];
    if (!defaultMethod || amountDue <= 0) return;
    setAmounts((current) => Object.keys(current).length
      ? current
      : { [paymentKey(defaultMethod)]: formatEditableAmount(amountDue) });
  }, [amountDue, methods]);

  const allocations = useMemo(() => methods.flatMap((method) => {
    const parsed = Number(amounts[paymentKey(method)] ?? 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return [];
    return [{
      method,
      amount: Number(parsed.toFixed(2)),
      confirmNow: method.methodType === 'cash' || policy.manualConfirmationMode === 'branch_operator',
    }];
  }), [amounts, methods, policy.manualConfirmationMode]);

  const allocated = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const outstanding = Math.max(0, Number((amountDue - allocated).toFixed(2)));
  const overAllocated = allocated > amountDue + 0.005;
  const splitBlocked = allocations.length > 1 && !policy.allowSplitPayments;
  const partialBlocked = allocated > 0 && outstanding > 0.005 && !policy.allowPartialPayments;
  const payLaterBlocked = payLater && !policy.allowPayLater;
  const emptyBlocked = allocated <= 0 && !payLater;
  const canSubmit = !disabled && !submitting && !overAllocated && !splitBlocked
    && !partialBlocked && !payLaterBlocked && !emptyBlocked;

  function changeAmount(method: PosPaymentMethod, value: string) {
    const clean = value.replace(/[^0-9.]/g, '');
    setAmounts((current) => ({ ...current, [paymentKey(method)]: clean }));
    setPayLater(false);
    setCommandId(createPosPaymentCommandId());
    onError('');
  }

  function useRemaining(method: PosPaymentMethod) {
    const key = paymentKey(method);
    const otherTotal = methods.reduce((sum, candidate) => {
      if (paymentKey(candidate) === key) return sum;
      const parsed = Number(amounts[paymentKey(candidate)] ?? 0);
      return sum + (Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    }, 0);
    const remaining = Math.max(0, Number((amountDue - otherTotal).toFixed(2)));
    setAmounts((current) => ({ ...current, [key]: formatEditableAmount(remaining) }));
    setPayLater(false);
    setCommandId(createPosPaymentCommandId());
    onError('');
  }

  function choosePayLater() {
    if (!policy.allowPayLater) return;
    setAmounts({});
    setPayLater(true);
    setCommandId(createPosPaymentCommandId());
    onError('');
  }

  function confirmCheckout() {
    if (!canSubmit) return;
    if (payLater) {
      Alert.alert(
        'Complete without payment?',
        `This sale will complete with ${formatMoney(amountDue, currency)} outstanding because Pay later is enabled in SellerTray settings.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Complete sale', onPress: () => void submitCheckout() },
        ],
      );
      return;
    }

    const manualNow = allocations.filter((allocation) => allocation.method.methodType !== 'cash' && allocation.confirmNow);
    const pendingManager = allocations.filter((allocation) => allocation.method.methodType !== 'cash' && !allocation.confirmNow);
    const messageParts = [
      allocated > 0 ? `Record ${formatMoney(allocated, currency)} across ${allocations.length} payment method${allocations.length === 1 ? '' : 's'}.` : '',
      outstanding > 0.005 ? `${formatMoney(outstanding, currency)} will remain outstanding.` : '',
      manualNow.length ? 'Confirm only after the transfer has arrived or the terminal shows approval.' : '',
      pendingManager.length ? 'Configured manual payments will remain awaiting payment-manager confirmation.' : '',
    ].filter(Boolean);
    Alert.alert(
      outstanding > 0.005 ? 'Complete with partial payment?' : 'Confirm payment?',
      messageParts.join(' '),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => void submitCheckout() },
      ],
    );
  }

  async function submitCheckout() {
    if (!canSubmit) return;
    setSubmitting(true);
    onError('');
    try {
      const result = await checkoutPosPaymentAllocations({
        tenantId,
        orderId,
        commandId,
        payLater,
        allocations: allocations.map((allocation) => ({
          paymentMethodId: allocation.method.paymentMethodId,
          amount: allocation.amount,
          confirmNow: allocation.confirmNow,
        })),
      });
      onResult(result);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to process this payment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.stack}>
      <View style={styles.summaryRow}>
        <View>
          <Text style={[styles.label, dark && styles.darkMuted]}>Allocated</Text>
          <Text style={[styles.summaryValue, dark && styles.darkText]}>{formatMoney(allocated, currency)}</Text>
        </View>
        <View style={styles.summaryRight}>
          <Text style={[styles.label, dark && styles.darkMuted]}>Outstanding</Text>
          <Text style={[styles.summaryValue, outstanding > 0.005 && styles.warningText, dark && styles.darkText, dark && outstanding > 0.005 && styles.darkWarningText]}>{formatMoney(outstanding, currency)}</Text>
        </View>
      </View>

      {methods.map((method) => {
        const key = paymentKey(method);
        return (
          <View key={key} style={[styles.methodCard, dark && styles.darkCard]}>
            <View style={styles.methodHeading}>
              <View style={[styles.methodIcon, dark && styles.darkMethodIcon]}>
                <Ionicons
                  name={method.methodType === 'cash' ? 'cash-outline' : method.methodType === 'card_terminal' ? 'card-outline' : 'business-outline'}
                  size={21}
                  color={dark ? theme.colors.green : theme.colors.greenDark}
                />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.methodName, dark && styles.darkText]}>{method.displayName}</Text>
                <Text style={[styles.methodNote, dark && styles.darkMuted]}>{paymentDescription(method, policy)}</Text>
              </View>
            </View>
            <View style={styles.amountRow}>
              <Text style={[styles.currency, dark && styles.darkText]}>{currency}</Text>
              <TextInput
                value={amounts[key] ?? ''}
                onChangeText={(value) => changeAmount(method, value)}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={theme.colors.subtle}
                editable={!disabled && !submitting && !payLater}
                style={[styles.amountInput, dark && styles.darkInput]}
              />
              <Pressable
                disabled={disabled || submitting || payLater}
                onPress={() => useRemaining(method)}
                style={styles.remainingButton}
              >
                <Text style={[styles.remainingText, dark && styles.darkAccentText]}>Use remaining</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {policy.allowPayLater ? (
        <Pressable
          disabled={disabled || submitting}
          onPress={choosePayLater}
          style={[
            styles.payLater,
            dark && styles.darkPayLater,
            payLater && (dark ? styles.darkPayLaterActive : styles.payLaterActive),
          ]}
        >
          <Ionicons
            name={payLater ? 'checkmark-circle' : 'time-outline'}
            size={21}
            color={payLater
              ? (dark ? theme.dark.accentText : theme.colors.greenDark)
              : (dark ? theme.dark.textMuted : theme.colors.navy)}
          />
          <View style={styles.flex}>
            <Text style={[styles.methodName, dark && styles.darkText]}>Pay later</Text>
            <Text style={[styles.methodNote, dark && styles.darkMuted]}>Complete this sale with the full balance outstanding.</Text>
          </View>
        </Pressable>
      ) : null}

      {splitBlocked ? <Text style={styles.errorText}>Split payment is disabled in SellerTray settings.</Text> : null}
      {partialBlocked ? <Text style={styles.errorText}>Partial payment is disabled in SellerTray settings.</Text> : null}
      {overAllocated ? <Text style={styles.errorText}>Payment allocations are more than the amount due.</Text> : null}
      {policy.manualConfirmationMode === 'payment_manager' ? (
        <Text style={[styles.policyNote, dark && styles.darkMuted]}>Bank transfer and terminal payments are recorded for payment-manager confirmation. Cash remains a cashier-confirmed drawer payment.</Text>
      ) : (
        <Text style={[styles.policyNote, dark && styles.darkMuted]}>Branch operators may confirm received bank/terminal payments at checkout. This can be changed on Merchant Web.</Text>
      )}

      <Pressable
        disabled={!canSubmit}
        onPress={confirmCheckout}
        style={[styles.primaryButton, !canSubmit && styles.disabled, dark && !canSubmit && styles.darkDisabled]}
      >
        {submitting ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.white} />}
        <Text style={styles.primaryText}>{submitting ? 'Processing…' : buttonLabel({ allocated, outstanding, payLater, currency })}</Text>
      </Pressable>
    </View>
  );
}

function paymentKey(method: PosPaymentMethod): string {
  return method.paymentMethodId ?? 'cash';
}
function cashFallback(): PosPaymentMethod {
  return {
    paymentMethodId: null,
    methodType: 'cash',
    displayName: 'Cash',
    sortOrder: -1,
    isDefault: true,
    bankName: null,
    bankAccountName: null,
    bankAccountNumber: null,
    instructions: null,
  };
}
function paymentDescription(method: PosPaymentMethod, policy: PosPaymentPolicy): string {
  if (method.methodType === 'cash') return 'Physical drawer cash';
  const authority = policy.manualConfirmationMode === 'branch_operator'
    ? 'Confirm received at checkout'
    : 'Payment manager confirms received funds';
  if (method.methodType === 'card_terminal') return `Payment terminal · ${authority}`;
  return `${method.bankName ?? 'Bank transfer'} · ${authority}`;
}
function formatEditableAmount(value: number): string {
  return Number(value.toFixed(2)).toString();
}
function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}
function buttonLabel(input: { allocated: number; outstanding: number; payLater: boolean; currency: string }): string {
  if (input.payLater) return `Complete · ${formatMoney(input.outstanding, input.currency)} outstanding`;
  if (input.outstanding > 0.005) return `Complete partial · ${formatMoney(input.outstanding, input.currency)} outstanding`;
  return `Confirm ${formatMoney(input.allocated, input.currency)}`;
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  flex: { flex: 1 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 4 },
  summaryRight: { alignItems: 'flex-end' },
  label: { fontSize: 12, fontWeight: '700', color: theme.colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryValue: { marginTop: 3, fontSize: 20, fontWeight: '800', color: theme.colors.navy },
  warningText: { color: theme.colors.warning },
  methodCard: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 12, backgroundColor: theme.colors.white, gap: 10 },
  methodHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  methodIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  methodName: { fontSize: 15, fontWeight: '800', color: theme.colors.navy },
  methodNote: { marginTop: 2, fontSize: 12, lineHeight: 17, color: theme.colors.muted },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currency: { fontSize: 13, fontWeight: '800', color: theme.colors.slate },
  amountInput: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, paddingHorizontal: 12, fontSize: 16, fontWeight: '700', color: theme.colors.navy, backgroundColor: theme.colors.cloud },
  remainingButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  remainingText: { fontSize: 12, fontWeight: '800', color: theme.colors.greenDark },
  payLater: { flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 12 },
  payLaterActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  policyNote: { fontSize: 12, lineHeight: 18, color: theme.colors.muted },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: theme.colors.danger },
  primaryButton: { minHeight: 50, borderRadius: theme.radius.md, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  primaryText: { color: theme.colors.white, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  darkCard: { backgroundColor: theme.dark.surfaceRaised, borderColor: theme.dark.border },
  darkInput: { backgroundColor: theme.dark.surface, borderColor: theme.dark.borderStrong, color: theme.dark.text },
  darkMethodIcon: { backgroundColor: theme.dark.accentSoft },
  darkPayLater: { borderColor: theme.dark.borderStrong },
  darkPayLaterActive: { borderColor: theme.colors.green, backgroundColor: theme.dark.accentSoft },
  darkDisabled: { backgroundColor: theme.dark.disabledSurface },
  darkText: { color: theme.dark.text },
  darkMuted: { color: theme.dark.textMuted },
  darkAccentText: { color: theme.dark.accentText },
  darkWarningText: { color: theme.dark.warningText },
});
