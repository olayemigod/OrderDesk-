import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import { ChatCatalogueReviewSection } from './ChatCatalogueReviewSection';
import type { CatalogueItem, CatalogueItemInput } from '../data/catalogueRepository';
import {
  configureWhatsAppCatalogue,
  loadWhatsAppCatalogueStatus,
  mapWhatsAppCatalogueItem,
  unmapWhatsAppCatalogueItem,
  type WhatsAppCatalogueStatus,
} from '../data/whatsappCatalogueRepository';
import { useCatalogue } from '../hooks/useCatalogue';

export function CatalogueView({ business }: { business: MerchantBusiness }) {
  const { items, loading, error, refresh, createItem, editItem, setActive } = useCatalogue(business.id);
  const [editing, setEditing] = useState<CatalogueItem | 'new' | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppCatalogueStatus | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(true);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [catalogIdDraft, setCatalogIdDraft] = useState('');
  const [catalogNameDraft, setCatalogNameDraft] = useState('');
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [mappingItemId, setMappingItemId] = useState<string | null>(null);
  const [retailerIdDraft, setRetailerIdDraft] = useState('');
  const [mappingBusy, setMappingBusy] = useState(false);
  const canEdit = business.role === 'owner' || business.role === 'manager';

  async function refreshWhatsAppCatalogue() {
    setWhatsappLoading(true);
    setWhatsappError(null);
    try {
      const status = await loadWhatsAppCatalogueStatus(business.id);
      setWhatsappStatus(status);
      setCatalogIdDraft(status.settings?.catalog_id ?? '');
      setCatalogNameDraft(status.settings?.catalog_name ?? '');
    } catch (err) {
      setWhatsappError(err instanceof Error ? err.message : 'Unable to load WhatsApp catalogue settings.');
    } finally {
      setWhatsappLoading(false);
    }
  }

  useEffect(() => {
    void refreshWhatsAppCatalogue();
  }, [business.id]);

  async function saveWhatsAppCatalogue() {
    if (!canEdit || catalogSaving) return;
    if (!catalogIdDraft.trim()) {
      setWhatsappError('Enter the WhatsApp Business catalogue ID.');
      return;
    }
    setCatalogSaving(true);
    setWhatsappError(null);
    try {
      await configureWhatsAppCatalogue(business.id, {
        catalogId: catalogIdDraft,
        catalogName: catalogNameDraft,
        enabled: true,
      });
      await refreshWhatsAppCatalogue();
    } catch (err) {
      setWhatsappError(err instanceof Error ? err.message : 'Unable to save WhatsApp catalogue settings.');
    } finally {
      setCatalogSaving(false);
    }
  }

  async function saveItemMapping(itemId: string) {
    const catalogId = whatsappStatus?.settings?.catalog_id;
    if (!canEdit || !catalogId || !retailerIdDraft.trim() || mappingBusy) return;
    setMappingBusy(true);
    setWhatsappError(null);
    try {
      await mapWhatsAppCatalogueItem(business.id, itemId, catalogId, retailerIdDraft);
      setMappingItemId(null);
      setRetailerIdDraft('');
      await Promise.all([refresh(), refreshWhatsAppCatalogue()]);
    } catch (err) {
      setWhatsappError(err instanceof Error ? err.message : 'Unable to map this WhatsApp catalogue product.');
    } finally {
      setMappingBusy(false);
    }
  }

  async function removeItemMapping(itemId: string) {
    if (!canEdit || mappingBusy) return;
    setMappingBusy(true);
    setWhatsappError(null);
    try {
      await unmapWhatsAppCatalogueItem(business.id, itemId);
      await Promise.all([refresh(), refreshWhatsAppCatalogue()]);
    } catch (err) {
      setWhatsappError(err instanceof Error ? err.message : 'Unable to remove the WhatsApp catalogue mapping.');
    } finally {
      setMappingBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>CATALOGUE & PRICING</Text>
          <Text style={styles.title}>Products customers can order</Text>
          <Text style={styles.subtitle}>
            Keep this lightweight: Add clear product details and the words customers commonly use on WhatsApp.
          </Text>
        </View>
        {canEdit && editing === null ? (
          <Pressable onPress={() => setEditing('new')} style={styles.addButton}>
            <Text style={styles.addButtonText}>+ Add product</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.whatsappCard}>
        <View style={styles.whatsappHeading}>
          <View style={styles.whatsappHeadingCopy}>
            <Text style={styles.whatsappEyebrow}>WHATSAPP CATALOGUE</Text>
            <Text style={styles.whatsappTitle}>
              {whatsappStatus?.settings ? 'Catalogue mapping active' : 'Connect your product catalogue'}
            </Text>
            <Text style={styles.whatsappText}>
              Map SellerTray products to WhatsApp Business product retailer IDs. Native WhatsApp catalogue orders then arrive as structured orders without AI parsing.
            </Text>
          </View>
          {whatsappLoading ? <ActivityIndicator size="small" /> : null}
        </View>

        {whatsappStatus?.settings ? (
          <View style={styles.whatsappStatusRow}>
            <View style={styles.whatsappStatusPill}>
              <Text style={styles.whatsappStatusText}>
                {whatsappStatus.settings.is_enabled ? 'Enabled' : 'Disabled'}
              </Text>
            </View>
            <Text style={styles.whatsappMeta}>
              {whatsappStatus.settings.catalog_name || 'WhatsApp catalogue'} · ID {whatsappStatus.settings.catalog_id}
            </Text>
          </View>
        ) : null}

        {canEdit ? (
          <View style={styles.whatsappForm}>
            <Field label="WhatsApp catalogue ID" hint="Use the catalogue ID assigned in Meta Commerce / WhatsApp Business.">
              <TextInput
                value={catalogIdDraft}
                onChangeText={setCatalogIdDraft}
                autoCapitalize="none"
                placeholder="e.g. 123456789012345"
                style={styles.input}
              />
            </Field>
            <Field label="Catalogue name" hint="Optional merchant-friendly label.">
              <TextInput
                value={catalogNameDraft}
                onChangeText={setCatalogNameDraft}
                placeholder="e.g. Main WhatsApp Catalogue"
                style={styles.input}
              />
            </Field>
            <Pressable disabled={catalogSaving || whatsappLoading} onPress={() => void saveWhatsAppCatalogue()} style={[styles.whatsappSaveButton, (catalogSaving || whatsappLoading) && styles.disabled]}>
              <Text style={styles.whatsappSaveButtonText}>{catalogSaving ? 'Saving…' : whatsappStatus?.settings ? 'Update catalogue connection' : 'Save catalogue connection'}</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.whatsappReadOnly}>Only the business Owner or Manager can change WhatsApp catalogue mappings.</Text>
        )}

        <View style={styles.importNotice}>
          <Text style={styles.importNoticeTitle}>Automatic Meta catalogue import is not active yet</Text>
          <Text style={styles.importNoticeText}>
            SellerTray will not read or sync a merchant's Meta catalogue using a shared platform credential. Automatic import will only be enabled after tenant-specific Meta asset authorization is verified.
          </Text>
        </View>

        {whatsappError ? <Text style={styles.errorText}>{whatsappError}</Text> : null}
        <Pressable disabled={whatsappLoading || catalogSaving || mappingBusy} onPress={() => void refreshWhatsAppCatalogue()}>
          <Text style={styles.retryText}>Refresh WhatsApp catalogue status</Text>
        </Pressable>
      </View>

      <ChatCatalogueReviewSection
        business={business}
        onCatalogueChanged={refresh}
      />

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void refresh()}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      ) : null}

      {editing ? (
        <CatalogueEditor
          key={editing === 'new' ? 'new' : editing.id}
          item={editing === 'new' ? null : editing}
          currency={business.currency}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === 'new') await createItem(input);
            else await editItem(editing.id, input);
            setEditing(null);
          }}
        />
      ) : null}

      {loading && items.length === 0 ? (
        <View style={styles.loadingCard}><ActivityIndicator /><Text style={styles.muted}>Loading catalogue…</Text></View>
      ) : null}

      {!loading && items.length === 0 && !editing ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Your catalogue is empty</Text>
          <Text style={styles.emptyText}>
            Add your first priced product. SellerTray will then guide you to WhatsApp connection.
          </Text>
          {canEdit ? (
            <Pressable onPress={() => setEditing('new')} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Add first product</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.list}>
        {items.map((item) => (
          <View key={item.id} style={[styles.itemCard, !item.isActive && styles.itemInactive]}>
            <View style={styles.itemTop}>
              <View style={styles.itemIdentity}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemMeta}>
                  {[item.category, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(' · ') || 'Uncategorised'}
                </Text>
              </View>
              <Text style={styles.price}>{item.price === null ? 'No price' : money(item.price, business.currency)}</Text>
            </View>

            <Text style={styles.aliasLabel}>CUSTOMER WORDS</Text>
            <Text style={styles.aliases}>{item.aliases.length ? item.aliases.join(', ') : 'No aliases yet'}</Text>

            <View style={styles.whatsappItemRow}>
              <View style={styles.whatsappItemCopy}>
                <Text style={styles.aliasLabel}>WHATSAPP PRODUCT</Text>
                <Text style={styles.aliases}>
                  {item.whatsappProductRetailerId
                    ? `Mapped · ${item.whatsappProductRetailerId}`
                    : whatsappStatus?.settings
                      ? 'Not mapped'
                      : 'Catalogue connection required'}
                </Text>
              </View>
              {canEdit && whatsappStatus?.settings ? (
                item.whatsappProductRetailerId ? (
                  <Pressable disabled={mappingBusy} onPress={() => void removeItemMapping(item.id)}>
                    <Text style={styles.link}>Unmap</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => {
                      setMappingItemId(item.id);
                      setRetailerIdDraft('');
                    }}
                  >
                    <Text style={styles.link}>Map</Text>
                  </Pressable>
                )
              ) : null}
            </View>

            {mappingItemId === item.id ? (
              <View style={styles.mappingEditor}>
                <Text style={styles.fieldLabel}>Product retailer ID</Text>
                <Text style={styles.help}>
                  Enter the exact product_retailer_id used for this item in the connected WhatsApp Business catalogue.
                </Text>
                <TextInput
                  value={retailerIdDraft}
                  onChangeText={setRetailerIdDraft}
                  autoCapitalize="none"
                  placeholder="e.g. SEM-5KG"
                  style={styles.input}
                />
                <View style={styles.mappingActions}>
                  <Pressable
                    disabled={mappingBusy}
                    onPress={() => {
                      setMappingItemId(null);
                      setRetailerIdDraft('');
                    }}
                    style={styles.mappingSecondary}
                  >
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    disabled={mappingBusy || !retailerIdDraft.trim()}
                    onPress={() => void saveItemMapping(item.id)}
                    style={[styles.mappingPrimary, (!retailerIdDraft.trim() || mappingBusy) && styles.disabled]}
                  >
                    <Text style={styles.primaryButtonText}>{mappingBusy ? 'Mapping…' : 'Save mapping'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={styles.itemActions}>
              <Text style={[styles.stateText, item.isActive ? styles.activeText : styles.inactiveText]}>
                {item.isActive ? 'Active' : 'Inactive'}
              </Text>
              {canEdit ? (
                <View style={styles.actionLinks}>
                  <Pressable onPress={() => setEditing(item)}><Text style={styles.link}>Edit</Text></Pressable>
                  <Pressable onPress={() => void setActive(item.id, !item.isActive)}>
                    <Text style={styles.link}>{item.isActive ? 'Deactivate' : 'Activate'}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function CatalogueEditor({
  item,
  currency,
  onSave,
  onCancel,
}: {
  item: CatalogueItem | null;
  currency: string;
  onSave: (input: CatalogueItemInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [price, setPrice] = useState(item?.price === null || item?.price === undefined ? '' : String(item.price));
  const [aliases, setAliases] = useState(item?.aliases.join(', ') ?? '');
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [item?.id]);

  async function save() {
    const parsedPrice = Number(price);
    if (!name.trim()) return setError('Product name is required.');
    if (!price.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) return setError('Enter a valid selling price.');

    setSubmitting(true);
    setError(null);
    try {
      await onSave({
        name,
        sku: sku || null,
        category: category || null,
        imageUrl: imageUrl || null,
        price: parsedPrice,
        aliases: aliases.split(',').map((value) => value.trim()).filter(Boolean),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save catalogue item.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.editorCard}>
      <Text style={styles.editorTitle}>{item ? 'Edit product' : 'Add product'}</Text>
      <Field label="Product name" required hint="Use the name customers and staff will easily recognise.">
        <TextInput value={name} onChangeText={setName} placeholder="e.g. Golden Penny Semovita 5kg" style={styles.input} />
      </Field>

      <Field label="Selling price" required hint={`Amount charged to the customer in ${currency}.`}>
        <TextInput
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="e.g. 12500"
          style={styles.input}
        />
      </Field>

      <Field label="Category" hint="Optional. Helps organise your product list.">
        <TextInput value={category} onChangeText={setCategory} placeholder="e.g. Groceries" style={styles.input} />
      </Field>

      <Field label="SKU / product code" hint="Optional internal product code.">
        <TextInput value={sku} onChangeText={setSku} placeholder="e.g. SEM-5KG" style={styles.input} />
      </Field>

      <Field label="Customer words / aliases" hint="Optional. Add other names customers may type on WhatsApp, separated by commas.">
        <TextInput
          value={aliases}
          onChangeText={setAliases}
          placeholder="e.g. semo 5kg, big semovita, semo bag"
          style={styles.input}
        />
      </Field>

      <Field label="Product image URL" hint="Optional for now. Direct photo upload will replace this field later.">
        <TextInput
          value={imageUrl}
          onChangeText={setImageUrl}
          autoCapitalize="none"
          placeholder="https://..."
          style={styles.input}
        />
      </Field>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.editorActions}>
        <Pressable disabled={submitting} onPress={onCancel} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
        <Pressable disabled={submitting} onPress={() => void save()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{submitting ? 'Saving…' : 'Save product'}</Text>
        </Pressable>
      </View>
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
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}{required ? ' *' : ''}</Text>
      {hint ? <Text style={styles.help}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

const styles = StyleSheet.create({
  wrap: { gap: 13, marginTop: 6 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headingCopy: { flex: 1 },
  eyebrow: { color: '#98A2B3', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#101828', fontSize: 21, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 4 },
  addButton: { backgroundColor: '#246BFD', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  addButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  list: { gap: 9 },
  itemCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 15, padding: 13, gap: 8 },
  itemInactive: { opacity: 0.58 },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  itemIdentity: { flex: 1 },
  itemName: { color: '#101828', fontSize: 14, fontWeight: '900' },
  itemMeta: { color: '#98A2B3', fontSize: 10, marginTop: 2 },
  price: { color: '#101828', fontSize: 13, fontWeight: '900' },
  aliasLabel: { color: '#98A2B3', fontSize: 8, fontWeight: '900', letterSpacing: 0.9, marginTop: 3 },
  aliases: { color: '#475467', fontSize: 11, lineHeight: 16 },
  itemActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  actionLinks: { flexDirection: 'row', gap: 14 },
  stateText: { fontSize: 10, fontWeight: '900' },
  activeText: { color: '#027A48' },
  inactiveText: { color: '#667085' },
  link: { color: '#246BFD', fontSize: 11, fontWeight: '800' },
  editorCard: { backgroundColor: '#F9FAFB', borderRadius: 15, borderWidth: 1, borderColor: '#EAECF0', padding: 13, gap: 10 },
  editorTitle: { color: '#101828', fontSize: 15, fontWeight: '900' },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingHorizontal: 11, backgroundColor: '#FFFFFF', color: '#101828' },
  field: { gap: 6 },
  fieldLabel: { color: '#344054', fontSize: 12, fontWeight: '900' },
  help: { color: '#667085', fontSize: 10, lineHeight: 15 },
  editorActions: { flexDirection: 'row', gap: 8 },
  primaryButton: { flex: 1, minHeight: 43, borderRadius: 10, backgroundColor: '#246BFD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 },
  secondaryButton: { flex: 1, minHeight: 43, borderRadius: 10, borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryText: { color: '#344054', fontWeight: '900', fontSize: 12 },
  loadingCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 18, alignItems: 'center', gap: 8 },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 15, borderWidth: 1, borderColor: '#EAECF0', padding: 16, gap: 8 },
  emptyTitle: { color: '#101828', fontSize: 14, fontWeight: '900' },
  emptyText: { color: '#667085', fontSize: 11, lineHeight: 17 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 12, padding: 11, gap: 4 },
  errorText: { color: '#B42318', fontSize: 11, lineHeight: 16 },
  retryText: { color: '#B42318', fontSize: 11, fontWeight: '900' },
  muted: { color: '#667085', fontSize: 11 },
  whatsappCard: { backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#ABEFC6', borderRadius: 16, padding: 14, gap: 10 },
  whatsappHeading: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  whatsappHeadingCopy: { flex: 1 },
  whatsappEyebrow: { color: '#027A48', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  whatsappTitle: { color: '#101828', fontSize: 14, fontWeight: '900', marginTop: 3 },
  whatsappText: { color: '#475467', fontSize: 10, lineHeight: 16, marginTop: 4 },
  whatsappStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  whatsappStatusPill: { backgroundColor: '#D1FADF', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  whatsappStatusText: { color: '#027A48', fontSize: 9, fontWeight: '900' },
  whatsappMeta: { color: '#475467', fontSize: 9, fontWeight: '700', flexShrink: 1 },
  whatsappForm: { gap: 9 },
  whatsappSaveButton: { minHeight: 43, borderRadius: 10, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  whatsappSaveButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  whatsappReadOnly: { color: '#667085', fontSize: 10, lineHeight: 15 },
  importNotice: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 10, gap: 3 },
  importNoticeTitle: { color: '#344054', fontSize: 10, fontWeight: '900' },
  importNoticeText: { color: '#667085', fontSize: 9, lineHeight: 14 },
  whatsappItemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  whatsappItemCopy: { flex: 1 },
  mappingEditor: { backgroundColor: '#F9FAFB', borderRadius: 10, padding: 10, gap: 7 },
  mappingActions: { flexDirection: 'row', gap: 8 },
  mappingSecondary: { flex: 1, minHeight: 38, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  mappingPrimary: { flex: 1, minHeight: 38, backgroundColor: '#12B76A', borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
