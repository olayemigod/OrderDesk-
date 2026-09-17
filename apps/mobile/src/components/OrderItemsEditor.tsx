import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { MerchantRole } from '../data/businessRepository';
import { loadCatalogue, type CatalogueItem } from '../data/catalogueRepository';
import type { OrderItemInput } from '../data/ordersRepository';
import {
  createCatalogueFromOrderItem,
  keepOrderItemOneOff,
  loadOrderItemCatalogueCandidates,
  matchOrderItemToCatalogue,
  type OrderItemCatalogueCandidate,
} from '../data/orderItemCatalogueResolutionRepository';
import type { MatchSource, MerchantOrder, OrderItem } from '../domain/order';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

const money = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
});

const reviewReasonLabels: Record<string, string> = {
  no_items: 'No order items could be identified',
  fallback_parser: 'Fallback parser was used',
  low_parser_confidence: 'Order interpretation confidence is low',
  unmatched_catalogue_item: 'One or more products are not in your catalogue',
  missing_price: 'One or more products need a selling price',
};

const matchLabels: Record<MatchSource, string> = {
  legacy: 'Earlier order',
  catalogue_name: 'Matched catalogue name',
  catalogue_alias: 'Matched product alias',
  normalized_name: 'Matched normalized catalogue name',
  normalized_alias: 'Matched normalized alias',
  unmatched: 'Not matched to catalogue',
  manual: 'Merchant-entered item',
  merchant_match: 'Matched by merchant',
  one_off: 'Approved one-off item',
};

type Props = {
  order: MerchantOrder;
  tenantId: string;
  role: MerchantRole;
  editable: boolean;
  onAdd: (orderId: string, item: OrderItemInput) => Promise<void>;
  onEdit: (itemId: string, item: OrderItemInput) => Promise<void>;
  onRemove: (itemId: string) => Promise<void>;
  onResolved: () => Promise<void>;
  onCatalogueChanged: () => Promise<void>;
};

export function OrderItemsEditor({
  order,
  tenantId,
  role,
  editable,
  onAdd,
  onEdit,
  onRemove,
  onResolved,
  onCatalogueChanged,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState<OrderItemCatalogueCandidate[]>([]);

  useEffect(() => {
    let active = true;
    void loadOrderItemCatalogueCandidates(tenantId, order.id)
      .then((rows) => {
        if (active) setCandidates(rows);
      })
      .catch(() => {
        if (active) setCandidates([]);
      });
    return () => {
      active = false;
    };
  }, [tenantId, order.id, order.items]);

  return (
    <View style={styles.wrap}>
      <ReviewDiagnostics order={order} />

      {order.items.length === 0 ? (
        <View style={[styles.emptyState, appearance.dark && darkStyles.warningCard]}>
          <Text style={[styles.emptyTitle, appearance.dark && darkStyles.warningTitle]}>No items parsed</Text>
          <Text style={[styles.emptyText, appearance.dark && darkStyles.warningText]}>
            Add what the customer ordered before accepting this order.
          </Text>
        </View>
      ) : null}

      {order.items.map((item) => {
        const candidate = candidates.find((entry) => entry.orderItemId === item.id) ?? null;
        return (
          <View key={item.id} style={styles.itemStack}>
            {editable ? (
              <EditableLineItem
                item={item}
                onSave={(input) => onEdit(item.id, input)}
                onRemove={() => onRemove(item.id)}
              />
            ) : (
              <ReadOnlyLineItem item={item} />
            )}

            {editable && item.matchSource === 'unmatched' ? (
              <UnmatchedCatalogueResolver
                tenantId={tenantId}
                role={role}
                item={item}
                candidate={candidate}
                onResolved={async (catalogueChanged) => {
                  setCandidates(await loadOrderItemCatalogueCandidates(tenantId, order.id));
                  await onResolved();
                  if (catalogueChanged) await onCatalogueChanged();
                }}
              />
            ) : null}
          </View>
        );
      })}

      {editable ? (
        adding ? (
          <NewLineItem
            onCancel={() => setAdding(false)}
            onSave={async (input) => {
              await onAdd(order.id, input);
              setAdding(false);
            }}
          />
        ) : (
          <Pressable onPress={() => setAdding(true)} style={styles.addButton}>
            <Text style={styles.addButtonText}>+ Add item</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

function ReviewDiagnostics({ order }: { order: MerchantOrder }) {
  const appearance = useSellerTrayAppearance();
  const confidence = order.confidence === null ? null : Math.round(order.confidence * 100);
  const showParser = order.parserSource !== 'legacy' || order.parserVersion;

  if (!showParser && order.reviewReasons.length === 0) return null;

  return (
    <View style={[styles.reviewCard, appearance.dark && darkStyles.card]}>
      <Text style={[styles.reviewTitle, appearance.dark && darkStyles.titleText]}>Why SellerTray wants a review</Text>
      {showParser ? (
        <Text style={[styles.reviewMeta, appearance.dark && darkStyles.bodyText]}>
          {formatParserSource(order.parserSource)}
          {order.parserVersion ? ` · ${order.parserVersion}` : ''}
          {confidence === null ? '' : ` · ${confidence}% confidence`}
        </Text>
      ) : null}
      {order.reviewReasons.length > 0 ? (
        <View style={styles.reasonList}>
          {order.reviewReasons.map((reason) => (
            <Text key={reason} style={[styles.reasonText, appearance.dark && darkStyles.bodyText]}>
              • {reviewReasonLabels[reason] ?? formatReason(reason)}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={[styles.reviewMeta, appearance.dark && darkStyles.bodyText]}>Review the customer message and order lines before accepting.</Text>
      )}
    </View>
  );
}

function ReadOnlyLineItem({ item }: { item: OrderItem }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.lineItem, appearance.dark && darkStyles.rowBorder]}>
      <View style={styles.quantityBox}>
        <Text style={styles.quantityText}>{item.quantity}×</Text>
      </View>
      <View style={styles.lineItemNameWrap}>
        <Text style={[styles.lineItemName, appearance.dark && darkStyles.titleText]}>{item.name}</Text>
        <Text style={[styles.lineItemPrice, appearance.dark && darkStyles.bodyText]}>
          {item.unitPrice === null ? 'Price not set' : `${money.format(item.unitPrice)} each`}
        </Text>
        <MatchDetail item={item} />
      </View>
      <Text style={[styles.lineTotal, appearance.dark && darkStyles.titleText]}>
        {item.unitPrice === null ? '—' : money.format(item.unitPrice * item.quantity)}
      </Text>
    </View>
  );
}

function EditableLineItem({
  item,
  onSave,
  onRemove,
}: {
  item: OrderItem;
  onSave: (input: OrderItemInput) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [price, setPrice] = useState(item.unitPrice === null ? '' : String(item.unitPrice));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appearance = useSellerTrayAppearance();

  useEffect(() => {
    setName(item.name);
    setQuantity(String(item.quantity));
    setPrice(item.unitPrice === null ? '' : String(item.unitPrice));
  }, [item.id, item.name, item.quantity, item.unitPrice]);

  async function save() {
    const input = parseInput(name, quantity, price);
    if ('error' in input) {
      setError(input.error);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSave(input.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save item.');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    setSubmitting(true);
    setError(null);
    try {
      await onRemove();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove item.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.editorCard, appearance.dark && darkStyles.card]}>
      <MatchDetail item={item} />
      <TextInput
        placeholder="Item name"
        value={name}
        onChangeText={setName}
        style={[styles.input, appearance.dark && darkStyles.input]}
      />
      <View style={styles.inputRow}>
        <TextInput
          keyboardType="decimal-pad"
          placeholder="Qty"
          value={quantity}
          onChangeText={setQuantity}
          style={[styles.input, styles.smallInput, appearance.dark && darkStyles.input]}
        />
        <TextInput
          keyboardType="decimal-pad"
          placeholder="Price (₦)"
          value={price}
          onChangeText={setPrice}
          style={[styles.input, styles.priceInput, appearance.dark && darkStyles.input]}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.editorActions}>
        <Pressable disabled={submitting} onPress={() => void remove()} style={styles.removeButton}>
          <Text style={styles.removeButtonText}>Remove</Text>
        </Pressable>
        <Pressable disabled={submitting} onPress={() => void save()} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>{submitting ? 'Saving…' : 'Save item'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MatchDetail({ item }: { item: OrderItem }) {
  const appearance = useSellerTrayAppearance();
  const originalDiffers =
    item.originalName && item.originalName.trim().toLocaleLowerCase() !== item.name.trim().toLocaleLowerCase();
  const confidence = item.matchConfidence === null ? '' : ` · ${Math.round(item.matchConfidence * 100)}%`;

  if (item.matchSource === 'legacy' && !originalDiffers) return null;

  return (
    <View style={styles.matchWrap}>
      <Text style={[styles.matchText, appearance.dark && darkStyles.greenText, item.matchSource === 'unmatched' && styles.matchWarning]}>
        {matchLabels[item.matchSource]}{confidence}
      </Text>
      {originalDiffers ? (
        <Text style={[styles.originalText, appearance.dark && darkStyles.bodyText]}>Customer wording: “{item.originalName}”</Text>
      ) : null}
    </View>
  );
}

function UnmatchedCatalogueResolver({
  tenantId,
  role,
  item,
  candidate,
  onResolved,
}: {
  tenantId: string;
  role: MerchantRole;
  item: OrderItem;
  candidate: OrderItemCatalogueCandidate | null;
  onResolved: (catalogueChanged: boolean) => Promise<void>;
}) {
  const appearance = useSellerTrayAppearance();
  const canCreateCatalogue = role === 'owner' || role === 'manager';
  const [mode, setMode] = useState<'none' | 'match' | 'create' | 'one_off'>('none');
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [search, setSearch] = useState(item.originalName || item.name);
  const [name, setName] = useState(item.originalName || item.name);
  const [price, setPrice] = useState(item.unitPrice === null ? '' : String(item.unitPrice));
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  const [learnAlias, setLearnAlias] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadCatalogue(tenantId)
      .then((rows) => {
        if (active) setCatalogue(rows.filter((entry) => entry.isActive));
      })
      .catch(() => {
        if (active) setCatalogue([]);
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matches = catalogue
    .filter((entry) => {
      if (!normalizedSearch) return true;
      return catalogueSearchMatches(entry, normalizedSearch);
    })
    .slice(0, 12);

  async function run(action: () => Promise<void>, catalogueChanged = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode('none');
      await onResolved(catalogueChanged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resolve this catalogue item.');
    } finally {
      setBusy(false);
    }
  }

  async function matchExisting(catalogueItem: CatalogueItem) {
    if (catalogueItem.price === null) {
      setError('This catalogue product does not have a selling price yet.');
      return;
    }
    await run(
      () => matchOrderItemToCatalogue({
        tenantId,
        orderItemId: item.id,
        catalogItemId: catalogueItem.id,
        learnAlias: canCreateCatalogue && learnAlias,
      }),
      canCreateCatalogue && learnAlias,
    );
  }

  async function createProduct() {
    const amount = Number(price);
    if (!name.trim()) return setError('Enter the catalogue product name.');
    if (!price.trim() || !Number.isFinite(amount) || amount < 0) {
      return setError('Enter a valid selling price.');
    }
    await run(
      async () => {
        await createCatalogueFromOrderItem({
          tenantId,
          orderItemId: item.id,
          name,
          price: amount,
          sku,
          category,
          learnAlias,
        });
      },
      true,
    );
  }

  async function keepOneOff() {
    const amount = Number(price);
    if (!price.trim() || !Number.isFinite(amount) || amount < 0) {
      return setError('Enter the selling price for this one-off item.');
    }
    await run(() => keepOrderItemOneOff({
      tenantId,
      orderItemId: item.id,
      price: amount,
      name,
    }));
  }

  return (
    <View style={[styles.resolveCard, appearance.dark && darkStyles.warningCard]}>
      <Text style={[styles.resolveEyebrow, appearance.dark && darkStyles.warningTitle]}>CATALOGUE RESOLUTION REQUIRED</Text>
      <Text style={[styles.resolveTitle, appearance.dark && darkStyles.titleText]}>
        Unknown item: “{candidate?.customerWording || item.originalName || item.name}”
      </Text>
      <Text style={[styles.resolveBody, appearance.dark && darkStyles.warningText]}>
        Resolve this product before accepting the order. SellerTray will keep the customer wording as evidence.
      </Text>

      <View style={styles.resolveActions}>
        <Pressable
          disabled={busy}
          onPress={() => setMode(mode === 'match' ? 'none' : 'match')}
          style={[styles.resolveButton, appearance.dark && darkStyles.outlineButton]}
        >
          <Text style={[styles.resolveButtonText, appearance.dark && darkStyles.titleText]}>Match existing</Text>
        </Pressable>
        {canCreateCatalogue ? (
          <Pressable
            disabled={busy}
            onPress={() => setMode(mode === 'create' ? 'none' : 'create')}
            style={[styles.resolveButton, appearance.dark && darkStyles.outlineButton]}
          >
            <Text style={[styles.resolveButtonText, appearance.dark && darkStyles.titleText]}>Create product</Text>
          </Pressable>
        ) : null}
        <Pressable
          disabled={busy}
          onPress={() => setMode(mode === 'one_off' ? 'none' : 'one_off')}
          style={[styles.resolveButton, appearance.dark && darkStyles.outlineButton]}
        >
          <Text style={[styles.resolveButtonText, appearance.dark && darkStyles.titleText]}>Keep one-off</Text>
        </Pressable>
      </View>

      {mode === 'match' ? (
        <View style={[styles.resolvePanel, appearance.dark && darkStyles.subtleCard]}>
          <Text style={[styles.resolvePanelTitle, appearance.dark && darkStyles.titleText]}>Match an existing catalogue product</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search product, alias, SKU or category"
            placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
            style={[styles.input, appearance.dark && darkStyles.input]}
          />
          {canCreateCatalogue ? (
            <Pressable onPress={() => setLearnAlias((value) => !value)} style={styles.learnAliasRow}>
              <View style={[styles.checkBox, learnAlias && styles.checkBoxActive]}>
                {learnAlias ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
              <Text style={[styles.learnAliasText, appearance.dark && darkStyles.bodyText]}>
                Remember “{candidate?.customerWording || item.originalName || item.name}” as an alias for future chats
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.resolveHint, appearance.dark && darkStyles.bodyText]}>
              Staff can match the order item; Owner or Manager controls permanent catalogue aliases.
            </Text>
          )}

          <View style={styles.catalogueMatchList}>
            {matches.length === 0 ? (
              <Text style={[styles.resolveHint, appearance.dark && darkStyles.bodyText]}>No active catalogue product matches this search.</Text>
            ) : matches.map((entry) => (
              <Pressable
                key={entry.id}
                disabled={busy || entry.price === null}
                onPress={() => void matchExisting(entry)}
                style={[styles.catalogueMatchRow, appearance.dark && darkStyles.card, entry.price === null && styles.disabled]}
              >
                <View style={styles.matchProductCopy}>
                  <Text style={[styles.catalogueMatchName, appearance.dark && darkStyles.titleText]}>{entry.name}</Text>
                  <Text style={[styles.resolveHint, appearance.dark && darkStyles.bodyText]}>
                    {entry.price === null ? 'Price not set' : money.format(entry.price)}
                    {entry.aliases.length > 0 ? ' · ' + entry.aliases.slice(0, 2).join(', ') : ''}
                  </Text>
                </View>
                <Text style={styles.useProductText}>Use</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {mode === 'create' && canCreateCatalogue ? (
        <View style={[styles.resolvePanel, appearance.dark && darkStyles.subtleCard]}>
          <Text style={[styles.resolvePanelTitle, appearance.dark && darkStyles.titleText]}>Create catalogue product from this order</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Canonical product name"
            placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
            style={[styles.input, appearance.dark && darkStyles.input]}
          />
          <TextInput
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            placeholder="Selling price"
            placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
            style={[styles.input, appearance.dark && darkStyles.input]}
          />
          <View style={styles.inputRow}>
            <TextInput
              value={sku}
              onChangeText={setSku}
              placeholder="SKU (optional)"
              placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
              style={[styles.input, styles.priceInput, appearance.dark && darkStyles.input]}
            />
            <TextInput
              value={category}
              onChangeText={setCategory}
              placeholder="Category"
              placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
              style={[styles.input, styles.priceInput, appearance.dark && darkStyles.input]}
            />
          </View>
          <Pressable onPress={() => setLearnAlias((value) => !value)} style={styles.learnAliasRow}>
            <View style={[styles.checkBox, learnAlias && styles.checkBoxActive]}>
              {learnAlias ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
            <Text style={[styles.learnAliasText, appearance.dark && darkStyles.bodyText]}>
              Learn the customer wording as a product alias
            </Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => void createProduct()} style={styles.primaryResolveButton}>
            <Text style={styles.primaryResolveText}>{busy ? 'Creating…' : 'Create product & resolve order'}</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'one_off' ? (
        <View style={[styles.resolvePanel, appearance.dark && darkStyles.subtleCard]}>
          <Text style={[styles.resolvePanelTitle, appearance.dark && darkStyles.titleText]}>Keep as a one-off item</Text>
          <Text style={[styles.resolveHint, appearance.dark && darkStyles.bodyText]}>
            Use this when you can fulfil this customer request but do not want it added to your reusable catalogue.
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Order item name"
            placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
            style={[styles.input, appearance.dark && darkStyles.input]}
          />
          <TextInput
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            placeholder="Selling price"
            placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
            style={[styles.input, appearance.dark && darkStyles.input]}
          />
          <Pressable disabled={busy} onPress={() => void keepOneOff()} style={styles.primaryResolveButton}>
            <Text style={styles.primaryResolveText}>{busy ? 'Saving…' : 'Approve as one-off item'}</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function NewLineItem({
  onSave,
  onCancel,
}: {
  onSave: (input: OrderItemInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appearance = useSellerTrayAppearance();

  async function save() {
    const input = parseInput(name, quantity, price);
    if ('error' in input) {
      setError(input.error);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSave(input.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add item.');
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.editorCard, styles.newItemCard, appearance.dark && darkStyles.card]}>
      <Text style={[styles.newItemTitle, appearance.dark && darkStyles.titleText]}>Add order item</Text>
      <TextInput
        autoFocus
        placeholder="Item name"
        placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
        value={name}
        onChangeText={setName}
        style={[styles.input, appearance.dark && darkStyles.input]}
      />
      <View style={styles.inputRow}>
        <TextInput
          keyboardType="decimal-pad"
          placeholder="Qty"
          placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
          value={quantity}
          onChangeText={setQuantity}
          style={[styles.input, styles.smallInput, appearance.dark && darkStyles.input]}
        />
        <TextInput
          keyboardType="decimal-pad"
          placeholder="Price (₦)"
          placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
          value={price}
          onChangeText={setPrice}
          style={[styles.input, styles.priceInput, appearance.dark && darkStyles.input]}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.editorActions}>
        <Pressable disabled={submitting} onPress={onCancel} style={styles.removeButton}>
          <Text style={styles.removeButtonText}>Cancel</Text>
        </Pressable>
        <Pressable disabled={submitting} onPress={() => void save()} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>{submitting ? 'Adding…' : 'Add item'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function parseInput(
  name: string,
  quantityText: string,
  priceText: string,
): { value: OrderItemInput } | { error: string } {
  const trimmedName = name.trim();
  const quantity = Number(quantityText);
  const price = Number(priceText);

  if (!trimmedName) return { error: 'Enter an item name.' };
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'Quantity must be greater than zero.' };
  if (!priceText.trim() || !Number.isFinite(price) || price < 0) {
    return { error: 'Enter a valid selling price before saving.' };
  }

  return {
    value: {
      name: trimmedName,
      quantity,
      unitPrice: price,
    },
  };
}

function catalogueSearchMatches(entry: CatalogueItem, search: string): boolean {
  const query = normalizeProductSearch(search);
  if (!query) return true;

  const variants = [
    entry.name,
    entry.sku ?? '',
    entry.category ?? '',
    ...entry.aliases,
  ]
    .map(normalizeProductSearch)
    .filter(Boolean);

  const queryTokens = new Set(query.split(' ').filter(Boolean));

  return variants.some((variant) => {
    if (variant.includes(query) || query.includes(variant)) return true;
    const variantTokens = variant.split(' ').filter(Boolean);
    return variantTokens.length > 0 && variantTokens.every((token) => queryTokens.has(token));
  });
}

function normalizeProductSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*(kilograms?|kilogrammes?|kgs?)\b/g, '$1kg')
    .replace(/\bsemo\b/g, 'semolina')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(?:bags?|cartons?|packs?|packets?|bottles?|crates?|boxes?|pieces?|pcs|units?|of)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .sort()
    .join(' ');
}

function formatParserSource(source: MerchantOrder['parserSource']): string {
  if (source === 'external') return 'AI parser';
  if (source === 'fallback') return 'Fallback parser';
  if (source === 'manual') return 'Manual order';
  return 'Earlier parser';
}

function formatReason(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  itemStack: { gap: 8 },
  reviewCard: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12, gap: 5, borderWidth: 1, borderColor: '#E4E7EC' },
  reviewTitle: { color: '#344054', fontWeight: '900', fontSize: 12 },
  reviewMeta: { color: '#667085', fontSize: 13, lineHeight: 16 },
  reasonList: { gap: 3, marginTop: 2 },
  reasonText: { color: '#475467', fontSize: 13, lineHeight: 16 },
  emptyState: { backgroundColor: '#FFF8E7', borderRadius: 12, padding: 12 },
  emptyTitle: { color: '#7A2E0E', fontWeight: '800', fontSize: 13 },
  emptyText: { color: '#854A0E', marginTop: 4, fontSize: 12, lineHeight: 18 },
  lineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E7EC',
  },
  quantityBox: {
    minWidth: 40,
    borderRadius: 10,
    backgroundColor: '#ECFDF3',
    paddingVertical: 8,
    alignItems: 'center',
  },
  quantityText: { color: '#12B76A', fontWeight: '800' },
  lineItemNameWrap: { flex: 1 },
  lineItemName: { color: '#102A43', fontWeight: '700', fontSize: 14 },
  lineItemPrice: { color: '#667085', marginTop: 2, fontSize: 12 },
  lineTotal: { color: '#102A43', fontWeight: '800', fontSize: 13 },
  matchWrap: { gap: 2, marginTop: 3 },
  matchText: { color: '#027A48', fontSize: 12, fontWeight: '700' },
  matchWarning: { color: '#B54708' },
  originalText: { color: '#667085', fontSize: 12, lineHeight: 14 },
  editorCard: { borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 12, gap: 9 },
  newItemCard: { backgroundColor: '#F9FAFB' },
  newItemTitle: { color: '#344054', fontWeight: '800', fontSize: 13 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    color: '#102A43',
  },
  inputRow: { flexDirection: 'row', gap: 8 },
  smallInput: { width: 86 },
  priceInput: { flex: 1 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  removeButton: { paddingVertical: 9, paddingHorizontal: 12 },
  removeButtonText: { color: '#B42318', fontWeight: '800', fontSize: 12 },
  saveButton: { backgroundColor: '#12B76A', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 13 },
  saveButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  addButton: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 2 },
  addButtonText: { color: '#12B76A', fontWeight: '800', fontSize: 13 },
  resolveCard: { backgroundColor: '#FFF8E7', borderWidth: 1, borderColor: '#FEDF89', borderRadius: 14, padding: 12, gap: 9 },
  resolveEyebrow: { color: '#B54708', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  resolveTitle: { color: '#7A2E0E', fontSize: 14, lineHeight: 20, fontWeight: '900' },
  resolveBody: { color: '#854A0E', fontSize: 13, lineHeight: 19 },
  resolveActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  resolveButton: { minHeight: 40, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  resolveButtonText: { color: '#344054', fontSize: 12, fontWeight: '900' },
  resolvePanel: { backgroundColor: '#FFFFFF', borderRadius: 11, padding: 10, gap: 8 },
  resolvePanelTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  resolveHint: { color: '#667085', fontSize: 12, lineHeight: 18 },
  learnAliasRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 3 },
  checkBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: '#98A2B3', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkBoxActive: { backgroundColor: '#12B76A', borderColor: '#12B76A' },
  checkMark: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  learnAliasText: { color: '#475467', fontSize: 12, lineHeight: 18, flex: 1 },
  catalogueMatchList: { gap: 6 },
  catalogueMatchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, padding: 9, borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 10, backgroundColor: '#FFFFFF' },
  matchProductCopy: { flex: 1 },
  catalogueMatchName: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  useProductText: { color: '#079455', fontSize: 12, fontWeight: '900' },
  primaryResolveButton: { minHeight: 44, backgroundColor: '#12B76A', borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  primaryResolveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  error: { color: '#B42318', fontSize: 12, lineHeight: 17 },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#475467' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#98A2B3', color: '#102A43' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  greenText: { color: '#6CE9A6' },
  rowBorder: { borderBottomColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  outlineButton: { backgroundColor: '#162F46', borderColor: '#667085' },
  warningCard: { backgroundColor: '#3D2A12' },
  warningTitle: { color: '#FEDF89' },
  warningText: { color: '#FEC84B' },
});
