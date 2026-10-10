import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CatalogueItem } from '../data/catalogueRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  items: CatalogueItem[];
  currency?: string;
  initialQuery?: string;
  selectedQuantities?: Record<string, number>;
  disabled?: boolean;
  maxResults?: number;
  onSelect: (item: CatalogueItem) => void | Promise<void>;
  title?: string;
  hint?: string;
};

export function CatalogueProductPicker({
  items,
  currency = 'NGN',
  initialQuery = '',
  selectedQuantities = {},
  disabled = false,
  maxResults = 16,
  onSelect,
  title = 'Find a product',
  hint = 'Search by product name, SKU, category or customer alias.',
}: Props) {
  const appearance = useSellerTrayAppearance();
  const [query, setQuery] = useState(initialQuery);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activePriced = useMemo(
    () => items.filter((item) => item.isActive && item.price !== null),
    [items],
  );

  const results = useMemo(() => {
    const cleanQuery = normalize(query);
    if (!cleanQuery) return [];

    return activePriced
      .map((item) => ({ item, score: scoreCatalogueItem(item, cleanQuery) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
      .slice(0, maxResults)
      .map((entry) => entry.item);
  }, [activePriced, maxResults, query]);

  async function select(item: CatalogueItem) {
    if (disabled || busyId) return;
    setBusyId(item.id);
    setError(null);
    try {
      await onSelect(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to select this product.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, appearance.dark && darkStyles.title]}>{title}</Text>
      <Text style={[styles.hint, appearance.dark && darkStyles.body]}>{hint}</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        editable={!disabled}
        autoCorrect={false}
        autoCapitalize="none"
        placeholder="Search products…"
        placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
        style={[styles.search, appearance.dark && darkStyles.search]}
      />

      {!query.trim() ? (
        <Text style={[styles.empty, appearance.dark && darkStyles.body]}>
          Start typing to search. SellerTray will not force you to scroll through the full catalogue.
        </Text>
      ) : results.length === 0 ? (
        <Text style={[styles.empty, appearance.dark && darkStyles.body]}>
          No active priced product matches “{query.trim()}”.
        </Text>
      ) : (
        <View style={styles.results}>
          {results.map((item) => {
            const quantity = selectedQuantities[item.id] ?? 0;
            return (
              <Pressable
                key={item.id}
                disabled={disabled || busyId !== null}
                onPress={() => void select(item)}
                style={({ pressed }) => [
                  styles.row,
                  appearance.dark && darkStyles.row,
                  quantity > 0 && styles.selectedRow,
                  quantity > 0 && appearance.dark && darkStyles.selectedRow,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.copy}>
                  <Text style={[styles.name, appearance.dark && darkStyles.title]}>{item.name}</Text>
                  <Text style={[styles.meta, appearance.dark && darkStyles.body]}>
                    {formatMoney(item.price ?? 0, currency)}
                    {item.sku ? ` · ${item.sku}` : ''}
                    {item.category ? ` · ${item.category}` : ''}
                  </Text>
                  {item.aliases.length > 0 ? (
                    <Text style={[styles.aliases, appearance.dark && darkStyles.body]} numberOfLines={1}>
                      Also: {item.aliases.slice(0, 3).join(', ')}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.actionWrap}>
                  {quantity > 0 ? <Text style={styles.quantity}>{quantity}×</Text> : null}
                  <Text style={styles.action}>{busyId === item.id ? 'Adding…' : 'Add'}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function scoreCatalogueItem(item: CatalogueItem, normalizedQuery: string): number {
  const queryTokens = tokenStems(normalizedQuery);
  const fields: Array<{ value: string | null; weight: number }> = [
    { value: item.name, weight: 100 },
    { value: item.sku, weight: 95 },
    { value: item.category, weight: 55 },
    ...item.aliases.map((alias) => ({ value: alias, weight: 90 })),
  ];

  let best = 0;
  for (const field of fields) {
    if (!field.value) continue;
    const normalizedValue = normalize(field.value);
    if (!normalizedValue) continue;

    if (normalizedValue === normalizedQuery) best = Math.max(best, field.weight + 100);
    else if (normalizedValue.startsWith(normalizedQuery)) best = Math.max(best, field.weight + 70);
    else if (normalizedValue.includes(normalizedQuery)) best = Math.max(best, field.weight + 45);

    const valueTokens = tokenStems(normalizedValue);
    const matchedTokens = queryTokens.filter((token) =>
      valueTokens.some((candidate) => candidate === token || candidate.startsWith(token) || token.startsWith(candidate)),
    ).length;
    if (queryTokens.length > 0 && matchedTokens === queryTokens.length) {
      best = Math.max(best, field.weight + 25 + matchedTokens * 5);
    } else if (matchedTokens > 0) {
      best = Math.max(best, field.weight + matchedTokens * 4);
    }
  }

  return best;
}

function tokenStems(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter(Boolean)
    .map(singularize);
}

function singularize(value: string): string {
  if (value.length > 4 && value.endsWith('ies')) return value.slice(0, -3) + 'y';
  if (value.length > 4 && value.endsWith('ses')) return value.slice(0, -2);
  if (value.length > 3 && value.endsWith('es')) return value.slice(0, -2);
  if (value.length > 3 && value.endsWith('s') && !value.endsWith('ss')) return value.slice(0, -1);
  return value;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  title: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  hint: { color: '#667085', fontSize: 12, lineHeight: 18 },
  search: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 11,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    color: '#102A43',
  },
  results: { gap: 7 },
  row: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
  },
  selectedRow: { borderColor: '#6CE9A6', backgroundColor: '#F0FDF4' },
  copy: { flex: 1, minWidth: 0 },
  name: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  meta: { color: '#667085', fontSize: 12, marginTop: 2 },
  aliases: { color: '#667085', fontSize: 11, marginTop: 2 },
  actionWrap: { alignItems: 'flex-end', gap: 3 },
  action: { color: '#12B76A', fontSize: 12, fontWeight: '900' },
  quantity: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  empty: { color: '#667085', fontSize: 12, lineHeight: 18, paddingVertical: 4 },
  error: { color: '#B42318', fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.8 },
});

const darkStyles = StyleSheet.create({
  title: { color: '#F8FAFC' },
  body: { color: '#D0D5DD' },
  search: { backgroundColor: '#162F46', borderColor: '#475467', color: '#F8FAFC' },
  row: { backgroundColor: '#102A43', borderColor: '#344054' },
  selectedRow: { backgroundColor: '#12372C', borderColor: '#1C6B4A' },
});
