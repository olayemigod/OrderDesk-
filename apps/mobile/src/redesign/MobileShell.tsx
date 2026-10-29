import { useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SellerTrayBrand } from '../components/SellerTrayBrand';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { useBusinessContextSelection } from './BusinessContextSelection';

export type SellerTrayPrimaryTab = 'home' | 'sell' | 'orders' | 'inventory' | 'more';
export type SellerTraySyncState = 'online' | 'syncing' | 'offline';

export const SELLERTRAY_PRIMARY_TABS: ReadonlyArray<{
  key: SellerTrayPrimaryTab;
  label: string;
  icon: string;
}> = [
  { key: 'home', label: 'Home', icon: 'home-outline' },
  { key: 'sell', label: 'Sell', icon: 'cart-outline' },
  { key: 'orders', label: 'Orders', icon: 'receipt-outline' },
  { key: 'inventory', label: 'Inventory', icon: 'cube-outline' },
  { key: 'more', label: 'More', icon: 'ellipsis-horizontal' },
] as const;

type Props = {
  activeTab: SellerTrayPrimaryTab;
  businessName: string;
  branchName?: string | null;
  canSwitchBranch?: boolean;
  notificationCount?: number;
  orderAttentionCount?: number;
  syncState?: SellerTraySyncState;
  onTabChange: (tab: SellerTrayPrimaryTab) => void;
  onOpenNotifications?: () => void;
  onOpenBranchSwitcher?: () => void;
  onRefresh?: () => void | Promise<void>;
  children: ReactNode;
};

export function MobileShell({
  activeTab,
  businessName,
  branchName,
  canSwitchBranch = false,
  notificationCount = 0,
  orderAttentionCount = 0,
  syncState = 'online',
  onTabChange,
  onOpenNotifications,
  onOpenBranchSwitcher,
  onRefresh,
  children,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const businessContext = useBusinessContextSelection();
  const dark = appearance.dark;
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, dark && darkStyles.safeArea]}>
      <StatusBar
        barStyle={dark ? 'light-content' : 'dark-content'}
        backgroundColor={dark ? theme.colors.navyDeep : theme.colors.cloud}
      />

      <View style={[styles.frame, dark && darkStyles.frame]}>
        <View style={[styles.header, dark && darkStyles.header]}>
          <SellerTrayBrand size={32} inverted={dark} />

          <View style={styles.headerActions}>
            <SyncPill state={syncState} />
            <Pressable
              accessibilityLabel="Open notifications"
              disabled={!onOpenNotifications}
              onPress={onOpenNotifications}
              style={({ pressed }) => [styles.iconButton, dark && darkStyles.card, pressed && styles.pressed]}
            >
              <Ionicons name="notifications-outline" size={22} color={dark ? theme.colors.mint : theme.colors.navy} />
              {notificationCount > 0 ? (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationBadgeText}>{notificationCount > 99 ? '99+' : notificationCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>

        <View style={[styles.contextBar, dark && darkStyles.contextBar]}>
          <View style={styles.contextCopy}>
            <Text style={[styles.contextLabel, dark && darkStyles.bodyText]}>BUSINESS</Text>
            {businessContext.canSwitchBusiness ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Switch Business. Current Business ${businessName}`}
                hitSlop={8}
                onPress={businessContext.openBusinessSwitcher}
                style={({ pressed }) => [styles.businessSelectorTrigger, pressed && styles.pressed]}
              >
                <Text numberOfLines={1} style={[styles.businessName, dark && darkStyles.titleText]}>{businessName}</Text>
                <Ionicons name="chevron-down" size={17} color={dark ? theme.dark.accentText : theme.colors.greenDark} />
              </Pressable>
            ) : (
              <Text numberOfLines={1} style={[styles.businessName, dark && darkStyles.titleText]}>{businessName}</Text>
            )}
            <View style={styles.branchRow}>
              <Ionicons name="location-outline" size={15} color={dark ? theme.dark.textMuted : theme.colors.muted} />
              <Text numberOfLines={1} style={[styles.branchName, dark && darkStyles.bodyText]}>{branchName?.trim() || 'Business-wide'}</Text>
            </View>
          </View>

          {canSwitchBranch && onOpenBranchSwitcher ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch Branch"
              onPress={onOpenBranchSwitcher}
              style={({ pressed }) => [styles.branchButton, dark && darkStyles.outlineButton, pressed && styles.pressed]}
            >
              <Text style={[styles.branchButtonText, dark && darkStyles.greenText]}>Branch</Text>
              <Ionicons name="chevron-down" size={16} color={dark ? theme.dark.accentText : theme.colors.greenDark} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, dark && darkStyles.content]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              colors={[theme.colors.green]}
              tintColor={dark ? theme.colors.mint : theme.colors.greenDark}
              progressBackgroundColor={dark ? theme.dark.surface : theme.colors.white}
            />
          ) : undefined}
        >
          {children}
        </ScrollView>

        <View style={[styles.bottomNav, dark && darkStyles.bottomNav]}>
          {SELLERTRAY_PRIMARY_TABS.map((tab) => (
            <PrimaryNavButton
              key={tab.key}
              icon={tab.icon}
              label={tab.label}
              active={activeTab === tab.key}
              count={tab.key === 'orders' ? orderAttentionCount : 0}
              onPress={() => onTabChange(tab.key)}
            />
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

function PrimaryNavButton({ icon, label, active, count, onPress }: {
  icon: string;
  label: string;
  active: boolean;
  count: number;
  onPress: () => void;
}) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.navButton, active && styles.navButtonActive, dark && active && darkStyles.navButtonActive, pressed && styles.pressed]}
    >
      <View style={styles.navIconWrap}>
        <Ionicons name={icon as never} size={21} color={active ? theme.colors.green : dark ? theme.dark.textMuted : theme.colors.muted} />
        {count > 0 ? (
          <View style={styles.navBadge}><Text style={styles.navBadgeText}>{count > 99 ? '99+' : count}</Text></View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.navLabel, dark && darkStyles.bodyText, active && styles.navLabelActive, dark && active && darkStyles.greenText]}>{label}</Text>
    </Pressable>
  );
}

function SyncPill({ state }: { state: SellerTraySyncState }) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const label = state === 'offline' ? 'Offline' : state === 'syncing' ? 'Syncing' : 'Online';
  const icon = state === 'offline' ? 'cloud-offline-outline' : state === 'syncing' ? 'sync-outline' : 'cloud-done-outline';
  const offline = state === 'offline';

  return (
    <View style={[
      styles.syncPill,
      dark && darkStyles.subtleCard,
      offline && (dark ? darkStyles.warningPill : styles.syncPillOffline),
    ]}>
      <Ionicons
        name={icon as never}
        size={14}
        color={offline
          ? (dark ? theme.dark.warningText : theme.colors.warning)
          : (dark ? theme.dark.accentText : theme.colors.greenDark)}
      />
      <Text style={[
        styles.syncText,
        dark && darkStyles.bodyText,
        offline && styles.syncTextOffline,
        dark && offline && darkStyles.warningText,
      ]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.cloud, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0 },
  frame: { flex: 1, backgroundColor: theme.colors.cloud },
  header: { minHeight: 64, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.cloud },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  notificationBadge: { position: 'absolute', right: 2, top: 2, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: theme.colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  notificationBadgeText: { color: theme.colors.white, fontSize: 10, fontWeight: '900' },
  contextBar: { minHeight: 76, paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.white, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  contextCopy: { flex: 1, minWidth: 0, gap: 2 },
  contextLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.9 },
  businessSelectorTrigger: { minHeight: 30, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5 },
  businessName: { flexShrink: 1, color: theme.colors.navy, fontSize: 16, fontWeight: '900' },
  branchRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  branchName: { flex: 1, color: theme.colors.muted, fontSize: 12, fontWeight: '700' },
  branchButton: { minHeight: 40, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  branchButtonText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  bottomNav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 4, paddingTop: 7, paddingBottom: Platform.OS === 'android' ? 14 : 10, gap: 1 },
  navButton: { flex: 1, minHeight: 58, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 2 },
  navButtonActive: { backgroundColor: theme.colors.mintSoft },
  navIconWrap: { minWidth: 30, alignItems: 'center', position: 'relative' },
  navLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  navLabelActive: { color: theme.colors.greenDark },
  navBadge: { position: 'absolute', right: -8, top: -7, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  navBadgeText: { color: theme.colors.white, fontSize: 10, fontWeight: '900' },
  syncPill: { minHeight: 30, borderRadius: theme.radius.pill, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncPillOffline: { backgroundColor: theme.colors.warningSoft },
  syncText: { color: theme.colors.greenDark, fontSize: 10, fontWeight: '900' },
  syncTextOffline: { color: '#B54708' },
  pressed: { opacity: 0.72 },
});

const darkStyles = StyleSheet.create({
  safeArea: { backgroundColor: theme.colors.navyDeep },
  frame: { backgroundColor: theme.dark.canvas },
  header: { backgroundColor: theme.dark.canvas, borderBottomColor: theme.dark.border },
  contextBar: { backgroundColor: theme.dark.surface, borderBottomColor: theme.dark.border },
  content: { backgroundColor: theme.dark.canvas },
  card: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  subtleCard: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.border },
  outlineButton: { backgroundColor: theme.dark.surface, borderColor: theme.dark.borderStrong },
  bottomNav: { backgroundColor: theme.colors.navyDeep, borderTopColor: theme.dark.border },
  navButtonActive: { backgroundColor: theme.dark.accentSoft },
  warningPill: { backgroundColor: theme.dark.warningSurface, borderColor: theme.dark.warningBorder },
  warningText: { color: theme.dark.warningText },
  titleText: { color: theme.dark.text },
  bodyText: { color: theme.dark.textMuted },
  greenText: { color: theme.dark.accentText },
});
