import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import type { ManualOrderLineInput } from '../data/ordersRepository';
import { useCatalogue } from '../hooks/useCatalogue';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { CatalogueProductPicker } from './CatalogueProductPicker';

type Props = {
  business: MerchantBusiness;
  onCreate: (input: {
    customerName: string;
    customerPhone: string;
    note?: string | null;
    items: ManualOrderLineInput[];
  }) => Promise<string>;
  onCreated: (orderId: string) => void;
};

export function ManualOrderComposer({ business, onCreate, onCreated }: Props) {
  const appearance = useSellerTrayAppearance();
  const { items, loading, error: catalogueError } = useCatalogue(business.id);
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [note, setNote] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeItems = useMemo(
    () => items.filter((item) => item.isActive && item.price !== null),
    [items],
  );
  const selected = useMemo(
    () => activeItems
      .filter((item) => (quantities[item.id] ?? 0) > 0)
      .map((item) => ({ item, quantity: quantities[item.id] ?? 0 })),
    [activeItems, quantities],
  );

  const total = selected.reduce((sum, row) => sum + ((row.item.price ?? 0) * row.quantity), 0);

  function changeQuantity(itemId: string, delta: number) {
    setQuantities((current) => {
      const next = Math.max(0, Math.min(9999, (current[itemId] ?? 0) + delta));
      const copy = { ...current };
      if (next === 0) delete copy[itemId];
      else copy[itemId] = next;
      return copy;
    });
  }

  async function create() {
    if (!customerName.trim()) return setError('Enter the customer name.');
    if (!customerPhone.trim()) return setError('Enter the customer phone number.');
    if (!selected.length) return setError('Choose at least one product.');

    setSubmitting(true);
    setError(null);
    try {
      const orderId = await onCreate({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        note: note.trim() || null,
        items: selected.map(({ item, quantity }) => ({ catalogItemId: item.id, quantity })),
      });
      setCustomerName('');
      setCustomerPhone('');
      setNote('');
      setQuantities({});
      setOpen(false);
      onCreated(orderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create order.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}>
        <Text style={styles.newButtonText}>+ New order</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, appearance.dark && darkStyles.card]}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>MANUAL ORDER</Text>
          <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Create an order</Text>
          <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>
            Search your catalogue and add only the products the customer requested.
          </Text>
        </View>
        <Pressable disabled={submitting} onPress={() => setOpen(false)}>
          <Text style={[styles.close, appearance.dark && darkStyles.bodyText]}>Close</Text>
        </Pressable>
      </View>

      <Field label="Customer name" required hint="The name you want staff to recognise in the order list.">
        <TextInput
          value={customerName}
          onChangeText={setCustomerName}
          placeholder="e.g. Aisha Bello"
          placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
          editable={!submitting}
          style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]}
        />
      </Field>

      <Field label="Customer phone" required hint="Include the country code where possible, e.g. +2348012345678.">
        <TextInput
          value={customerPhone}
          onChangeText={setCustomerPhone}
          placeholder="+234..."
          placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
          keyboardType="phone-pad"
          editable={!submitting}
          style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]}
        />
      </Field>

      <Field label="Order note" hint="Optional instruction or context from the customer.">
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Deliver before 4pm"
          placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'}
          multiline
          editable={!submitting}
          style={[styles.input, styles.noteInput, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]}
        />
      </Field>

      <View style={styles.field}>
        <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>Products *</Text>
        <Text style={[styles.hint, appearance.dark && darkStyles.bodyText]}>
          Search the catalogue instead of scrolling through the full inventory.
        </Text>
      </View>

      {catalogueError ? <Text style={styles.error}>{catalogueError}</Text> : null}
      {loading && !activeItems.length ? (
        <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Loading products…</Text>
      ) : null}
      {!loading && !activeItems.length ? (
        <Text style={[styles.emptyText, appearance.dark && darkStyles.bodyText]}>
          No active priced products yet. Add products from the Products tab first.
        </Text>
      ) : null}

      {activeItems.length ? (
        <CatalogueProductPicker
          items={activeItems}
          currency={business.currency}
          selectedQuantities={quantities}
          disabled={submitting}
          title="Search and add products"
          hint="Search by product, SKU, category or alias. Similar variants remain separate so you can choose the correct one."
          onSelect={(item) => changeQuantity(item.id, 1)}
        />
      ) : null}

      {selected.length ? (
        <View style={[styles.basket, appearance.dark && darkStyles.basket]}>
          <Text style={[styles.basketTitle, appearance.dark && darkStyles.titleText]}>Selected products</Text>
          {selected.map(({ item, quantity }) => (
            <View key={item.id} style={styles.selectedRow}>
              <View style={styles.selectedCopy}>
                <Text style={[styles.productName, appearance.dark && darkStyles.titleText]}>{item.name}</Text>
                <Text style={[styles.productPrice, appearance.dark && darkStyles.bodyText]}>
                  {money(item.price ?? 0, business.currency)} each
                </Text>
              </View>
              <View style={styles.quantityControls}>
                <Pressable
                  disabled={submitting}
                  onPress={() => changeQuantity(item.id, -1)}
                  style={[styles.qtyButton, appearance.dark && darkStyles.qtyButton]}
                >
                  <Text style={[styles.qtyButtonText, appearance.dark && darkStyles.titleText]}>−</Text>
                </Pressable>
                <Text style={[styles.qtyValue, appearance.dark && darkStyles.titleText]}>{quantity}</Text>
                <Pressable
                  disabled={submitting}
                  onPress={() => changeQuantity(item.id, 1)}
                  style={[styles.qtyButton, appearance.dark && darkStyles.qtyButton]}
                >
                  <Text style={[styles.qtyButtonText, appearance.dark && darkStyles.titleText]}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, appearance.dark && darkStyles.bodyText]}>Order total</Text>
            <Text style={[styles.total, appearance.dark && darkStyles.titleText]}>{money(total, business.currency)}</Text>
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        disabled={submitting || !selected.length}
        onPress={() => void create()}
        style={({ pressed }) => [styles.createButton, pressed && styles.pressed, (submitting || !selected.length) && styles.disabled]}
      >
        <Text style={styles.createButtonText}>{submitting ? 'Creating order…' : 'Create order'}</Text>
      </Pressable>
    </View>
  );
}

function Field({
  label,
  required = false,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>{label}{required ? ' *' : ''}</Text>
      {hint ? <Text style={[styles.hint, appearance.dark && darkStyles.bodyText]}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

const styles = StyleSheet.create({
  newButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#12B76A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  newButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 18,
    padding: 16,
    gap: 15,
  },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headingCopy: { flex: 1 },
  eyebrow: { color: '#12B76A', fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 22, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 4 },
  close: { color: '#667085', fontSize: 12, fontWeight: '800' },
  field: { gap: 6 },
  label: { color: '#344054', fontSize: 13, fontWeight: '900' },
  hint: { color: '#667085', fontSize: 12, lineHeight: 18 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 11,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    color: '#102A43',
  },
  noteInput: { minHeight: 76, paddingTop: 12, textAlignVertical: 'top' },
  basket: { borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 12, padding: 11, gap: 9 },
  basketTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectedCopy: { flex: 1 },
  productName: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  productPrice: { color: '#667085', fontSize: 12, marginTop: 2 },
  quantityControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyButton: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  qtyButtonText: { color: '#102A43', fontSize: 18, fontWeight: '900' },
  qtyValue: { minWidth: 24, textAlign: 'center', color: '#102A43', fontSize: 13, fontWeight: '900' },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 3 },
  totalLabel: { color: '#667085', fontSize: 12, fontWeight: '800' },
  total: { color: '#102A43', fontSize: 18, fontWeight: '900' },
  createButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#12B76A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  muted: { color: '#667085', fontSize: 12 },
  emptyText: { color: '#667085', fontSize: 13, lineHeight: 17 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 16 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  basket: { backgroundColor: '#102A43', borderColor: '#344054' },
  qtyButton: { backgroundColor: '#162F46', borderColor: '#475467' },
  input: { backgroundColor: '#162F46', borderColor: '#475467' },
  inputText: { color: '#F8FAFC' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
});
