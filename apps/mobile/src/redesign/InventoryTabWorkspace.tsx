import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  loadCommerceProducts,
  type CommerceBranch,
  type CommerceProduct,
} from '../data/commerceRepository';
import {
  loadActiveStockCount,
  loadInventoryCapabilities,
  type InventoryCapabilities,
  type StockCountDetail,
} from '../data/inventoryRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { InventoryWorkspace } from './InventoryWorkspace';
import { StockCountWorkspace } from './StockCountWorkspace';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
};

const NO_CAPABILITIES: InventoryCapabilities = {
  canReceiveStock: false,
  canAdjustStock: false,
  canCountStock: false,
  canApplyStockCount: false,
};

export function InventoryTabWorkspace({ tenantId, branch }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [capabilities, setCapabilities] = useState<InventoryCapabilities>(NO_CAPABILITIES);
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [activeCount, setActiveCount] = useState<StockCountDetail | null>(null);
  const [loadingCountAccess, setLoadingCountAccess] = useState(true);
  const [countAccessError, setCountAccessError] = useState<string | null>(null);
  const [countOpen, setCountOpen] = useState(false);
  const [inventoryVersion, setInventoryVersion] = useState(0);

  async function refreshCountEntry() {
    setLoadingCountAccess(true);
    setCountAccessError(null);
    try {
      const [nextCapabilities, nextProducts] = await Promise.all([
        loadInventoryCapabilities(tenantId, branch.id),
        loadCommerceProducts(tenantId),
      ]);
      setCapabilities(nextCapabilities);
      setProducts(nextProducts);

      if (nextCapabilities.canCountStock || nextCapabilities.canApplyStockCount) {
        try {
          setActiveCount(await loadActiveStockCount(tenantId, branch.id));
        } catch (err) {
          setActiveCount(null);
          setCountAccessError(err instanceof Error ? err.message : 'Unable to load the active stock count.');
        }
      } else {
        setActiveCount(null);
      }
    } catch (err) {
      setCapabilities(NO_CAPABILITIES);
      setProducts([]);
      setActiveCount(null);
      setCountAccessError(err instanceof Error ? err.message : 'Stock count access could not be verified.');
    } finally {
      setLoadingCountAccess(false);
    }
  }

  useEffect(() => {
    setCountOpen(false);
    setInventoryVersion(0);
    void refreshCountEntry();
  }, [tenantId, branch.id]);

  if (countOpen) {
    return (
      <StockCountWorkspace
        tenantId={tenantId}
        branch={branch}
        products={products}
        capabilities={capabilities}
        onInventoryChanged={() => {
          setInventoryVersion((value) => value + 1);
        }}
        onClose={() => {
          setCountOpen(false);
          setInventoryVersion((value) => value + 1);
          void refreshCountEntry();
        }}
      />
    );
  }

  const canUseCount = capabilities.canCountStock || capabilities.canApplyStockCount;

  return (
    <View style={styles.stack}>
      {loadingCountAccess ? (
        <View style={[styles.countCard, dark && darkStyles.card]}>
          <ActivityIndicator size="small" />
          <View style={styles.countCopy}>
            <Text style={[styles.countTitle, dark && darkStyles.titleText]}>Stock count</Text>
            <Text style={[styles.countText, dark && darkStyles.bodyText]}>Checking count access…</Text>
          </View>
        </View>
      ) : canUseCount ? (
        <Pressable
          onPress={() => setCountOpen(true)}
          style={({ pressed }) => [styles.countCard, dark && darkStyles.card, activeCount && styles.countCardActive, pressed && styles.pressed]}
        >
          <View style={[styles.countIcon, activeCount && styles.countIconActive]}>
            <Ionicons name={activeCount ? 'clipboard' : 'clipboard-outline'} size={22} color={theme.colors.greenDark} />
          </View>
          <View style={styles.countCopy}>
            <Text style={[styles.countTitle, dark && darkStyles.titleText]}>
              {activeCount?.status === 'review' ? 'Review stock count' : activeCount ? 'Continue stock count' : 'Stock count'}
            </Text>
            <Text style={[styles.countText, dark && darkStyles.bodyText]}>
              {activeCount
                ? `${activeCount.reference} · ${activeCount.status === 'review' ? 'Variance review ready' : `${activeCount.capturedItems}/${activeCount.totalItems} products counted`}`
                : 'Count physical stock, review variances, then apply authorised reconciliation.'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
        </Pressable>
      ) : countAccessError ? (
        <View style={[styles.permissionCard, dark && darkStyles.subtleCard]}>
          <Ionicons name="shield-outline" size={18} color={theme.colors.muted} />
          <Text style={[styles.permissionText, dark && darkStyles.bodyText]}>
            Stock count access could not be verified. Inventory viewing remains available.
          </Text>
        </View>
      ) : null}

      <InventoryWorkspace
        key={`${tenantId}:${branch.id}:${inventoryVersion}`}
        tenantId={tenantId}
        branch={branch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  countCard: {
    minHeight: 82,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.white,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  countCardActive: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  countIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: theme.colors.cloud, alignItems: 'center', justifyContent: 'center' },
  countIconActive: { backgroundColor: theme.colors.white },
  countCopy: { flex: 1, minWidth: 0 },
  countTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  countText: { color: theme.colors.slate, fontSize: 11, lineHeight: 17, marginTop: 2 },
  permissionCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.cloud, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  permissionText: { flex: 1, color: theme.colors.muted, fontSize: 11, lineHeight: 17 },
  pressed: { opacity: 0.76 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});