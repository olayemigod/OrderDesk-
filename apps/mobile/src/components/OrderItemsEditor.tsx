import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CatalogueProductPicker } from './CatalogueProductPicker';
import type { MerchantRole } from '../data/businessRepository';
import {
  createCatalogueItem,
  loadCatalogue,
  type CatalogueItem,
} from '../data/catalogueRepository';
import type { OrderItemInput } from '../data/ordersRepository';
import {
  addCatalogueOrderItem,
  createCatalogueFromOrderItem,
  keepOrderItemOneOff,
  matchOrderItemToCatalogue,
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
  onEdit,
  onRemove,
  onResolved,
  onCatalogueChanged,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

  async function refreshCatalogue() {
    setCatalogueLoading(true);
    setCatalogueError(null);
    try {
      setCatalogue(await loadCatalogue(tenantId));
    } catch (err) {
      setCatalogueError(err instanceof Error ? err.message : 'Unable to load the catalogue.');
    } finally {
      setCatalogueLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setCatalogueLoading(true);
    setCatalogueError(null);
    void loadCatalogue(tenantId)
      .then((rows) => {
        if (active) setCatalogue(rows);
      })
      .catch((err) => {
        if (active) setCatalogueError(err instanceof Error ? err.message : 'Unable to load the catalogue.');
      })
      .finally(() => {
        if (active) setCatalogueLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const canCreateProduct = role === 'owner' || role === 'manager';

  async function catalogueChanged() {
    await refreshCatalogue();
    await onCatalogueChanged();
  }

  return (
    <View style={styles.wrap}>
      <ReviewDiagnostics order={order} />

      {catalogueError ? <Text style={styles.error}>{catalogueError}</Text> : null}
      {catalogueLoading ? (
        <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Loading catalogue…</Text>
      ) : null}

      {order.items.length === 0 ? (
        <View style={[styles.warningCard, appearance.dark && darkStyles.warningCard]}>
          <Text style={[styles.warningTitle, appearance.dark && darkStyles.warningTitle]}>No products yet</Text>
          <Text style={[styles.warningText, appearance.dark && darkStyles.warningText]}>
            Search the catalogue and add what the customer actually ordered before accepting this order.
          </Text>
        </View>
      ) : null}

      {order.items.map((item) => (
        <GovernedOrderItemEditor
          key={item.id}
          item={item}
          tenantId={tenantId}
          role={role}
          editable={editable}
          catalogue={catalogue}
          onEdit={onEdit}
          onRemove={onRemove}
          onResolved={onResolved}
          onCatalogueChanged={catalogueChanged}
        />
      ))}

      {editable ? (
        <AddProductPanel
          tenantId={tenantId}
          orderId={order.id}
          catalogue={catalogue}
          canCreateProduct={canCreateProduct}
          onAdded={onResolved}
          onCatalogueChanged={catalogueChanged}
        />
      ) : null}
    </View>
  );
}

function ReviewDiagnostics({ order }: { order: MerchantOrder }) {
  const appearance = useSellerTrayAppearance();
  const confidence = order.confidence === null ? null : Math.round(order.confidence * 100);
  const showParser = order.parserSource !== 'legacy' || Boolean(order.parserVersion);

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
      {order.reviewReasons.map((reason) => (
        <Text key={reason} style={[styles.reasonText, appearance.dark && darkStyles.bodyText]}>
          • {reviewReasonLabels[reason] ?? formatReason(reason)}
        </Text>
      ))}
    </View>
  );
}

function GovernedOrderItemEditor({
  item,
  tenantId,
  role,
  editable,
  catalogue,
  onEdit,
  onRemove,
  onResolved,
  onCatalogueChanged,
}: {
  item: OrderItem;
  tenantId: string;
  role: MerchantRole;
  editable: boolean;
  catalogue: CatalogueItem[];
  onEdit: (itemId: string, item: OrderItemInput) => Promise<void>;
  onRemove: (itemId: string) => Promise<void>;
  onResolved: () => Promise<void>;
  onCatalogueChanged: () => Promise<void>;
}) {
  const appearance = useSellerTrayAppearance();
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [changeOpen, setChangeOpen] = useState(item.matchSource === 'unmatched');
  const [createOpen, setCreateOpen] = useState(false);
  const [oneOffOpen, setOneOffOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCreateProduct = role === 'owner' || role === 'manager';

  useEffect(() => {
    setQuantity(String(item.quantity));
  }, [item.id, item.quantity]);

  async function saveQuantity() {
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 9999) {
      setError('Enter a valid quantity.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onEdit(item.id, { name: item.name, quantity: parsed, unitPrice: item.unitPrice });
      await onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update quantity.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onRemove(item.id);
      await onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove product.');
    } finally {
      setBusy(false);
    }
  }

  async function changeProduct(selected: CatalogueItem) {
    setError(null);
    await matchOrderItemToCatalogue({
      tenantId,
      orderItemId: item.id,
      catalogItemId: selected.id,
      learnAlias: item.matchSource === 'unmatched' && canCreateProduct,
    });
    setChangeOpen(false);
    await onResolved();
  }

  return (
    <View style={[styles.itemCard, appearance.dark && darkStyles.card]}>
      <View style={styles.itemHeader}>
        <View style={styles.itemCopy}>
          <Text style={[styles.itemName, appearance.dark && darkStyles.titleText]}>{item.name}</Text>
          <Text style={[styles.itemPrice, appearance.dark && darkStyles.bodyText]}>
            {item.unitPrice === null ? 'Price not set' : `${money.format(item.unitPrice)} each`}
          </Text>
          <MatchDetail item={item} />
        </View>
        <Text style={[styles.lineTotal, appearance.dark && darkStyles.titleText]}>
          {item.unitPrice === null ? '—' : money.format(item.unitPrice * item.quantity)}
        </Text>
      </View>

      {editable ? (
        <>
          <View style={styles.quantityRow}>
            <View style={styles.quantityField}>
              <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>Quantity</Text>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="decimal-pad"
                editable={!busy}
                style={[styles.input, styles.quantityInput, appearance.dark && darkStyles.input]}
              />
            </View>
            <Pressable disabled={busy} onPress={() => void saveQuantity()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>{busy ? 'Saving…' : 'Save quantity'}</Text>
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            <Pressable disabled={busy} onPress={() => setChangeOpen((value) => !value)} style={styles.outlineButton}>
              <Text style={[styles.outlineButtonText, appearance.dark && darkStyles.titleText]}>
                {changeOpen ? 'Close product search' : 'Change product'}
              </Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => void remove()} style={styles.removeButton}>
              <Text style={styles.removeButtonText}>Remove</Text>
            </Pressable>
          </View>

          {changeOpen ? (
            <View style={[styles.subPanel, appearance.dark && darkStyles.subtleCard]}>
              <CatalogueProductPicker
                items={catalogue}
                initialQuery={item.originalName || item.name}
                disabled={busy}
                onSelect={changeProduct}
                title={item.matchSource === 'unmatched' ? 'Resolve to a catalogue product' : 'Choose the correct product'}
                hint="Search by name, SKU, category or alias. SellerTray will use the catalogue price automatically."
              />

              {canCreateProduct ? (
                <Pressable onPress={() => setCreateOpen((value) => !value)} style={styles.textButton}>
                  <Text style={styles.textButtonText}>
                    {createOpen ? 'Cancel new product' : 'Product not in catalogue? Create it'}
                  </Text>
                </Pressable>
              ) : (
                <Text style={[styles.help, appearance.dark && darkStyles.bodyText]}>
                  If the product does not exist, an Owner or Manager must add it to the catalogue.
                </Text>
              )}

              {createOpen && canCreateProduct ? (
                <CreateProductForm
                  initialName={item.originalName || item.name}
                  onCreate={async (input) => {
                    if (item.matchSource === 'unmatched') {
                      await createCatalogueFromOrderItem({
                        tenantId,
                        orderItemId: item.id,
                        name: input.name,
                        price: input.price,
                        sku: input.sku,
                        category: input.category,
                        learnAlias: true,
                      });
                    } else {
                      const newId = await createCatalogueItem(tenantId, {
                        name: input.name,
                        sku: input.sku,
                        category: input.category,
                        imageUrl: null,
                        price: input.price,
                        aliases: [],
                      });
                      await matchOrderItemToCatalogue({
                        tenantId,
                        orderItemId: item.id,
                        catalogItemId: newId,
                        learnAlias: false,
                      });
                    }
                    setCreateOpen(false);
                    setChangeOpen(false);
                    await onCatalogueChanged();
                    await onResolved();
                  }}
                />
              ) : null}

              {item.matchSource === 'unmatched' ? (
                <>
                  <Pressable onPress={() => setOneOffOpen((value) => !value)} style={styles.textButton}>
                    <Text style={styles.textButtonText}>
                      {oneOffOpen ? 'Cancel one-off' : 'Fulfil once without adding to catalogue'}
                    </Text>
                  </Pressable>
                  {oneOffOpen ? (
                    <OneOffForm
                      item={item}
                      onSave={async (name, price) => {
                        await keepOrderItemOneOff({ tenantId, orderItemId: item.id, name, price });
                        setOneOffOpen(false);
                        setChangeOpen(false);
                        await onResolved();
                      }}
                    />
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function AddProductPanel({
  tenantId,
  orderId,
  catalogue,
  canCreateProduct,
  onAdded,
  onCatalogueChanged,
}: {
  tenantId: string;
  orderId: string;
  catalogue: CatalogueItem[];
  canCreateProduct: boolean;
  onAdded: () => Promise<void>;
  onCatalogueChanged: () => Promise<void>;
}) {
  const appearance = useSellerTrayAppearance();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const parsedQuantity = useMemo(() => Number(quantity), [quantity]);

  async function addProduct(item: CatalogueItem) {
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || parsedQuantity > 9999) {
      throw new Error('Enter a valid quantity before choosing the product.');
    }
    await addCatalogueOrderItem({ tenantId, orderId, catalogItemId: item.id, quantity: parsedQuantity });
    setQuantity('1');
    setOpen(false);
    await onAdded();
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={styles.addButton}>
        <Text style={styles.addButtonText}>+ Add product</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.addPanel, appearance.dark && darkStyles.card]}>
      <View style={styles.panelHeader}>
        <View style={styles.itemCopy}>
          <Text style={[styles.panelTitle, appearance.dark && darkStyles.titleText]}>Add a product</Text>
          <Text style={[styles.help, appearance.dark && darkStyles.bodyText]}>
            Search the catalogue instead of scrolling through inventory. SellerTray copies the governed selling price.
          </Text>
        </View>
        <Pressable onPress={() => setOpen(false)}>
          <Text style={[styles.closeText, appearance.dark && darkStyles.bodyText]}>Close</Text>
        </Pressable>
      </View>

      <View style={styles.quantityField}>
        <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>Quantity</Text>
        <TextInput value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" style={[styles.input, styles.quantityInput, appearance.dark && darkStyles.input]} />
      </View>

      <CatalogueProductPicker
        items={catalogue}
        onSelect={addProduct}
        title="Search catalogue"
        hint="Search by product name, SKU, category or customer alias."
      />

      {canCreateProduct ? (
        <Pressable onPress={() => setCreateOpen((value) => !value)} style={styles.textButton}>
          <Text style={styles.textButtonText}>{createOpen ? 'Cancel new product' : 'Product not found? Create it'}</Text>
        </Pressable>
      ) : (
        <Text style={[styles.help, appearance.dark && darkStyles.bodyText]}>Only an Owner or Manager can create a new catalogue product.</Text>
      )}

      {createOpen && canCreateProduct ? (
        <CreateProductForm
          initialName=""
          onCreate={async (input) => {
            try {
              const itemId = await createCatalogueItem(tenantId, {
                name: input.name,
                sku: input.sku,
                category: input.category,
                imageUrl: null,
                price: input.price,
                aliases: [],
              });
              if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || parsedQuantity > 9999) {
                throw new Error('Enter a valid quantity.');
              }
              await addCatalogueOrderItem({ tenantId, orderId, catalogItemId: itemId, quantity: parsedQuantity });
              setCreateOpen(false);
              setOpen(false);
              setQuantity('1');
              await onCatalogueChanged();
              await onAdded();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Unable to create and add the product.');
            }
          }}
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function CreateProductForm({
  initialName,
  onCreate,
}: {
  initialName: string;
  onCreate: (input: { name: string; price: number; sku: string | null; category: string | null }) => Promise<void>;
}) {
  const appearance = useSellerTrayAppearance();
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const amount = Number(price);
    if (!name.trim()) return setError('Enter the product name.');
    if (!price.trim() || !Number.isFinite(amount) || amount < 0) return setError('Enter a valid selling price.');
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), price: amount, sku: sku.trim() || null, category: category.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the product.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.createForm, appearance.dark && darkStyles.subtleCard]}>
      <Text style={[styles.panelTitle, appearance.dark && darkStyles.titleText]}>Create catalogue product</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Product name" placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'} style={[styles.input, appearance.dark && darkStyles.input]} />
      <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="Selling price" placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'} style={[styles.input, appearance.dark && darkStyles.input]} />
      <View style={styles.splitRow}>
        <TextInput value={sku} onChangeText={setSku} placeholder="SKU (optional)" placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'} style={[styles.input, styles.flexInput, appearance.dark && darkStyles.input]} />
        <TextInput value={category} onChangeText={setCategory} placeholder="Category" placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'} style={[styles.input, styles.flexInput, appearance.dark && darkStyles.input]} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable disabled={busy} onPress={() => void create()} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>{busy ? 'Creating…' : 'Create & use product'}</Text>
      </Pressable>
    </View>
  );
}

function OneOffForm({ item, onSave }: { item: OrderItem; onSave: (name: string, price: number) => Promise<void> }) {
  const appearance = useSellerTrayAppearance();
  const [name, setName] = useState(item.originalName || item.name);
  const [price, setPrice] = useState(item.unitPrice === null ? '' : String(item.unitPrice));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const amount = Number(price);
    if (!name.trim()) return setError('Enter the one-off item name.');
    if (!price.trim() || !Number.isFinite(amount) || amount < 0) return setError('Enter a valid selling price.');
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim(), amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to approve the one-off item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.createForm, appearance.dark && darkStyles.subtleCard]}>
      <Text style={[styles.help, appearance.dark && darkStyles.bodyText]}>One-off keeps this order exceptional. It does not teach SellerTray a permanent catalogue product.</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Customer item wording" placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'} style={[styles.input, appearance.dark && darkStyles.input]} />
      <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="Selling price" placeholderTextColor={appearance.dark ? '#98A2B3' : '#667085'} style={[styles.input, appearance.dark && darkStyles.input]} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable disabled={busy} onPress={() => void save()} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Approve one-off'}</Text>
      </Pressable>
    </View>
  );
}

function MatchDetail({ item }: { item: OrderItem }) {
  const appearance = useSellerTrayAppearance();
  const originalDiffers = Boolean(item.originalName && item.originalName.trim().toLocaleLowerCase() !== item.name.trim().toLocaleLowerCase());
  const confidence = item.matchConfidence === null ? '' : ` · ${Math.round(item.matchConfidence * 100)}%`;
  if (item.matchSource === 'legacy' && !originalDiffers) return null;

  return (
    <View style={styles.matchWrap}>
      <Text style={[styles.matchText, item.matchSource === 'unmatched' && styles.matchWarning]}>{matchLabels[item.matchSource]}{confidence}</Text>
      {originalDiffers ? <Text style={[styles.originalText, appearance.dark && darkStyles.bodyText]}>Customer wording: “{item.originalName}”</Text> : null}
    </View>
  );
}

function formatParserSource(source: MerchantOrder['parserSource']) {
  if (source === 'external') return 'AI interpreted';
  if (source === 'fallback') return 'Fallback interpreted';
  if (source === 'manual') return 'Merchant-entered';
  return 'Earlier order format';
}

function formatReason(value: string) {
  return value.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  reviewCard: { borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#F8FAFC', borderRadius: 14, padding: 12, gap: 5 },
  reviewTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  reviewMeta: { color: '#667085', fontSize: 12, lineHeight: 18 },
  reasonText: { color: '#667085', fontSize: 12, lineHeight: 18 },
  warningCard: { borderWidth: 1, borderColor: '#FEC84B', backgroundColor: '#FFFAEB', borderRadius: 14, padding: 12, gap: 4 },
  warningTitle: { color: '#7A2E0E', fontSize: 13, fontWeight: '900' },
  warningText: { color: '#7A2E0E', fontSize: 12, lineHeight: 18 },
  itemCard: { borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 15, padding: 13, backgroundColor: '#FFFFFF', gap: 11 },
  itemHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  itemCopy: { flex: 1 },
  itemName: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  itemPrice: { color: '#667085', fontSize: 12, marginTop: 3 },
  lineTotal: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  matchWrap: { marginTop: 5, gap: 2 },
  matchText: { color: '#12B76A', fontSize: 11, fontWeight: '800' },
  matchWarning: { color: '#B54708' },
  originalText: { color: '#667085', fontSize: 11, lineHeight: 16 },
  quantityRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  quantityField: { gap: 5 },
  label: { color: '#344054', fontSize: 12, fontWeight: '800' },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingHorizontal: 11, backgroundColor: '#FFFFFF', color: '#102A43' },
  quantityInput: { width: 88 },
  secondaryButton: { minHeight: 44, borderRadius: 10, backgroundColor: '#102A43', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  outlineButton: { minHeight: 40, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  outlineButtonText: { color: '#102A43', fontSize: 12, fontWeight: '800' },
  removeButton: { minHeight: 40, borderRadius: 10, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF3F2' },
  removeButtonText: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  subPanel: { borderRadius: 12, padding: 12, backgroundColor: '#F8FAFC', gap: 11 },
  addButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#12B76A', alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: '#12B76A', fontSize: 13, fontWeight: '900' },
  addPanel: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 15, padding: 13, backgroundColor: '#FFFFFF', gap: 12 },
  panelHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  panelTitle: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  closeText: { color: '#667085', fontSize: 12, fontWeight: '800' },
  help: { color: '#667085', fontSize: 12, lineHeight: 18 },
  textButton: { alignSelf: 'flex-start', paddingVertical: 4 },
  textButtonText: { color: '#027A48', fontSize: 12, fontWeight: '900' },
  createForm: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 11, gap: 9 },
  splitRow: { flexDirection: 'row', gap: 8 },
  flexInput: { flex: 1 },
  primaryButton: { minHeight: 44, borderRadius: 10, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  muted: { color: '#667085', fontSize: 12 },
  error: { color: '#B42318', fontSize: 12, lineHeight: 17 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46' },
  input: { backgroundColor: '#162F46', borderColor: '#475467', color: '#F8FAFC' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  warningCard: { backgroundColor: '#3A2A12', borderColor: '#8A5D13' },
  warningTitle: { color: '#FEC84B' },
  warningText: { color: '#FEDF89' },
});
