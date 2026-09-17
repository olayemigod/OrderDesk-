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
  loadConversations,
  replyToConversation,
  resolveConversation,
  returnConversationToAi,
  takeOverConversation,
  type ConversationSummary,
  type ConversationWorkState,
} from '../data/conversationsRepository';
import { sendMerchantPaymentOptions } from '../data/orderPaymentsRepository';
import { loadTeam, type TeamMember } from '../data/teamRepository';
import { orderTotal, type MerchantOrder } from '../domain/order';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';

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
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    setSelectedCustomerId('');
    setReplyText('');
    setNotice(null);
    setError(null);
    void refresh();
  }, [refresh]);

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
      customerOrders.sort((a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
      );
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
      const matchesFilter =
        filter === 'all' ||
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
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized);
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
      setNotice(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this conversation.');
    } finally {
      setBusyAction(null);
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
            setNotice(null);
            setError(null);
          }}
          style={styles.backButton}
        >
          <Text style={[styles.backText, appearance.dark && styles.darkGreen]}>← Conversations</Text>
        </Pressable>

        <View style={[styles.card, appearance.dark && styles.darkCard]}>
          <View style={styles.headerRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(selected.customerName)}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={[styles.title, appearance.dark && styles.darkTitle]}>{selected.customerName}</Text>
              <Text style={[styles.meta, appearance.dark && styles.darkBody]}>
                {selected.customerPhone || selected.customerWaId}
              </Text>
            </View>
            <WorkStateBadge state={selected.workState} />
          </View>

          {selected.assignedUserEmail ? (
            <Text style={[styles.assignmentText, appearance.dark && styles.darkBody]}>
              Assigned to {selected.assignedUserEmail}
            </Text>
          ) : null}
          {selected.lastStateReason ? (
            <Text style={[styles.assignmentText, appearance.dark && styles.darkBody]}>
              {selected.lastStateReason}
            </Text>
          ) : null}
          {unread?.unreadCount ? (
            <Text style={[styles.assignmentText, appearance.dark && styles.darkGreen]}>
              {unread.unreadCount} unread message{unread.unreadCount === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>

        <View style={[styles.card, appearance.dark && styles.darkCard]}>
          <Text style={[styles.cardTitle, appearance.dark && styles.darkTitle]}>Conversation control</Text>
          <Text style={[styles.body, appearance.dark && styles.darkBody]}>
            SellerTray only automates this chat while it is in AI handling. Human takeover pauses automatic conversation actions.
          </Text>
          <View style={styles.actionWrap}>
            {selected.workState !== 'merchant_handling' && selected.workState !== 'waiting_customer' ? (
              <ActionButton
                label={busyAction === 'take-over' ? 'Taking over…' : 'Take over'}
                icon="hand-left-outline"
                disabled={Boolean(busyAction)}
                onPress={() => void runStateAction(
                  'take-over',
                  () => takeOverConversation(tenantId, selected.customerId),
                  'Conversation moved to merchant handling.',
                )}
              />
            ) : null}
            {selected.workState !== 'ai_handling' ? (
              <ActionButton
                label={busyAction === 'return-ai' ? 'Returning…' : 'Return to AI'}
                icon="sparkles-outline"
                disabled={Boolean(busyAction)}
                secondary
                onPress={() => void runStateAction(
                  'return-ai',
                  () => returnConversationToAi(tenantId, selected.customerId),
                  'SellerTray automation is active again for this conversation.',
                )}
              />
            ) : null}
            {selected.workState !== 'resolved' ? (
              <ActionButton
                label={busyAction === 'resolve' ? 'Resolving…' : 'Resolve'}
                icon="checkmark-circle-outline"
                disabled={Boolean(busyAction)}
                secondary
                onPress={() => void runStateAction(
                  'resolve',
                  () => resolveConversation(tenantId, selected.customerId),
                  'Conversation resolved.',
                )}
              />
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
                  onPress={() => void runStateAction(
                    'assign:' + member.userId,
                    () => assignConversation(tenantId, selected.customerId, member.userId),
                    'Conversation assigned to ' + member.email + '.',
                  )}
                  style={[
                    styles.memberChip,
                    appearance.dark && styles.darkOutline,
                    active && styles.memberChipActive,
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.memberChipText,
                      appearance.dark && styles.darkGreen,
                      active && styles.memberChipTextActive,
                    ]}
                  >
                    {member.email}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={[styles.card, appearance.dark && styles.darkCard]}>
          <Text style={[styles.cardTitle, appearance.dark && styles.darkTitle]}>Latest conversation</Text>
          {selected.lastInboundText ? (
            <View style={[styles.customerBubble, appearance.dark && styles.darkMint]}>
              <Text style={[styles.bubbleText, appearance.dark && styles.darkTitle]}>{selected.lastInboundText}</Text>
              <Text style={[styles.bubbleMeta, appearance.dark && styles.darkMuted]}>
                Customer · {formatDate(selected.lastInboundAt)}
              </Text>
            </View>
          ) : null}
          {selected.lastOutboundText ? (
            <View style={[styles.merchantBubble, appearance.dark && styles.darkOutline]}>
              <Text style={[styles.bubbleText, appearance.dark && styles.darkTitle]}>{selected.lastOutboundText}</Text>
              <Text style={[styles.bubbleMeta, appearance.dark && styles.darkMuted]}>
                SellerTray / merchant · {formatDate(selected.lastOutboundAt)}
              </Text>
            </View>
          ) : null}

          <TextInput
            value={replyText}
            onChangeText={setReplyText}
            placeholder="Reply to customer on WhatsApp"
            placeholderTextColor={theme.colors.subtle}
            multiline
            maxLength={1500}
            style={[styles.replyInput, appearance.dark && styles.darkInput]}
          />
          <Pressable
            disabled={Boolean(busyAction)}
            onPress={() => void sendReply()}
            style={[styles.primaryButton, busyAction && styles.disabled]}
          >
            <Ionicons name="send-outline" size={18} color={theme.colors.white} />
            <Text style={styles.primaryButtonText}>{busyAction === 'reply' ? 'Sending…' : 'Reply'}</Text>
          </Pressable>
          <Text style={[styles.helperText, appearance.dark && styles.darkMuted]}>
            Free-form WhatsApp replies are sent only inside the active 24-hour customer-service window.
          </Text>
        </View>

        {notice ? (
          <View style={[styles.notice, appearance.dark && styles.darkMint]}>
            <Text style={[styles.noticeText, appearance.dark && styles.darkTitle]}>{notice}</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={[styles.card, appearance.dark && styles.darkCard]}>
          <Text style={[styles.cardTitle, appearance.dark && styles.darkTitle]}>Linked orders</Text>
          {selectedOrders.length === 0 ? (
            <Text style={[styles.body, appearance.dark && styles.darkBody]}>
              No order is linked to this conversation yet.
            </Text>
          ) : (
            selectedOrders.map((order) => {
              const total = orderTotal(order);
              return (
                <View key={order.id} style={[styles.orderRow, appearance.dark && styles.darkOutline]}>
                  <View style={styles.flex}>
                    <Text style={[styles.orderRef, appearance.dark && styles.darkTitle]}>{order.publicOrderId}</Text>
                    <Text style={[styles.meta, appearance.dark && styles.darkBody]}>
                      {order.items.length} item{order.items.length === 1 ? '' : 's'} · {total === null ? 'Needs pricing' : formatMoney(total, currency)}
                    </Text>
                    <Text style={[styles.meta, appearance.dark && styles.darkBody]}>
                      {order.status.replaceAll('_', ' ')} · {order.paymentStatus.replaceAll('_', ' ')}
                    </Text>
                  </View>
                  <View style={styles.orderActions}>
                    {order.paymentStatus !== 'paid' && ['accepted', 'processing', 'ready'].includes(order.status) ? (
                      <Pressable
                        disabled={paymentBusyId !== null}
                        onPress={() => void sendPayment(order.id)}
                        style={[styles.secondaryButton, appearance.dark && styles.darkOutline]}
                      >
                        <Text style={[styles.secondaryButtonText, appearance.dark && styles.darkGreen]}>
                          {paymentBusyId === order.id ? 'Sending…' : 'Payment'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => onOpenOrder(order.id)} style={styles.openButton}>
                      <Text style={styles.openButtonText}>Open</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && styles.darkBody]}>WHATSAPP OPERATIONS</Text>
        <Text style={[styles.pageTitle, appearance.dark && styles.darkTitle]}>Conversations</Text>
        <Text style={[styles.body, appearance.dark && styles.darkBody]}>
          AI handling, merchant exceptions and customer follow-up in one operational inbox.
        </Text>
      </View>

      <View style={styles.statsGrid}>
        <Stat label="Needs merchant" value={counts.needs_merchant} active={filter === 'needs_merchant'} attention onPress={() => setFilter('needs_merchant')} />
        <Stat label="Merchant handling" value={counts.merchant_handling} active={filter === 'merchant_handling'} onPress={() => setFilter('merchant_handling')} />
        <Stat label="AI handling" value={counts.ai_handling} active={filter === 'ai_handling'} onPress={() => setFilter('ai_handling')} />
        <Stat label="Waiting customer" value={counts.waiting_customer} active={filter === 'waiting_customer'} onPress={() => setFilter('waiting_customer')} />
      </View>

      <View style={styles.searchRow}>
        <View style={[styles.searchBox, appearance.dark && styles.darkInput]}>
          <Ionicons name="search-outline" size={19} color={theme.colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search customer or message"
            placeholderTextColor={theme.colors.subtle}
            autoCorrect={false}
            style={[styles.searchInput, appearance.dark && styles.darkTitle]}
          />
        </View>
        <Pressable
          onPress={() => setShowFilters((value) => !value)}
          style={[styles.filterButton, appearance.dark && styles.darkOutline, showFilters && styles.filterButtonActive]}
        >
          <Ionicons
            name="options-outline"
            size={21}
            color={showFilters ? theme.colors.white : appearance.dark ? theme.colors.mint : theme.colors.navy}
          />
        </Pressable>
      </View>

      {showFilters ? (
        <View style={[styles.card, appearance.dark && styles.darkCard]}>
          <View style={styles.filterWrap}>
            <FilterButton label={'All (' + counts.all + ')'} active={filter === 'all'} onPress={() => setFilter('all')} />
            <FilterButton label={'Unread (' + counts.unread + ')'} active={filter === 'unread'} onPress={() => setFilter('unread')} />
            <FilterButton label={'AI handling (' + counts.ai_handling + ')'} active={filter === 'ai_handling'} onPress={() => setFilter('ai_handling')} />
            <FilterButton label={'Needs merchant (' + counts.needs_merchant + ')'} active={filter === 'needs_merchant'} onPress={() => setFilter('needs_merchant')} />
            <FilterButton label={'Merchant handling (' + counts.merchant_handling + ')'} active={filter === 'merchant_handling'} onPress={() => setFilter('merchant_handling')} />
            <FilterButton label={'Waiting customer (' + counts.waiting_customer + ')'} active={filter === 'waiting_customer'} onPress={() => setFilter('waiting_customer')} />
            <FilterButton label={'Resolved (' + counts.resolved + ')'} active={filter === 'resolved'} onPress={() => setFilter('resolved')} />
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void refresh()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator />
          <Text style={[styles.body, appearance.dark && styles.darkBody]}>Loading conversations…</Text>
        </View>
      ) : visible.length === 0 ? (
        <View style={[styles.card, appearance.dark && styles.darkCard]}>
          <Text style={[styles.cardTitle, appearance.dark && styles.darkTitle]}>No conversations here</Text>
          <Text style={[styles.body, appearance.dark && styles.darkBody]}>
            New WhatsApp customer messages will enter this operational inbox even when SellerTray deliberately does not create an order.
          </Text>
        </View>
      ) : (
        <View style={[styles.list, appearance.dark && styles.darkCard]}>
          {visible.map((item) => {
            const unread = unreadByCustomer.get(item.customerId);
            const linkedOrders = ordersByCustomer.get(item.customerId) ?? [];
            return (
              <Pressable
                key={item.customerId}
                onPress={() => {
                  if (item.customerId) {
                    void onMarkConversationRead(item.customerId, unread?.latestReceivedAt ?? item.lastInboundAt);
                  }
                  setSelectedCustomerId(item.customerId);
                  setNotice(null);
                  setError(null);
                }}
                style={[styles.listRow, appearance.dark && styles.darkBorder]}
              >
                <View style={styles.avatarSmall}>
                  <Text style={styles.avatarSmallText}>{initials(item.customerName)}</Text>
                </View>
                <View style={styles.flex}>
                  <View style={styles.nameRow}>
                    <Text numberOfLines={1} style={[styles.name, appearance.dark && styles.darkTitle]}>{item.customerName}</Text>
                    <Text style={[styles.time, appearance.dark && styles.darkMuted]}>{formatDate(item.lastActivityAt)}</Text>
                  </View>
                  <Text numberOfLines={1} style={[styles.preview, appearance.dark && styles.darkBody]}>
                    {item.lastInboundText || item.lastOutboundText || 'WhatsApp activity'}
                  </Text>
                  <View style={styles.rowMetaWrap}>
                    <WorkStateBadge state={item.workState} compact />
                    {item.assignedUserEmail ? (
                      <Text numberOfLines={1} style={[styles.assigneeMeta, appearance.dark && styles.darkMuted]}>
                        {item.assignedUserEmail}
                      </Text>
                    ) : null}
                    {linkedOrders.length > 0 ? (
                      <Text style={[styles.assigneeMeta, appearance.dark && styles.darkMuted]}>
                        {linkedOrders.length} order{linkedOrders.length === 1 ? '' : 's'}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {unread?.unreadCount ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{unread.unreadCount > 99 ? '99+' : unread.unreadCount}</Text>
                  </View>
                ) : (
                  <Text style={[styles.chevron, appearance.dark && styles.darkMuted]}>›</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function WorkStateBadge({ state, compact = false }: { state: ConversationWorkState; compact?: boolean }) {
  const attention = state === 'needs_merchant';
  const positive = state === 'ai_handling';
  return (
    <View style={[
      styles.stateBadge,
      compact && styles.stateBadgeCompact,
      attention && styles.stateBadgeAttention,
      positive && styles.stateBadgePositive,
    ]}>
      <Text style={[
        styles.stateBadgeText,
        attention && styles.stateBadgeTextAttention,
        positive && styles.stateBadgeTextPositive,
      ]}>
        {workStateLabels[state]}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  disabled,
  secondary = false,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        secondary ? styles.secondaryAction : styles.primaryAction,
        secondary && appearance.dark && styles.darkOutline,
        disabled && styles.disabled,
      ]}
    >
      <Ionicons
        name={icon}
        size={17}
        color={secondary ? (appearance.dark ? theme.colors.mint : theme.colors.navy) : theme.colors.white}
      />
      <Text style={[
        secondary ? styles.secondaryActionText : styles.primaryActionText,
        secondary && appearance.dark && styles.darkGreen,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Stat({
  label,
  value,
  active,
  attention = false,
  onPress,
}: {
  label: string;
  value: number;
  active: boolean;
  attention?: boolean;
  onPress: () => void;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.stat,
        appearance.dark && styles.darkCard,
        active && styles.statActive,
        attention && value > 0 && styles.statAttention,
      ]}
    >
      <Text style={[styles.statValue, appearance.dark && styles.darkTitle]}>{value}</Text>
      <Text style={[styles.statLabel, appearance.dark && styles.darkBody]}>{label}</Text>
    </Pressable>
  );
}

function FilterButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filterChip, appearance.dark && styles.darkOutline, active && styles.filterChipActive]}
    >
      <Text style={[styles.filterChipText, appearance.dark && styles.darkGreen, active && styles.filterChipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase() ?? '').join('');
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: currency || 'NGN',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return (currency || 'NGN') + ' ' + value.toFixed(2);
  }
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { color: theme.colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  pageTitle: { color: theme.colors.navy, fontSize: 28, fontWeight: '800', marginTop: 4 },
  title: { color: theme.colors.navy, fontSize: 20, fontWeight: '800' },
  cardTitle: { color: theme.colors.navy, fontSize: 16, fontWeight: '800', marginBottom: 6 },
  body: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
  meta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  card: {
    backgroundColor: theme.colors.white,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E7ECF1',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: theme.colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: theme.colors.white, fontWeight: '800', fontSize: 16 },
  assignmentText: { color: theme.colors.slate, marginTop: 10, fontSize: 12 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 4 },
  backText: { color: theme.colors.green, fontWeight: '800', fontSize: 14 },
  actionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  primaryAction: {
    flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: theme.colors.navy,
    paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12,
  },
  primaryActionText: { color: theme.colors.white, fontWeight: '800', fontSize: 13 },
  secondaryAction: {
    flexDirection: 'row', gap: 7, alignItems: 'center', borderWidth: 1, borderColor: '#CBD5E1',
    paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12,
  },
  secondaryActionText: { color: theme.colors.navy, fontWeight: '800', fontSize: 13 },
  smallLabel: { color: theme.colors.slate, fontSize: 12, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  memberRow: { gap: 8, paddingRight: 12 },
  memberChip: {
    borderWidth: 1, borderColor: '#D8E0E8', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8, maxWidth: 220,
  },
  memberChipActive: { backgroundColor: theme.colors.navy, borderColor: theme.colors.navy },
  memberChipText: { color: theme.colors.navy, fontSize: 12, fontWeight: '700' },
  memberChipTextActive: { color: theme.colors.white },
  customerBubble: {
    alignSelf: 'flex-start', maxWidth: '92%', padding: 12, borderRadius: 14,
    backgroundColor: theme.colors.mint, marginTop: 8,
  },
  merchantBubble: {
    alignSelf: 'flex-end', maxWidth: '92%', padding: 12, borderRadius: 14,
    borderWidth: 1, borderColor: '#D8E0E8', marginTop: 10,
  },
  bubbleText: { color: theme.colors.navy, fontSize: 14, lineHeight: 20 },
  bubbleMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 6 },
  replyInput: {
    minHeight: 86, marginTop: 14, borderWidth: 1, borderColor: '#CBD5E1',
    borderRadius: 14, padding: 12, color: theme.colors.navy, textAlignVertical: 'top',
    backgroundColor: theme.colors.white,
  },
  primaryButton: {
    marginTop: 10, backgroundColor: theme.colors.green, borderRadius: 12, minHeight: 44,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  primaryButtonText: { color: theme.colors.white, fontWeight: '800' },
  helperText: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  notice: { padding: 12, borderRadius: 12, backgroundColor: theme.colors.mint },
  noticeText: { color: theme.colors.navy, fontSize: 13, fontWeight: '700' },
  errorCard: { backgroundColor: '#FEF2F2', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#FECACA' },
  errorText: { color: '#B42318', fontSize: 13, lineHeight: 18 },
  retryText: { color: theme.colors.green, fontWeight: '800', marginTop: 8 },
  orderRow: {
    flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderColor: '#E7ECF1',
    borderRadius: 14, padding: 12, marginTop: 10,
  },
  orderRef: { color: theme.colors.navy, fontWeight: '800', fontSize: 13 },
  orderActions: { gap: 6, alignItems: 'flex-end' },
  secondaryButton: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7 },
  secondaryButtonText: { color: theme.colors.navy, fontWeight: '800', fontSize: 11 },
  openButton: { backgroundColor: theme.colors.navy, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 },
  openButtonText: { color: theme.colors.white, fontWeight: '800', fontSize: 11 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    width: '48%', minHeight: 76, backgroundColor: theme.colors.white,
    borderRadius: 16, borderWidth: 1, borderColor: '#E7ECF1', padding: 12,
  },
  statActive: { borderColor: theme.colors.green, borderWidth: 2 },
  statAttention: { backgroundColor: '#FFF7ED' },
  statValue: { color: theme.colors.navy, fontSize: 22, fontWeight: '800' },
  statLabel: { color: theme.colors.slate, fontSize: 12, marginTop: 4 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
    borderWidth: 1, borderColor: '#D8E0E8', borderRadius: 12, paddingHorizontal: 12,
    backgroundColor: theme.colors.white,
  },
  searchInput: { flex: 1, color: theme.colors.navy, paddingVertical: 9 },
  filterButton: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#D8E0E8', borderRadius: 12,
  },
  filterButtonActive: { backgroundColor: theme.colors.navy, borderColor: theme.colors.navy },
  filterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { borderWidth: 1, borderColor: '#D8E0E8', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  filterChipActive: { backgroundColor: theme.colors.navy, borderColor: theme.colors.navy },
  filterChipText: { color: theme.colors.navy, fontSize: 11, fontWeight: '700' },
  filterChipTextActive: { color: theme.colors.white },
  loadingRow: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12 },
  list: { backgroundColor: theme.colors.white, borderRadius: 16, overflow: 'hidden' },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D8E0E8',
  },
  avatarSmall: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.navy,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarSmallText: { color: theme.colors.white, fontSize: 13, fontWeight: '800' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: theme.colors.navy, fontSize: 14, fontWeight: '800' },
  time: { color: theme.colors.muted, fontSize: 10 },
  preview: { color: theme.colors.slate, fontSize: 12, marginTop: 3 },
  rowMetaWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  assigneeMeta: { color: theme.colors.muted, fontSize: 10, maxWidth: 150 },
  stateBadge: {
    alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#EEF2F6',
  },
  stateBadgeCompact: { paddingHorizontal: 8, paddingVertical: 4 },
  stateBadgeAttention: { backgroundColor: '#FFF1E8' },
  stateBadgePositive: { backgroundColor: theme.colors.mint },
  stateBadgeText: { color: theme.colors.slate, fontSize: 10, fontWeight: '800' },
  stateBadgeTextAttention: { color: '#B54708' },
  stateBadgeTextPositive: { color: '#067647' },
  unreadBadge: {
    minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12,
    backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center',
  },
  unreadText: { color: theme.colors.white, fontWeight: '800', fontSize: 10 },
  chevron: { color: theme.colors.muted, fontSize: 24 },
  disabled: { opacity: 0.55 },
  darkCard: { backgroundColor: '#102A43', borderColor: '#28455F' },
  darkTitle: { color: '#F8FAFC' },
  darkBody: { color: '#C7D4DF' },
  darkMuted: { color: '#9FB0BF' },
  darkGreen: { color: theme.colors.mint },
  darkMint: { backgroundColor: '#173F39' },
  darkOutline: { borderColor: '#466078' },
  darkInput: { backgroundColor: '#0C2235', borderColor: '#466078', color: '#F8FAFC' },
  darkBorder: { borderBottomColor: '#28455F' },
});
