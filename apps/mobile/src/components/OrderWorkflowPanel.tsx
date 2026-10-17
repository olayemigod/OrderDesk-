import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { MerchantOrder, OrderStatus } from '../domain/order';

type WorkflowAction = 'reject' | 'accept' | 'start' | 'ready' | 'cancel';
type ExceptionMode = 'reject' | 'cancel' | null;

type Props = {
  order: MerchantOrder;
  onReject: (reason: string) => Promise<void>;
  onAccept: () => Promise<void>;
  onStart: () => Promise<void>;
  onReady: () => Promise<void>;
  onCancel: (reason: string) => Promise<void>;
};

const actionSuccess: Record<WorkflowAction, string> = {
  reject: 'Order rejected.',
  accept: 'Order accepted. It is ready to move into processing.',
  start: 'Processing started.',
  ready: 'Order marked ready.',
  cancel: 'Order cancelled.',
};

export function OrderWorkflowPanel({
  order,
  onReject,
  onAccept,
  onStart,
  onReady,
  onCancel,
}: Props) {
  const [pending, setPending] = useState<WorkflowAction | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exceptionMode, setExceptionMode] = useState<ExceptionMode>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    setPending(null);
    setSuccess(null);
    setError(null);
    setExceptionMode(null);
    setReason('');
  }, [order.id]);

  const blockers = useMemo(() => currentBlockers(order), [order]);
  const editable = order.status === 'needs_review' || order.status === 'draft';
  const active = ['accepted', 'processing', 'ready'].includes(order.status);
  const canAccept = editable && blockers.length === 0;

  async function run(action: WorkflowAction, operation: () => Promise<void>) {
    if (pending) return;

    setPending(action);
    setSuccess(null);
    setError(null);
    try {
      await operation();
      setSuccess(actionSuccess[action]);
      setExceptionMode(null);
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SellerTray could not complete that action.');
    } finally {
      setPending(null);
    }
  }

  async function confirmException() {
    const cleanReason = reason.trim();
    if (!exceptionMode || !cleanReason) return;

    if (exceptionMode === 'reject') {
      await run('reject', () => onReject(cleanReason));
    } else {
      await run('cancel', () => onCancel(cleanReason));
    }
  }

  return (
    <View style={styles.wrap}>
      {editable ? (
        blockers.length > 0 ? (
          <View style={styles.blockerCard}>
            <Text style={styles.blockerTitle}>Resolve before accepting</Text>
            {blockers.map((blocker) => (
              <Text key={blocker} style={styles.blockerText}>• {blocker}</Text>
            ))}
          </View>
        ) : (
          <View style={styles.readyCard}>
            <Text style={styles.readyTitle}>Ready to accept</Text>
            <Text style={styles.readyText}>The order currently has at least one item and every line has a selling price.</Text>
          </View>
        )
      ) : (
        <View style={styles.progressCard}>
          <Text style={styles.progressEyebrow}>WORKFLOW</Text>
          <Text style={styles.progressTitle}>{workflowHeadline(order.status)}</Text>
          <Text style={styles.progressText}>{workflowHelper(order.status)}</Text>
          {order.statusReason ? <Text style={styles.closureReason}>Reason: {order.statusReason}</Text> : null}
        </View>
      )}

      {success ? (
        <View style={styles.successCard}>
          <Text style={styles.successText}>{success}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Action failed</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorHint}>The order was not intentionally advanced. Check the message above and retry.</Text>
        </View>
      ) : null}

      {exceptionMode ? (
        <ExceptionReasonForm
          mode={exceptionMode}
          reason={reason}
          pending={pending !== null}
          onChangeReason={setReason}
          onCancel={() => {
            if (pending) return;
            setExceptionMode(null);
            setReason('');
            setError(null);
          }}
          onConfirm={() => void confirmException()}
        />
      ) : (
        <WorkflowActions
          status={order.status}
          canAccept={canAccept}
          pending={pending}
          onRequestReject={() => {
            setSuccess(null);
            setError(null);
            setExceptionMode('reject');
          }}
          onAccept={() => void run('accept', onAccept)}
          onStart={() => void run('start', onStart)}
          onReady={() => void run('ready', onReady)}
          onRequestCancel={() => {
            setSuccess(null);
            setError(null);
            setExceptionMode('cancel');
          }}
          showCancel={active}
        />
      )}
    </View>
  );
}

function currentBlockers(order: MerchantOrder): string[] {
  const blockers: string[] = [];
  if (order.items.length === 0) blockers.push('Add at least one product to the order.');

  const missingPriceCount = order.items.filter((item) => item.unitPrice === null).length;
  if (missingPriceCount > 0) {
    blockers.push(`Set a selling price for ${missingPriceCount} line${missingPriceCount === 1 ? '' : 's'}.`);
  }

  return blockers;
}

function ExceptionReasonForm({
  mode,
  reason,
  pending,
  onChangeReason,
  onCancel,
  onConfirm,
}: {
  mode: Exclude<ExceptionMode, null>;
  reason: string;
  pending: boolean;
  onChangeReason: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const reject = mode === 'reject';
  const canConfirm = Boolean(reason.trim()) && !pending;

  return (
    <View style={styles.reasonCard}>
      <Text style={styles.reasonTitle}>{reject ? 'Why are you rejecting this order?' : 'Why are you cancelling this order?'}</Text>
      <Text style={styles.reasonHelp}>This reason is saved to the order history for accountability.</Text>
      <TextInput
        value={reason}
        onChangeText={onChangeReason}
        placeholder={reject ? 'e.g. Product unavailable' : 'e.g. Customer cancelled after confirmation'}
        maxLength={500}
        multiline
        style={styles.reasonInput}
      />
      <Text style={styles.reasonCount}>{reason.length}/500</Text>
      <View style={styles.actionRow}>
        <ActionButton label="Back" secondary disabled={pending} onPress={onCancel} />
        <ActionButton
          label={pending ? 'Saving…' : reject ? 'Confirm rejection' : 'Confirm cancellation'}
          destructive
          disabled={!canConfirm}
          loading={pending}
          onPress={onConfirm}
        />
      </View>
    </View>
  );
}

function WorkflowActions({
  status,
  canAccept,
  pending,
  onRequestReject,
  onAccept,
  onStart,
  onReady,
  onRequestCancel,
  showCancel,
}: {
  status: OrderStatus;
  canAccept: boolean;
  pending: WorkflowAction | null;
  onRequestReject: () => void;
  onAccept: () => void;
  onStart: () => void;
  onReady: () => void;
  onRequestCancel: () => void;
  showCancel: boolean;
}) {
  const busy = pending !== null;

  if (status === 'needs_review' || status === 'draft') {
    return (
      <View style={styles.actionRow}>
        <ActionButton label="Reject" secondary disabled={busy} onPress={onRequestReject} />
        <ActionButton
          label={pending === 'accept' ? 'Accepting…' : 'Accept order'}
          disabled={!canAccept || busy}
          loading={pending === 'accept'}
          onPress={onAccept}
        />
      </View>
    );
  }

  if (status === 'accepted') {
    return (
      <View style={styles.stackActions}>
        <ActionButton label={pending === 'start' ? 'Starting…' : 'Start processing'} disabled={busy} loading={pending === 'start'} onPress={onStart} />
        {showCancel ? <ActionButton label="Cancel order" secondary disabled={busy} onPress={onRequestCancel} /> : null}
      </View>
    );
  }

  if (status === 'processing') {
    return (
      <View style={styles.stackActions}>
        <ActionButton label={pending === 'ready' ? 'Updating…' : 'Mark ready'} disabled={busy} loading={pending === 'ready'} onPress={onReady} />
        {showCancel ? <ActionButton label="Cancel order" secondary disabled={busy} onPress={onRequestCancel} /> : null}
      </View>
    );
  }

  if (status === 'ready') {
    return showCancel ? (
      <View style={styles.stackActions}>
        <ActionButton label="Cancel order" secondary disabled={busy} onPress={onRequestCancel} />
      </View>
    ) : null;
  }

  return null;
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  destructive = false,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        secondary && styles.actionButtonSecondary,
        destructive && styles.actionButtonDestructive,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading ? <ActivityIndicator size="small" /> : null}
      <Text style={[styles.actionButtonText, secondary && styles.actionButtonSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

function workflowHeadline(status: OrderStatus): string {
  if (status === 'accepted') return 'Accepted';
  if (status === 'processing') return 'Processing';
  if (status === 'ready') return 'Ready for customer';
  if (status === 'completed') return 'Completed';
  if (status === 'rejected') return 'Rejected';
  if (status === 'cancelled') return 'Cancelled';
  return 'Needs review';
}

function workflowHelper(status: OrderStatus): string {
  if (status === 'accepted') return 'Next action: start processing when fulfilment begins.';
  if (status === 'processing') return 'Next action: mark the order ready when fulfilment is complete.';
  if (status === 'ready') return 'Next action: record customer pickup or delivery below before completing the order.';
  if (status === 'completed') return 'No further workflow action is required.';
  if (status === 'rejected') return 'This order is closed and cannot be progressed.';
  if (status === 'cancelled') return 'This order is closed and cannot be progressed.';
  return 'Review the items and prices before accepting.';
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  blockerCard: { backgroundColor: '#FFF8E7', borderRadius: 12, padding: 12, gap: 4 },
  blockerTitle: { color: '#7A2E0E', fontSize: 12, fontWeight: '900' },
  blockerText: { color: '#854A0E', fontSize: 11, lineHeight: 17 },
  readyCard: { backgroundColor: '#ECFDF3', borderRadius: 12, padding: 12, gap: 3 },
  readyTitle: { color: '#027A48', fontSize: 12, fontWeight: '900' },
  readyText: { color: '#05603A', fontSize: 11, lineHeight: 17 },
  progressCard: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12 },
  progressEyebrow: { color: '#98A2B3', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  progressTitle: { color: '#101828', fontSize: 14, fontWeight: '900', marginTop: 3 },
  progressText: { color: '#667085', fontSize: 11, lineHeight: 17, marginTop: 3 },
  closureReason: { color: '#344054', fontSize: 11, lineHeight: 17, marginTop: 7, fontWeight: '700' },
  successCard: { backgroundColor: '#ECFDF3', borderRadius: 12, padding: 11 },
  successText: { color: '#027A48', fontSize: 11, fontWeight: '800', lineHeight: 17 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 12, padding: 12 },
  errorTitle: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 11, lineHeight: 17, marginTop: 3 },
  errorHint: { color: '#B54708', fontSize: 10, lineHeight: 15, marginTop: 4 },
  reasonCard: { borderWidth: 1, borderColor: '#FDA29B', borderRadius: 12, padding: 12, gap: 8, backgroundColor: '#FFFBFA' },
  reasonTitle: { color: '#912018', fontSize: 13, fontWeight: '900' },
  reasonHelp: { color: '#667085', fontSize: 11, lineHeight: 16 },
  reasonInput: { minHeight: 76, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, padding: 10, backgroundColor: '#FFFFFF', color: '#101828', textAlignVertical: 'top' },
  reasonCount: { color: '#98A2B3', fontSize: 9, textAlign: 'right' },
  actionRow: { flexDirection: 'row', gap: 9 },
  stackActions: { gap: 8 },
  actionButton: { minHeight: 46, backgroundColor: '#246BFD', borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, paddingHorizontal: 12, flex: 1 },
  actionButtonSecondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD' },
  actionButtonDestructive: { backgroundColor: '#D92D20' },
  actionButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  actionButtonSecondaryText: { color: '#344054' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
});
