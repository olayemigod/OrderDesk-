import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { WhatsAppConnectionView } from '../components/WhatsAppConnectionView';
import type { MerchantBusiness } from '../data/businessRepository';
import type { CommerceBranch } from '../data/commerceRepository';
import {
  loadWhatsAppBranchRoute,
  setWhatsAppBranchRoute,
  type WhatsAppBranchRoute,
} from '../data/whatsappBranchRepository';
import type { MerchantOrder } from '../domain/order';
import { useConversationUnreadCounts } from '../hooks/useConversationUnreadCounts';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  business: MerchantBusiness;
  branch: CommerceBranch;
  branches: CommerceBranch[];
  orders: MerchantOrder[];
  onClose: () => void;
  onOpenOrders: () => void;
};

type ConversationRow = {
  customerId: string;
  customerName: string;
  customerPhone: string;
  orderCount: number;
  attentionCount: number;
  latestAt: string;
  latestMessage: string;
};

export function WhatsAppWorkspace({
  business,
  branch,
  branches,
  orders,
  onClose,
  onOpenOrders,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const unread = useConversationUnreadCounts(business.id, branch.id);
  const [route, setRoute] = useState<WhatsAppBranchRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(true);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const whatsappOrders = useMemo(
    () => orders.filter((order) => order.source === 'whatsapp' && order.branchId === branch.id),
    [orders, branch.id],
  );

  const conversations = useMemo(() => groupConversations(whatsappOrders), [whatsappOrders]);
  const routedBranch = route ? branches.find((candidate) => candidate.id === route.branchId) ?? null : null;
  const canManageRoute = business.role === 'owner' || business.role === 'manager';
  const routedHere = route?.branchId === branch.id;

  useEffect(() => {
    let mounted = true;
    setRouteLoading(true);
    setRouteError(null);
    void loadWhatsAppBranchRoute(business.id)
      .then((next) => {
        if (mounted) setRoute(next);
      })
      .catch((error) => {
        if (mounted) setRouteError(error instanceof Error ? error.message : 'Unable to load WhatsApp Branch routing.');
      })
      .finally(() => {
        if (mounted) setRouteLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [business.id]);

  async function routeToCurrentBranch() {
    if (!canManageRoute || !route || routedHere || routeBusy) return;
    setRouteBusy(true);
    setRouteError(null);
    try {
      setRoute(await setWhatsAppBranchRoute(business.id, branch.id));
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : 'Unable to change the WhatsApp receiving Branch.');
    } finally {
      setRouteBusy(false);
    }
  }

  async function openConversation(row: ConversationRow) {
    const unreadState = unread.unreadByCustomer.get(row.customerId);
    if ((unreadState?.unreadCount ?? 0) > 0) {
      try {
        await unread.markRead(row.customerId, unreadState?.latestReceivedAt ?? row.latestAt);
      } catch {
        // Opening shared Orders must not be blocked if read-state sync fails.
      }
    }
    onOpenOrders();
  }

  return (
    <View style={styles.stack}>
      <Pressable onPress={onClose} style={styles.backRow}>
        <Ionicons name="chevron-back" size={20} color={dark ? theme.colors.cloud : theme.colors.navy} />
        <Text style={[styles.backText, dark && darkStyles.titleText]}>More</Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>WHATSAPP</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>WhatsApp selling</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Customer chats stay on WhatsApp. SellerTray turns supported messages into the same Branch orders, payments and stock workflow used everywhere else.
        </Text>
      </View>

      <View style={[styles.routeCard, routedHere && styles.routeCardActive, dark && darkStyles.card]}>
        <View style={styles.routeHeader}>
          <View style={[styles.routeIcon, routedHere && styles.routeIconActive]}>
            <Ionicons name="logo-whatsapp" size={22} color={theme.colors.greenDark} />
          </View>
          <View style={styles.flexOne}>
            <Text style={[styles.routeTitle, dark && darkStyles.titleText]}>Receiving Branch</Text>
            {routeLoading ? (
              <Text style={[styles.routeText, dark && darkStyles.bodyText]}>Loading WhatsApp routing…</Text>
            ) : route ? (
              <Text style={[styles.routeText, dark && darkStyles.bodyText]}>
                New WhatsApp messages currently enter {routedBranch?.name ?? 'the configured Branch'}.
              </Text>
            ) : (
              <Text style={[styles.routeText, dark && darkStyles.bodyText]}>
                Connect WhatsApp below. New connections initially receive orders in Main Branch.
              </Text>
            )}
          </View>
          {routeLoading ? <ActivityIndicator size="small" /> : null}
        </View>

        {routeError ? <Text style={styles.errorText}>{routeError}</Text> : null}

        {route && !routedHere && canManageRoute ? (
          <Pressable disabled={routeBusy} onPress={() => void routeToCurrentBranch()} style={[styles.routeButton, routeBusy && styles.disabled]}>
            {routeBusy ? <ActivityIndicator size="small" color={theme.colors.white} /> : <Ionicons name="git-branch-outline" size={17} color={theme.colors.white} />}
            <Text style={styles.routeButtonText}>{routeBusy ? 'Updating…' : `Receive WhatsApp in ${branch.name}`}</Text>
          </Pressable>
        ) : null}

        {route && routedHere ? (
          <View style={styles.routeActiveRow}>
            <Ionicons name="checkmark-circle" size={17} color={theme.colors.greenDark} />
            <Text style={styles.routeActiveText}>New WhatsApp orders are routed to this Branch.</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={[styles.sectionLabel, dark && darkStyles.bodyText]}>CUSTOMER CHATS</Text>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Order conversations</Text>
          </View>
          {unread.unreadCount > 0 ? (
            <View style={styles.unreadTotalPill}>
              <Text style={styles.unreadTotalText}>{unread.unreadCount} unread</Text>
            </View>
          ) : null}
        </View>

        {unread.error ? <Text style={styles.errorText}>{unread.error}</Text> : null}

        {conversations.length === 0 ? (
          <View style={[styles.emptyCard, dark && darkStyles.card]}>
            <Ionicons name="chatbubbles-outline" size={26} color={theme.colors.greenDark} />
            <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No WhatsApp orders in {branch.name}</Text>
            <Text style={[styles.emptyText, dark && darkStyles.bodyText]}>
              Supported customer order messages routed to this Branch will appear here and in Orders.
            </Text>
          </View>
        ) : null}

        {conversations.map((row) => {
          const unreadCount = unread.unreadByCustomer.get(row.customerId)?.unreadCount ?? 0;
          return (
            <Pressable
              key={row.customerId}
              onPress={() => void openConversation(row)}
              style={({ pressed }) => [styles.conversationCard, dark && darkStyles.card, pressed && styles.pressed]}
            >
              <View style={styles.conversationTop}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(row.customerName)}</Text>
                </View>
                <View style={styles.flexOne}>
                  <View style={styles.conversationNameRow}>
                    <Text style={[styles.customerName, dark && darkStyles.titleText]} numberOfLines={1}>{row.customerName}</Text>
                    {unreadCount > 0 ? (
                      <View style={styles.unreadPill}><Text style={styles.unreadText}>{unreadCount}</Text></View>
                    ) : null}
                  </View>
                  <Text style={[styles.customerPhone, dark && darkStyles.bodyText]}>{row.customerPhone || 'WhatsApp customer'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.subtle} />
              </View>

              <Text style={[styles.messageText, dark && darkStyles.bodyText]} numberOfLines={2}>
                {row.latestMessage || 'WhatsApp order received'}
              </Text>

              <View style={styles.conversationFooter}>
                <Text style={[styles.metaText, dark && darkStyles.bodyText]}>
                  {row.orderCount} {row.orderCount === 1 ? 'order' : 'orders'} · {formatTime(row.latestAt)}
                </Text>
                {row.attentionCount > 0 ? (
                  <Text style={styles.attentionText}>{row.attentionCount} need attention</Text>
                ) : (
                  <Text style={styles.openText}>Open Orders</Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionLabel, dark && darkStyles.bodyText]}>CONNECTION & CONSENT</Text>
        <WhatsAppConnectionView business={business} />
      </View>
    </View>
  );
}

function groupConversations(orders: MerchantOrder[]): ConversationRow[] {
  const grouped = new Map<string, ConversationRow>();
  for (const order of orders) {
    const existing = grouped.get(order.customerId);
    const needsAttention = order.status === 'needs_review' || order.paymentStatus === 'verification_required' || order.paymentStatus === 'payment_issue';
    if (!existing) {
      grouped.set(order.customerId, {
        customerId: order.customerId,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        orderCount: 1,
        attentionCount: needsAttention ? 1 : 0,
        latestAt: order.receivedAt,
        latestMessage: order.customerMessage,
      });
      continue;
    }
    existing.orderCount += 1;
    existing.attentionCount += needsAttention ? 1 : 0;
    if (new Date(order.receivedAt).getTime() > new Date(existing.latestAt).getTime()) {
      existing.latestAt = order.receivedAt;
      existing.latestMessage = order.customerMessage;
      existing.customerName = order.customerName;
      existing.customerPhone = order.customerPhone;
    }
  }
  return [...grouped.values()].sort(
    (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'WA';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-NG', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  backRow: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 4 },
  backText: { color: theme.colors.navy, fontSize: 13, fontWeight: '800' },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { color: theme.colors.navy, fontSize: 27, lineHeight: 33, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 13, lineHeight: 19 },
  routeCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 10 },
  routeCardActive: { borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft },
  routeHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  routeIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: theme.colors.cloud, alignItems: 'center', justifyContent: 'center' },
  routeIconActive: { backgroundColor: '#DCFAE6' },
  routeTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  routeText: { color: theme.colors.slate, fontSize: 11, lineHeight: 17, marginTop: 2 },
  routeButton: { minHeight: 42, borderRadius: 12, backgroundColor: theme.colors.green, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  routeButtonText: { color: theme.colors.white, fontSize: 11, fontWeight: '900', textAlign: 'center', flexShrink: 1 },
  routeActiveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  routeActiveText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '800', flex: 1 },
  errorText: { color: theme.colors.danger, fontSize: 11, lineHeight: 17, fontWeight: '700' },
  section: { gap: 9 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  sectionTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900', marginTop: 2 },
  unreadTotalPill: { borderRadius: 14, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 9, paddingVertical: 5 },
  unreadTotalText: { color: theme.colors.greenDark, fontSize: 10, fontWeight: '900' },
  emptyCard: { minHeight: 120, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 15, alignItems: 'center', justifyContent: 'center', gap: 7 },
  emptyTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  conversationCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 12, gap: 9 },
  conversationTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  conversationNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customerName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900', flexShrink: 1 },
  customerPhone: { color: theme.colors.muted, fontSize: 10, marginTop: 2 },
  unreadPill: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadText: { color: theme.colors.white, fontSize: 9, fontWeight: '900' },
  messageText: { color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  conversationFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metaText: { color: theme.colors.muted, fontSize: 10, flexShrink: 1 },
  attentionText: { color: '#B54708', fontSize: 10, fontWeight: '900' },
  openText: { color: theme.colors.greenDark, fontSize: 10, fontWeight: '900' },
  flexOne: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.45 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});
