import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CommerceBranch } from '../data/commerceRepository';
import {
  loadBranchStock,
  loadStockMovements,
  type BranchStockRow,
  type StockMovementRow,
} from '../data/inventoryRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
};

export function InventoryWorkspace({ tenantId, branch }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [rows, setRows] = useState<BranchStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);

  async function refreshStock() {
    setLoading(true);
    setError(null);
    try {
      const next = await loadBranchStock(tenantId, branch.id);
      setRows(next);
      if (selectedProductId && !next.some((row) => row.catalogItemId === selectedProductId)) {
        setSelectedProductId(null);
        setMovements([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load branch stock.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelectedProductId(null);
    setMovements([]);
    void refreshStock();
  }, [tenantId, branch.id]);

  useEffect(() => {
    if (!selectedProductId) {
      setMovements([]);
      setMovementError(null);
      return undefined;
    }

    let active = true;
    setMovementLoading(true);
    setMovementError(null);
    void loadStockMovements(tenantId, branch.id, selectedProductId, 50)
      .then((next) => {
        if (active) setMovements(next);
      })
      .catch((err) => {
        if (active) setMovementError(err instanceof Error ? err.message : 'Unable to load stock history.');
      })
      .finally(() => {
        if (active) setMovementLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tenantId, branch.id, selectedProductId]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!normalizedQuery) return rows;
    return rows.filter((row) =>
      [row.itemName, row.sku ?? '', row.category ?? '', row.stockUom]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [normalizedQuery, rows]);

  const outOfStockCount = rows.filter((row) => row.quantityOnHand <= 0).length;
  const selected = rows.find((row) => row.catalogItemId === selectedProductId) ?? null;

  if (selected) {
    return (
      <View style={styles.stack}>
        <Pressable onPress={() => setSelectedProductId(null)} style={styles.backButton}>
          <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
          <Text style={styles.backText}>Inventory</Text>
        </Pressable>

        <View style={styles.heading}>
          <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>STOCK HISTORY</Text>
          <Text style={[styles.title, dark && darkStyles.titleText]}>{selected.itemName}</Text>
          <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
            {branch.name} · {formatQuantity(selected.quantityOnHand)} {selected.stockUom} on hand
          </Text>
        </View>

        <View style={[styles.balanceCard, dark && darkStyles.card]}>
          <View style={styles.balanceIcon}>
            <Ionicons name="cube-outline" size={24} color={theme.colors.greenDark} />
          </View>
          <View style={styles.balanceCopy}>
            <Text style={[styles.balanceLabel, dark && darkStyles.bodyText]}>Current stock</Text>
            <Text style={[styles.balanceValue, dark && darkStyles.titleText]}>
              {formatQuantity(selected.quantityOnHand)} {selected.stockUom}
            </Text>
            <Text style={[styles.balanceMeta, dark && darkStyles.bodyText]}>
              {selected.lastMovementAt ? `Last movement ${formatDateTime(selected.lastMovementAt)}` : 'No stock movements yet'}
            </Text>
          </View>
        </View>

        {movementError ? (
          <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
            <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{movementError}</Text>
          </View>
        ) : null}

        {movementLoading && movements.length === 0 ? (
          <View style={[styles.emptyCard, dark && darkStyles.card]}>
            <ActivityIndicator />
            <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading stock history…</Text>
          </View>
        ) : null}

        {!movementLoading && movements.length === 0 ? (
          <View style={[styles.emptyCard, dark && darkStyles.card]}>
            <Ionicons name="swap-vertical-outline" size={28} color={theme.colors.greenDark} />
            <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No movement yet</Text>
            <Text style={[styles.muted, dark && darkStyles.bodyText]}>
              Stock receipts, sales, returns, transfers and adjustments will appear here after they are posted.
            </Text>
          </View>
        ) : (
          <View style={styles.movementList}>
            {movements.map((movement) => (
              <View key={movement.id} style={[styles.movementCard, dark && darkStyles.card]}>
                <View style={styles.movementTopRow}>
                  <View style={[styles.movementIcon, movement.quantityDelta < 0 && styles.movementIconOut]}>
                    <Ionicons
                      name={movement.quantityDelta < 0 ? 'arrow-up-outline' : 'arrow-down-outline'}
                      size={18}
                      color={movement.quantityDelta < 0 ? '#B42318' : theme.colors.greenDark}
                    />
                  </View>
                  <View style={styles.movementCopy}>
                    <Text style={[styles.movementTitle, dark && darkStyles.titleText]}>
                      {movementLabel(movement.movementType)}
                    </Text>
                    <Text style={[styles.movementMeta, dark && darkStyles.bodyText]}>
                      {formatDateTime(movement.businessAt)} · {movement.referenceId}
                    </Text>
                  </View>
                  <Text style={[styles.movementQuantity, movement.quantityDelta < 0 && styles.movementQuantityOut]}>
                    {movement.quantityDelta > 0 ? '+' : ''}{formatQuantity(movement.quantityDelta)} {movement.stockUom}
                  </Text>
                </View>
                {movement.sourceUom.toLowerCase() !== movement.stockUom.toLowerCase() ? (
                  <Text style={[styles.conversionText, dark && darkStyles.bodyText]}>
                    {formatQuantity(movement.sourceQuantity)} {movement.sourceUom} × {formatQuantity(movement.conversionFactor)}
                  </Text>
                ) : null}
                {movement.reason ? (
                  <Text style={[styles.reasonText, dark && darkStyles.bodyText]}>{movement.reason}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>INVENTORY</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>Stock at {branch.name}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Quantities are shown in each product’s stock unit.
        </Text>
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard label="Products" value={rows.length} icon="cube-outline" dark={dark} />
        <SummaryCard label="Out of stock" value={outOfStockCount} icon="alert-circle-outline" dark={dark} attention={outOfStockCount > 0} />
      </View>

      <View style={[styles.searchBox, dark && darkStyles.input]}>
        <Ionicons name="search-outline" size={19} color={theme.colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search product, SKU or stock unit"
          placeholderTextColor={theme.colors.subtle}
          autoCorrect={false}
          style={[styles.searchInput, dark && darkStyles.inputText]}
        />
        <Pressable onPress={() => void refreshStock()} disabled={loading} style={styles.refreshButton}>
          <Ionicons name="refresh-outline" size={20} color={theme.colors.greenDark} />
        </Pressable>
      </View>

      {error ? (
        <View style={[styles.errorCard, dark && darkStyles.errorCard]}>
          <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
          <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{error}</Text>
        </View>
      ) : null}

      {loading && rows.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <ActivityIndicator />
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading branch stock…</Text>
        </View>
      ) : null}

      {!loading && visibleRows.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}>
          <Ionicons name="cube-outline" size={28} color={theme.colors.greenDark} />
          <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>
            {rows.length === 0 ? 'No products yet' : 'No matching stock item'}
          </Text>
          <Text style={[styles.muted, dark && darkStyles.bodyText]}>
            {rows.length === 0
              ? 'Add products before tracking stock for this branch.'
              : 'Change the search and try again.'}
          </Text>
        </View>
      ) : (
        <View style={styles.stockList}>
          {visibleRows.map((row) => {
            const out = row.quantityOnHand <= 0;
            return (
              <Pressable
                key={row.catalogItemId}
                onPress={() => setSelectedProductId(row.catalogItemId)}
                style={({ pressed }) => [styles.stockCard, dark && darkStyles.card, pressed && styles.pressed]}
              >
                <View style={[styles.stockIcon, out && styles.stockIconOut]}>
                  <Ionicons name="cube-outline" size={21} color={out ? '#B42318' : theme.colors.greenDark} />
                </View>
                <View style={styles.stockCopy}>
                  <Text style={[styles.stockName, dark && darkStyles.titleText]}>{row.itemName}</Text>
                  <Text style={[styles.stockMeta, dark && darkStyles.bodyText]}>
                    {[row.sku, row.category].filter(Boolean).join(' · ') || row.stockUom}
                  </Text>
                  <Text style={[styles.stockUpdated, dark && darkStyles.bodyText]}>
                    {row.lastMovementAt ? `Updated ${formatDateTime(row.lastMovementAt)}` : 'No stock movement yet'}
                  </Text>
                </View>
                <View style={styles.stockBalance}>
                  <Text style={[styles.stockQuantity, dark && darkStyles.titleText, out && styles.stockQuantityOut]}>
                    {formatQuantity(row.quantityOnHand)}
                  </Text>
                  <Text style={[styles.stockUom, dark && darkStyles.bodyText]}>{row.stockUom}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.subtle} />
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={[styles.infoCard, dark && darkStyles.subtleCard]}>
        <Ionicons name="shield-checkmark-outline" size={20} color={theme.colors.greenDark} />
        <Text style={[styles.infoText, dark && darkStyles.bodyText]}>
          Stock changes are recorded as auditable movements. Counts and adjustments will be reviewed before they change on-hand quantity.
        </Text>
      </View>
    </View>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  dark,
  attention = false,
}: {
  label: string;
  value: number;
  icon: string;
  dark: boolean;
  attention?: boolean;
}) {
  return (
    <View style={[styles.summaryCard, dark && darkStyles.card, attention && styles.summaryCardAttention]}>
      <Ionicons name={icon as never} size={20} color={attention ? '#B54708' : theme.colors.greenDark} />
      <Text style={[styles.summaryValue, dark && darkStyles.titleText]}>{value}</Text>
      <Text style={[styles.summaryLabel, dark && darkStyles.bodyText]}>{label}</Text>
    </View>
  );
}

function movementLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  title: { color: theme.colors.navy, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
  backButton: { alignSelf: 'flex-start', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5 },
  backText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  summaryRow: { flexDirection: 'row', gap: 8 },
  summaryCard: { flex: 1, minHeight: 90, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 12, gap: 3 },
  summaryCardAttention: { backgroundColor: theme.colors.warningSoft, borderColor: '#FEDF89' },
  summaryValue: { color: theme.colors.navy, fontSize: 22, fontWeight: '900', marginTop: 4 },
  summaryLabel: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  searchBox: { minHeight: 50, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, paddingLeft: 12, paddingRight: 5, flexDirection: 'row', alignItems: 'center', gap: 7 },
  searchInput: { flex: 1, minHeight: 48, color: theme.colors.navy, fontSize: 14, paddingVertical: 0 },
  refreshButton: { width: 42, height: 42, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  errorCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { flex: 1, color: '#912018', fontSize: 12, lineHeight: 18 },
  emptyCard: { minHeight: 120, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 7 },
  emptyTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  muted: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  stockList: { gap: 8 },
  stockCard: { minHeight: 82, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  stockIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  stockIconOut: { backgroundColor: theme.colors.dangerSoft },
  stockCopy: { flex: 1, minWidth: 0 },
  stockName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  stockMeta: { color: theme.colors.muted, fontSize: 10.5, marginTop: 2 },
  stockUpdated: { color: theme.colors.subtle, fontSize: 10, marginTop: 4 },
  stockBalance: { alignItems: 'flex-end' },
  stockQuantity: { color: theme.colors.navy, fontSize: 18, fontWeight: '900' },
  stockQuantityOut: { color: '#B42318' },
  stockUom: { color: theme.colors.muted, fontSize: 10.5, fontWeight: '700' },
  infoCard: { borderRadius: theme.radius.md, backgroundColor: theme.colors.mintSoft, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
  balanceCard: { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  balanceIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  balanceCopy: { flex: 1 },
  balanceLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '800' },
  balanceValue: { color: theme.colors.navy, fontSize: 23, fontWeight: '900', marginTop: 2 },
  balanceMeta: { color: theme.colors.muted, fontSize: 10.5, marginTop: 3 },
  movementList: { gap: 8 },
  movementCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 11, gap: 6 },
  movementTopRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  movementIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: theme.colors.mintSoft, alignItems: 'center', justifyContent: 'center' },
  movementIconOut: { backgroundColor: theme.colors.dangerSoft },
  movementCopy: { flex: 1 },
  movementTitle: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  movementMeta: { color: theme.colors.muted, fontSize: 10.5, marginTop: 2 },
  movementQuantity: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  movementQuantityOut: { color: '#B42318' },
  conversionText: { color: theme.colors.muted, fontSize: 10.5, paddingLeft: 45 },
  reasonText: { color: theme.colors.slate, fontSize: 11, lineHeight: 16, paddingLeft: 45 },
  pressed: { opacity: 0.74 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  input: { backgroundColor: theme.colors.navy, borderColor: '#475467' },
  inputText: { color: theme.colors.cloud },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});
