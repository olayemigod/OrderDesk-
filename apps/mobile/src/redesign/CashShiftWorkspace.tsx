import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { SellerTrayText as Text } from '../components/SellerTrayText';
import type { CommerceBranch } from '../data/commerceRepository';
import {
  closeCashShift,
  correctCashMovement,
  loadActiveCashShift,
  loadCashCorrectionAuthority,
  loadCashRegisters,
  loadCashShift,
  loadCashShiftCapabilities,
  loadCashWriteAccess,
  loadExpenseCategoryOptions,
  openCashShift,
  recordCashMovement,
  reviewCashShift,
  type CashCorrectionKind,
  type CashMovementType,
  type CashRegister,
  type CashShift,
  type CashShiftCapabilities,
  type CashShiftMovement,
  type ShiftPaymentSummary,
  type ShiftReviewDecision,
} from '../data/cashShiftRepository';
import { loadCashShiftHistory, type CashShiftHistoryRow } from '../data/cashShiftHistoryRepository';
import type { ExpenseCategoryOption } from '../data/moneyRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { createCashMovementCommandId, createOperationalReference } from './operationalReference';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  onClose: () => void;
  onShiftChanged?: (shift: CashShift | null) => void;
};

const NO_CAPABILITIES: CashShiftCapabilities = {
  canOpenShift: false,
  canRecordCashMovement: false,
  canRecordExpense: false,
  canCloseShift: false,
  canReviewShift: false,
};

export function CashShiftWorkspace({ tenantId, branch, onClose, onShiftChanged }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryOption[]>([]);
  const [capabilities, setCapabilities] = useState<CashShiftCapabilities>(NO_CAPABILITIES);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  const [canCorrectCashMovement, setCanCorrectCashMovement] = useState(false);
  const [shift, setShift] = useState<CashShift | null>(null);
  const [history, setHistory] = useState<CashShiftHistoryRow[]>([]);
  const [reviewShift, setReviewShift] = useState<CashShift | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedRegisterId, setSelectedRegisterId] = useState('');
  const [openingCash, setOpeningCash] = useState('0');
  const [movementMode, setMovementMode] = useState<CashMovementType | null>(null);
  const [movementCommandId, setMovementCommandId] = useState('');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReference, setMovementReference] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [correctionMovement, setCorrectionMovement] = useState<CashShiftMovement | null>(null);
  const [correctionKind, setCorrectionKind] = useState<CashCorrectionKind>('replace');
  const [correctionCommandId, setCorrectionCommandId] = useState('');
  const [correctionType, setCorrectionType] = useState<CashMovementType>('cash_in');
  const [correctionAmount, setCorrectionAmount] = useState('');
  const [correctionReference, setCorrectionReference] = useState('');
  const [correctionActivityReason, setCorrectionActivityReason] = useState('');
  const [correctionExpenseCategoryId, setCorrectionExpenseCategoryId] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [closeMode, setCloseMode] = useState(false);
  const [declaredCash, setDeclaredCash] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [reviewDecision, setReviewDecision] = useState<ShiftReviewDecision>('accepted');
  const [reviewNote, setReviewNote] = useState('');

  async function refresh(options?: { quiet?: boolean }) {
    if (!options?.quiet) setLoading(true);
    setError(null);
    const [registerResult, categoryResult, capabilityResult, writeResult, correctionResult, shiftResult, historyResult] = await Promise.allSettled([
      loadCashRegisters(tenantId, branch.id),
      loadExpenseCategoryOptions(tenantId),
      loadCashShiftCapabilities(tenantId, branch.id),
      loadCashWriteAccess(tenantId),
      loadCashCorrectionAuthority(tenantId, branch.id),
      loadActiveCashShift(tenantId, branch.id),
      loadCashShiftHistory(tenantId, branch.id, 30),
    ] as const);
    const errors: string[] = [];

    if (registerResult.status === 'fulfilled') {
      setRegisters(registerResult.value);
      setSelectedRegisterId((current) => registerResult.value.some((entry) => entry.id === current)
        ? current
        : registerResult.value.find((entry) => entry.isDefault)?.id ?? registerResult.value[0]?.id ?? '');
    } else {
      setRegisters([]);
      setSelectedRegisterId('');
      errors.push('Unable to refresh registers.');
    }

    if (categoryResult.status === 'fulfilled') {
      setExpenseCategories(categoryResult.value);
      setExpenseCategoryId((current) => categoryResult.value.some((entry) => entry.id === current)
        ? current
        : categoryResult.value[0]?.id ?? '');
      setCorrectionExpenseCategoryId((current) => categoryResult.value.some((entry) => entry.id === current)
        ? current
        : categoryResult.value[0]?.id ?? '');
    } else {
      setExpenseCategories([]);
      setExpenseCategoryId('');
      setCorrectionExpenseCategoryId('');
      errors.push('Unable to refresh Expense Categories.');
    }

    if (capabilityResult.status === 'fulfilled') {
      setCapabilities(capabilityResult.value);
      setCapabilitiesLoaded(true);
    } else {
      setCapabilities(NO_CAPABILITIES);
      setCapabilitiesLoaded(false);
      errors.push('Unable to confirm cashier permissions.');
    }

    if (writeResult.status === 'fulfilled') setCanWrite(writeResult.value);
    else {
      setCanWrite(null);
      errors.push('Unable to confirm whether cashier actions are available.');
    }

    if (correctionResult.status === 'fulfilled') setCanCorrectCashMovement(correctionResult.value);
    else {
      setCanCorrectCashMovement(false);
      errors.push('Unable to confirm cash correction permission.');
    }

    if (shiftResult.status === 'fulfilled') {
      setShift(shiftResult.value);
      onShiftChanged?.(shiftResult.value);
    } else {
      setShift(null);
      errors.push('Unable to refresh the current cashier shift.');
    }

    if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
    else {
      setHistory([]);
      errors.push('Unable to refresh cashier history.');
    }

    if (errors.length) setError(errors.join(' '));
    if (!options?.quiet) setLoading(false);
  }

  useEffect(() => {
    setShift(null);
    setHistory([]);
    setExpenseCategories([]);
    setExpenseCategoryId('');
    setCorrectionExpenseCategoryId('');
    setCapabilities(NO_CAPABILITIES);
    setCapabilitiesLoaded(false);
    setCanWrite(null);
    setCanCorrectCashMovement(false);
    setReviewShift(null);
    setCloseMode(false);
    closeMovement();
    closeCorrection();
    void refresh();
  }, [tenantId, branch.id]);

  const closedForReview = useMemo(() => history.filter((entry) => entry.status === 'closed'), [history]);

  async function handleOpenShift() {
    if (saving) return;
    if (canWrite !== true) return setError(readOnlyMessage('open a cashier shift'));
    const amount = parseCashInput(openingCash);
    if (!selectedRegisterId) return setError('Choose a register before opening the shift.');
    if (amount === null || amount < 0) return setError('Enter a valid opening cash amount.');
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await openCashShift({ tenantId, branchId: branch.id, registerId: selectedRegisterId, openingCash: amount });
      await refresh({ quiet: true });
      setNotice(result.idempotentReplay ? 'This shift is already open.' : 'Shift opened.');
    } catch (err) {
      setError(errorMessage(err, 'Unable to open this shift.'));
    } finally {
      setSaving(false);
    }
  }

  function beginMovement(type: CashMovementType) {
    closeCorrection();
    setMovementMode(type);
    setMovementCommandId(createCashMovementCommandId(type));
    setMovementAmount('');
    setMovementReference(createOperationalReference(type));
    setMovementReason('');
    setExpenseCategoryId(type === 'expense' ? expenseCategories[0]?.id ?? '' : '');
    setCloseMode(false);
    setError(null);
    setNotice(null);
  }

  function closeMovement() {
    if (saving) return;
    setMovementMode(null);
    setMovementCommandId('');
  }

  async function handleMovement() {
    if (!shift || !movementMode || saving) return;
    if (canWrite !== true) return setError(readOnlyMessage('record cash activity'));
    const amount = parseCashInput(movementAmount);
    if (!movementCommandId) return setError('Restart this cash activity and try again.');
    if (amount === null || amount <= 0) return setError('Enter an amount greater than zero.');
    if (!movementReference.trim()) return setError('Enter a reference for this cash activity.');
    if (!movementReason.trim()) return setError('Enter a reason for this cash activity.');
    if (movementMode === 'expense' && !expenseCategoryId) return setError('Choose an Expense Category.');

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recordCashMovement({
        tenantId,
        shiftId: shift.shiftId,
        movementType: movementMode,
        commandId: movementCommandId,
        amount,
        reference: movementReference,
        reason: movementReason,
        expenseCategoryId: movementMode === 'expense' ? expenseCategoryId : null,
      });
      closeMovement();
      await refresh({ quiet: true });
      setNotice(result.idempotentReplay ? 'This cash activity was already recorded.' : `${movementLabel(result.movementType)} recorded.`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to record this cash activity.'));
    } finally {
      setSaving(false);
    }
  }

  function beginCorrection(movement: CashShiftMovement, kind: CashCorrectionKind) {
    closeMovement();
    setCorrectionMovement(movement);
    setCorrectionKind(kind);
    setCorrectionCommandId(createCashMovementCommandId(movement.movementType));
    setCorrectionType(movement.movementType);
    setCorrectionAmount(formatQuantity(movement.amount));
    setCorrectionReference(movement.reference);
    setCorrectionActivityReason(movement.reason);
    setCorrectionExpenseCategoryId(
      movement.movementType === 'expense' && movement.expenseCategoryId
        && expenseCategories.some((category) => category.id === movement.expenseCategoryId)
        ? movement.expenseCategoryId
        : movement.movementType === 'expense'
          ? expenseCategories[0]?.id ?? ''
          : '',
    );
    setCorrectionReason('');
    setCloseMode(false);
    setError(null);
    setNotice(null);
  }

  function chooseCorrectionType(type: CashMovementType) {
    setCorrectionType(type);
    setCorrectionExpenseCategoryId((current) => type === 'expense'
      ? expenseCategories.some((category) => category.id === current)
        ? current
        : expenseCategories[0]?.id ?? ''
      : '');
  }

  function closeCorrection() {
    if (saving) return;
    setCorrectionMovement(null);
    setCorrectionCommandId('');
    setCorrectionReason('');
  }

  async function handleCorrection() {
    if (!shift || !correctionMovement || saving) return;
    if (canWrite !== true) return setError(readOnlyMessage('correct cash activity'));
    if (!canCorrectCashMovement) return setError('You do not have permission to correct cash activity in this branch.');
    if (!correctionCommandId) return setError('Restart this cash correction and try again.');
    if (!correctionReason.trim()) return setError('Enter why this cash activity is being corrected.');

    let replacementAmount: number | null = null;
    if (correctionKind === 'replace') {
      replacementAmount = parseCashInput(correctionAmount);
      if (replacementAmount === null || replacementAmount <= 0) return setError('Enter a corrected amount greater than zero.');
      if (!correctionReference.trim()) return setError('Enter the corrected reference.');
      if (!correctionActivityReason.trim()) return setError('Enter the corrected activity reason.');
      if (correctionType === 'expense' && !correctionExpenseCategoryId) return setError('Choose an Expense Category.');
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await correctCashMovement({
        tenantId,
        shiftId: shift.shiftId,
        movementId: correctionMovement.movementId,
        correctionKind,
        correctionReason,
        commandId: correctionCommandId,
        replacementType: correctionKind === 'replace' ? correctionType : null,
        replacementAmount,
        replacementReference: correctionKind === 'replace' ? correctionReference : null,
        replacementReason: correctionKind === 'replace' ? correctionActivityReason : null,
        replacementExpenseCategoryId: correctionKind === 'replace' && correctionType === 'expense'
          ? correctionExpenseCategoryId
          : null,
      });
      closeCorrection();
      await refresh({ quiet: true });
      setNotice(result.idempotentReplay
        ? 'This cash correction was already applied.'
        : correctionKind === 'replace'
          ? 'Cash activity updated. Original audit history was preserved.'
          : 'Cash activity removed from the effective drawer total. Original audit history was preserved.');
    } catch (err) {
      setError(errorMessage(err, 'Unable to correct this cash activity.'));
    } finally {
      setSaving(false);
    }
  }

  function beginCloseShift() {
    if (!shift) return;
    closeMovement();
    closeCorrection();
    setDeclaredCash(formatQuantity(shift.expectedCash));
    setCloseNote('');
    setCloseMode(true);
    setError(null);
    setNotice(null);
  }

  async function handleCloseShift() {
    if (!shift || saving) return;
    if (canWrite !== true) return setError(readOnlyMessage('close this shift'));
    const amount = parseCashInput(declaredCash);
    if (amount === null || amount < 0) return setError('Enter the cash physically counted in the drawer.');
    const variance = amount - shift.expectedCash;
    if (Math.abs(variance) >= 0.01 && !closeNote.trim()) return setError('Explain the cash difference before closing this shift.');

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await closeCashShift({ tenantId, shiftId: shift.shiftId, declaredCash: amount, note: closeNote });
      setCloseMode(false);
      await refresh({ quiet: true });
      setNotice(`Shift closed. Drawer cash difference: ${formatMoney(result.variance ?? variance, shift.currency)}.`);
    } catch (err) {
      setError(errorMessage(err, 'Unable to close this shift.'));
    } finally {
      setSaving(false);
    }
  }

  async function openReview(entry: CashShiftHistoryRow) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const detail = await loadCashShift(tenantId, entry.shiftId);
      setReviewShift(detail);
      setReviewDecision('accepted');
      setReviewNote('');
    } catch (err) {
      setError(errorMessage(err, 'Unable to open this shift review.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleReview() {
    if (!reviewShift || saving) return;
    if (canWrite !== true) return setError(readOnlyMessage('save a shift review'));
    if (reviewDecision === 'follow_up' && !reviewNote.trim()) return setError('Enter what needs follow-up.');
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await reviewCashShift({ tenantId, shiftId: reviewShift.shiftId, decision: reviewDecision, note: reviewNote });
      setReviewShift(null);
      await refresh({ quiet: true });
      setNotice(reviewDecision === 'accepted' ? 'Shift review accepted.' : 'Shift marked for follow-up.');
    } catch (err) {
      setError(errorMessage(err, 'Unable to review this shift.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <View style={styles.stack}><BackButton dark={dark} onPress={onClose} /><Card dark={dark}><ActivityIndicator /><Text style={[styles.helper, dark && darkStyles.bodyText]}>Loading cash and shift…</Text></Card></View>;
  }

  if (reviewShift) {
    return (
      <View style={styles.stack}>
        <BackButton dark={dark} label="Cash & Shift" onPress={() => setReviewShift(null)} />
        <Heading eyebrow="SHIFT REVIEW" title={reviewShift.registerName} subtitle={`Closed ${formatDateTime(reviewShift.closedAt)} · ${branch.name}`} dark={dark} />
        {error ? <MessageCard text={error} error dark={dark} /> : null}
        {canWrite === false ? <MessageCard text="This business is read-only. Shift details remain available, but review decisions cannot be saved until the subscription is reactivated." error dark={dark} /> : null}
        <View style={styles.metricGrid}>
          <MetricCard label="Expected drawer" value={formatMoney(reviewShift.expectedCash, reviewShift.currency)} dark={dark} />
          <MetricCard label="Cash counted" value={formatMoney(reviewShift.declaredCash ?? 0, reviewShift.currency)} dark={dark} />
          <MetricCard label="Cash difference" value={formatSignedMoney(reviewShift.variance ?? 0, reviewShift.currency)} dark={dark} attention={Math.abs(reviewShift.variance ?? 0) >= 0.01} />
          <MetricCard label="Expenses" value={formatMoney(reviewShift.expenses, reviewShift.currency)} dark={dark} />
        </View>
        <PaymentSummaryCard summary={reviewShift.paymentSummary} dark={dark} />
        {reviewShift.closeNote ? <InfoCard title="Cashier note" text={reviewShift.closeNote} dark={dark} /> : null}
        <Card dark={dark}>
          <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Review decision</Text>
          <View style={styles.choiceRow}>
            <ChoiceButton label="Accept" active={reviewDecision === 'accepted'} onPress={() => setReviewDecision('accepted')} dark={dark} />
            <ChoiceButton label="Needs follow-up" active={reviewDecision === 'follow_up'} onPress={() => setReviewDecision('follow_up')} dark={dark} />
          </View>
          <FieldLabel dark={dark}>Review note</FieldLabel>
          <TextInput value={reviewNote} onChangeText={setReviewNote} placeholder={reviewDecision === 'follow_up' ? 'What needs follow-up?' : 'Optional review note'} placeholderTextColor={theme.colors.subtle} multiline style={[styles.input, styles.multiline, dark && darkStyles.input]} />
          <PrimaryButton label="Save review" loading={saving} disabled={canWrite !== true} onPress={() => void handleReview()} />
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <BackButton dark={dark} onPress={onClose} />
      <Heading eyebrow="CASH & SHIFT" title={branch.name} subtitle="Open the drawer, record cash activity, reconcile payments, then count and close your shift." dark={dark} />
      {error ? <MessageCard text={error} error dark={dark} /> : null}
      {canWrite === false ? <MessageCard text="This business is read-only. You can review cashier information, but cashier actions are unavailable until the subscription is reactivated." error dark={dark} /> : null}
      {notice ? <MessageCard text={notice} dark={dark} /> : null}

      {!shift ? (
        <Card dark={dark}>
          <SectionHeader title="Open shift" subtitle="Choose the drawer and enter the physical cash already inside it." icon="lock-open-outline" dark={dark} />
          {canWrite === false ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>Cashier actions are unavailable while this business is read-only.</Text>
            : canWrite === null ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>SellerTray could not confirm whether cashier actions are available. Refresh and try again.</Text>
              : !capabilitiesLoaded ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>Cashier permissions could not be confirmed. Refresh and try again.</Text>
                : !capabilities.canOpenShift ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>You do not have permission to open a cashier shift.</Text>
                  : registers.length === 0 ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>No active register is available for this branch.</Text>
                    : <>
                      <FieldLabel dark={dark}>Register</FieldLabel>
                      <View style={styles.choiceWrap}>{registers.map((register) => <ChoiceButton key={register.id} label={register.name} active={selectedRegisterId === register.id} onPress={() => setSelectedRegisterId(register.id)} dark={dark} />)}</View>
                      <FieldLabel dark={dark}>Opening cash</FieldLabel>
                      <TextInput value={openingCash} onChangeText={setOpeningCash} keyboardType="decimal-pad" style={[styles.input, dark && darkStyles.input]} />
                      <PrimaryButton label="Open shift" loading={saving} disabled={canWrite !== true} onPress={() => void handleOpenShift()} />
                    </>}
        </Card>
      ) : (
        <>
          <View style={styles.metricGrid}>
            <MetricCard label="Opening cash" value={formatMoney(shift.openingCash, shift.currency)} dark={dark} />
            <MetricCard label="Cash sales" value={formatMoney(shift.cashSales, shift.currency)} dark={dark} />
            <MetricCard label="Cash refunds" value={formatMoney(shift.cashRefunds, shift.currency)} dark={dark} />
            <MetricCard label="Expected drawer" value={formatMoney(shift.expectedCash, shift.currency)} dark={dark} />
          </View>
          <PaymentSummaryCard summary={shift.paymentSummary} dark={dark} />

          <Card dark={dark}>
            <SectionHeader title="Cash activity" subtitle="Cash in and cashier expenses change the expected drawer cash. Use More → Cash Out for Bank Deposit or Owner Withdrawal." icon="cash-outline" dark={dark} />
            {!movementMode && !correctionMovement && !closeMode ? (
              <View style={styles.choiceWrap}>
                {capabilities.canRecordCashMovement ? <ChoiceButton label="Cash in" active={false} onPress={() => beginMovement('cash_in')} dark={dark} /> : null}
                {capabilities.canRecordExpense ? <ChoiceButton label="Expense" active={false} onPress={() => beginMovement('expense')} dark={dark} /> : null}
              </View>
            ) : null}

            {movementMode ? (
              <View style={styles.formStack}>
                <Text style={[styles.formTitle, dark && darkStyles.titleText]}>{movementLabel(movementMode)}</Text>
                {movementMode === 'expense' ? <>
                  <FieldLabel dark={dark}>Expense Category</FieldLabel>
                  {expenseCategories.length === 0
                    ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>No active Expense Category is available. Ask an Owner or Manager to create one in Merchant Web.</Text>
                    : <View style={styles.choiceWrap}>{expenseCategories.map((category) => <ChoiceButton key={category.id} label={category.name} active={expenseCategoryId === category.id} onPress={() => setExpenseCategoryId(category.id)} dark={dark} />)}</View>}
                </> : null}
                <FieldLabel dark={dark}>Amount</FieldLabel>
                <TextInput value={movementAmount} onChangeText={setMovementAmount} keyboardType="decimal-pad" style={[styles.input, dark && darkStyles.input]} />
                <FieldLabel dark={dark}>Reference</FieldLabel>
                <TextInput value={movementReference} onChangeText={setMovementReference} style={[styles.input, dark && darkStyles.input]} />
                <FieldLabel dark={dark}>Reason</FieldLabel>
                <TextInput value={movementReason} onChangeText={setMovementReason} multiline style={[styles.input, styles.multiline, dark && darkStyles.input]} />
                <ActionButtons onCancel={closeMovement} confirmLabel="Record activity" loading={saving} onConfirm={() => void handleMovement()} />
              </View>
            ) : null}

            {correctionMovement ? (
              <View style={[styles.correctionCard, dark && darkStyles.subtleCard]}>
                <Text style={[styles.formTitle, dark && darkStyles.titleText]}>{correctionKind === 'replace' ? 'Edit cash activity' : 'Remove cash activity'}</Text>
                <Text style={[styles.helper, dark && darkStyles.bodyText]}>The original entry stays in audit history. SellerTray applies a governed correction to the effective drawer total.</Text>
                {correctionKind === 'replace' ? <>
                  <FieldLabel dark={dark}>Activity</FieldLabel>
                  <View style={styles.choiceWrap}>
                    <ChoiceButton label="Cash in" active={correctionType === 'cash_in'} onPress={() => chooseCorrectionType('cash_in')} dark={dark} />
                    <ChoiceButton label="Cash out" active={correctionType === 'cash_out'} onPress={() => chooseCorrectionType('cash_out')} dark={dark} />
                    <ChoiceButton label="Expense" active={correctionType === 'expense'} onPress={() => chooseCorrectionType('expense')} dark={dark} />
                  </View>
                  {correctionType === 'expense' ? <>
                    <FieldLabel dark={dark}>Expense Category</FieldLabel>
                    {expenseCategories.length === 0
                      ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>No active Expense Category is available. Create or reactivate one in Merchant Web before replacing this entry with an Expense.</Text>
                      : <View style={styles.choiceWrap}>{expenseCategories.map((category) => <ChoiceButton key={category.id} label={category.name} active={correctionExpenseCategoryId === category.id} onPress={() => setCorrectionExpenseCategoryId(category.id)} dark={dark} />)}</View>}
                  </> : null}
                  <FieldLabel dark={dark}>Amount</FieldLabel>
                  <TextInput value={correctionAmount} onChangeText={setCorrectionAmount} keyboardType="decimal-pad" style={[styles.input, dark && darkStyles.input]} />
                  <FieldLabel dark={dark}>Reference</FieldLabel>
                  <TextInput value={correctionReference} onChangeText={setCorrectionReference} style={[styles.input, dark && darkStyles.input]} />
                  <FieldLabel dark={dark}>Activity reason</FieldLabel>
                  <TextInput value={correctionActivityReason} onChangeText={setCorrectionActivityReason} multiline style={[styles.input, styles.multiline, dark && darkStyles.input]} />
                </> : <InfoCard title="Activity being removed" text={`${movementLabel(correctionMovement.movementType)} · ${formatMoney(correctionMovement.amount, correctionMovement.currency)} · ${correctionMovement.reference}`} dark={dark} />}
                <FieldLabel dark={dark}>Why are you making this correction?</FieldLabel>
                <TextInput value={correctionReason} onChangeText={setCorrectionReason} multiline placeholder="Required for audit history" placeholderTextColor={theme.colors.subtle} style={[styles.input, styles.multiline, dark && darkStyles.input]} />
                <ActionButtons onCancel={closeCorrection} confirmLabel={correctionKind === 'replace' ? 'Save changes' : 'Remove activity'} loading={saving} danger={correctionKind === 'remove'} onConfirm={() => void handleCorrection()} />
              </View>
            ) : null}
          </Card>

          <Card dark={dark}>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Recorded cash activity</Text>
            {shift.movements.length === 0 ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>No cash in, cash out or expense has been recorded yet.</Text> : shift.movements.map((movement) => (
              <View key={movement.movementId} style={[styles.activityRow, dark && darkStyles.activityRow]}>
                <View style={styles.activityIcon}><Ionicons name={movementIcon(movement.movementType)} size={17} color={theme.colors.greenDark} /></View>
                <View style={styles.flexOne}>
                  <Text style={[styles.activityTitle, dark && darkStyles.titleText]}>{movementLabel(movement.movementType)}</Text>
                  <Text style={[styles.activityMeta, dark && darkStyles.bodyText]}>{movement.expenseCategory ? `${movement.expenseCategory} · ` : ''}{movement.reference} · {movement.reason}</Text>
                  {canWrite === true && canCorrectCashMovement && shift.status === 'open' ? (
                    <View style={styles.inlineActions}>
                      <Pressable disabled={saving} onPress={() => beginCorrection(movement, 'replace')}><Text style={styles.editText}>Edit</Text></Pressable>
                      <Pressable disabled={saving} onPress={() => beginCorrection(movement, 'remove')}><Text style={styles.removeText}>Remove</Text></Pressable>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.activityAmount, dark && darkStyles.titleText]}>{formatMoney(movement.amount, movement.currency)}</Text>
              </View>
            ))}
          </Card>

          {closeMode ? (
            <Card dark={dark}>
              <SectionHeader title="Close shift" subtitle="Count the physical drawer cash. Explain any difference before closing." icon="lock-closed-outline" dark={dark} />
              <FieldLabel dark={dark}>Cash counted</FieldLabel>
              <TextInput value={declaredCash} onChangeText={setDeclaredCash} keyboardType="decimal-pad" style={[styles.input, dark && darkStyles.input]} />
              <FieldLabel dark={dark}>Note</FieldLabel>
              <TextInput value={closeNote} onChangeText={setCloseNote} multiline placeholder="Required if counted cash differs from expected cash" placeholderTextColor={theme.colors.subtle} style={[styles.input, styles.multiline, dark && darkStyles.input]} />
              <ActionButtons onCancel={() => setCloseMode(false)} confirmLabel="Close shift" loading={saving} onConfirm={() => void handleCloseShift()} />
            </Card>
          ) : capabilities.canCloseShift ? <PrimaryButton label="Count & close shift" loading={false} disabled={canWrite !== true || Boolean(movementMode) || Boolean(correctionMovement)} onPress={beginCloseShift} /> : null}
        </>
      )}

      <Card dark={dark}>
        <SectionHeader title="Shift history" subtitle="Closed shifts remain available for review and audit." icon="time-outline" dark={dark} />
        {history.length === 0 ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>No prior shifts for this branch.</Text> : history.slice(0, 8).map((entry) => (
          <View key={entry.shiftId} style={[styles.historyRow, dark && darkStyles.activityRow]}>
            <View style={styles.flexOne}>
              <Text style={[styles.activityTitle, dark && darkStyles.titleText]}>{entry.registerName}</Text>
              <Text style={[styles.activityMeta, dark && darkStyles.bodyText]}>{formatDateTime(entry.openedAt)} · {titleCase(entry.status)}</Text>
            </View>
            <View style={styles.historyRight}>
              {entry.variance !== null ? <Text style={[styles.activityAmount, dark && darkStyles.titleText]}>{formatSignedMoney(entry.variance, entry.currency)}</Text> : null}
              {entry.status === 'closed' && capabilities.canReviewShift ? <Pressable disabled={saving || canWrite !== true} onPress={() => void openReview(entry)}><Text style={styles.editText}>Review</Text></Pressable> : null}
            </View>
          </View>
        ))}
        {closedForReview.length > 0 && !capabilities.canReviewShift ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>Closed shifts awaiting review are visible to a manager or owner with review permission.</Text> : null}
      </Card>
    </View>
  );
}

function Card({ children, dark }: { children: React.ReactNode; dark: boolean }) {
  return <View style={[styles.card, dark && darkStyles.card]}>{children}</View>;
}

function Heading({ eyebrow, title, subtitle, dark }: { eyebrow: string; title: string; subtitle: string; dark: boolean }) {
  return <View style={styles.heading}><Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>{eyebrow}</Text><Text style={[styles.pageTitle, dark && darkStyles.titleText]}>{title}</Text><Text style={[styles.pageSubtitle, dark && darkStyles.bodyText]}>{subtitle}</Text></View>;
}

function BackButton({ dark, onPress, label = 'Back' }: { dark: boolean; onPress: () => void; label?: string }) {
  return <Pressable onPress={onPress} style={styles.backButton}><Ionicons name="chevron-back" size={19} color={dark ? theme.colors.white : theme.colors.navy} /><Text style={[styles.backText, dark && darkStyles.titleText]}>{label}</Text></Pressable>;
}

function SectionHeader({ title, subtitle, icon, dark }: { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; dark: boolean }) {
  return <View style={styles.sectionHeader}><View style={styles.sectionIcon}><Ionicons name={icon} size={20} color={theme.colors.greenDark} /></View><View style={styles.flexOne}><Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{title}</Text><Text style={[styles.helper, dark && darkStyles.bodyText]}>{subtitle}</Text></View></View>;
}

function FieldLabel({ children, dark }: { children: React.ReactNode; dark: boolean }) {
  return <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>{children}</Text>;
}

function ChoiceButton({ label, active, onPress, dark }: { label: string; active: boolean; onPress: () => void; dark: boolean }) {
  return <Pressable onPress={onPress} style={[styles.choiceButton, dark && darkStyles.choiceButton, active && styles.choiceActive]}><Text style={[styles.choiceText, dark && darkStyles.bodyText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}

function PrimaryButton({ label, loading, disabled, onPress }: { label: string; loading: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable disabled={disabled || loading} onPress={onPress} style={[styles.primaryButton, (disabled || loading) && styles.disabled]}>{loading ? <ActivityIndicator color={theme.colors.white} /> : null}<Text style={styles.primaryText}>{loading ? 'Saving…' : label}</Text></Pressable>;
}

function ActionButtons({ onCancel, confirmLabel, loading, danger = false, onConfirm }: { onCancel: () => void; confirmLabel: string; loading: boolean; danger?: boolean; onConfirm: () => void }) {
  return <View style={styles.actionButtons}><Pressable disabled={loading} onPress={onCancel} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable><Pressable disabled={loading} onPress={onConfirm} style={[styles.primaryButton, styles.flexButton, danger && styles.dangerButton, loading && styles.disabled]}>{loading ? <ActivityIndicator color={theme.colors.white} /> : null}<Text style={styles.primaryText}>{loading ? 'Saving…' : confirmLabel}</Text></Pressable></View>;
}

function MetricCard({ label, value, dark, attention = false }: { label: string; value: string; dark: boolean; attention?: boolean }) {
  return <View style={[styles.metricCard, dark && darkStyles.card, attention && styles.attentionCard]}><Text style={[styles.metricLabel, dark && darkStyles.bodyText]}>{label}</Text><Text style={[styles.metricValue, dark && darkStyles.titleText, attention && styles.attentionText]}>{value}</Text></View>;
}

function PaymentSummaryCard({ summary, dark }: { summary: ShiftPaymentSummary[]; dark: boolean }) {
  return <Card dark={dark}><Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Payments in this shift</Text>{summary.length === 0 ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>No completed payments recorded for this shift yet.</Text> : summary.map((row) => <View key={row.methodKey} style={styles.summaryRow}><View style={styles.flexOne}><Text style={[styles.activityTitle, dark && darkStyles.titleText]}>{row.displayName}</Text><Text style={[styles.activityMeta, dark && darkStyles.bodyText]}>{row.transactionCount} transaction{row.transactionCount === 1 ? '' : 's'}</Text></View><Text style={[styles.activityAmount, dark && darkStyles.titleText]}>{formatMoney(row.amount, row.currency)}</Text></View>)}</Card>;
}

function InfoCard({ title, text, dark }: { title: string; text: string; dark: boolean }) {
  return <View style={[styles.infoCard, dark && darkStyles.subtleCard]}><Text style={[styles.activityTitle, dark && darkStyles.titleText]}>{title}</Text><Text style={[styles.helper, dark && darkStyles.bodyText]}>{text}</Text></View>;
}

function MessageCard({ text, error = false, dark }: { text: string; error?: boolean; dark: boolean }) {
  return <View style={[styles.messageCard, error ? styles.errorCard : styles.noticeCard, dark && darkStyles.subtleCard]}><Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={19} color={error ? theme.colors.danger : theme.colors.greenDark} /><Text style={[styles.messageText, dark && darkStyles.bodyText]}>{text}</Text></View>;
}

function movementLabel(type: CashMovementType): string {
  if (type === 'cash_in') return 'Cash in';
  if (type === 'cash_out') return 'Cash out';
  return 'Expense';
}

function movementIcon(type: CashMovementType): keyof typeof Ionicons.glyphMap {
  if (type === 'cash_in') return 'arrow-down-circle-outline';
  if (type === 'cash_out') return 'arrow-up-circle-outline';
  return 'receipt-outline';
}

function parseCashInput(value: string): number | null {
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatSignedMoney(value: number, currency: string): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatMoney(value, currency)}`;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').split(' ').map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : '').join(' ');
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function readOnlyMessage(action: string): string {
  return `This business is read-only. Reactivate the SellerTray subscription before you ${action}.`;
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  heading: { gap: 4 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  pageTitle: { color: theme.colors.navy, fontSize: 26, fontWeight: '900' },
  pageSubtitle: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  backButton: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 4, paddingVertical: 4 },
  backText: { color: theme.colors.navy, fontSize: 13, fontWeight: '800' },
  card: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 18, borderWidth: 1, gap: 11, padding: 14 },
  sectionHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  sectionIcon: { alignItems: 'center', backgroundColor: theme.colors.mintSoft, borderRadius: 12, height: 38, justifyContent: 'center', width: 38 },
  sectionTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  helper: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  fieldLabel: { color: theme.colors.slate, fontSize: 12, fontWeight: '900', marginTop: 2 },
  input: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, color: theme.colors.navy, fontSize: 14, minHeight: 44, paddingHorizontal: 11, paddingVertical: 10 },
  multiline: { minHeight: 74, textAlignVertical: 'top' },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choiceButton: { borderColor: theme.colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  choiceActive: { backgroundColor: theme.colors.mintSoft, borderColor: theme.colors.green },
  choiceText: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  choiceTextActive: { color: theme.colors.greenDark },
  primaryButton: { alignItems: 'center', backgroundColor: theme.colors.green, borderRadius: 12, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14, paddingVertical: 10 },
  primaryText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  secondaryButton: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  secondaryText: { color: theme.colors.slate, fontSize: 12, fontWeight: '900' },
  dangerButton: { backgroundColor: theme.colors.danger },
  disabled: { opacity: 0.5 },
  actionButtons: { flexDirection: 'row', gap: 8 },
  flexButton: { flex: 1 },
  formStack: { gap: 8, paddingTop: 4 },
  formTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  correctionCard: { backgroundColor: theme.colors.mintSoft, borderRadius: 14, gap: 8, padding: 12 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  metricCard: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 14, borderWidth: 1, flexBasis: '47%', flexGrow: 1, gap: 4, padding: 12 },
  metricLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '800' },
  metricValue: { color: theme.colors.navy, fontSize: 16, fontWeight: '900' },
  attentionCard: { borderColor: '#FDA29B' },
  attentionText: { color: theme.colors.danger },
  activityRow: { alignItems: 'flex-start', borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 9, paddingTop: 10 },
  activityIcon: { alignItems: 'center', backgroundColor: theme.colors.mintSoft, borderRadius: 10, height: 34, justifyContent: 'center', width: 34 },
  activityTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  activityMeta: { color: theme.colors.muted, fontSize: 11, lineHeight: 16 },
  activityAmount: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  inlineActions: { flexDirection: 'row', gap: 14, marginTop: 5 },
  editText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  removeText: { color: theme.colors.danger, fontSize: 11, fontWeight: '900' },
  flexOne: { flex: 1, gap: 2 },
  summaryRow: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingTop: 6 },
  historyRow: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingTop: 9 },
  historyRight: { alignItems: 'flex-end', gap: 5 },
  infoCard: { backgroundColor: theme.colors.mintSoft, borderRadius: 12, gap: 3, padding: 10 },
  messageCard: { alignItems: 'flex-start', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 11 },
  errorCard: { backgroundColor: theme.colors.dangerSoft },
  noticeCard: { backgroundColor: theme.colors.mintSoft },
  messageText: { color: theme.colors.slate, flex: 1, fontSize: 12, lineHeight: 17 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46' },
  input: { backgroundColor: '#162F46', borderColor: '#344054', color: theme.colors.white },
  choiceButton: { borderColor: '#344054' },
  titleText: { color: theme.colors.white },
  bodyText: { color: '#D0D5DD' },
  activityRow: { borderTopColor: '#344054' },
});