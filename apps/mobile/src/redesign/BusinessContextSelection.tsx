import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { MerchantBusiness } from '../data/businessRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type BusinessContextSelectionValue = {
  canSwitchBusiness: boolean;
  openBusinessSwitcher: () => void;
};

const BusinessContextSelectionContext = createContext<BusinessContextSelectionValue>({
  canSwitchBusiness: false,
  openBusinessSwitcher: () => undefined,
});

type Props = {
  businesses: MerchantBusiness[];
  activeBusinessId: string;
  onSelectBusiness: (businessId: string) => Promise<void>;
  children: ReactNode;
};

export function BusinessContextSelectionProvider({
  businesses,
  activeBusinessId,
  onSelectBusiness,
  children,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canSwitchBusiness = businesses.length > 1;
  const expanded = width >= 600;

  const value = useMemo<BusinessContextSelectionValue>(() => ({
    canSwitchBusiness,
    openBusinessSwitcher: () => {
      if (!canSwitchBusiness) return;
      setError(null);
      setOpen(true);
    },
  }), [canSwitchBusiness]);

  async function chooseBusiness(businessId: string) {
    if (switchingId) return;
    if (businessId === activeBusinessId) {
      setOpen(false);
      return;
    }

    setSwitchingId(businessId);
    setError(null);
    try {
      await onSelectBusiness(businessId);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to switch Business.');
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <BusinessContextSelectionContext.Provider value={value}>
      {children}
      <Modal
        visible={open && canSwitchBusiness}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          if (!switchingId) setOpen(false);
        }}
      >
        <View style={[styles.modalRoot, expanded && styles.modalRootExpanded]}>
          <Pressable
            accessibilityLabel="Close Business selector"
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!switchingId) setOpen(false);
            }}
          />
          <View
            style={[
              styles.sheet,
              appearance.dark && darkStyles.sheet,
              expanded && styles.sheetExpanded,
              { maxHeight: Math.min(height * 0.78, 620) },
            ]}
          >
            <View style={styles.handle} />
            <View style={styles.headingRow}>
              <View style={styles.headingCopy}>
                <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Switch Business</Text>
                <Text style={[styles.help, appearance.dark && darkStyles.bodyText]}>
                  Choose the Business you want to operate. Branch selection remains separate inside that Business.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close Business selector"
                disabled={Boolean(switchingId)}
                onPress={() => setOpen(false)}
                style={({ pressed }) => [styles.closeButton, appearance.dark && darkStyles.closeButton, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={22} color={appearance.dark ? theme.dark.text : theme.colors.navy} />
              </Pressable>
            </View>

            {error ? (
              <View style={[styles.errorCard, appearance.dark && darkStyles.errorCard]}>
                <Text style={[styles.errorText, appearance.dark && darkStyles.errorText]}>{error}</Text>
              </View>
            ) : null}

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {businesses.map((business) => {
                const active = business.id === activeBusinessId;
                const switching = business.id === switchingId;
                return (
                  <Pressable
                    key={business.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, busy: switching }}
                    accessibilityLabel={`${active ? 'Current Business' : 'Switch to'} ${business.name}`}
                    disabled={Boolean(switchingId)}
                    onPress={() => void chooseBusiness(business.id)}
                    style={({ pressed }) => [
                      styles.businessRow,
                      appearance.dark && darkStyles.businessRow,
                      active && styles.businessRowActive,
                      appearance.dark && active && darkStyles.businessRowActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.businessIcon, active && styles.businessIconActive, appearance.dark && darkStyles.businessIcon]}>
                      <Ionicons
                        name="storefront-outline"
                        size={21}
                        color={active ? theme.colors.greenDark : appearance.dark ? theme.dark.textMuted : theme.colors.slate}
                      />
                    </View>
                    <View style={styles.businessCopy}>
                      <Text numberOfLines={2} style={[styles.businessName, appearance.dark && darkStyles.titleText]}>
                        {business.name}
                      </Text>
                      <Text style={[styles.businessMeta, appearance.dark && darkStyles.bodyText]}>
                        {roleLabel(business.role)}{active ? ' · Current Business' : ''}
                      </Text>
                    </View>
                    {switching ? (
                      <ActivityIndicator size="small" color={theme.colors.green} />
                    ) : active ? (
                      <Ionicons name="checkmark-circle" size={24} color={theme.colors.green} />
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color={appearance.dark ? theme.dark.textMuted : theme.colors.muted} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </BusinessContextSelectionContext.Provider>
  );
}

export function useBusinessContextSelection() {
  return useContext(BusinessContextSelectionContext);
}

function roleLabel(role: string) {
  const normalized = role.trim().replace(/_/g, ' ');
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Business member';
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(8, 24, 37, 0.56)',
  },
  modalRootExpanded: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: theme.colors.white,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sheetExpanded: {
    maxWidth: 520,
    borderRadius: 24,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    backgroundColor: '#D0D5DD',
    marginBottom: 12,
  },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.navy, fontSize: 20, fontWeight: '900' },
  help: { color: theme.colors.slate, fontSize: 13, lineHeight: 19, marginTop: 4 },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.cloud,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorCard: { marginTop: 12, borderRadius: 12, backgroundColor: theme.colors.dangerSoft, padding: 10 },
  errorText: { color: '#B42318', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  list: { marginTop: 14 },
  listContent: { gap: 9, paddingBottom: 4 },
  businessRow: {
    minHeight: 68,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  businessRowActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  businessIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: theme.colors.white,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  businessIconActive: { borderColor: theme.colors.green },
  businessCopy: { flex: 1, minWidth: 0 },
  businessName: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  businessMeta: { color: theme.colors.muted, fontSize: 12, fontWeight: '700', marginTop: 3 },
  pressed: { opacity: 0.72 },
});

const darkStyles = StyleSheet.create({
  sheet: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  closeButton: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.borderStrong },
  errorCard: { backgroundColor: theme.dark.warningSurface, borderColor: theme.dark.warningBorder },
  errorText: { color: theme.dark.warningText },
  businessRow: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.border },
  businessRowActive: { backgroundColor: theme.dark.accentSoft, borderColor: theme.colors.green },
  businessIcon: { backgroundColor: theme.dark.surface, borderColor: theme.dark.borderStrong },
  titleText: { color: theme.dark.text },
  bodyText: { color: theme.dark.textMuted },
});
