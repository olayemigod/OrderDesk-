import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MerchantOrder, OrderStatus } from '../domain/order';

type WorkflowAction = 'reject' | 'accept' | 'start' | 'ready' | 'complete';

type Props = {
  order: MerchantOrder;
  onReject: () => Promise<void>;
  onAccept: () => Promise<void>;
  onStart: () => Promise<void>;
  onReady: () => Promise<void>;
  onComplete: () => Promise<void>;
};

const actionSuccess: Record<WorkflowAction, string> = {
  reject: 'Order rejected.',
  accept: 'Order accepted. It is ready to move into processing.',
  start: 'Processing started.',
  ready: 'Order marked ready.',
  complete: 'Order completed.',
};

export function OrderWorkflowPanel({
  order,
  onReject,
  onAccept,
  onStart,
  onReady,
  onComplete,
}: Props) {
  const [pending, setPending] = useState<WorkflowAction | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPending(null);
    setSuccess(null);
    setError(null);
  }, [order.id]);

  const blockers = useMemo(() => currentBlockers(order), [order]);
  const editable = order.status === 'needs_review' || order.status === 'draft';
  const canAccept = editable && blockers.length === 0;

  async function run(action: WorkflowAction, operation: () => Promise<void>) {
    if (pending) return;

    setPending(action);
    setSuccess(null);
    setError(null);
    try {
      await operation();
      setSuccess(actionSuccess[action]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OrderDesk could not complete that action.');
    } finally {
      setPending(null);
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

      <WorkflowActions
        status={order.status}
        canAccept={canAccept}
        pending={pending}
        onReject={() => run('reject', onReject)}
        onAccept={() => run('accept', onAccept)}
        onStart={() => run('start', onStart)}
        onReady={() => run('ready', onReady)}
        onComplete={() => run('complete', onComplete)}
      />
    </View>
  );
}

function currentBlockers(order: MerchantOrder): string[] {
  const blockers: string[] = [];
  if (order.items.length === 0) blockers.push('Add at least one product to the order.');

  const missingPriceCount = order.items.filter((item) => item.unitPrice === null).length;
  if (missingPriceCount > 0) {
    blockers.push(
      `Set a selling price for ${missingPriceCount} line${missingPriceCount === 1 ? '' : 's'}.`,
    );
  }

  return blockers;
}

function WorkflowActions({
  status,
  canAccept,
  pending,
  onReject,
  onAccept,
  onStart,
  onReady,
  onComplete,
}: {
  status: OrderStatus;
  canAccept: boolean;
  pending: WorkflowAction | null;
  onReject: () => void;
  onAccept: () => void;
  onStart: () => void;
  onReady: () => void;
  onComplete: () => void;
}) {
  const busy = pending !== null;

  if (status === 'needs_review' || status === 'draft') {
    return (
      <View style={styles.actionRow}>
        <ActionButton
          label={pending === 'reject' ? 'Rejecting…' : 'Reject'}
          secondary
          disabled={busy}
          loading={pending === 'reject'}
          onPress={onReject}
        />
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
      <ActionButton
        label={pending === 'start' ? 'Starting…' : 'Start processing'}
        disabled={busy}
        loading={pending === 'start'}
        onPress={onStart}
      />
    );
  }

  if (status === 'processing') {
    return (
      <ActionButton
        label={pending === 'ready' ? 'Updating…' : 'Mark ready'}
        disabled={busy}
        loading={pending === 'ready'}
        onPress={onReady}
      />
    );
  }

  if (status === 'ready') {
    return (
      <ActionButton
        label={pending === 'complete' ? 'Completing…' : 'Complete order'}
        disabled={busy}
        loading={pending === 'complete'}
        onPress={onComplete}
      />
    );
  }

  return null;
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
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
  if (status === 'ready') return 'Next action: complete the order after customer handover or delivery.';
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
  successCard: { backgroundColor: '#ECFDF3', borderRadius: 12, padding: 11 },
  successText: { color: '#027A48', fontSize: 11, fontWeight: '800', lineHeight: 17 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 12, padding: 12 },
  errorTitle: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 11, lineHeight: 17, marginTop: 3 },
  errorHint: { color: '#B54708', fontSize: 10, lineHeight: 15, marginTop: 4 },
  actionRow: { flexDirection: 'row', gap: 9 },
  actionButton: {
    flex: 1,
    minHeight: 46,
    backgroundColor: '#246BFD',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
  },
  actionButtonSecondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD' },
  actionButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  actionButtonSecondaryText: { color: '#344054' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
});
