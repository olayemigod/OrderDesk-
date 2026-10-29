import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCurrentBusinessOnboardingState } from '../hooks/useOnboardingState';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { OnboardingPreparationCard } from './OnboardingPreparationCard';

export type HomeAttentionItem = {
  key: string;
  title: string;
  detail: string;
  icon: string;
  count?: number;
  tone?: 'normal' | 'warning' | 'urgent';
  onPress: () => void;
};

type Props = {
  merchantName: string;
  branchName?: string | null;
  currency: string;
  salesToday: number;
  ordersToday: number;
  amountCollectedToday: number;
  expensesToday?: number | null;
  lowStockCount?: number;
  pendingWhatsappCount?: number;
  pendingTransferCount?: number;
  shiftOpen?: boolean | null;
  attentionItems?: HomeAttentionItem[];
  onNewSale: () => void;
  onOpenOrders: () => void;
  onOpenInventory: () => void;
  onOpenWhatsapp: () => void;
};

export function HomeDashboard({
  merchantName,
  branchName,
  currency,
  salesToday,
  ordersToday,
  amountCollectedToday,
  expensesToday = null,
  lowStockCount = 0,
  pendingWhatsappCount = 0,
  pendingTransferCount = 0,
  shiftOpen = null,
  attentionItems = [],
  onNewSale,
  onOpenOrders,
  onOpenInventory,
  onOpenWhatsapp,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const onboarding = useCurrentBusinessOnboardingState();
  const dark = appearance.dark;
  const visibleAttention = attentionItems.slice(0, 4);

  return (
    <View style={styles.stack}>
      <View style={styles.greetingBlock}>
        <Text
          style={[
            styles.greeting,
            dark && darkStyles.titleText,
            appearance.textSize === 'large' && styles.greetingLarge,
          ]}
        >
          {timeGreeting()}, {firstName(merchantName)}
        </Text>
        <Text style={[styles.subtle, dark && darkStyles.bodyText]}>
          {branchName?.trim() ? `${branchName} at a glance` : 'Your business at a glance'}
        </Text>
      </View>

      <OnboardingPreparationCard
        state={onboarding.state}
        loading={onboarding.loading}
        error={onboarding.error}
        onRefresh={onboarding.refresh}
      />

      <Pressable
        accessibilityRole="button"
        onPress={onNewSale}
        style={({ pressed }) => [styles.newSaleButton, pressed && styles.pressed]}
      >
        <View style={styles.newSaleIcon}>
          <Ionicons name="cart-outline" size={25} color={theme.colors.white} />
        </View>
        <View style={styles.newSaleCopy}>
          <Text style={styles.newSaleTitle}>New Sale</Text>
          <Text style={styles.newSaleText}>Start a quick counter or walk-in sale</Text>
        </View>
        <Ionicons name="arrow-forward" size={22} color={theme.colors.white} />
      </Pressable>

      <View style={styles.metricGrid}>
        <MetricCard icon="cash-outline" label="Sales today" value={formatMoney(salesToday, currency)} dark={dark} />
        <MetricCard icon="receipt-outline" label="Orders" value={String(ordersToday)} dark={dark} />
        <MetricCard icon="wallet-outline" label="Collected" value={formatMoney(amountCollectedToday, currency)} dark={dark} />
        <MetricCard
          icon="remove-circle-outline"
          label="Expenses"
          value={expensesToday === null ? '—' : formatMoney(expensesToday, currency)}
          dark={dark}
          muted={expensesToday === null}
        />
      </View>

      <View style={[styles.statusCard, dark && darkStyles.card]}>
        <View style={styles.sectionHeadingRow}>
          <View>
            <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>TODAY</Text>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Store status</Text>
          </View>
          {shiftOpen !== null ? (
            <View style={[
              styles.shiftPill,
              dark && darkStyles.shiftPill,
              !shiftOpen && styles.shiftPillClosed,
              dark && !shiftOpen && darkStyles.shiftPillClosed,
            ]}>
              <Ionicons
                name={shiftOpen ? 'radio-button-on-outline' : 'radio-button-off-outline'}
                size={14}
                color={shiftOpen
                  ? (dark ? theme.dark.accentText : theme.colors.greenDark)
                  : (dark ? theme.dark.textMuted : theme.colors.muted)}
              />
              <Text style={[
                styles.shiftText,
                dark && darkStyles.shiftText,
                !shiftOpen && styles.shiftTextClosed,
                dark && !shiftOpen && darkStyles.shiftTextClosed,
              ]}>
                {shiftOpen ? 'Shift open' : 'Shift closed'}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.statusGrid}>
          <StatusAction icon="logo-whatsapp" label="WhatsApp" value={pendingWhatsappCount} hint="waiting" onPress={onOpenWhatsapp} dark={dark} />
          <StatusAction icon="cube-outline" label="Low stock" value={lowStockCount} hint="items" onPress={onOpenInventory} dark={dark} />
          <StatusAction icon="card-outline" label="Transfers" value={pendingTransferCount} hint="pending" onPress={onOpenInventory} dark={dark} />
        </View>
      </View>

      <View style={[styles.attentionCard, dark && darkStyles.card]}>
        <View style={styles.sectionHeadingRow}>
          <View>
            <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>NEEDS ATTENTION</Text>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>What needs action</Text>
          </View>
          <View style={[styles.attentionCount, dark && darkStyles.warningBadge]}>
            <Text style={[styles.attentionCountText, dark && darkStyles.warningText]}>{visibleAttention.length}</Text>
          </View>
        </View>

        {visibleAttention.length === 0 ? (
          <View style={[styles.emptyState, dark && darkStyles.subtleCard]}>
            <Ionicons name="checkmark-circle-outline" size={22} color={theme.colors.green} />
            <Text style={[styles.emptyStateText, dark && darkStyles.bodyText]}>Nothing urgent needs your attention.</Text>
          </View>
        ) : (
          visibleAttention.map((item) => <AttentionRow key={item.key} item={item} dark={dark} />)
        )}
      </View>

      <View style={[styles.quickCard, dark && darkStyles.card]}>
        <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Quick actions</Text>
        <View style={styles.quickRow}>
          <QuickAction icon="receipt-outline" label="Orders" onPress={onOpenOrders} dark={dark} />
          <QuickAction icon="cube-outline" label="Inventory" onPress={onOpenInventory} dark={dark} />
          <QuickAction icon="logo-whatsapp" label="WhatsApp" onPress={onOpenWhatsapp} dark={dark} />
        </View>
      </View>
    </View>
  );
}

function MetricCard({ icon, label, value, dark, muted = false }: {
  icon: string;
  label: string;
  value: string;
  dark: boolean;
  muted?: boolean;
}) {
  return (
    <View style={[styles.metricCard, dark && darkStyles.card]}>
      <View style={[styles.metricIcon, dark && darkStyles.subtleCard]}>
        <Ionicons name={icon as never} size={19} color={dark ? theme.colors.green : theme.colors.greenDark} />
      </View>
      <Text style={[styles.metricLabel, dark && darkStyles.bodyText]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.metricValue, dark && darkStyles.titleText, muted && styles.metricValueMuted]}>{value}</Text>
    </View>
  );
}

function StatusAction({ icon, label, value, hint, onPress, dark }: {
  icon: string;
  label: string;
  value: number;
  hint: string;
  onPress: () => void;
  dark: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.statusAction, dark && darkStyles.subtleCard, pressed && styles.pressed]}>
      <Ionicons name={icon as never} size={20} color={dark ? theme.colors.green : theme.colors.greenDark} />
      <Text style={[styles.statusValue, dark && darkStyles.titleText]}>{value}</Text>
      <Text style={[styles.statusLabel, dark && darkStyles.bodyText]}>{label}</Text>
      <Text style={[styles.statusHint, dark && darkStyles.mutedText]}>{hint}</Text>
    </Pressable>
  );
}

function AttentionRow({ item, dark }: { item: HomeAttentionItem; dark: boolean }) {
  const warning = item.tone === 'warning' || item.tone === 'urgent';
  return (
    <Pressable
      onPress={item.onPress}
      style={({ pressed }) => [
        styles.attentionRow,
        dark && darkStyles.subtleCard,
        warning && (dark ? darkStyles.warningRow : styles.attentionRowWarning),
        pressed && styles.pressed,
      ]}
    >
      <View style={[
        styles.attentionIcon,
        dark && darkStyles.attentionIcon,
        warning && (dark ? darkStyles.warningIcon : styles.attentionIconWarning),
      ]}>
        <Ionicons
          name={item.icon as never}
          size={20}
          color={warning
            ? (dark ? theme.dark.warningText : '#B54708')
            : (dark ? theme.colors.green : theme.colors.greenDark)}
        />
      </View>
      <View style={styles.attentionCopy}>
        <Text style={[styles.attentionTitle, dark && darkStyles.titleText]}>{item.title}</Text>
        <Text style={[styles.attentionDetail, dark && darkStyles.bodyText]}>{item.detail}</Text>
      </View>
      {typeof item.count === 'number' ? (
        <View style={styles.rowCountBadge}><Text style={styles.rowCountText}>{item.count}</Text></View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={dark ? theme.dark.textMuted : theme.colors.subtle} />
    </Pressable>
  );
}

function QuickAction({ icon, label, onPress, dark }: {
  icon: string;
  label: string;
  onPress: () => void;
  dark: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickAction, dark && darkStyles.subtleCard, pressed && styles.pressed]}>
      <View style={[styles.quickIcon, dark && darkStyles.card]}>
        <Ionicons name={icon as never} size={22} color={dark ? theme.colors.green : theme.colors.greenDark} />
      </View>
      <Text style={[styles.quickLabel, dark && darkStyles.titleText]}>{label}</Text>
    </Pressable>
  );
}

function firstName(value: string): string {
  const clean = value.trim();
  if (!clean) return 'there';
  const part = clean.split(/\s+/)[0] ?? clean;
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function timeGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  greetingBlock: { gap: 4 },
  greeting: { color: theme.colors.navy, fontSize: 27, lineHeight: 33, fontWeight: '900' },
  greetingLarge: { fontSize: 30, lineHeight: 36 },
  subtle: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
  newSaleButton: { minHeight: 82, borderRadius: theme.radius.lg, backgroundColor: theme.colors.green, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12, ...theme.shadow.card },
  newSaleIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.17)', alignItems: 'center', justifyContent: 'center' },
  newSaleCopy: { flex: 1 },
  newSaleTitle: { color: theme.colors.white, fontSize: 20, fontWeight: '900' },
  newSaleText: { color: '#E8FFF3', fontSize: 12, lineHeight: 18, marginTop: 2, fontWeight: '700' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: { flexGrow: 1, flexBasis: '46%', minWidth: 138, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, gap: 4 },
  metricIcon: { width: 35, height: 35, borderRadius: 11, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  metricLabel: { color: theme.colors.slate, fontSize: 12, fontWeight: '800', marginTop: 2 },
  metricValue: { color: theme.colors.navy, fontSize: 21, fontWeight: '900' },
  metricValueMuted: { color: theme.colors.subtle },
  statusCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 12 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  sectionTitle: { color: theme.colors.navy, fontSize: 18, fontWeight: '900', marginTop: 2 },
  shiftPill: { minHeight: 32, borderRadius: theme.radius.pill, backgroundColor: theme.colors.mintSoft, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9 },
  shiftPillClosed: { backgroundColor: '#F2F4F7' },
  shiftText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  shiftTextClosed: { color: theme.colors.muted },
  statusGrid: { flexDirection: 'row', gap: 8 },
  statusAction: { flex: 1, minHeight: 104, borderRadius: theme.radius.md, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: theme.colors.border, padding: 11, gap: 2 },
  statusValue: { color: theme.colors.navy, fontSize: 21, fontWeight: '900', marginTop: 4 },
  statusLabel: { color: theme.colors.slate, fontSize: 11, fontWeight: '900' },
  statusHint: { color: theme.colors.subtle, fontSize: 10, fontWeight: '700' },
  attentionCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 9 },
  attentionCount: { minWidth: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.warningSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  attentionCountText: { color: '#B54708', fontSize: 14, fontWeight: '900' },
  emptyState: { minHeight: 58, borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12 },
  emptyStateText: { flex: 1, color: theme.colors.slate, fontSize: 12, fontWeight: '700' },
  attentionRow: { minHeight: 70, borderRadius: theme.radius.md, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11 },
  attentionRowWarning: { backgroundColor: theme.colors.warningSoft, borderColor: '#FEDF89' },
  attentionIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  attentionIconWarning: { backgroundColor: '#FEF0C7' },
  attentionCopy: { flex: 1 },
  attentionTitle: { color: theme.colors.navy, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  attentionDetail: { color: theme.colors.slate, fontSize: 11, lineHeight: 17, marginTop: 2 },
  rowCountBadge: { minWidth: 25, height: 25, borderRadius: 13, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  rowCountText: { color: theme.colors.white, fontSize: 11, fontWeight: '900' },
  quickCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, gap: 11 },
  quickRow: { flexDirection: 'row', gap: 8 },
  quickAction: { flex: 1, minHeight: 82, borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 5 },
  quickIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { color: theme.colors.navy, fontSize: 11, fontWeight: '900', textAlign: 'center' },
  pressed: { opacity: 0.74 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  subtleCard: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.border },
  attentionIcon: { backgroundColor: theme.dark.accentSoft },
  warningRow: { backgroundColor: theme.dark.warningSurface, borderColor: theme.dark.warningBorder },
  warningIcon: { backgroundColor: theme.dark.warningSurfaceStrong },
  warningBadge: { backgroundColor: theme.dark.warningSurface },
  warningText: { color: theme.dark.warningText },
  shiftPill: { backgroundColor: theme.dark.accentSoft },
  shiftPillClosed: { backgroundColor: theme.dark.surfaceSubtle },
  shiftText: { color: theme.dark.accentText },
  shiftTextClosed: { color: theme.dark.textMuted },
  titleText: { color: theme.dark.text },
  bodyText: { color: theme.dark.textMuted },
  mutedText: { color: theme.dark.textSubtle },
});
