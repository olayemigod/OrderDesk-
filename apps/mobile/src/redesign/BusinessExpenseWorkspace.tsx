import { useEffect, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SellerTrayText as Text } from '../components/SellerTrayText';
import type { CommerceBranch } from '../data/commerceRepository';
import {
  loadMoneyOperationOptions,
  recordBusinessExpense,
  type BusinessBankAccount,
  type BusinessExpenseFundingSource,
  type OpenCashDrawer,
} from '../data/moneyRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { createCashMovementCommandId, createOperationalReference } from './operationalReference';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  onClose: () => void;
};

export function BusinessExpenseWorkspace({ tenantId, branch, onClose }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [fundingSource, setFundingSource] = useState<BusinessExpenseFundingSource>('cash');
  const [bankAccounts, setBankAccounts] = useState<BusinessBankAccount[]>([]);
  const [cashDrawers, setCashDrawers] = useState<OpenCashDrawer[]>([]);
  const [bankPaymentMethodId, setBankPaymentMethodId] = useState('');
  const [cashShiftId, setCashShiftId] = useState('');
  const [canRecord, setCanRecord] = useState(false);
  const [expenseCategory, setExpenseCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState(() => createOperationalReference('expense'));
  const [reason, setReason] = useState('');
  const [commandId, setCommandId] = useState(() => createCashMovementCommandId('expense'));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const options = await loadMoneyOperationOptions(tenantId, branch.id);
      setCanRecord(options.canRecordBusinessExpense);
      setBankAccounts(options.bankAccounts);
      setCashDrawers(options.openCashDrawers);
      setBankPaymentMethodId((current) => options.bankAccounts.some((entry) => entry.id === current)
        ? current
        : options.bankAccounts[0]?.id ?? '');
      setCashShiftId((current) => options.openCashDrawers.some((entry) => entry.shiftId === current)
        ? current
        : options.openCashDrawers[0]?.shiftId ?? '');
    } catch (cause) {
      setCanRecord(false);
      setBankAccounts([]);
      setCashDrawers([]);
      setError(errorMessage(cause, 'Unable to load Business Expense options.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantId, branch.id]);

  function resetForm() {
    setExpenseCategory('');
    setAmount('');
    setReference(createOperationalReference('expense'));
    setReason('');
    setCommandId(createCashMovementCommandId('expense'));
  }

  async function submit() {
    if (saving) return;
    if (!canRecord) return setError('Only an authorised Owner or Manager can record Business Expenses.');
    const parsed = Number(amount.replace(/,/g, '').trim());
    if (!expenseCategory.trim()) return setError('Enter an expense category.');
    if (!Number.isFinite(parsed) || parsed <= 0) return setError('Enter an amount greater than zero.');
    if (!reference.trim()) return setError('Enter a reference for this Business Expense.');
    if (!reason.trim()) return setError('Enter a reason for this Business Expense.');
    if (fundingSource === 'bank' && !bankPaymentMethodId) return setError('Choose the Business bank account paying this expense.');
    if (fundingSource === 'cash' && !cashShiftId) return setError('Choose the open cash drawer paying this expense.');
    if (!commandId) return setError('Restart this Business Expense and try again.');

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recordBusinessExpense({
        tenantId,
        branchId: branch.id,
        fundingSource,
        paymentMethodId: fundingSource === 'bank' ? bankPaymentMethodId : null,
        cashShiftId: fundingSource === 'cash' ? cashShiftId : null,
        expenseCategory,
        amount: parsed,
        reference,
        reason,
        commandId,
      });
      setNotice(result.idempotentReplay
        ? 'This Business Expense was already recorded.'
        : fundingSource === 'cash'
          ? 'Business Expense recorded. SellerTray reduced the selected drawer exactly once.'
          : 'Business Expense recorded from the selected Business bank account.');
      resetForm();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to record this Business Expense.'));
    } finally {
      setSaving(false);
    }
  }

  const selectedDrawer = cashDrawers.find((entry) => entry.shiftId === cashShiftId) ?? null;

  return <View style={styles.stack}>
    <Pressable onPress={onClose} style={styles.backButton}>
      <Ionicons name="chevron-back" size={19} color={dark ? theme.colors.white : theme.colors.navy} />
      <Text style={[styles.backText, dark && darkStyles.titleText]}>More</Text>
    </Pressable>

    <View style={styles.heading}>
      <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>BUSINESS EXPENSE</Text>
      <Text style={[styles.title, dark && darkStyles.titleText]}>Record business spending</Text>
      <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>For Owners and Managers. Cash and Bank funding use the same governed money core as Merchant Web.</Text>
    </View>

    {error ? <Message text={error} error dark={dark} /> : null}
    {notice ? <Message text={notice} dark={dark} /> : null}

    {loading ? <Card dark={dark}><View style={styles.loadingRow}><ActivityIndicator /><Text style={[styles.helper, dark && darkStyles.bodyText]}>Loading funding options…</Text></View></Card> : null}
    {!loading && !canRecord ? <Card dark={dark}><Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Management authority required</Text><Text style={[styles.helper, dark && darkStyles.bodyText]}>Business Expenses are available only to an authorised Owner or Manager for this Branch.</Text></Card> : null}

    {!loading && canRecord ? <>
      <Card dark={dark}>
        <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Funding source</Text>
        <View style={styles.choiceRow}>
          <Choice label="Cash" active={fundingSource === 'cash'} onPress={() => { setFundingSource('cash'); setError(null); setNotice(null); }} dark={dark} />
          <Choice label="Bank" active={fundingSource === 'bank'} onPress={() => { setFundingSource('bank'); setError(null); setNotice(null); }} dark={dark} />
        </View>
        <Text style={[styles.helper, dark && darkStyles.bodyText]}>{fundingSource === 'cash'
          ? 'SellerTray records one operating expense and one matching drawer effect atomically.'
          : 'The expense is charged to the selected Business bank account and does not change drawer cash.'}</Text>
      </Card>

      {fundingSource === 'cash' ? <Card dark={dark}>
        <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Open cash drawer</Text>
        {cashDrawers.length === 0 ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>No open cash drawer is available in {branch.name}. Open a cashier shift or use Bank funding.</Text>
          : <View style={styles.optionList}>{cashDrawers.map((drawer) => <Pressable key={drawer.shiftId} onPress={() => setCashShiftId(drawer.shiftId)} style={[styles.optionChoice, dark && darkStyles.optionChoice, cashShiftId === drawer.shiftId && styles.optionChoiceActive]}>
            <View style={styles.flexOne}><Text style={[styles.optionTitle, dark && darkStyles.titleText]}>{drawer.registerName}</Text><Text style={[styles.helper, dark && darkStyles.bodyText]}>Expected drawer {formatMoney(drawer.expectedCash, 'NGN')}</Text></View>
            <Ionicons name={cashShiftId === drawer.shiftId ? 'radio-button-on' : 'radio-button-off'} size={20} color={cashShiftId === drawer.shiftId ? theme.colors.greenDark : theme.colors.muted} />
          </Pressable>)}</View>}
        {selectedDrawer ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>Selected drawer currently expects {formatMoney(selectedDrawer.expectedCash, 'NGN')}.</Text> : null}
      </Card> : <Card dark={dark}>
        <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Business bank account</Text>
        {bankAccounts.length === 0 ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>No enabled Business bank account is available. Configure one in Merchant Web first.</Text>
          : <View style={styles.optionList}>{bankAccounts.map((bank) => <Pressable key={bank.id} onPress={() => setBankPaymentMethodId(bank.id)} style={[styles.optionChoice, dark && darkStyles.optionChoice, bankPaymentMethodId === bank.id && styles.optionChoiceActive]}>
            <View style={styles.flexOne}><Text style={[styles.optionTitle, dark && darkStyles.titleText]}>{bank.displayName}</Text><Text style={[styles.helper, dark && darkStyles.bodyText]}>{[bank.bankName, bank.accountNumber].filter(Boolean).join(' · ')}</Text></View>
            <Ionicons name={bankPaymentMethodId === bank.id ? 'radio-button-on' : 'radio-button-off'} size={20} color={bankPaymentMethodId === bank.id ? theme.colors.greenDark : theme.colors.muted} />
          </Pressable>)}</View>}
      </Card>}

      <Card dark={dark}>
        <Field label="Expense category" dark={dark}><TextInput value={expenseCategory} onChangeText={setExpenseCategory} placeholder="e.g. Utilities" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} /></Field>
        <Field label="Amount" dark={dark}><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} /></Field>
        <Field label="Reference" dark={dark}><TextInput value={reference} onChangeText={setReference} style={[styles.input, dark && darkStyles.input]} /></Field>
        <Field label="Reason" dark={dark}><TextInput value={reason} onChangeText={setReason} multiline placeholder="What was this expense for?" placeholderTextColor={theme.colors.subtle} style={[styles.input, styles.multiline, dark && darkStyles.input]} /></Field>
        <Pressable disabled={saving || (fundingSource === 'cash' ? !cashShiftId : !bankPaymentMethodId)} onPress={() => void submit()} style={[styles.primaryButton, (saving || (fundingSource === 'cash' ? !cashShiftId : !bankPaymentMethodId)) && styles.disabled]}>
          {saving ? <ActivityIndicator color={theme.colors.white} /> : null}
          <Text style={styles.primaryText}>{saving ? 'Recording…' : 'Record Business Expense'}</Text>
        </Pressable>
      </Card>
    </> : null}
  </View>;
}

function Card({ children, dark }: { children: ReactNode; dark: boolean }) {
  return <View style={[styles.card, dark && darkStyles.card]}>{children}</View>;
}
function Choice({ label, active, onPress, dark }: { label: string; active: boolean; onPress: () => void; dark: boolean }) {
  return <Pressable onPress={onPress} style={[styles.choice, dark && darkStyles.choice, active && styles.choiceActive]}><Text style={[styles.choiceText, dark && darkStyles.bodyText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}
function Field({ label, dark, children }: { label: string; dark: boolean; children: ReactNode }) {
  return <View style={styles.field}><Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>{label}</Text>{children}</View>;
}
function Message({ text, error = false, dark }: { text: string; error?: boolean; dark: boolean }) {
  return <View style={[styles.message, error ? styles.errorMessage : styles.noticeMessage, dark && darkStyles.subtleCard]}><Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={19} color={error ? theme.colors.danger : theme.colors.greenDark} /><Text style={[styles.messageText, dark && darkStyles.bodyText]}>{text}</Text></View>;
}
function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function formatMoney(value: number, currency: string): string {
  try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}

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
  loadingRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderColor: theme.colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  choiceActive: { backgroundColor: theme.colors.mintSoft, borderColor: theme.colors.green },
  choiceText: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  choiceTextActive: { color: theme.colors.greenDark },
  optionList: { gap: 8 },
  optionChoice: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 11 },
  optionChoiceActive: { backgroundColor: theme.colors.mintSoft, borderColor: theme.colors.green },
  optionTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  flexOne: { flex: 1 },
  field: { gap: 6 },
  fieldLabel: { color: theme.colors.slate, fontSize: 12, fontWeight: '900' },
  input: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, color: theme.colors.navy, fontSize: 14, minHeight: 44, paddingHorizontal: 11, paddingVertical: 10 },
  multiline: { minHeight: 74, textAlignVertical: 'top' },
  primaryButton: { alignItems: 'center', backgroundColor: theme.colors.green, borderRadius: 12, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14, paddingVertical: 10 },
  primaryText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  message: { alignItems: 'flex-start', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 11 },
  errorMessage: { backgroundColor: theme.colors.dangerSoft },
  noticeMessage: { backgroundColor: theme.colors.mintSoft },
  messageText: { color: theme.colors.slate, flex: 1, fontSize: 12, lineHeight: 17 },
});
const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46' },
  input: { backgroundColor: '#162F46', borderColor: '#344054', color: theme.colors.white },
  choice: { borderColor: '#344054' },
  optionChoice: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  titleText: { color: theme.colors.white },
  bodyText: { color: '#D0D5DD' },
});
