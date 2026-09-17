import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  assignConversation,
  loadConversationMessages,
  loadConversations,
  replyToConversation,
  resolveConversation,
  returnConversationToAi,
  takeOverConversation,
  type ConversationMessage,
  type ConversationSummary,
  type ConversationWorkState,
} from '../data/conversationsRepository';
import { sendMerchantPaymentOptions } from '../data/orderPaymentsRepository';
import { loadTeam, type TeamMember } from '../data/teamRepository';
import { orderTotal, type MerchantOrder } from '../domain/order';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  orders: MerchantOrder[];
  currency: string;
  unreadByCustomer: Map<string, { unreadCount: number; latestReceivedAt: string | null }>;
  onMarkConversationRead: (customerId: string, through: string | null) => Promise<void>;
  onOpenOrder: (orderId: string) => void;
};

type InboxFilter = 'all' | 'unread' | ConversationWorkState;

const workStateLabels: Record<ConversationWorkState, string> = {
  ai_handling: 'AI handling',
  needs_merchant: 'Needs merchant',
  merchant_handling: 'Merchant handling',
  waiting_customer: 'Waiting customer',
  resolved: 'Resolved',
};

const filters: Array<{ key: InboxFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'needs_merchant', label: 'Needs merchant' },
  { key: 'merchant_handling', label: 'Merchant handling' },
  { key: 'ai_handling', label: 'AI handling' },
  { key: 'waiting_customer', label: 'Waiting customer' },
  { key: 'resolved', label: 'Resolved' },
];

export function ConversationsView({
  tenantId,
  orders,
  currency,
  unreadByCustomer,
  onMarkConversationRead,
  onOpenOrder,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [thread, setThread] = useState<ConversationMessage[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [query, setQuery] = useState('');
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [paymentBusyId, setPaymentBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [conversations, teamSnapshot] = await Promise.all([
        loadConversations(tenantId),
        loadTeam(tenantId),
      ]);
      setItems(conversations);
      setTeam(teamSnapshot.members);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load conversations.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const refreshThread = useCallback(async (customerId: string) => {
    if (!customerId) {
      setThread([]);
      return;
    }
    setThreadLoading(true);
    try {
      setThread(await loadConversationMessages(tenantId, customerId, 120));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load conversation history.');
    } finally {
      setThreadLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    setSelectedCustomerId('');
    setReplyText('');
    setThread([]);
    setNotice(null);
    setError(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedCustomerId) return;
    void refreshThread(selectedCustomerId);
  }, [refreshThread, selectedCustomerId]);

  const ordersByCustomer = useMemo(() => {
    const grouped = new Map<string, MerchantOrder[]>();
    orders
      .filter((order) => order.source === 'whatsapp' && order.customerId)
      .forEach((order) => {
        const existing = grouped.get(order.customerId) ?? [];
        existing.push(order);
        grouped.set(order.customerId, existing);
      });
    grouped.forEach((customerOrders) => {
      customerOrders.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
    });
    return grouped;
  }, [orders]);

  const selected = items.find((item) => item.customerId === selectedCustomerId) ?? null;
  const selectedOrders = selected ? ordersByCustomer.get(selected.customerId) ?? [] : [];

  const counts = useMemo(() => ({
    all: items.length,
    unread: items.filter((item) => (unreadByCustomer.get(item.customerId)?.unreadCount ?? 0) > 0).length,
    ai_handling: items.filter((item) => item.workState === 'ai_handling').length,
    needs_merchant: items.filter((item) => item.workState === 'needs_merchant').length,
    merchant_handling: items.filter((item) => item.workState === 'merchant_handling').length,
    waiting_customer: items.filter((item) => item.workState === 'waiting_customer').length,
    resolved: items.filter((item) => item.workState === 'resolved').length,
  }), [items, unreadByCustomer]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const unreadCount = unreadByCustomer.get(item.customerId)?.unreadCount ?? 0;
      const matchesFilter = filter === 'all' ||
        (filter === 'unread' && unreadCount > 0) ||
        item.workState === filter;
      if (!matchesFilter) return false;
      if (!normalized) return true;
      return [
        item.customerName,
        item.customerPhone ?? '',
        item.customerWaId,
        item.lastInboundText ?? '',
        item.lastOutboundText ?? '',
        item.latestOrderPublicId ?? '',
      ].join(' ').toLocaleLowerCase().includes(normalized);
    });
  }, [filter, items, query, unreadByCustomer]);

  async function runStateAction(
    actionKey: string,
    operation: () => Promise<void>,
    successMessage: string,
  ) {
    if (busyAction) return;
    setBusyAction(actionKey);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await refresh();
      if (selectedCustomerId) await refreshThread(selectedCustomerId);
      setNotice(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this conversation.');
    } finally {
      setBusyAction(null);
    }
  }

  async function openConversation(item: ConversationSummary) {
    setSelectedCustomerId(item.customerId);
    setReplyText('');
    setNotice(null);
    setError(null);
    const unread = unreadByCustomer.get(item.customerId);
    const through = unread?.latestReceivedAt ?? item.lastInboundAt;
    try {
      await onMarkConversationRead(item.customerId, through);
    } catch {
      // Reading the thread must not be blocked if the read marker cannot be persisted.
    }
  }

  async function sendReply() {
    if (!selected || busyAction) return;
    const clean = replyText.trim();
    if (!clean) {
      setError('Enter a reply before sending.');
      return;
    }
    await runStateAction(
      'reply',
      () => replyToConversation(tenantId, selected.customerId, clean),
      'Reply queued. SellerTray is waiting for the customer.',
    );
    setReplyText('');
  }

  async function sendPayment(orderId: string) {
    if (paymentBusyId) return;
    setPaymentBusyId(orderId);
    setError(null);
    setNotice(null);
    try {
      const result = await sendMerchantPaymentOptions(tenantId, orderId);
      setNotice(result.message);
      if (selectedCustomerId) await refreshThread(selectedCustomerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send payment options.');
    } finally {
      setPaymentBusyId(null);
    }
  }

  if (selected) {
    const unread = unreadByCustomer.get(selected.customerId);
    return (
      <View style={styles.stack}>
        <Pressable
          onPress={() => {
            setSelectedCustomerId('');
            setReplyText('');
            setThread([]);
            setNotice(null);
            setError(null);
          }}
          style={styles.backButton}
        >
          <Text style={[styles.backText, appearance.dark && styles.darkGreen]}>← Conversations</Text>
        </Pressable>

        <View style={[styles.card, appearance.dark && styles.darkCard]}>
          <View style={styles.headerRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(selected.customerName)}</Text></View>
            <View style={styles.flex}>
              <Text style={[styles.title, appearance.dark && styles.darkTitle]}>{selected.customerName}</Text>
              <Text style={[styles.meta, appearance.dark && styles.darkBody]}>{selected.customerPhone || selected.customerWaId}</Text>
            </View>
            <WorkStateBadge state={selected.workState} />
          </View>
          {selected.assignedUserEmail ? <Text style={[styles.assignmentText, appearance.dark && styles.darkBody]}>Assigned to {selected.assignedUserEmail}</Text> : null}
          {selected.lastStateReason ? <Text style={[styles.assignmentText, appearance.dark && styles.darkBody]}>{selected.lastStateReason}</Text> : null}
          {unread?.unreadCount ? <Text style={[styles.assignmentText, appearance.dark && styles.darkGreen]}>{unread.unreadCount} unread message{unread.unreadCount === 1 ? '' : 's'}</Text> : null}
        </View>

        <View style={[styles.card, appearance.dark && styles.darkCard]}>
          <Text style={[styles.cardTitle, appearance.dark && styles.darkTitle]}>Conversation control</Text>
          <Text style={[styles.body, appearance.dark && styles.darkBody]}>SellerTray automates this chat only while it is in AI handling. Human takeover pauses automatic conversation actions.</Text>
          <View style={styles.actionWrap}>
            {selected.workState !== 'merchant_handling' && selected.workState !== 'waiting_customer' ? (
              <ActionButton label={busyAction === 'take-over' ? 'Taking over…' : 'Take over'} icon="hand-left-outline" disabled={Boolean(busyAction)} onPress={() => void runStateAction('take-over', () => takeOverConversation(tenantId, selected.customerId), 'Conversation moved to merchant handling.')} />
            ) : null}
            {selected.workState !== 'ai_handling' ? (
              <ActionButton label={busyAction === 'return-ai' ? 'Returning…' : 'Return to AI'} icon="sparkles-outline" disabled={Boolean(busyAction)} secondary onPress={() => void runStateAction('return-ai', () => returnConversationToAi(tenantId, selected.customerId), 'SellerTray automation is active again for this conversation.')} />
            ) : null}
            {selected.workState !== 'resolved' ? (
              <ActionButton label={busyAction === 'resolve' ? 'Resolving…' : 'Resolve'} icon="checkmark-circle-outline" disabled={Boolean(busyAction)} secondary onPress={() => void runStateAction('resolve', () => resolveConversation(tenantId, selected.customerId), 'Conversation resolved.')} />
            ) : null}
          </View>

          <Text style={[styles.smallLabel, appearance.dark && styles.darkBody]}>Assign</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memberRow}>
            {team.map((member) => {
              const active = selected.assignedUserId === member.userId;
              return (
                <Pressable
                  key={member.userId}
                  disabled={Boolean(busyAction)}
                  onPress={() => void runStateAction('assign:' + member.userId, () => assignConversation(tenantId, selected.customerId, member.userId), 'Conversation assigned to ' + member.email + '.')}
                  style={[styles.memberChip, appearance.dark && styles.darkOutline, active && styles.memberChipActive]}
                >
                  <Text numberOfLines={1} style={[styles.memberChipText, appearance.dark && styles.darkGreen, active && styles.memberChipTextActive]}>{member.email}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={[styles.card, appearance.dark && styles.darkCard]}>
          <View style={styles.sectionHeadingRow}>
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, appearance.dark && styles.darkTitle]}>Conversation history</Text>
              <Text style={[styles.meta, appearance.dark && styles.darkBody]}>Latest conversation and earlier messages from Customer, merchant and SellerTray in chronological order.</Text>
            </View>
            <Pressable disabled={threadLoading} onPress={() => void refreshThread(selected.customerId)} style={styles.refreshButton}>
              <Ionicons name="refresh-outline" size={17} color="#079455" />
            </Pressable>
          </View>

          {threadLoading ? (
            <View style={styles.loadingRow}><ActivityIndicator /><Text style={[styles.meta, appearance.dark && styles.darkBody]}>Loading conversation…</Text></View>
          ) : thread.length === 0 ? (
            <Text style={[styles.body, appearance.dark && styles.darkBody]}>No WhatsApp messages are available for this customer yet.</Text>
          ) : (
            <View style={styles.threadList}>
              {thread.map((message) => <ThreadMessage key={message.id} message={message} dark={appearance.dark} />)}
            </View>
          )}

          <TextInput
            value={replyText}
            onChangeText={setReplyText}
            placeholder="Reply to customer on WhatsApp"
            placeholderTextColor="#98A2B3"
            multiline
            maxLength={1500}
            style={[styles.replyInput, appearance.dark && styles.darkInput]}
          />
          <Pressable disabled={Boolean(busyAction)} onPress={() => void sendReply()} style={[styles.primaryButton, busyAction && styles.disabled]}>
            <Ionicons name="send-outline" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>{busyAction === 'reply' ? 'Sending…' : 'Reply'}</Text>
          </Pressable>
          <Text style={[styles.helperText, appearance.dark && styles.darkMuted]}>Free-form WhatsApp replies are sent only inside the active 24-hour customer-service window.</Text>
        </View>

        {notice ? <View style={[styles.notice, appearance.dark && styles.darkMint]}><Text style={[styles.noticeText, appearance.dark && styles.darkTitle]}>{notice}</Text></View> : null}
        {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={[styles.card, appearance.dark && styles.darkCard]}>
          <Text style={[styles.cardTitle, appearance.dark && styles.darkTitle]}>Linked orders</Text>
          {selectedOrders.length === 0 ? (
            <Text style={[styles.body, appearance.dark && styles.darkBody]}>No order is linked to this conversation yet.</Text>
          ) : selectedOrders.map((order) => {
            const total = orderTotal(order);
            return (
              <View key={order.id} style={[styles.orderRow, appearance.dark && styles.darkOutline]}>
                <View style={styles.flex}>
                  <Text style={[styles.orderRef, appearance.dark && styles.darkTitle]}>{order.publicOrderId}</Text>
                  <Text style={[styles.meta, appearance.dark && styles.darkBody]}>{order.items.length} item{order.items.length === 1 ? '' : 's'} · {total === null ? 'Needs pricing' : formatMoney(total, currency)}</Text>
                  <Text style={[styles.meta, appearance.dark && styles.darkBody]}>{order.status.replaceAll('_', ' ')} · {order.paymentStatus.replaceAll('_', ' ')}</Text>
                </View>
                <View style={styles.orderActions}>
                  {order.paymentStatus !== 'paid' && ['accepted', 'processing', 'ready'].includes(order.status) ? (
                    <Pressable disabled={paymentBusyId !== null} onPress={() => void sendPayment(order.id)} style={[styles.secondaryButton, appearance.dark && styles.darkOutline]}>
                      <Text style={[styles.secondaryButtonText, appearance.dark && styles.darkGreen]}>{paymentBusyId === order.id ? 'Sending…' : 'Payment'}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => onOpenOrder(order.id)} style={styles.openButton}><Text style={styles.openButtonText}>Open</Text></Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && styles.darkMuted]}>SHARED INBOX</Text>
        <Text style={[styles.pageTitle, appearance.dark && styles.darkTitle]}>Conversations</Text>
        <Text style={[styles.body, appearance.dark && styles.darkBody]}>See every customer chat, take over when judgement is needed, and return safe conversations to SellerTray automation.</Text>
      </View>

      <TextInput value={query} onChangeText={setQuery} placeholder="Search customer, message or order" placeholderTextColor="#98A2B3" style={[styles.searchInput, appearance.dark && styles.darkInput]} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {filters.map((item) => {
          const active = filter === item.key;
          const count = counts[item.key];
          return (
            <Pressable key={item.key} onPress={() => setFilter(item.key)} style={[styles.filterChip, appearance.dark && styles.darkOutline, active && styles.filterChipActive]}>
              <Text style={[styles.filterText, appearance.dark && styles.darkGreen, active && styles.filterTextActive]}>{item.label} {count}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View> : null}
      {loading ? <View style={styles.loadingRow}><ActivityIndicator /><Text style={[styles.meta, appearance.dark && styles.darkBody]}>Loading conversations…</Text></View> : null}

      {!loading && visible.length === 0 ? (
        <View style={[styles.card, appearance.dark && styles.darkCard]}><Text style={[styles.body, appearance.dark && styles.darkBody]}>No conversations match this view.</Text></View>
      ) : visible.map((item) => {
        const unread = unreadByCustomer.get(item.customerId)?.unreadCount ?? 0;
        const latest = item.lastInboundText || item.lastOutboundText || 'No message preview yet';
        return (
          <Pressable key={item.customerId} onPress={() => void openConversation(item)} style={[styles.card, styles.conversationCard, appearance.dark && styles.darkCard]}>
            <View style={styles.headerRow}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{initials(item.customerName)}</Text></View>
              <View style={styles.flex}>
                <View style={styles.nameRow}>
                  <Text numberOfLines={1} style={[styles.listName, appearance.dark && styles.darkTitle]}>{item.customerName}</Text>
                  {unread > 0 ? <View style={styles.unreadBadge}><Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text></View> : null}
                </View>
                <Text numberOfLines={2} style={[styles.preview, appearance.dark && styles.darkBody]}>{latest}</Text>
                <Text style={[styles.meta, appearance.dark && styles.darkMuted]}>{formatDate(item.lastActivityAt)}{item.assignedUserEmail ? ' · ' + item.assignedUserEmail : ''}</Text>
              </View>
              <WorkStateBadge state={item.workState} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function ThreadMessage({ message, dark }: { message: ConversationMessage; dark: boolean }) {
  const inbound = message.direction === 'inbound';
  const actor = message.actor === 'customer' ? 'Customer' : message.actor === 'merchant' ? 'Merchant' : 'SellerTray';
  return (
    <View style={[styles.threadBubble, inbound ? styles.customerBubble : styles.outboundBubble, dark && (inbound ? styles.darkMint : styles.darkOutline)]}>
      <Text style={[styles.bubbleText, dark && styles.darkTitle]}>{message.text}</Text>
      <Text style={[styles.bubbleMeta, dark && styles.darkMuted]}>{actor} · {formatDate(message.occurredAt)}{message.deliveryStatus ? ' · ' + message.deliveryStatus.replaceAll('_', ' ') : ''}</Text>
    </View>
  );
}

function WorkStateBadge({ state }: { state: ConversationWorkState }) {
  const attention = state === 'needs_merchant';
  return (
    <View style={[styles.stateBadge, attention && styles.stateBadgeAttention]}>
      <Text style={[styles.stateText, attention && styles.stateTextAttention]}>{workStateLabels[state]}</Text>
    </View>
  );
}

function ActionButton({ label, icon, disabled, secondary = false, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; disabled: boolean; secondary?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.actionButton, secondary && styles.actionButtonSecondary, disabled && styles.disabled]}>
      <Ionicons name={icon} size={16} color={secondary ? '#079455' : '#FFFFFF'} />
      <Text style={[styles.actionButtonText, secondary && styles.actionButtonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

function formatDate(value: string | null): string {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value);
  } catch {
    return (currency || 'NGN') + ' ' + value.toFixed(2);
  }
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  eyebrow: { color: '#667085', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  pageTitle: { color: '#102A43', fontSize: 24, fontWeight: '900', marginTop: 2 },
  title: { color: '#102A43', fontSize: 17, fontWeight: '900' },
  cardTitle: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  body: { color: '#475467', fontSize: 13, lineHeight: 19 },
  meta: { color: '#667085', fontSize: 11, lineHeight: 16 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 13, gap: 10 },
  conversationCard: { paddingVertical: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  flex: { flex: 1, minWidth: 0 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#D9FBE8', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#079455', fontWeight: '900', fontSize: 13 },
  listName: { flex: 1, color: '#102A43', fontSize: 14, fontWeight: '900' },
  preview: { color: '#475467', fontSize: 12, lineHeight: 17, marginTop: 2 },
  unreadBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  stateBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: '#F2F4F7' },
  stateBadgeAttention: { backgroundColor: '#FEF3F2' },
  stateText: { color: '#475467', fontSize: 9, fontWeight: '900' },
  stateTextAttention: { color: '#B42318' },
  searchInput: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, paddingHorizontal: 12, color: '#102A43', backgroundColor: '#FFFFFF' },
  filterRow: { gap: 7, paddingRight: 10 },
  filterChip: { minHeight: 35, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  filterChipActive: { backgroundColor: '#12B76A', borderColor: '#12B76A' },
  filterText: { color: '#475467', fontSize: 11, fontWeight: '900' },
  filterTextActive: { color: '#FFFFFF' },
  backButton: { alignSelf: 'flex-start', paddingVertical: 4 },
  backText: { color: '#079455', fontWeight: '900', fontSize: 13 },
  assignmentText: { color: '#667085', fontSize: 11, lineHeight: 16 },
  actionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  actionButton: { minHeight: 38, paddingHorizontal: 11, borderRadius: 9, backgroundColor: '#12B76A', flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionButtonSecondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD' },
  actionButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  actionButtonTextSecondary: { color: '#079455' },
  smallLabel: { color: '#667085', fontSize: 10, fontWeight: '900', marginTop: 3 },
  memberRow: { gap: 7 },
  memberChip: { maxWidth: 180, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  memberChipActive: { backgroundColor: '#ECFDF3', borderColor: '#12B76A' },
  memberChipText: { color: '#079455', fontSize: 10, fontWeight: '800' },
  memberChipTextActive: { fontWeight: '900' },
  refreshButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  threadList: { gap: 8 },
  threadBubble: { maxWidth: '92%', borderRadius: 12, padding: 10, gap: 4 },
  customerBubble: { alignSelf: 'flex-start', backgroundColor: '#ECFDF3' },
  outboundBubble: { alignSelf: 'flex-end', backgroundColor: '#F2F4F7', borderWidth: 1, borderColor: '#E4E7EC' },
  bubbleText: { color: '#102A43', fontSize: 13, lineHeight: 19 },
  bubbleMeta: { color: '#667085', fontSize: 9, lineHeight: 13 },
  replyInput: { minHeight: 84, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, padding: 10, color: '#102A43', backgroundColor: '#FFFFFF', textAlignVertical: 'top' },
  primaryButton: { minHeight: 44, backgroundColor: '#12B76A', borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  helperText: { color: '#667085', fontSize: 10, lineHeight: 15 },
  notice: { backgroundColor: '#ECFDF3', borderRadius: 11, padding: 10 },
  noticeText: { color: '#344054', fontSize: 12, lineHeight: 18 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 11, padding: 10 },
  errorText: { color: '#B42318', fontSize: 12, lineHeight: 18 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 11, padding: 10 },
  orderRef: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  orderActions: { gap: 6, alignItems: 'flex-end' },
  secondaryButton: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  secondaryButtonText: { color: '#079455', fontSize: 10, fontWeight: '900' },
  openButton: { backgroundColor: '#102A43', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  openButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  darkCard: { backgroundColor: '#102A43', borderColor: '#344054' },
  darkTitle: { color: '#F8FAFC' },
  darkBody: { color: '#D0D5DD' },
  darkMuted: { color: '#98A2B3' },
  darkGreen: { color: '#5DE2A2' },
  darkMint: { backgroundColor: '#163B32' },
  darkOutline: { backgroundColor: '#162F46', borderColor: '#475467' },
  darkInput: { backgroundColor: '#0B2035', borderColor: '#475467', color: '#F8FAFC' },
});
