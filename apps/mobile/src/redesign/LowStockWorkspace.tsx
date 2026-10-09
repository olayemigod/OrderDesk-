import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CommerceBranch } from '../data/commerceRepository';
import { loadLowStock, type LowStockRow } from '../data/lowStockRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  onClose: () => void;
};

export function LowStockWorkspace({ tenantId, branch, onClose }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [rows, setRows] = useState<LowStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setRows(await loadLowStock(tenantId, branch.id));
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Unable to load low stock.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantId, branch.id]);

  return (
    <View style={styles.stack}>
      <Pressable onPress={onClose} style={styles.backButton}>
        <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
        <Text style={[styles.backText, dark && darkStyles.bodyText]}>Inventory</Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>LOW STOCK</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>{branch.name}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Alerts use each product’s branch threshold in Stock UOM. Quantities remain ledger-derived.
        </Text>
      </View>

      {error ? (
        <View style={[styles.messageCard, styles.errorCard, dark && darkStyles.subtleCard]}>
          <Ionicons name="alert-circle-outline" size={19} color={theme.colors.danger} />
          <Text style={[styles.messageText, dark && darkStyles.bodyText]}>{error}</Text>
        </View>
      ) : null}

      {loading && rows.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Checking stock levels…</Text>
        </View>
      ) : null}

      {!loading && rows.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <Ionicons name="checkmark-circle-outline" size={30} color={theme.colors.green} />
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>Stock levels look good</Text>
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>
            No active product is at or below its low stock threshold for this branch.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((row) => (
            <View key={row.catalogItemId} style={[styles.card, dark && darkStyles.card]}>
              <View style={[styles.icon, row.isOutOfStock && styles.iconUrgent]}>
                <Ionicons
                  name={row.isOutOfStock ? 'alert-circle-outline' : 'cube-outline'}
                  size={21}
                  color={row.isOutOfStock ? theme.colors.danger : theme.colors.greenDark}
                />
              </View>
              <View style={styles.copy}>
                <Text style={[styles.itemName, dark && darkStyles.titleText]}>{row.itemName}</Text>
                <Text style={[styles.meta, dark && darkStyles.bodyText]}>
                  {[row.sku, row.category].filter(Boolean).join(' · ') || row.stockUom}
                </Text>
                <Text style={[styles.detail, dark && darkStyles.bodyText]}>
                  {row.isOutOfStock
                    ? 'Out of stock'
                    : `${formatQuantity(row.quantityOnHand)} ${row.stockUom} on hand · Alert at ${formatQuantity(row.lowStockThreshold)}`}
                </Text>
                {row.suggestedReorderQuantity !== null && row.suggestedReorderQuantity > 0 ? (
                  <Text style={[styles.reorder, dark && darkStyles.bodyText]}>
                    Suggested replenishment: {formatQuantity(row.suggestedReorderQuantity)} {row.stockUom}
                    {row.reorderTarget !== null ? ` to reach ${formatQuantity(row.reorderTarget)}` : ''}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.quantityPill, row.isOutOfStock && styles.quantityPillUrgent]}>
                <Text style={[styles.quantityText, row.isOutOfStock && styles.quantityTextUrgent]}>
                  {formatQuantity(row.quantityOnHand)}
                </Text>
                <Text style={[styles.quantityUom, dark && darkStyles.bodyText]}>{row.stockUom}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <Pressable disabled={loading} onPress={() => void refresh()} style={[styles.refreshButton, loading && styles.disabled]}>
        <Ionicons name="refresh-outline" size={18} color={theme.colors.greenDark} />
        <Text style={styles.refreshText}>Refresh stock alerts</Text>
      </Pressable>
    </View>
  );
}

function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  backButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  backText: { color: theme.colors.greenDark, fontSize: 13, fontWeight: '800' },
  heading: { gap: 4 },
  eyebrow: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: theme.colors.navy, fontSize: 23, lineHeight: 29, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 12, lineHeight: 18 },
  list: { gap: 9 },
  card: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.lg, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  icon: { width: 40, height: 40, borderRadius: 13, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  iconUrgent: { backgroundColor: theme.colors.dangerSoft },
  copy: { flex: 1, minWidth: 0 },
  itemName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  meta: { color: theme.colors.muted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  detail: { color: theme.colors.slate, fontSize: 11, lineHeight: 16, marginTop: 4 },
  reorder: { color: theme.colors.greenDark, fontSize: 10, lineHeight: 15, marginTop: 3, fontWeight: '700' },
  quantityPill: { minWidth: 56, borderRadius: 12, backgroundColor: theme.colors.cloud, paddingHorizontal: 8, paddingVertical: 7, alignItems: 'center' },
  quantityPillUrgent: { backgroundColor: theme.colors.dangerSoft },
  quantityText: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  quantityTextUrgent: { color: theme.colors.danger },
  quantityUom: { color: theme.colors.muted, fontSize: 9, marginTop: 1 },
  messageCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.cloud, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorCard: { backgroundColor: theme.colors.dangerSoft },
  messageText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  emptyCard: { minHeight: 150, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 18 },
  emptyTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  refreshButton: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: theme.colors.white },
  refreshText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});