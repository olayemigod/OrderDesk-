import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CommerceBranch } from '../data/commerceRepository';
import {
  closeCashShift,
  loadActiveCashShift,
  loadCashRegisters,
  loadCashShift,
  loadCashShiftCapabilities,
  openCashShift,
  recordCashMovement,
  reviewCashShift,
  type CashMovementType,
  type CashRegister,
  type CashShift,
  type CashShiftCapabilities,
  type ShiftReviewDecision,
} from '../data/cashShiftRepository';
import { loadCashShiftHistory, type CashShiftHistoryRow } from '../data/cashShiftHistoryRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

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
  const [capabilities, setCapabilities] = useState<CashShiftCapabilities>(NO_CAPABILITIES);
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
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReference, setMovementReference] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('');
  const [closeMode, setCloseMode] = useState(false);
  const [declaredCash, setDeclaredCash] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [reviewDecision, setReviewDecision] = useState<ShiftReviewDecision>('accepted');
  const [reviewNote, setReviewNote] = useState('');

  async function refresh(options?: { quiet?: boolean }) {
    if (!options?.quiet) setLoading(true);
    setError(null);
    try {
      const [nextRegisters, nextCapabilities, nextShift, nextHistory] = await Promise.all([
        loadCashRegisters(tenantId, branch.id),
        loadCashShiftCapabilities(tenantId, branch.id),
        loadActiveCashShift(tenantId, branch.id),
        loadCashShiftHistory(tenantId, branch.id, 30),
      ]);
      setRegisters(nextRegisters);
      setCapabilities(nextCapabilities);
      setShift(nextShift);
      setHistory(nextHistory);
      setSelectedRegisterId((current) => {
        if (nextRegisters.some((entry) => entry.id === current)) return current;
        return nextRegisters.find((entry) => entry.isDefault)?.id ?? nextRegisters[0]?.id ?? '';
      });
      onShiftChanged?.(nextShift);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load cash and shift information.');
    } finally {
      if (!options?.quiet) setLoading(false);
    }
  }

  useEffect(() => {
    setShift(null);
    setHistory([]);
    setReviewShift(null);
    setCloseMode(false);
    setMovementMode(null);
    void refresh();
  }, [tenantId, branch.id]);

  const closedForReview = useMemo(
    () => history.filter((entry) => entry.status === 'closed'),
    [history],
  );

  async function handleOpenShift() {
    if (saving) return;
    const amount = Number(openingCash);
    if (!selectedRegisterId) {
      setError('Choose a register before opening the shift.');
      return;
    }
    if (openingCash.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      setError('Enter a valid opening cash amount.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await openCashShift({
        tenantId,
        branchId: branch.id,
        registerId: selectedRegisterId,
        openingCash: amount,
      });
      await refresh({ quiet: true });
      setNotice(result.idempotentReplay ? 'This shift is already open.' : 'Shift opened. Cash sales can now be recorded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open this shift.');
    } finally {
      setSaving(false);
    }
  }

  function beginMovement(type: CashMovementType) {
    setMovementMode(type);
    setMovementAmount('');
    setMovementReference('');
    setMovementReason('');
    setExpenseCategory('');
    setError(null);
    setNotice(null);
  }

  async function handleMovement() {
    if (!shift || !movementMode || saving) return;
    const amount = Number(movementAmount);
    if (movementAmount.trim() === '' || !Number.isFinite(amount) || amount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!movementReference.trim()) {
      setError('Enter a reference for this cash activity.');
      return;
    }
    if (!movementReason.trim()) {
      setError('Enter a reason for this cash activity.');
      return;
    }
    if (movementMode === 'expense' && !expenseCategory.trim()) {
      setError('Enter an expense category.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recordCashMovement({
        tenantId,
        shiftId: shift.shiftId,
        movementType: movementMode,
        amount,
        reference: movementReference,
        reason: movementReason,
        expenseCategory: movementMode === 'expense' ? expenseCategory : null,
      });
      await refresh({ quiet: true });
      setMovementMode(null);
      setNotice(result.idempotentReplay ? 'This cash activity was already recorded.' : `${movementLabel(result.movementType)} recorded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record this cash activity.');
    } finally {
      setSaving(false);
    }
  }

  function beginCloseShift() {
    if (!shift) return;
    setDeclaredCash(formatQuantity(shift.expectedCash));
    setCloseNote('');
    setCloseMode(true);
    setError(null);
    setNotice(null);
  }

  async function handleCloseShift() {
    if (!shift || saving) return;
    const amount = Number(declaredCash);
    if (declaredCash.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      setError('Enter the cash physically counted in the drawer.');
      return;
    }
    const variance = amount - shift.expectedCash;
    if (Math.abs(variance) >= 0.01 && !closeNote.trim()) {
      setError('Explain the cash difference before closing this shift.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await closeCashShift({
        tenantId,
        shiftId: shift.shiftId,
        declaredCash: amount,
        note: closeNote,
      });
      setCloseMode(false);
      await refresh({ quiet: true });
      setNotice(`Shift closed. Cash difference: ${formatMoney(result.variance ?? variance, shift.currency)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to close this shift.');
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
      setError(err instanceof Error ? err.message : 'Unable to open this shift review.');
    } finally {
      setSaving(false);
    }
  }

  async function handleReview() {
    if (!reviewShift || saving) return;
    if (reviewDecision === 'follow_up' && !reviewNote.trim()) {
      setError('Enter what needs follow-up.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await reviewCashShift({
        tenantId,
        shiftId: reviewShift.shiftId,
        decision: reviewDecision,
        note: reviewNote,
      });
      setReviewShift(null);
      await refresh({ quiet: true });
      setNotice(reviewDecision === 'accepted' ? 'Shift review accepted.' : 'Shift marked for follow-up.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review this shift.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.stack}>
        <BackButton dark={dark} onPress={onClose} />
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading cash and shift…</Text>
        </View>
      </View>
    );
  }

  if (reviewShift) {
    return (
      <View style={styles.stack}>
        <BackButton dark={dark} label="Cash & Shift" onPress={() => setReviewShift(null)} />
        <View style={styles.heading}>
          <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SHIFT REVIEW</Text>
          <Text style={[styles.title, dark && darkStyles.titleText]}>{reviewShift.registerName}</Text>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
            Closed {formatDateTime(reviewShift.closedAt)} · {branch.name}
          </Text>
        </View>
        {error ? <MessageCard text={error} error dark={dark} /> : null}
        <View style={styles.metricGrid}>
          <MetricCard label="Expected" value={formatMoney(reviewShift.expectedCash, reviewShift.currency)} dark={dark} />
          <MetricCard label="Declared" value={formatMoney(reviewShift.declaredCash ?? 0, reviewShift.currency)} dark={dark} />
          <MetricCard label="Difference" value={formatSignedMoney(reviewShift.variance ?? 0, reviewShift.currency)} dark={dark} attention={Math.abs(reviewShift.variance ?? 0) >= 0.01} />
          <MetricCard label="Expenses" value={formatMoney(reviewShift.expenses, reviewShift.currency)} dark={dark} />
        </View>
        {reviewShift.closeNote ? (
          <View style={[styles.infoCard, dark && darkStyles.subtleCard]}>
            <Text style={[styles.infoTitle, dark && darkStyles.titleText]}>Cashier note</Text>
            <Text style={[styles.infoText, dark && darkStyles.bodyText]}>{reviewShift.closeNote}</Text>
          </View>
        ) : null}
        <View style={[styles.formCard, dark && darkStyles.card]}>
          <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Review decision</Text>
          <View style={styles.choiceRow}>
            <ChoiceButton label="Accept" active={reviewDecision === 'accepted'} onPress={() => setReviewDecision('accepted')} dark={dark} />
            <ChoiceButton label="Needs follow-up" active={reviewDecision === 'follow_up'} onPress={() => setReviewDecision('follow_up')} dark={dark} />
          </View>
          <FieldLabel dark={dark}>Review note</FieldLabel>
          <TextInput
            value={reviewNote}
            onChangeText={setReviewNote}
            placeholder={reviewDecision === 'follow_up' ? 'What needs follow-up?' : 'Optional review note'}
            placeholderTextColor={theme.colors.subtle}
            multiline
            style={[styles.input, styles.multiline, dark && darkStyles.input]}
          />
          <PrimaryButton label="Save review" loading={saving} onPress={() => void handleReview()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <BackButton dark={dark} onPress={onClose} />
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>CASH & SHIFT</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>{branch.name}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Open the drawer, record cash activity, then count and close it at the end of your shift.
        </Text>
      </View>

      {error ? <MessageCard text={error} error dark={dark} /> : null}
      {notice ? <MessageCard text={notice} dark={dark} /> : null}

      {!shift ? (
        <View style={[styles.formCard, dark && darkStyles.card]}>
          <View style={styles.sectionRow}>
            <View style={styles.flexOne}>
              <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Open shift</Text>
              <Text style={[styles.helper, dark && darkStyles.bodyText]}>Choose the drawer and enter the cash already inside it.</Text>
            </View>
            <Ionicons name="lock-open-outline" size={23} color={theme.colors.greenDark} />
          </View>
          {!capabilities.canOpenShift ? (
            <Text style={[styles.helper, dark && darkStyles.bodyText]}>You do not have permission to open a cashier shift.</Text>
          ) : registers.length === 0 ? (
            <Text style={[styles.helper, dark && darkStyles.bodyText]}>No active register is available for this branch.</Text>
          ) : (
            <>
              <FieldLabel dark={dark}>Register</FieldLabel>
              <View style={styles.choiceWrap}>
                {registers.map((register) => (
                  <ChoiceButton
                    key={register.id}
                    label={`${register.name}${register.isDefault ? ' · Default' : ''}`}
                    active={selectedRegisterId === register.id}
                    onPress={() => setSelectedRegisterId(register.id)}
                    dark={dark}
                  />
                ))}
              </View>
              <FieldLabel dark={dark}>Opening cash</FieldLabel>
              <TextInput
                value={openingCash}
                onChangeText={setOpeningCash}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={theme.colors.subtle}
                style={[styles.input, dark && darkStyles.input]}
              />
              <PrimaryButton label="Open shift" loading={saving} onPress={() => void handleOpenShift()} />
            </>
          )}
        </View>
      ) : (
        <>
          <View style={[styles.shiftCard, dark && darkStyles.card]}>
            <View style={styles.sectionRow}>
              <View style={styles.flexOne}>
                <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SHIFT OPEN</Text>
                <Text style={[styles.shiftTitle, dark && darkStyles.titleText]}>{shift.registerName}</Text>
                <Text style={[styles.helper, dark && darkStyles.bodyText]}>Opened {formatDateTime(shift.openedAt)}</Text>
              </View>
              <View style={styles.openPill}>
                <View style={styles.openDot} />
                <Text style={styles.openPillText}>Open</Text>
              </View>
            </View>
            <View style={styles.metricGrid}>
              <MetricCard label="Expected cash" value={formatMoney(shift.expectedCash, shift.currency)} dark={dark} />
              <MetricCard label="Cash sales" value={formatMoney(shift.cashSales, shift.currency)} dark={dark} />
              <MetricCard label="Expenses" value={formatMoney(shift.expenses, shift.currency)} dark={dark} />
              <MetricCard label="Cash refunds" value={formatMoney(shift.cashRefunds, shift.currency)} dark={dark} />
            </View>
            <Text style={[styles.breakdown, dark && darkStyles.bodyText]}>
              Opening {formatMoney(shift.openingCash, shift.currency)} · Cash in {formatMoney(shift.cashIn, shift.currency)} · Cash out {formatMoney(shift.cashOut, shift.currency)}
            </Text>
          </View>

          {movementMode ? (
            <View style={[styles.formCard, dark && darkStyles.card]}>
              <View style={styles.sectionRow}>
                <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{movementLabel(movementMode)}</Text>
                <Pressable disabled={saving} onPress={() => setMovementMode(null)} style={styles.iconButton}>
                  <Ionicons name="close" size={20} color={theme.colors.slate} />
                </Pressable>
              </View>
              {movementMode === 'expense' ? (
                <>
                  <FieldLabel dark={dark}>Expense category</FieldLabel>
                  <TextInput
                    value={expenseCategory}
                    onChangeText={setExpenseCategory}
                    placeholder="e.g. Delivery"
                    placeholderTextColor={theme.colors.subtle}
                    style={[styles.input, dark && darkStyles.input]}
                  />
                </>
              ) : null}
              <FieldLabel dark={dark}>Amount</FieldLabel>
              <TextInput
                value={movementAmount}
                onChangeText={setMovementAmount}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={theme.colors.subtle}
                style={[styles.input, dark && darkStyles.input]}
              />
              <FieldLabel dark={dark}>Reference</FieldLabel>
              <TextInput
                value={movementReference}
                onChangeText={setMovementReference}
                placeholder="Receipt, voucher or note number"
                placeholderTextColor={theme.colors.subtle}
                style={[styles.input, dark && darkStyles.input]}
              />
              <FieldLabel dark={dark}>Reason</FieldLabel>
              <TextInput
                value={movementReason}
                onChangeText={setMovementReason}
                placeholder="Why did cash move?"
                placeholderTextColor={theme.colors.subtle}
                multiline
                style={[styles.input, styles.multiline, dark && darkStyles.input]}
              />
              <PrimaryButton label={`Record ${movementLabel(movementMode).toLowerCase()}`} loading={saving} onPress={() => void handleMovement()} />
            </View>
          ) : (
            <View style={styles.actionGrid}>
              {capabilities.canRecordExpense ? <ActionButton icon="receipt-outline" label="Expense" onPress={() => beginMovement('expense')} dark={dark} /> : null}
              {capabilities.canRecordCashMovement ? <ActionButton icon="add-circle-outline" label="Cash in" onPress={() => beginMovement('cash_in')} dark={dark} /> : null}
              {capabilities.canRecordCashMovement ? <ActionButton icon="remove-circle-outline" label="Cash out" onPress={() => beginMovement('cash_out')} dark={dark} /> : null}
              {capabilities.canCloseShift ? <ActionButton icon="lock-closed-outline" label="Close shift" onPress={beginCloseShift} dark={dark} /> : null}
            </View>
          )}

          {closeMode ? (
            <View style={[styles.formCard, dark && darkStyles.card]}>
              <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Close shift</Text>
              <Text style={[styles.helper, dark && darkStyles.bodyText]}>
                Count the cash physically in the drawer. SellerTray expects {formatMoney(shift.expectedCash, shift.currency)}.
              </Text>
              <FieldLabel dark={dark}>Cash counted</FieldLabel>
              <TextInput
                value={declaredCash}
                onChangeText={setDeclaredCash}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={theme.colors.subtle}
                style={[styles.input, dark && darkStyles.input]}
              />
              <FieldLabel dark={dark}>Difference note</FieldLabel>
              <TextInput
                value={closeNote}
                onChangeText={setCloseNote}
                placeholder="Required when cash is over or short"
                placeholderTextColor={theme.colors.subtle}
                multiline
                style={[styles.input, styles.multiline, dark && darkStyles.input]}
              />
              <View style={styles.inlineActions}>
                <SecondaryButton label="Keep open" onPress={() => setCloseMode(false)} dark={dark} />
                <PrimaryButton label="Close shift" loading={saving} onPress={() => void handleCloseShift()} compact />
              </View>
            </View>
          ) : null}

          <View style={[styles.activityCard, dark && darkStyles.card]}>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Cash activity</Text>
            {shift.movements.length === 0 ? (
              <Text style={[styles.helper, dark && darkStyles.bodyText]}>No cash in, cash out or expense has been recorded yet.</Text>
            ) : shift.movements.map((movement) => (
              <View key={movement.movementId} style={styles.activityRow}>
                <View style={[styles.activityIcon, movement.movementType === 'expense' && styles.expenseIcon]}>
                  <Ionicons name={movementIcon(movement.movementType)} size={17} color={theme.colors.greenDark} />
                </View>
                <View style={styles.flexOne}>
                  <Text style={[styles.activityTitle, dark && darkStyles.titleText]}>{movementLabel(movement.movementType)}</Text>
                  <Text style={[styles.activityMeta, dark && darkStyles.bodyText]}>{movement.reference} · {movement.reason}</Text>
                </View>
                <Text style={[styles.activityAmount, dark && darkStyles.titleText]}>{formatMoney(movement.amount, movement.currency)}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {capabilities.canReviewShift && closedForReview.length > 0 ? (
        <View style={[styles.activityCard, dark && darkStyles.card]}>
          <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Needs review</Text>
          <Text style={[styles.helper, dark && darkStyles.bodyText]}>Review closed shifts and cash differences.</Text>
          {closedForReview.map((entry) => (
            <Pressable key={entry.shiftId} disabled={saving} onPress={() => void openReview(entry)} style={styles.historyRow}>
              <View style={styles.flexOne}>
                <Text style={[styles.activityTitle, dark && darkStyles.titleText]}>{entry.registerName}</Text>
                <Text style={[styles.activityMeta, dark && darkStyles.bodyText]}>{formatDateTime(entry.closedAt)} · Difference {formatSignedMoney(entry.variance ?? 0, entry.currency)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.subtle} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {history.length > 0 ? (
        <View style={[styles.activityCard, dark && darkStyles.card]}>
          <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Recent shifts</Text>
          {history.slice(0, 6).map((entry) => (
            <View key={entry.shiftId} style={styles.historyRow}>
              <View style={styles.flexOne}>
                <Text style={[styles.activityTitle, dark && darkStyles.titleText]}>{entry.registerName}</Text>
                <Text style={[styles.activityMeta, dark && darkStyles.bodyText]}>{formatDateTime(entry.openedAt)} · {statusLabel(entry.status)}</Text>
              </View>
              {entry.variance !== null ? <Text style={[styles.activityAmount, dark && darkStyles.titleText]}>{formatSignedMoney(entry.variance, entry.currency)}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BackButton({ dark, onPress, label = 'More' }: { dark: boolean; onPress: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} style={styles.backButton}>
      <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
      <Text style={[styles.backText, dark && darkStyles.bodyText]}>{label}</Text>
    </Pressable>
  );
}

function PrimaryButton({ label, loading, onPress, compact = false }: { label: string; loading?: boolean; onPress: () => void; compact?: boolean }) {
  return (
    <Pressable disabled={loading} onPress={onPress} style={({ pressed }) => [styles.primaryButton, compact && styles.flexButton, pressed && styles.pressed, loading && styles.disabled]}>
      {loading ? <ActivityIndicator color={theme.colors.white} size="small" /> : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress, dark }: { label: string; onPress: () => void; dark: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.secondaryButton, dark && darkStyles.outlineButton]}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({ icon, label, onPress, dark }: { icon: string; label: string; onPress: () => void; dark: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionButton, dark && darkStyles.card, pressed && styles.pressed]}>
      <View style={styles.actionIcon}><Ionicons name={icon as never} size={20} color={theme.colors.greenDark} /></View>
      <Text style={[styles.actionLabel, dark && darkStyles.titleText]}>{label}</Text>
    </Pressable>
  );
}

function ChoiceButton({ label, active, onPress, dark }: { label: string; active: boolean; onPress: () => void; dark: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.choiceButton, dark && darkStyles.outlineButton, active && styles.choiceButtonActive]}>
      <Text style={[styles.choiceText, dark && darkStyles.bodyText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function MetricCard({ label, value, dark, attention = false }: { label: string; value: string; dark: boolean; attention?: boolean }) {
  return (
    <View style={[styles.metricCard, dark && darkStyles.subtleCard, attention && styles.metricAttention]}>
      <Text style={[styles.metricValue, dark && darkStyles.titleText, attention && styles.metricAttentionText]}>{value}</Text>
      <Text style={[styles.metricLabel, dark && darkStyles.bodyText]}>{label}</Text>
    </View>
  );
}

function MessageCard({ text, error = false, dark }: { text: string; error?: boolean; dark: boolean }) {
  return (
    <View style={[error ? styles.errorCard : styles.noticeCard, dark && (error ? darkStyles.errorCard : darkStyles.subtleCard)]}>
      <Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={19} color={error ? theme.colors.danger : theme.colors.greenDark} />
      <Text style={[error ? styles.errorText : styles.noticeText, dark && darkStyles.bodyText]}>{text}</Text>
    </View>
  );
}

function FieldLabel({ children, dark }: { children: string; dark: boolean }) {
  return <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>{children}</Text>;
}

function movementLabel(type: CashMovementType): string {
  if (type === 'cash_in') return 'Cash in';
  if (type === 'cash_out') return 'Cash out';
  return 'Expense';
}

function movementIcon(type: CashMovementType): string {
  if (type === 'cash_in') return 'add-circle-outline';
  if (type === 'cash_out') return 'remove-circle-outline';
  return 'receipt-outline';
}

function statusLabel(status: CashShiftHistoryRow['status']): string {
  if (status === 'open') return 'Open';
  if (status === 'closed') return 'Awaiting review';
  return 'Reviewed';
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
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  flexOne: { flex: 1, minWidth: 0 },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  title: { color: theme.colors.navy, fontSize: 27, lineHeight: 33, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 13, lineHeight: 19 },
  muted: { color: theme.colors.muted, fontSize: 12 },
  backButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  backText: { color: theme.colors.slate, fontSize: 13, fontWeight: '800' },
  emptyCard: { minHeight: 120, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 8 },
  formCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 10 },
  shiftCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 12 },
  activityCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 9 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sectionTitle: { color: theme.colors.navy, fontSize: 16, fontWeight: '900' },
  shiftTitle: { color: theme.colors.navy, fontSize: 20, fontWeight: '900', marginTop: 2 },
  helper: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, marginTop: 2 },
  fieldLabel: { color: theme.colors.slate, fontSize: 11, fontWeight: '800', marginTop: 2 },
  input: { minHeight: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#F9FAFB', paddingHorizontal: 12, color: theme.colors.navy, fontSize: 14 },
  multiline: { minHeight: 78, paddingTop: 12, textAlignVertical: 'top' },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceButton: { minHeight: 38, borderRadius: 19, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  choiceButtonActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  choiceText: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  choiceTextActive: { color: theme.colors.greenDark },
  primaryButton: { minHeight: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  primaryButtonText: { color: theme.colors.white, fontSize: 13, fontWeight: '900' },
  secondaryButton: { minHeight: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryButtonText: { color: theme.colors.greenDark, fontSize: 13, fontWeight: '900' },
  inlineActions: { flexDirection: 'row', gap: 9 },
  flexButton: { flex: 1 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  actionButton: { minWidth: '47%', flexGrow: 1, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  actionIcon: { width: 35, height: 35, borderRadius: 11, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  openPill: { borderRadius: 20, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5 },
  openDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.green },
  openPillText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: { width: '48%', flexGrow: 1, borderRadius: theme.radius.md, backgroundColor: theme.colors.cloud, padding: 11 },
  metricAttention: { backgroundColor: '#FFF4E5' },
  metricValue: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  metricAttentionText: { color: '#B54708' },
  metricLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '700', marginTop: 3 },
  breakdown: { color: theme.colors.muted, fontSize: 11, lineHeight: 17 },
  activityRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, paddingTop: 8 },
  activityIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  expenseIcon: { backgroundColor: '#FFF4E5' },
  activityTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  activityMeta: { color: theme.colors.muted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  activityAmount: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  historyRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, paddingTop: 8 },
  infoCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.cloud, padding: 12, gap: 4 },
  infoTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  infoText: { color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  noticeCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  errorText: { flex: 1, color: '#B42318', fontSize: 11, lineHeight: 17 },
  noticeText: { flex: 1, color: theme.colors.greenDark, fontSize: 11, lineHeight: 17 },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.55 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  outlineButton: { backgroundColor: '#162F46', borderColor: '#344054' },
  input: { backgroundColor: '#162F46', borderColor: '#344054', color: theme.colors.cloud },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
});