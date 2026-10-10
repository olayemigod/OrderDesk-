import { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { createPosDraft } from '../data/commerceRepository';
import type { CommerceBranch } from '../data/commerceRepository';
import {
  listPendingPosDrafts,
  removePendingPosDraft,
  type PendingPosDraftSync,
} from '../data/offlinePosDraftQueue';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  onClose: () => void;
  onOpenOrders?: () => void;
};

export function SyncStatusWorkspace({ tenantId, branch, onClose, onOpenOrders }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [pending, setPending] = useState<PendingPosDraftSync[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPending(await listPendingPosDrafts(tenantId, branch.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read pending sync work.');
    } finally {
      setLoading(false);
    }
  }, [branch.id, tenantId]);

  useEffect(() => {
    setError(null);
    setNotice(null);
    void refresh();
  }, [refresh]);

  async function retry(entry: PendingPosDraftSync) {
    if (busyId) return;
    setBusyId(entry.requestId);
    setError(null);
    setNotice(null);
    try {
      await createPosDraft({
        tenantId: entry.tenantId,
        branchId: entry.branchId,
        requestId: entry.requestId,
        items: entry.items,
      });
      setNotice('Draft saved to SellerTray. No payment or stock movement was posted by this sync.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sync this draft yet.');
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  function discard(entry: PendingPosDraftSync) {
    if (busyId) return;
    Alert.alert(
      'Discard local retry?',
      'This removes only the pending retry from this device. It does not cancel a SellerTray draft that may already exist on the server.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Discard retry',
          style: 'destructive',
          onPress: () => {
            setBusyId(entry.requestId);
            setError(null);
            setNotice(null);
            void removePendingPosDraft(entry.tenantId, entry.requestId)
              .then(() => refresh())
              .catch((cause) => {
                setError(cause instanceof Error ? cause.message : 'Unable to discard this retry.');
              })
              .finally(() => setBusyId(null));
          },
        },
      ],
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.topRow}>
        <Pressable onPress={onClose} style={({ pressed }) => [styles.backButton, dark && darkStyles.card, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={20} color={dark ? theme.colors.cloud : theme.colors.navy} />
        </Pressable>
        <View style={styles.headingCopy}>
          <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SYNC STATUS</Text>
          <Text style={[styles.title, dark && darkStyles.titleText]}>Pending draft saves</Text>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
            Review draft-sale saves for {branch.name} that did not receive a confirmed server response.
          </Text>
        </View>
      </View>

      <View style={[styles.safetyCard, dark && darkStyles.safetyCard]}>
        <Ionicons name="shield-checkmark-outline" size={21} color={theme.colors.greenDark} />
        <View style={styles.safetyCopy}>
          <Text style={[styles.safetyTitle, dark && darkStyles.titleText]}>Draft sync only</Text>
          <Text style={[styles.helper, dark && darkStyles.bodyText]}>
            Retrying can only create or recover an unpaid draft. It never confirms cash, deducts stock, or issues a receipt. Current server pricing and permissions still apply.
          </Text>
        </View>
      </View>

      {notice ? (
        <View style={[styles.noticeCard, dark && darkStyles.noticeCard]}>
          <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.greenDark} />
          <Text style={[styles.noticeText, dark && darkStyles.bodyText]}>{notice}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
          <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={[styles.card, dark && darkStyles.card, styles.centered]}>
          <ActivityIndicator />
          <Text style={[styles.helper, dark && darkStyles.bodyText]}>Checking pending sync work…</Text>
        </View>
      ) : null}

      {!loading && pending.length === 0 ? (
        <View style={[styles.card, dark && darkStyles.card, styles.centered]}>
          <Ionicons name="cloud-done-outline" size={30} color={theme.colors.greenDark} />
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>Nothing pending</Text>
          <Text style={[styles.helper, dark && darkStyles.bodyText]}>
            There are no unresolved draft saves for this Branch on this device.
          </Text>
          {onOpenOrders ? (
            <Pressable onPress={onOpenOrders} style={({ pressed }) => [styles.secondaryButton, dark && darkStyles.secondary, pressed && styles.pressed]}>
              <Text style={[styles.secondaryButtonText, dark && darkStyles.titleText]}>Open Orders</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {pending.map((entry) => {
        const busy = busyId === entry.requestId;
        const quantity = entry.items.reduce((sum, item) => sum + item.quantity, 0);
        return (
          <View key={entry.requestId} style={[styles.card, dark && darkStyles.card]}>
            <View style={styles.cardTopRow}>
              <View style={styles.cardTitleCopy}>
                <Text style={[styles.cardTitle, dark && darkStyles.titleText]}>
                  {entry.items.length} {entry.items.length === 1 ? 'product' : 'products'} · {formatQuantity(quantity)} units
                </Text>
                <Text style={[styles.meta, dark && darkStyles.bodyText]}>
                  First saved {formatTime(entry.createdAt)} · Attempts {entry.attemptCount}
                </Text>
              </View>
              <View style={[styles.pendingPill, dark && darkStyles.secondary]}>
                <Text style={[styles.pendingPillText, dark && darkStyles.bodyText]}>Pending</Text>
              </View>
            </View>

            {entry.lastError ? (
              <View style={[styles.inlineError, dark && darkStyles.errorCard]}>
                <Text style={[styles.inlineErrorText, dark && darkStyles.bodyText]}>{entry.lastError}</Text>
              </View>
            ) : null}

            <View style={styles.actionRow}>
              <Pressable
                disabled={Boolean(busyId)}
                onPress={() => void retry(entry)}
                style={({ pressed }) => [styles.primaryButton, Boolean(busyId) && styles.disabled, pressed && !busyId && styles.pressed]}
              >
                {busy ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="sync-outline" size={17} color={theme.colors.white} />}
                <Text style={styles.primaryButtonText}>{busy ? 'Retrying' : 'Retry draft save'}</Text>
              </Pressable>
              <Pressable
                disabled={Boolean(busyId)}
                onPress={() => discard(entry)}
                style={({ pressed }) => [styles.discardButton, dark && darkStyles.secondary, Boolean(busyId) && styles.disabled, pressed && !busyId && styles.pressed]}
              >
                <Text style={[styles.discardText, dark && darkStyles.bodyText]}>Discard local retry</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'earlier';
  return date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  topRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  headingCopy: { flex: 1, gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { color: theme.colors.navy, fontSize: 25, lineHeight: 31, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 12, lineHeight: 18 },
  safetyCard: { borderRadius: 14, borderWidth: 1, borderColor: '#A6F4C5', backgroundColor: theme.colors.mintSoft, padding: 12, flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  safetyCopy: { flex: 1, gap: 3 },
  safetyTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  helper: { color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  noticeCard: { borderRadius: 14, borderWidth: 1, borderColor: '#A6F4C5', backgroundColor: '#ECFDF3', padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  noticeText: { flex: 1, color: theme.colors.greenDark, fontSize: 11, lineHeight: 17 },
  errorCard: { borderRadius: 14, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: '#FEF3F2', padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  errorText: { flex: 1, color: '#B42318', fontSize: 11, lineHeight: 17 },
  card: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 10 },
  centered: { alignItems: 'center' },
  emptyTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  secondaryButton: { minHeight: 40, borderRadius: 12, backgroundColor: theme.colors.cloud, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: theme.colors.navy, fontSize: 11, fontWeight: '900' },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitleCopy: { flex: 1, gap: 3 },
  cardTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  meta: { color: theme.colors.muted, fontSize: 10, lineHeight: 15 },
  pendingPill: { borderRadius: 20, backgroundColor: '#FEF0C7', paddingHorizontal: 8, paddingVertical: 4 },
  pendingPillText: { color: '#B54708', fontSize: 9, fontWeight: '900' },
  inlineError: { borderRadius: 10, backgroundColor: '#FEF3F2', padding: 9 },
  inlineErrorText: { color: '#B42318', fontSize: 10, lineHeight: 15 },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  primaryButton: { minHeight: 42, borderRadius: 12, backgroundColor: theme.colors.green, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryButtonText: { color: theme.colors.white, fontSize: 11, fontWeight: '900' },
  discardButton: { minHeight: 42, borderRadius: 12, backgroundColor: theme.colors.cloud, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  discardText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.76 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  secondary: { backgroundColor: '#1D2939' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
  safetyCard: { backgroundColor: '#102A43', borderColor: '#12B76A' },
  noticeCard: { backgroundColor: '#102A43', borderColor: '#12B76A' },
  errorCard: { backgroundColor: '#451A1A', borderColor: '#B42318' },
});
