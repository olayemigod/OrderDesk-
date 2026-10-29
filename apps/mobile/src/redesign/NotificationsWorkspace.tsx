import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MerchantNotification } from '../data/merchantNotificationsRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  notifications: MerchantNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onMarkRead: (notificationId: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onOpenOrder: (orderId: string) => void;
};

export function NotificationsWorkspace({
  notifications,
  unreadCount,
  loading,
  error,
  onBack,
  onRefresh,
  onMarkRead,
  onMarkAllRead,
  onOpenOrder,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);


  async function markRead(notification: MerchantNotification) {
    if (notification.isRead || pendingId) return;
    setPendingId(notification.id);
    setActionError(null);
    try {
      await onMarkRead(notification.id);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to mark this notification as read.');
    } finally {
      setPendingId(null);
    }
  }

  async function openNotification(notification: MerchantNotification) {
    if (!notification.isRead) {
      setPendingId(notification.id);
      setActionError(null);
      try {
        await onMarkRead(notification.id);
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : 'Unable to mark this notification as read.');
        setPendingId(null);
        return;
      }
      setPendingId(null);
    }

    if (notification.orderId) onOpenOrder(notification.orderId);
  }

  async function markAllRead() {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    setActionError(null);
    try {
      await onMarkAllRead();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to mark notifications as read.');
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <View style={styles.page}>
      <View style={styles.titleRow}>
        <Pressable
          accessibilityLabel="Back from notifications"
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, dark && darkStyles.card, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={20} color={dark ? theme.colors.mint : theme.colors.navy} />
        </Pressable>
        <View style={styles.titleCopy}>
          <Text style={[styles.title, dark && darkStyles.titleText]}>Notifications</Text>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up'}
          </Text>
        </View>
        {unreadCount > 0 ? (
          <Pressable
            accessibilityLabel="Mark all notifications as read"
            disabled={markingAll}
            onPress={() => void markAllRead()}
            style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
          >
            {markingAll ? <ActivityIndicator size="small" color={theme.colors.greenDark} /> : null}
            <Text style={styles.textButtonLabel}>{markingAll ? 'Updating' : 'Mark all read'}</Text>
          </Pressable>
        ) : null}
      </View>

      {actionError || error ? (
        <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
          <View style={styles.errorCopy}>
            <Text style={[styles.errorTitle, dark && darkStyles.titleText]}>Notifications could not update</Text>
            <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{actionError || error}</Text>
            <Pressable onPress={() => void onRefresh()} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {loading && notifications.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <ActivityIndicator color={theme.colors.greenDark} />
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>Loading notifications</Text>
        </View>
      ) : notifications.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <View style={styles.emptyIcon}>
            <Ionicons name="notifications-off-outline" size={28} color={theme.colors.greenDark} />
          </View>
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No notifications yet</Text>
          <Text style={[styles.emptyText, dark && darkStyles.bodyText]}>
            SellerTray will show business notifications here when something needs your attention.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {notifications.map((notification) => {
            const tone = notificationTone(notification.severity);
            const pending = pendingId === notification.id;
            return (
              <View
                key={notification.id}
                style={[
                  styles.notificationCard,
                  dark && darkStyles.card,
                  !notification.isRead && styles.unreadCard,
                  dark && !notification.isRead && darkStyles.unreadCard,
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: tone.background }]}>
                  <Ionicons name={tone.icon as never} size={20} color={tone.foreground} />
                </View>
                <View style={styles.notificationCopy}>
                  <View style={styles.notificationHeading}>
                    <Text style={[styles.notificationTitle, dark && darkStyles.titleText]}>{notification.title}</Text>
                    {!notification.isRead ? <View accessibilityLabel="Unread notification" style={styles.unreadDot} /> : null}
                  </View>
                  <Text style={[styles.notificationBody, dark && darkStyles.bodyText]}>{notification.body}</Text>
                  <Text style={[styles.notificationTime, dark && darkStyles.mutedText]}>{formatNotificationTime(notification.createdAt)}</Text>
                  <View style={styles.actions}>
                    {!notification.isRead ? (
                      <Pressable
                        disabled={pending}
                        onPress={() => void markRead(notification)}
                        style={({ pressed }) => [styles.secondaryButton, dark && darkStyles.secondaryButton, pressed && styles.pressed]}
                      >
                        {pending ? <ActivityIndicator size="small" color={theme.colors.greenDark} /> : <Ionicons name="checkmark-outline" size={16} color={theme.colors.greenDark} />}
                        <Text style={styles.secondaryButtonText}>{pending ? 'Updating' : 'Mark read'}</Text>
                      </Pressable>
                    ) : null}
                    {notification.orderId ? (
                      <Pressable
                        disabled={pending}
                        onPress={() => void openNotification(notification)}
                        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                      >
                        <Text style={styles.primaryButtonText}>Open order</Text>
                        <Ionicons name="arrow-forward" size={16} color={theme.colors.white} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function notificationTone(severity: MerchantNotification['severity']) {
  if (severity === 'urgent') {
    return { icon: 'alert-circle-outline', foreground: theme.colors.danger, background: theme.colors.dangerSoft };
  }
  if (severity === 'attention') {
    return { icon: 'warning-outline', foreground: '#B54708', background: theme.colors.warningSoft };
  }
  return { icon: 'notifications-outline', foreground: theme.colors.info, background: theme.colors.infoSoft };
}

function formatNotificationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  titleRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCopy: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.navy, fontSize: 22, fontWeight: '900' },
  subtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  textButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4 },
  textButtonLabel: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  list: { gap: 10 },
  notificationCard: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.white,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  unreadCard: { borderColor: '#ABEFC6', backgroundColor: '#F6FEF9' },
  iconWrap: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  notificationCopy: { flex: 1, minWidth: 0 },
  notificationHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notificationTitle: { flex: 1, color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.green },
  notificationBody: { color: theme.colors.slate, fontSize: 12, lineHeight: 18, marginTop: 4 },
  notificationTime: { color: theme.colors.subtle, fontSize: 10, fontWeight: '700', marginTop: 7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  secondaryButton: {
    minHeight: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#ABEFC6',
    backgroundColor: theme.colors.mintSoft,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  secondaryButtonText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  primaryButton: {
    minHeight: 36,
    borderRadius: 11,
    backgroundColor: theme.colors.green,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  primaryButtonText: { color: theme.colors.white, fontSize: 11, fontWeight: '900' },
  errorCard: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: '#FDA29B',
    backgroundColor: theme.colors.dangerSoft,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  errorCopy: { flex: 1 },
  errorTitle: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 11, lineHeight: 17, marginTop: 2 },
  retryButton: { alignSelf: 'flex-start', marginTop: 7 },
  retryText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  emptyCard: {
    minHeight: 180,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.white,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  emptyText: { maxWidth: 300, color: theme.colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  unreadCard: { backgroundColor: '#12372C', borderColor: '#218A5A' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
  mutedText: { color: '#98A2B3' },
  secondaryButton: { backgroundColor: '#12372C', borderColor: '#218A5A' },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
});
