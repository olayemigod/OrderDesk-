import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { OrderItemInput } from '../data/ordersRepository';
import type { MatchSource, MerchantOrder, OrderItem } from '../domain/order';

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
};

type Props = {
  order: MerchantOrder;
  editable: boolean;
  onAdd: (orderId: string, item: OrderItemInput) => Promise<void>;
  onEdit: (itemId: string, item: OrderItemInput) => Promise<void>;
  onRemove: (itemId: string) => Promise<void>;
};

export function OrderItemsEditor({ order, editable, onAdd, onEdit, onRemove }: Props) {
  const [adding, setAdding] = useState(false);

  return (
    <View style={styles.wrap}>
      <ReviewDiagnostics order={order} />

      {order.items.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No items parsed</Text>
          <Text style={styles.emptyText}>
            Add what the customer ordered before accepting this order.
          </Text>
        </View>
      ) : null}

      {order.items.map((item) =>
        editable ? (
          <EditableLineItem
            key={item.id}
            item={item}
            onSave={(input) => onEdit(item.id, input)}
            onRemove={() => onRemove(item.id)}
          />
        ) : (
          <ReadOnlyLineItem key={item.id} item={item} />
        ),
      )}

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
  const confidence = order.confidence === null ? null : Math.round(order.confidence * 100);
  const showParser = order.parserSource !== 'legacy' || order.parserVersion;

  if (!showParser && order.reviewReasons.length === 0) return null;

  return (
    <View style={styles.reviewCard}>
      <Text style={styles.reviewTitle}>Why SellerTray wants a review</Text>
      {showParser ? (
        <Text style={styles.reviewMeta}>
          {formatParserSource(order.parserSource)}
          {order.parserVersion ? ` · ${order.parserVersion}` : ''}
          {confidence === null ? '' : ` · ${confidence}% confidence`}
        </Text>
      ) : null}
      {order.reviewReasons.length > 0 ? (
        <View style={styles.reasonList}>
          {order.reviewReasons.map((reason) => (
            <Text key={reason} style={styles.reasonText}>
              • {reviewReasonLabels[reason] ?? formatReason(reason)}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.reviewMeta}>Review the customer message and order lines before accepting.</Text>
      )}
    </View>
  );
}

function ReadOnlyLineItem({ item }: { item: OrderItem }) {
  return (
    <View style={styles.lineItem}>
      <View style={styles.quantityBox}>
        <Text style={styles.quantityText}>{item.quantity}×</Text>
      </View>
      <View style={styles.lineItemNameWrap}>
        <Text style={styles.lineItemName}>{item.name}</Text>
        <Text style={styles.lineItemPrice}>
          {item.unitPrice === null ? 'Price not set' : `${money.format(item.unitPrice)} each`}
        </Text>
        <MatchDetail item={item} />
      </View>
      <Text style={styles.lineTotal}>
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
    <View style={styles.editorCard}>
      <MatchDetail item={item} />
      <TextInput
        placeholder="Item name"
        value={name}
        onChangeText={setName}
        style={styles.input}
      />
      <View style={styles.inputRow}>
        <TextInput
          keyboardType="decimal-pad"
          placeholder="Qty"
          value={quantity}
          onChangeText={setQuantity}
          style={[styles.input, styles.smallInput]}
        />
        <TextInput
          keyboardType="decimal-pad"
          placeholder="Price (₦)"
          value={price}
          onChangeText={setPrice}
          style={[styles.input, styles.priceInput]}
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
  const originalDiffers =
    item.originalName && item.originalName.trim().toLocaleLowerCase() !== item.name.trim().toLocaleLowerCase();
  const confidence = item.matchConfidence === null ? '' : ` · ${Math.round(item.matchConfidence * 100)}%`;

  if (item.matchSource === 'legacy' && !originalDiffers) return null;

  return (
    <View style={styles.matchWrap}>
      <Text style={[styles.matchText, item.matchSource === 'unmatched' && styles.matchWarning]}>
        {matchLabels[item.matchSource]}{confidence}
      </Text>
      {originalDiffers ? (
        <Text style={styles.originalText}>Customer wording: “{item.originalName}”</Text>
      ) : null}
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
    <View style={[styles.editorCard, styles.newItemCard]}>
      <Text style={styles.newItemTitle}>Add order item</Text>
      <TextInput
        autoFocus
        placeholder="Item name"
        value={name}
        onChangeText={setName}
        style={styles.input}
      />
      <View style={styles.inputRow}>
        <TextInput
          keyboardType="decimal-pad"
          placeholder="Qty"
          value={quantity}
          onChangeText={setQuantity}
          style={[styles.input, styles.smallInput]}
        />
        <TextInput
          keyboardType="decimal-pad"
          placeholder="Price (₦)"
          value={price}
          onChangeText={setPrice}
          style={[styles.input, styles.priceInput]}
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
  reviewCard: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12, gap: 5, borderWidth: 1, borderColor: '#EAECF0' },
  reviewTitle: { color: '#344054', fontWeight: '900', fontSize: 12 },
  reviewMeta: { color: '#667085', fontSize: 11, lineHeight: 16 },
  reasonList: { gap: 3, marginTop: 2 },
  reasonText: { color: '#475467', fontSize: 11, lineHeight: 16 },
  emptyState: { backgroundColor: '#FFF8E7', borderRadius: 12, padding: 12 },
  emptyTitle: { color: '#7A2E0E', fontWeight: '800', fontSize: 13 },
  emptyText: { color: '#854A0E', marginTop: 4, fontSize: 12, lineHeight: 18 },
  lineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EAECF0',
  },
  quantityBox: {
    minWidth: 40,
    borderRadius: 10,
    backgroundColor: '#EEF4FF',
    paddingVertical: 8,
    alignItems: 'center',
  },
  quantityText: { color: '#246BFD', fontWeight: '800' },
  lineItemNameWrap: { flex: 1 },
  lineItemName: { color: '#101828', fontWeight: '700', fontSize: 14 },
  lineItemPrice: { color: '#98A2B3', marginTop: 2, fontSize: 12 },
  lineTotal: { color: '#101828', fontWeight: '800', fontSize: 13 },
  matchWrap: { gap: 2, marginTop: 3 },
  matchText: { color: '#027A48', fontSize: 10, fontWeight: '700' },
  matchWarning: { color: '#B54708' },
  originalText: { color: '#667085', fontSize: 10, lineHeight: 14 },
  editorCard: { borderWidth: 1, borderColor: '#EAECF0', borderRadius: 14, padding: 12, gap: 9 },
  newItemCard: { backgroundColor: '#F9FAFB' },
  newItemTitle: { color: '#344054', fontWeight: '800', fontSize: 13 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    color: '#101828',
  },
  inputRow: { flexDirection: 'row', gap: 8 },
  smallInput: { width: 86 },
  priceInput: { flex: 1 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  removeButton: { paddingVertical: 9, paddingHorizontal: 12 },
  removeButtonText: { color: '#B42318', fontWeight: '800', fontSize: 12 },
  saveButton: { backgroundColor: '#246BFD', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 13 },
  saveButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  addButton: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 2 },
  addButtonText: { color: '#246BFD', fontWeight: '800', fontSize: 13 },
  error: { color: '#B42318', fontSize: 12, lineHeight: 17 },
});
