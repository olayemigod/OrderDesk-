import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { MerchantBusiness } from '../data/businessRepository';
import {
  convertCustomerEnquiryToOrder,
  dismissCustomerEnquiry,
  loadCustomerEnquiries,
  replyToCustomerEnquiry,
  type CustomerEnquiry,
} from '../data/customerEnquiriesRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Filter = 'active' | 'converted' | 'all';

export function CustomerEnquiriesView({ business }: { business: MerchantBusiness }) {
  const appearance = useSellerTrayAppearance();
  const [items, setItems] = useState<CustomerEnquiry[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [actionNotices, setActionNotices] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await loadCustomerEnquiries(business.id, null, 150));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customer enquiries.');
    } finally {
      setLoading(false);
    }
  }, [business.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActionError = (id: string, message: string | null) => {
    setActionErrors((current) => {
      const next = { ...current };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  };

  const setActionNotice = (id: string, message: string | null) => {
    setActionNotices((current) => {
      const next = { ...current };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  };

  const convertToOrder = async (item: CustomerEnquiry) => {
    const quantity = Number(quantities[item.id] ?? '1');
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 9999) {
      setActionError(item.id, 'Enter a quantity between 1 and 9999.');
      return;
    }
    setBusyId(item.id);
    setActionError(item.id, null);
    setActionNotice(item.id, null);
    try {
      const result = await convertCustomerEnquiryToOrder(business.id, item.id, quantity);
      setActionNotice(item.id, result.publicOrderId ? `Order ${result.publicOrderId} created.` : 'Order created.');
      await refresh();
    } catch (err) {
      setActionError(item.id, err instanceof Error ? err.message : 'Unable to create order.');
    } finally {
      setBusyId(null);
    }
  };

  const sendReply = async (item: CustomerEnquiry) => {
    const message = (replies[item.id] ?? '').trim();
    if (!message) {
      setActionError(item.id, 'Enter a reply first.');
      return;
    }
    setBusyId(item.id);
    setActionError(item.id, null);
    setActionNotice(item.id, null);
    try {
      await replyToCustomerEnquiry(business.id, item.id, message);
      setReplies((current) => ({ ...current, [item.id]: '' }));
      setActionNotice(item.id, 'Reply queued for WhatsApp delivery.');
      await refresh();
    } catch (err) {
      setActionError(item.id, err instanceof Error ? err.message : 'Unable to send reply.');
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (item: CustomerEnquiry) => {
    setBusyId(item.id);
    setActionError(item.id, null);
    setActionNotice(item.id, null);
    try {
      await dismissCustomerEnquiry(business.id, item.id);
      await refresh();
    } catch (err) {
      setActionError(item.id, err instanceof Error ? err.message : 'Unable to dismiss enquiry.');
    } finally {
      setBusyId(null);
    }
  };

  const visible = useMemo(() => items.filter((item) => {
    if (filter === 'active') return item.status === 'open' || item.status === 'replied';
    if (filter === 'converted') return item.status === 'converted';
    return true;
  }), [items, filter]);

  const activeCount = items.filter((item) => item.status === 'open' || item.status === 'replied').length;
  const convertedCount = items.filter((item) => item.status === 'converted').length;

  return (
    <View style={styles.wrap}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>SALES ENQUIRIES</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Customer enquiries</Text>
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>
          SellerTray keeps product questions separate from orders, then links an enquiry to the order when the customer actually commits to buy.
        </Text>
      </View>

      <View style={styles.stats}>
        <Stat label="Active leads" value={activeCount} dark={appearance.dark} />
        <Stat label="Converted" value={convertedCount} dark={appearance.dark} />
      </View>

      <View style={[styles.filters, appearance.dark && darkStyles.subtleCard]}>
        <FilterButton label="Active" active={filter === 'active'} onPress={() => setFilter('active')} dark={appearance.dark} />
        <FilterButton label="Converted" active={filter === 'converted'} onPress={() => setFilter('converted')} dark={appearance.dark} />
        <FilterButton label="All" active={filter === 'all'} onPress={() => setFilter('all')} dark={appearance.dark} />
      </View>

      {loading && items.length === 0 ? (
        <View style={[styles.loadingCard, appearance.dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>Loading enquiries…</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Enquiries unavailable</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void refresh()}><Text style={styles.retry}>Retry</Text></Pressable>
        </View>
      ) : null}

      {!loading && !error && visible.length === 0 ? (
        <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
          <Ionicons name="chatbubble-ellipses-outline" size={26} color="#12B76A" />
          <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>
            No {filter === 'all' ? '' : filter} enquiries yet
          </Text>
          <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>
            Questions like “How much is a bag of rice?” appear here without creating an order.
          </Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {visible.map((item) => (
          <View key={item.id} style={[styles.card, appearance.dark && darkStyles.card]}>
            <View style={styles.topRow}>
              <View style={styles.customerCopy}>
                <Text style={[styles.customerName, appearance.dark && darkStyles.titleText]}>{item.customerName}</Text>
                <Text style={[styles.meta, appearance.dark && darkStyles.bodyText]}>
                  {formatEnquiryType(item.enquiryType)} · {formatDate(item.createdAt)}
                </Text>
              </View>
              <StatusPill status={item.status} />
            </View>

            <View style={[styles.messageBox, appearance.dark && darkStyles.subtleCard]}>
              <Text style={[styles.messageText, appearance.dark && darkStyles.titleText]}>{item.originalText}</Text>
            </View>

            {item.matchedItemName ? (
              <View style={styles.matchRow}>
                <Ionicons name="pricetag-outline" size={18} color="#12B76A" />
                <View style={styles.customerCopy}>
                  <Text style={[styles.matchName, appearance.dark && darkStyles.titleText]}>{item.matchedItemName}</Text>
                  <Text style={[styles.meta, appearance.dark && darkStyles.bodyText]}>
                    {item.quotedPrice === null ? 'Catalogue match' : formatMoney(item.quotedPrice, item.currency)}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={[styles.reviewText, appearance.dark && darkStyles.warningText]}>
                Catalogue match needs merchant review.
              </Text>
            )}

            {item.responseText ? (
              <View style={[styles.replyBox, appearance.dark && darkStyles.mintCard]}>
                <Text style={[styles.replyLabel, appearance.dark && darkStyles.greenText]}>SELLERTRAY REPLIED</Text>
                <Text style={[styles.replyText, appearance.dark && darkStyles.bodyText]}>{item.responseText}</Text>
              </View>
            ) : null}

            {item.status === 'converted' ? (
              <View style={[styles.convertedBox, appearance.dark && darkStyles.mintCard]}>
                <Ionicons name="checkmark-circle-outline" size={19} color="#12B76A" />
                <Text style={[styles.convertedText, appearance.dark && darkStyles.greenText]}>
                  Customer committed to buy · enquiry converted to order
                </Text>
              </View>
            ) : item.status === 'dismissed' ? (
              <Text style={[styles.leadHint, appearance.dark && darkStyles.bodyText]}>
                Dismissed by the merchant. This enquiry will not trigger an order.
              </Text>
            ) : (
              <>
                <Text style={[styles.leadHint, appearance.dark && darkStyles.bodyText]}>
                  This remains an enquiry until the customer clearly commits, or you create the order yourself.
                </Text>
                <View style={[styles.actionPanel, appearance.dark && darkStyles.subtleCard]}>
                  <Text style={[styles.actionTitle, appearance.dark && darkStyles.titleText]}>MERCHANT ACTIONS</Text>

                  {item.matchedCatalogItemId ? (
                    <View style={styles.convertRow}>
                      <TextInput
                        value={quantities[item.id] ?? '1'}
                        onChangeText={(value) => setQuantities((current) => ({ ...current, [item.id]: value.replace(/[^0-9.]/g, '') }))}
                        keyboardType="decimal-pad"
                        editable={busyId !== item.id}
                        style={[styles.quantityInput, appearance.dark && darkStyles.input, appearance.dark && darkStyles.titleText]}
                      />
                      <Pressable
                        disabled={busyId === item.id}
                        onPress={() => void convertToOrder(item)}
                        style={[styles.primaryAction, busyId === item.id && styles.disabled]}
                      >
                        <Text style={styles.primaryActionText}>{busyId === item.id ? 'Working…' : 'Create order'}</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={[styles.actionHint, appearance.dark && darkStyles.warningText]}>
                      Create order is disabled until this enquiry is matched to a catalogue item.
                    </Text>
                  )}

                  <TextInput
                    value={replies[item.id] ?? ''}
                    onChangeText={(value) => setReplies((current) => ({ ...current, [item.id]: value }))}
                    placeholder="Reply to this customer on WhatsApp"
                    placeholderTextColor={appearance.dark ? '#98A2B3' : '#98A2B3'}
                    multiline
                    editable={busyId !== item.id}
                    style={[styles.replyInput, appearance.dark && darkStyles.input, appearance.dark && darkStyles.titleText]}
                  />

                  <View style={styles.actionButtons}>
                    <Pressable
                      disabled={busyId === item.id}
                      onPress={() => void sendReply(item)}
                      style={[styles.secondaryAction, appearance.dark && darkStyles.secondaryAction, busyId === item.id && styles.disabled]}
                    >
                      <Text style={[styles.secondaryActionText, appearance.dark && darkStyles.titleText]}>Reply</Text>
                    </Pressable>
                    <Pressable
                      disabled={busyId === item.id}
                      onPress={() => void dismiss(item)}
                      style={[styles.dismissAction, busyId === item.id && styles.disabled]}
                    >
                      <Text style={styles.dismissActionText}>Dismiss</Text>
                    </Pressable>
                  </View>

                  {actionErrors[item.id] ? <Text style={styles.actionError}>{actionErrors[item.id]}</Text> : null}
                  {actionNotices[item.id] ? <Text style={styles.actionNotice}>{actionNotices[item.id]}</Text> : null}
                </View>
              </>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function Stat({ label, value, dark }: { label: string; value: number; dark: boolean }) {
  return (
    <View style={[styles.statCard, dark && darkStyles.card]}>
      <Text style={[styles.statValue, dark && darkStyles.titleText]}>{value}</Text>
      <Text style={[styles.statLabel, dark && darkStyles.bodyText]}>{label}</Text>
    </View>
  );
}

function FilterButton({ label, active, onPress, dark }: { label: string; active: boolean; onPress: () => void; dark: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.filterButton, dark && darkStyles.filterButton, active && styles.filterActive, dark && active && darkStyles.filterActive]}>
      <Text style={[styles.filterText, dark && darkStyles.bodyText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function StatusPill({ status }: { status: CustomerEnquiry['status'] }) {
  const positive = status === 'converted';
  return (
    <View style={[styles.pill, positive ? styles.pillPositive : styles.pillNeutral]}>
      <Text style={[styles.pillText, positive ? styles.pillTextPositive : styles.pillTextNeutral]}>{status.toUpperCase()}</Text>
    </View>
  );
}

function formatEnquiryType(value: CustomerEnquiry['enquiryType']) {
  if (value === 'price') return 'Price enquiry';
  if (value === 'availability') return 'Availability enquiry';
  if (value === 'product') return 'Product enquiry';
  return 'General enquiry';
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return currency + ' ' + value.toFixed(0);
  }
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  list: { gap: 10 },
  customerCopy: { flex: 1 },
  eyebrow: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 27, lineHeight: 33, fontWeight: '900', marginTop: 3 },
  body: { color: '#667085', fontSize: 13, lineHeight: 20, marginTop: 3 },
  stats: { flexDirection: 'row', gap: 9 },
  statCard: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 13 },
  statValue: { color: '#102A43', fontSize: 22, fontWeight: '900' },
  statLabel: { color: '#667085', fontSize: 12, marginTop: 3, fontWeight: '700' },
  filters: { flexDirection: 'row', gap: 7, backgroundColor: '#F2F4F7', borderRadius: 13, padding: 4 },
  filterButton: { flex: 1, minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  filterActive: { backgroundColor: '#FFFFFF' },
  filterText: { color: '#667085', fontSize: 12, fontWeight: '800' },
  filterTextActive: { color: '#079455' },
  loadingCard: { minHeight: 120, backgroundColor: '#FFFFFF', borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyCard: { minHeight: 150, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 18 },
  emptyTitle: { color: '#102A43', fontSize: 16, fontWeight: '900', marginTop: 7 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, padding: 13, gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  customerName: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  meta: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 2 },
  messageBox: { backgroundColor: '#F9FAFB', borderRadius: 11, padding: 11 },
  messageText: { color: '#344054', fontSize: 13, lineHeight: 20, fontWeight: '700' },
  matchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  matchName: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  reviewText: { color: '#B54708', fontSize: 12, lineHeight: 18, fontWeight: '800' },
  replyBox: { backgroundColor: '#ECFDF3', borderRadius: 11, padding: 10 },
  replyLabel: { color: '#027A48', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  replyText: { color: '#344054', fontSize: 13, lineHeight: 19, marginTop: 3 },
  convertedBox: { backgroundColor: '#ECFDF3', borderRadius: 11, minHeight: 43, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
  convertedText: { color: '#027A48', fontSize: 12, lineHeight: 18, fontWeight: '800', flex: 1 },
  leadHint: { color: '#667085', fontSize: 12, lineHeight: 18 },
  actionPanel: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 11, gap: 9 },
  actionTitle: { color: '#344054', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  actionHint: { color: '#B54708', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  convertRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  quantityInput: { width: 72, minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingHorizontal: 10, backgroundColor: '#FFFFFF', color: '#102A43', textAlign: 'center', fontWeight: '800' },
  replyInput: { minHeight: 70, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, padding: 10, backgroundColor: '#FFFFFF', color: '#102A43', textAlignVertical: 'top', fontSize: 13, lineHeight: 19 },
  actionButtons: { flexDirection: 'row', gap: 8 },
  primaryAction: { flex: 1, minHeight: 44, borderRadius: 10, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryActionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  secondaryAction: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  secondaryActionText: { color: '#344054', fontSize: 13, fontWeight: '900' },
  dismissAction: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: '#FEF3F2', alignItems: 'center', justifyContent: 'center' },
  dismissActionText: { color: '#B42318', fontSize: 13, fontWeight: '900' },
  actionError: { color: '#B42318', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  actionNotice: { color: '#027A48', fontSize: 12, lineHeight: 18, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  pill: { borderRadius: 999, paddingVertical: 5, paddingHorizontal: 8 },
  pillPositive: { backgroundColor: '#ECFDF3' },
  pillNeutral: { backgroundColor: '#F2F4F7' },
  pillText: { fontSize: 12, fontWeight: '900' },
  pillTextPositive: { color: '#027A48' },
  pillTextNeutral: { color: '#475467' },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 14, padding: 13, gap: 4 },
  errorTitle: { color: '#B42318', fontSize: 14, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 13, lineHeight: 19 },
  retry: { color: '#12B76A', fontSize: 13, fontWeight: '900', marginTop: 4 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46' },
  mintCard: { backgroundColor: '#12372C' },
  filterButton: { backgroundColor: '#162F46' },
  filterActive: { backgroundColor: '#12372C' },
  input: { backgroundColor: '#162F46', borderColor: '#475467' },
  secondaryAction: { backgroundColor: '#162F46', borderColor: '#475467' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  greenText: { color: '#ABEFC6' },
  warningText: { color: '#FEC84B' },
});
