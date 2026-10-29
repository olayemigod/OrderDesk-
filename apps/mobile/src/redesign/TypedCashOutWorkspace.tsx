import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SellerTrayText as Text } from '../components/SellerTrayText';
import { loadActiveCashShift, type CashShift } from '../data/cashShiftRepository';
import type { CommerceBranch } from '../data/commerceRepository';
import {
  loadMoneyOperationOptions,
  recordTypedCashOut,
  type BusinessBankAccount,
  type CashOutType,
} from '../data/moneyRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { createCashMovementCommandId, createOperationalReference } from './operationalReference';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  activeShift: CashShift | null;
  onClose: () => void;
  onShiftChanged: (shift: CashShift | null) => void;
};

export function TypedCashOutWorkspace({ tenantId, branch, activeShift, onClose, onShiftChanged }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [cashOutType, setCashOutType] = useState<CashOutType>('bank_deposit');
  const [bankAccounts, setBankAccounts] = useState<BusinessBankAccount[]>([]);
  const [bankPaymentMethodId, setBankPaymentMethodId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState(() => createOperationalReference('cash_out'));
  const [reason, setReason] = useState('');
  const [commandId, setCommandId] = useState(() => createCashMovementCommandId('cash_out'));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void loadMoneyOperationOptions(tenantId, branch.id)
      .then((options) => {
        if (!alive) return;
        setBankAccounts(options.bankAccounts);
        setBankPaymentMethodId((current) => options.bankAccounts.some((entry) => entry.id === current)
          ? current
          : options.bankAccounts[0]?.id ?? '');
      })
      .catch((cause) => {
        if (alive) setError(errorMessage(cause, 'Unable to load Business bank accounts.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [tenantId, branch.id]);

  function chooseType(next: CashOutType) {
    setCashOutType(next);
    setError(null);
    setNotice(null);
  }

  function resetForm() {
    setAmount('');
    setReference(createOperationalReference('cash_out'));
    setReason('');
    setCommandId(createCashMovementCommandId('cash_out'));
  }

  async function submit() {
    if (saving) return;
    if (!activeShift || activeShift.status !== 'open') {
      setError('Open a cashier shift before recording Cash Out.');
      return;
    }
    const parsed = Number(amount.replace(/,/g, '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return setError('Enter an amount greater than zero.');
    if (cashOutType === 'bank_deposit' && !bankPaymentMethodId) {
      return setError('Choose the Business bank account receiving this deposit.');
    }
    if (!reference.trim()) return setError('Enter a reference for this Cash Out.');
    if (!reason.trim()) return setError('Enter a reason for this Cash Out.');
    if (!commandId) return setError('Restart this Cash Out and try again.');

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recordTypedCashOut({
        tenantId,
        shiftId: activeShift.shiftId,
        cashOutType,
        bankPaymentMethodId: cashOutType === 'bank_deposit' ? bankPaymentMethodId : null,
        amount: parsed,
        reference,
        reason,
        commandId,
      });
      const nextShift = await loadActiveCashShift(tenantId, branch.id);
      onShiftChanged(nextShift);
      setNotice(result.idempotentReplay
        ? 'This Cash Out was already recorded.'
        : cashOutType === 'bank_deposit'
          ? 'Bank Deposit recorded. Drawer cash was reduced once; this is not an operating expense.'
          : 'Owner Withdrawal recorded. Drawer cash was reduced once; this is not an operating expense.');
      resetForm();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to record this Cash Out.'));
    } finally {
      setSaving(false);
    }
  }

  const submitDisabled = saving || !activeShift || (cashOutType === 'bank_deposit' && !bankPaymentMethodId);

  return <View style={styles.stack}>
    <Pressable onPress={onClose} style={styles.backButton}>
      <Ionicons name="chevron-back" size={19} color={dark ? theme.dark.text : theme.colors.navy} />
      <Text style={[styles.backText, dark && darkStyles.titleText]}>More</Text>
    </Pressable>

    <View style={styles.heading}>
      <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>CASH OUT</Text>
      <Text style={[styles.title, dark && darkStyles.titleText]}>Move cash out of the drawer</Text>
      <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>Choose what happened so SellerTray keeps transfers, withdrawals and expenses separate in reporting.</Text>
    </View>

    {error ? <Message text={error} error dark={dark} /> : null}
    {notice ? <Message text={notice} dark={dark} /> : null}

    {!activeShift ? <Card dark={dark}>
      <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>No open cashier shift</Text>
      <Text style={[styles.helper, dark && darkStyles.bodyText]}>Open your Cash & Shift drawer first. Cash Out always belongs to a real open drawer.</Text>
    </Card> : null}

    <Card dark={dark}>
      <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Cash Out type</Text>
      <View style={styles.choiceRow}>
        <Choice label="Bank Deposit" active={cashOutType === 'bank_deposit'} onPress={() => chooseType('bank_deposit')} dark={dark} />
        <Choice label="Owner Withdrawal" active={cashOutType === 'owner_withdrawal'} onPress={() => chooseType('owner_withdrawal')} dark={dark} />
      </View>
      <Text style={[styles.helper, dark && darkStyles.bodyText]}>{cashOutType === 'bank_deposit'
        ? 'Cash moves from the drawer to a governed Business bank account. It is not an operating expense.'
        : 'Cash leaves the drawer for the owner. It is not an operating expense.'}</Text>
    </Card>

    {cashOutType === 'bank_deposit' ? <Card dark={dark}>
      <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Destination Business bank account</Text>
      {loading ? <View style={styles.loadingRow}><ActivityIndicator /><Text style={[styles.helper, dark && darkStyles.bodyText]}>Loading bank accounts…</Text></View>
        : bankAccounts.length === 0 ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>No enabled Business bank account is available. An Owner or Manager must configure one in Merchant Web before recording a Bank Deposit.</Text>
          : <View style={styles.bankList}>{bankAccounts.map((bank) => {
            const selected = bankPaymentMethodId === bank.id;
            return <Pressable
              key={bank.id}
              onPress={() => setBankPaymentMethodId(bank.id)}
              style={[
                styles.bankChoice,
                dark && darkStyles.bankChoice,
                selected && (dark ? darkStyles.bankChoiceActive : styles.bankChoiceActive),
              ]}
            >
              <View style={styles.flexOne}>
                <Text style={[styles.bankTitle, dark && darkStyles.titleText]}>{bank.displayName}</Text>
                <Text style={[styles.helper, dark && darkStyles.bodyText]}>{[bank.bankName, bank.accountNumber].filter(Boolean).join(' · ')}</Text>
              </View>
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected
                  ? (dark ? theme.dark.accentText : theme.colors.greenDark)
                  : (dark ? theme.dark.textSubtle : theme.colors.muted)}
              />
            </Pressable>;
          })}</View>}
    </Card> : null}

    <Card dark={dark}>
      <Field label="Amount" dark={dark}><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} /></Field>
      <Field label="Reference" dark={dark}><TextInput value={reference} onChangeText={setReference} style={[styles.input, dark && darkStyles.input]} /></Field>
      <Field label="Reason" dark={dark}><TextInput value={reason} onChangeText={setReason} multiline placeholder={cashOutType === 'bank_deposit' ? 'e.g. Deposit daily takings' : 'e.g. Owner cash withdrawal'} placeholderTextColor={theme.colors.subtle} style={[styles.input, styles.multiline, dark && darkStyles.input]} /></Field>
      <Pressable
        disabled={submitDisabled}
        onPress={() => void submit()}
        style={[styles.primaryButton, submitDisabled && styles.disabled, dark && submitDisabled && darkStyles.disabled]}
      >
        {saving ? <ActivityIndicator color={theme.colors.white} /> : null}
        <Text style={[styles.primaryText, submitDisabled && styles.disabledText, dark && submitDisabled && darkStyles.disabledText]}>
          {saving ? 'Recording…' : cashOutType === 'bank_deposit' ? 'Record Bank Deposit' : 'Record Owner Withdrawal'}
        </Text>
      </Pressable>
    </Card>
  </View>;
}

function Card({ children, dark }: { children: React.ReactNode; dark: boolean }) {
  return <View style={[styles.card, dark && darkStyles.card]}>{children}</View>;
}
function Choice({ label, active, onPress, dark }: { label: string; active: boolean; onPress: () => void; dark: boolean }) {
  return <Pressable
    onPress={onPress}
    style={[styles.choice, dark && darkStyles.choice, active && (dark ? darkStyles.choiceActive : styles.choiceActive)]}
  >
    <Text style={[
      styles.choiceText,
      dark && darkStyles.bodyText,
      active && styles.choiceTextActive,
      dark && active && darkStyles.choiceTextActive,
    ]}>{label}</Text>
  </Pressable>;
}
function Field({ label, dark, children }: { label: string; dark: boolean; children: React.ReactNode }) {
  return <View style={styles.field}><Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>{label}</Text>{children}</View>;
}
function Message({ text, error = false, dark }: { text: string; error?: boolean; dark: boolean }) {
  return <View style={[styles.message, error ? styles.errorMessage : styles.noticeMessage, dark && darkStyles.subtleCard]}><Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={19} color={error ? theme.colors.danger : theme.colors.green} /><Text style={[styles.messageText, dark && darkStyles.bodyText]}>{text}</Text></View>;
}
function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

const styles = StyleSheet.create({
  stack: { gap: 14 },
  backButton: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 4, paddingVertical: 4 },
  backText: { color: theme.colors.navy, fontSize: 13, fontWeight: '800' },
  heading: { gap: 4 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: theme.colors.navy, fontSize: 26, fontWeight: '900' },
  subtitle: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 18, borderWidth: 1, gap: 11, padding: 14 },
  sectionTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  helper: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderColor: theme.colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  choiceActive: { backgroundColor: theme.colors.mintSoft, borderColor: theme.colors.green },
  choiceText: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  choiceTextActive: { color: theme.colors.greenDark },
  loadingRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  bankList: { gap: 8 },
  bankChoice: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 11 },
  bankChoiceActive: { backgroundColor: theme.colors.mintSoft, borderColor: theme.colors.green },
  bankTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  flexOne: { flex: 1 },
  field: { gap: 6 },
  fieldLabel: { color: theme.colors.slate, fontSize: 12, fontWeight: '900' },
  input: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, color: theme.colors.navy, fontSize: 14, minHeight: 44, paddingHorizontal: 11, paddingVertical: 10 },
  multiline: { minHeight: 74, textAlignVertical: 'top' },
  primaryButton: { alignItems: 'center', backgroundColor: theme.colors.green, borderRadius: 12, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14, paddingVertical: 10 },
  primaryText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  disabled: { backgroundColor: '#D0D5DD' },
  disabledText: { color: theme.colors.muted },
  message: { alignItems: 'flex-start', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 11 },
  errorMessage: { backgroundColor: theme.colors.dangerSoft },
  noticeMessage: { backgroundColor: theme.colors.mintSoft },
  messageText: { color: theme.colors.slate, flex: 1, fontSize: 12, lineHeight: 17 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  subtleCard: { backgroundColor: theme.dark.surfaceSubtle },
  input: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.border, color: theme.dark.text },
  choice: { borderColor: theme.dark.border },
  choiceActive: { backgroundColor: theme.dark.accentSoft, borderColor: theme.colors.green },
  choiceTextActive: { color: theme.dark.accentText },
  bankChoice: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  bankChoiceActive: { backgroundColor: theme.dark.accentSoft, borderColor: theme.colors.green },
  disabled: { backgroundColor: theme.dark.disabledSurface },
  disabledText: { color: theme.dark.disabledText },
  titleText: { color: theme.dark.text },
  bodyText: { color: theme.dark.textMuted },
});
