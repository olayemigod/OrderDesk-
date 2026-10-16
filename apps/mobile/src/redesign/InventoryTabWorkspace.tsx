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
import { loadLowStock } from '../data/lowStockRepository';
import {
  isLikelyConnectivityError,
  loadCommerceProductCache,
  saveCommerceProductCache,
} from '../data/offlineSalesRepository';
import { sellerTrayUserMessage } from '../data/userFacingError';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { InventoryWorkspace } from './InventoryWorkspace';
import { LowStockWorkspace } from './LowStockWorkspace';
import { ProductManagementWorkspace } from './ProductManagementWorkspace';
import { StockCountWorkspace } from './StockCountWorkspace';
import { StockTransferWorkspace } from './StockTransferWorkspace';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  currency: string;
};

const NO_CAPABILITIES: InventoryCapabilities = {
  canReceiveStock: false,
  canAdjustStock: false,
  canCountStock: false,
  canApplyStockCount: false,
  canTransferStock: false,
};

export function InventoryTabWorkspace({ tenantId, branch, currency }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [capabilities, setCapabilities] = useState<InventoryCapabilities>(NO_CAPABILITIES);
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [activeCount, setActiveCount] = useState<StockCountDetail | null>(null);
  const [lowStockCount, setLowStockCount] = useState<number | null>(null);
  const [loadingCountAccess, setLoadingCountAccess] = useState(true);
  const [countAccessError, setCountAccessError] = useState<string | null>(null);
  const [countOpen, setCountOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [lowStockOpen, setLowStockOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [inventoryVersion, setInventoryVersion] = useState(0);

  async function refreshCountEntry() {
    setLoadingCountAccess(true);
    setCountAccessError(null);
    setLowStockCount(null);
    try {
      const [nextCapabilities, nextProducts] = await Promise.all([
        loadInventoryCapabilities(tenantId, branch.id),
        loadCommerceProducts(tenantId, { includeInactive: true }),
      ]);
      setCapabilities(nextCapabilities);
      setProducts(nextProducts);
      await saveCommerceProductCache(tenantId, nextProducts).catch(() => undefined);

      try {
        const alerts = await loadLowStock(tenantId, branch.id);
        setLowStockCount(alerts.length);
      } catch {
        setLowStockCount(null);
      }

      if (nextCapabilities.canCountStock || nextCapabilities.canApplyStockCount) {
        try {
          setActiveCount(await loadActiveStockCount(tenantId, branch.id));
        } catch (err) {
          setActiveCount(null);
          setCountAccessError(sellerTrayUserMessage(err, 'Stock count is unavailable right now.'));
        }
      } else {
        setActiveCount(null);
      }
    } catch (err) {
      setCapabilities(NO_CAPABILITIES);
      setActiveCount(null);
      setLowStockCount(null);
      const cached = isLikelyConnectivityError(err) ? await loadCommerceProductCache(tenantId) : null;
      setProducts(cached?.data ?? []);
      setCountAccessError(
        isLikelyConnectivityError(err)
          ? 'Inventory actions need a connection. Saved stock remains available to view.'
          : sellerTrayUserMessage(err, 'Inventory action access could not be verified.'),
      );
    } finally {
      setLoadingCountAccess(false);
    }
  }

  useEffect(() => {
    setCountOpen(false);
    setTransferOpen(false);
    setLowStockOpen(false);
    setProductsOpen(false);
    setInventoryVersion(0);
    void refreshCountEntry();
  }, [tenantId, branch.id]);

  if (productsOpen) {
    return (
      <ProductManagementWorkspace
        tenantId={tenantId}
        currency={currency}
        onClose={() => {
          setProductsOpen(false);
          setInventoryVersion((value) => value + 1);
          void refreshCountEntry();
        }}
      />
    );
  }

  if (lowStockOpen) {
    return (
      <LowStockWorkspace
        tenantId={tenantId}
        branch={branch}
        onClose={() => {
          setLowStockOpen(false);
          void refreshCountEntry();
        }}
      />
    );
  }

  if (transferOpen) {
    return (
      <StockTransferWorkspace
        tenantId={tenantId}
        branch={branch}
        products={products}
        capabilities={capabilities}
        onInventoryChanged={() => setInventoryVersion((value) => value + 1)}
        onClose={() => {
          setTransferOpen(false);
          setInventoryVersion((value) => value + 1);
          void refreshCountEntry();
        }}
      />
    );
  }

  if (countOpen) {
    return (
      <StockCountWorkspace
        tenantId={tenantId}
        branch={branch}
        products={products}
        capabilities={capabilities}
        onInventoryChanged={() => setInventoryVersion((value) => value + 1)}
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
      <Pressable
        onPress={() => setProductsOpen(true)}
        style={({ pressed }) => [styles.countCard, dark && darkStyles.card, pressed && styles.pressed]}
      >
        <View style={styles.countIcon}>
          <Ionicons name="pricetags-outline" size={22} color={theme.colors.greenDark} />
        </View>
        <View style={styles.countCopy}>
          <Text style={[styles.countTitle, dark && darkStyles.titleText]}>Products</Text>
          <Text style={[styles.countText, dark && darkStyles.bodyText]}>
            Search products, add one quickly or use a barcode as an optional shortcut.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

      <Pressable
        onPress={() => setLowStockOpen(true)}
        style={({ pressed }) => [
          styles.countCard,
          dark && darkStyles.card,
          lowStockCount !== null && lowStockCount > 0 && styles.lowStockCardActive,
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.countIcon, lowStockCount !== null && lowStockCount > 0 && styles.lowStockIconActive]}>
          <Ionicons
            name={lowStockCount !== null && lowStockCount > 0 ? 'alert-circle-outline' : 'checkmark-circle-outline'}
            size={22}
            color={lowStockCount !== null && lowStockCount > 0 ? theme.colors.danger : theme.colors.greenDark}
          />
        </View>
        <View style={styles.countCopy}>
          <Text style={[styles.countTitle, dark && darkStyles.titleText]}>Low stock</Text>
          <Text style={[styles.countText, dark && darkStyles.bodyText]}>
            {lowStockCount === null
              ? 'Open branch stock alerts.'
              : lowStockCount === 0
                ? 'No product is at or below its branch threshold.'
                : `${lowStockCount} product${lowStockCount === 1 ? '' : 's'} need replenishment attention.`}
          </Text>
        </View>
        {lowStockCount !== null && lowStockCount > 0 ? (
          <View style={styles.alertCount}>
            <Text style={styles.alertCountText}>{lowStockCount}</Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

      <Pressable
        onPress={() => setTransferOpen(true)}
        style={({ pressed }) => [styles.countCard, dark && darkStyles.card, pressed && styles.pressed]}
      >
        <View style={styles.countIcon}>
          <Ionicons name="git-compare-outline" size={22} color={theme.colors.greenDark} />
        </View>
        <View style={styles.countCopy}>
          <Text style={[styles.countTitle, dark && darkStyles.titleText]}>Stock transfers</Text>
          <Text style={[styles.countText, dark && darkStyles.bodyText]}>
            {capabilities.canTransferStock
              ? 'Move stock between accessible branches and confirm dispatch or receipt.'
              : 'View incoming and outgoing transfer history for this branch.'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

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
          style={({ pressed }) => [
            styles.countCard,
            dark && darkStyles.card,
            activeCount && styles.countCardActive,
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.countIcon, activeCount && styles.countIconActive]}>
            <Ionicons name={activeCount ? 'clipboard' : 'clipboard-outline'} size={22} color={theme.colors.greenDark} />
          </View>
          <View style={styles.countCopy}>
            <Text style={[styles.countTitle, dark && darkStyles.titleText]}>
              {activeCount?.status === 'review'
                ? 'Review stock count'
                : activeCount
                  ? 'Continue stock count'
                  : 'Stock count'}
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
            Inventory action access could not be verified. Inventory viewing remains available.
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
  lowStockCardActive: { borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft },
  countIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: theme.colors.cloud,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countIconActive: { backgroundColor: theme.colors.white },
  lowStockIconActive: { backgroundColor: theme.colors.white },
  countCopy: { flex: 1, minWidth: 0 },
  countTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  countText: { color: theme.colors.slate, fontSize: 11, lineHeight: 17, marginTop: 2 },
  alertCount: {
    minWidth: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: theme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  alertCountText: { color: theme.colors.white, fontSize: 10, fontWeight: '900' },
  permissionCard: {
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cloud,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  permissionText: { flex: 1, color: theme.colors.muted, fontSize: 11, lineHeight: 17 },
  pressed: { opacity: 0.76 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});