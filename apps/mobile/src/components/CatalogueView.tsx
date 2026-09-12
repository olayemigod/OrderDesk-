import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import { ChatCatalogueReviewSection } from './ChatCatalogueReviewSection';
import type { CatalogueItem, CatalogueItemInput } from '../data/catalogueRepository';
import { uploadCatalogueImage } from '../data/catalogueRepository';
import {
  configureWhatsAppCatalogue,
  loadWhatsAppCatalogueStatus,
  mapWhatsAppCatalogueItem,
  unmapWhatsAppCatalogueItem,
  type WhatsAppCatalogueStatus,
} from '../data/whatsappCatalogueRepository';
import { useCatalogue } from '../hooks/useCatalogue';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

export function CatalogueView({ business }: { business: MerchantBusiness }) {
  const appearance = useSellerTrayAppearance();
  const { items, loading, error, refresh, createItem, editItem, setActive } = useCatalogue(business.id);
  const [editing, setEditing] = useState<CatalogueItem | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [showWhatsAppTools, setShowWhatsAppTools] = useState(false);
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
  const activeCount = items.filter((item) => item.isActive).length;
  const mappedCount = items.filter((item) => Boolean(item.whatsappProductRetailerId)).length;
  const categories = useMemo(
    () => Array.from(new Set(
      items.map((item) => item.category?.trim()).filter((value): value is string => Boolean(value)),
    )).sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    const matchesCategory = categoryFilter === 'all' || item.category?.toLowerCase() === categoryFilter.toLowerCase();
    if (!matchesCategory) return false;
    if (!normalizedQuery) return true;
    return [
      item.name,
      item.sku ?? '',
      item.category ?? '',
      ...item.aliases,
    ].join(' ').toLowerCase().includes(normalizedQuery);
  });

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
          <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>CATALOGUE & PRICING</Text>
          <Text style={[styles.title, appearance.dark && darkStyles.titleText, appearance.textSize === 'large' && styles.titleLarge]}>Products customers can order</Text>
          <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>
            Keep this lightweight: Add clear product details and the words customers commonly use on WhatsApp.
          </Text>
        </View>
        {canEdit && editing === null ? (
          <Pressable onPress={() => setEditing('new')} style={styles.addButton}>
            <Text style={styles.addButtonText}>+ Add product</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.catalogueSummaryRow}>
        <CatalogueStat icon="cube-outline" label="Products" value={items.length} />
        <CatalogueStat icon="checkmark-circle-outline" label="Active" value={activeCount} positive />
        <CatalogueStat icon="logo-whatsapp" label="WA mapped" value={mappedCount} />
      </View>

      <View style={styles.searchRow}>
        <View style={[styles.searchBox, appearance.dark && darkStyles.input]}>
          <Ionicons name="search-outline" size={19} color="#667085" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search products, categories or SKU"
            placeholderTextColor="#98A2B3"
            autoCorrect={false}
            style={[styles.searchInputEmbedded, appearance.dark && darkStyles.inputText]}
          />
        </View>
        <Pressable
          onPress={() => setShowFilters((value) => !value)}
          style={[styles.filterIconButton, appearance.dark && darkStyles.outlineButton, showFilters && styles.filterIconButtonActive]}
          accessibilityLabel="Catalogue filters"
        >
          <Ionicons name="options-outline" size={21} color={showFilters ? '#FFFFFF' : '#102A43'} />
        </Pressable>
      </View>

      {showFilters ? (
        <View style={[styles.filterPanel, appearance.dark && darkStyles.card]}>
          <Text style={[styles.filterTitle, appearance.dark && darkStyles.titleText]}>Filter by category</Text>
          <View style={styles.categoryChips}>
            <CategoryChip label="All" active={categoryFilter === 'all'} onPress={() => setCategoryFilter('all')} />
            {categories.map((category) => (
              <CategoryChip
                key={category}
                label={category}
                active={categoryFilter === category}
                onPress={() => setCategoryFilter(category)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.whatsappSummaryCard, appearance.dark && darkStyles.mintCard]}>
        <View style={styles.whatsappSummaryCopy}>
          <Text style={styles.whatsappEyebrow}>WHATSAPP CATALOGUE</Text>
          <Text style={[styles.whatsappSummaryTitle, appearance.dark && darkStyles.titleText]}>
            {whatsappStatus?.settings ? 'Catalogue connection configured' : 'Optional catalogue connection'}
          </Text>
          <Text style={[styles.whatsappSummaryText, appearance.dark && darkStyles.bodyText]}>
            Keep product management simple. Open mapping tools only when connecting SellerTray products to a Meta catalogue.
          </Text>
        </View>
        <Pressable onPress={() => setShowWhatsAppTools((value) => !value)} style={styles.manageMappingButton}>
          <Text style={styles.manageMappingButtonText}>{showWhatsAppTools ? 'Hide' : 'Manage'}</Text>
        </Pressable>
      </View>

      {showWhatsAppTools ? (
      <View style={[styles.whatsappCard, appearance.dark && darkStyles.card]}>
        <View style={styles.whatsappHeading}>
          <View style={styles.whatsappHeadingCopy}>
            <Text style={styles.whatsappEyebrow}>WHATSAPP CATALOGUE</Text>
            <Text style={[styles.whatsappTitle, appearance.dark && darkStyles.titleText]}>
              {whatsappStatus?.settings ? 'Catalogue mapping active' : 'Connect your product catalogue'}
            </Text>
            <Text style={[styles.whatsappText, appearance.dark && darkStyles.bodyText]}>
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
            <Text style={[styles.whatsappMeta, appearance.dark && darkStyles.bodyText]}>
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
                style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]}
              />
            </Field>
            <Field label="Catalogue name" hint="Optional merchant-friendly label.">
              <TextInput
                value={catalogNameDraft}
                onChangeText={setCatalogNameDraft}
                placeholder="e.g. Main WhatsApp Catalogue"
                style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]}
              />
            </Field>
            <Pressable disabled={catalogSaving || whatsappLoading} onPress={() => void saveWhatsAppCatalogue()} style={[styles.whatsappSaveButton, (catalogSaving || whatsappLoading) && styles.disabled]}>
              <Text style={styles.whatsappSaveButtonText}>{catalogSaving ? 'Saving…' : whatsappStatus?.settings ? 'Update catalogue connection' : 'Save catalogue connection'}</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.whatsappReadOnly}>Only the business Owner or Manager can change WhatsApp catalogue mappings.</Text>
        )}

        <View style={[styles.importNotice, appearance.dark && darkStyles.infoCard]}>
          <Text style={[styles.importNoticeTitle, appearance.dark && darkStyles.titleText]}>Automatic Meta catalogue import is not active yet</Text>
          <Text style={[styles.importNoticeText, appearance.dark && darkStyles.bodyText]}>
            SellerTray will not read or sync a merchant's Meta catalogue using a shared platform credential. Automatic import will only be enabled after tenant-specific Meta asset authorization is verified.
          </Text>
        </View>

        {whatsappError ? <Text style={styles.errorText}>{whatsappError}</Text> : null}
        <Pressable disabled={whatsappLoading || catalogSaving || mappingBusy} onPress={() => void refreshWhatsAppCatalogue()}>
          <Text style={styles.retryText}>Refresh WhatsApp catalogue status</Text>
        </Pressable>
      </View>
      ) : null}

      <ChatCatalogueReviewSection
        business={business}
        onCatalogueChanged={refresh}
      />

      {error ? (
        <View style={[styles.errorCard, appearance.dark && darkStyles.errorCard]}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void refresh()}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      ) : null}

      {editing ? (
        <CatalogueEditor
          key={editing === 'new' ? 'new' : editing.id}
          item={editing === 'new' ? null : editing}
          currency={business.currency}
          tenantId={business.id}
          categories={categories}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === 'new') await createItem(input);
            else await editItem(editing.id, input);
            setEditing(null);
          }}
        />
      ) : null}

      {loading && items.length === 0 ? (
        <View style={[styles.loadingCard, appearance.dark && darkStyles.card]}><ActivityIndicator /><Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Loading catalogue…</Text></View>
      ) : null}

      {!loading && items.length === 0 && !editing ? (
        <View style={[styles.emptyCard, appearance.dark && darkStyles.card]}>
          <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>Your catalogue is empty</Text>
          <Text style={[styles.emptyText, appearance.dark && darkStyles.bodyText]}>
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
        {visibleItems.map((item) => (
          <View key={item.id} style={[styles.itemCard, appearance.dark && darkStyles.card, !item.isActive && styles.itemInactive]}>
            <View style={styles.itemTop}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.itemImage} resizeMode="cover" />
              ) : (
                <View style={styles.itemImageFallback}>
                  <Ionicons name="cube-outline" size={22} color="#079455" />
                </View>
              )}
              <View style={styles.itemIdentity}>
                <Text style={[styles.itemName, appearance.dark && darkStyles.titleText]}>{item.name}</Text>
                <Text style={[styles.itemMeta, appearance.dark && darkStyles.bodyText]}>
                  {[item.category, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(' · ') || 'Uncategorised'}
                </Text>
              </View>
              <Text style={[styles.price, appearance.dark && darkStyles.titleText]}>{item.price === null ? 'No price' : money(item.price, business.currency)}</Text>
            </View>

            <Text style={[styles.aliasLabel, appearance.dark && darkStyles.mutedText]}>CUSTOMER WORDS</Text>
            <Text style={[styles.aliases, appearance.dark && darkStyles.bodyText]}>{item.aliases.length ? item.aliases.join(', ') : 'No aliases yet'}</Text>

            <View style={styles.whatsappItemRow}>
              <View style={styles.whatsappItemCopy}>
                <Text style={[styles.aliasLabel, appearance.dark && darkStyles.mutedText]}>WHATSAPP PRODUCT</Text>
                <Text style={[styles.aliases, appearance.dark && darkStyles.bodyText]}>
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
              <View style={[styles.mappingEditor, appearance.dark && darkStyles.subtleCard]}>
                <Text style={styles.fieldLabel}>Product retailer ID</Text>
                <Text style={styles.help}>
                  Enter the exact product_retailer_id used for this item in the connected WhatsApp Business catalogue.
                </Text>
                <TextInput
                  value={retailerIdDraft}
                  onChangeText={setRetailerIdDraft}
                  autoCapitalize="none"
                  placeholder="e.g. SEM-5KG"
                  style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]}
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

function CatalogueStat({ icon, label, value, positive = false }: { icon: string; label: string; value: number; positive?: boolean }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.catalogueSummaryCard, appearance.dark && darkStyles.card]}>
      <View style={[styles.catalogueStatIcon, positive && styles.catalogueStatIconPositive]}>
        <Ionicons name={icon as never} size={20} color={positive ? '#079455' : '#102A43'} />
      </View>
      <Text style={[styles.catalogueSummaryValue, appearance.dark && darkStyles.titleText]}>{value}</Text>
      <Text style={[styles.catalogueSummaryLabel, appearance.dark && darkStyles.bodyText]}>{label}</Text>
    </View>
  );
}

function CategoryChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable onPress={onPress} style={[styles.categoryChip, appearance.dark && darkStyles.outlineButton, active && styles.categoryChipActive]}>
      <Text style={[styles.categoryChipText, appearance.dark && darkStyles.bodyText, active && styles.categoryChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CatalogueEditor({
  item,
  currency,
  tenantId,
  categories,
  onSave,
  onCancel,
}: {
  item: CatalogueItem | null;
  currency: string;
  tenantId: string;
  categories: string[];
  onSave: (input: CatalogueItemInput) => Promise<void>;
  onCancel: () => void;
}) {
  const appearance = useSellerTrayAppearance();
  const [name, setName] = useState(item?.name ?? '');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [customCategory, setCustomCategory] = useState('');
  const [price, setPrice] = useState(item?.price === null || item?.price === undefined ? '' : String(item.price));
  const [aliases, setAliases] = useState(item?.aliases.join(', ') ?? '');
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? '');
  const [imageUploading, setImageUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [item?.id]);

  async function chooseProductImage() {
    if (imageUploading || submitting) return;
    setError(null);

    if (Platform.OS === 'ios') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Allow photo access to choose a product image.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.82,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setImageUploading(true);
    try {
      const url = await uploadCatalogueImage(
        tenantId,
        asset.uri,
        asset.mimeType ?? 'image/jpeg',
      );
      setImageUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload the selected product image.');
    } finally {
      setImageUploading(false);
    }
  }

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
        category: category ? normalizeCategory(category) : null,
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
    <View style={[styles.editorCard, appearance.dark && darkStyles.card]}>
      <Text style={[styles.editorTitle, appearance.dark && darkStyles.titleText]}>{item ? 'Edit product' : 'Add product'}</Text>
      <Field label="Product name" required hint="Use the name customers and staff will easily recognise.">
        <TextInput value={name} onChangeText={setName} placeholder="e.g. Golden Penny Semovita 5kg" style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]} />
      </Field>

      <Field label="Selling price" required hint={`Amount charged to the customer in ${currency}.`}>
        <TextInput
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="e.g. 12500"
          style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]}
        />
      </Field>

      <Field label="Category" hint="Use a consistent category so sales and product reports group correctly.">
        <Pressable
          onPress={() => setShowCategoryPicker((value) => !value)}
          style={styles.categorySelect}
        >
          <Text style={[styles.categorySelectText, appearance.dark && darkStyles.inputText, !category && styles.categorySelectPlaceholder]}>
            {category || 'Choose category'}
          </Text>
          <Ionicons name={showCategoryPicker ? 'chevron-up' : 'chevron-down'} size={19} color="#667085" />
        </Pressable>
        {showCategoryPicker ? (
          <View style={[styles.categoryPicker, appearance.dark && darkStyles.card]}>
            {catalogueCategoryOptions(categories).map((option) => (
              <Pressable
                key={option}
                onPress={() => {
                  setCategory(option);
                  setCustomCategory('');
                  setShowCategoryPicker(false);
                }}
                style={[styles.categoryOption, appearance.dark && darkStyles.rowBorder, category === option && styles.categoryOptionActive]}
              >
                <Text style={[styles.categoryOptionText, appearance.dark && darkStyles.bodyText, category === option && styles.categoryOptionTextActive]}>{option}</Text>
                {category === option ? <Ionicons name="checkmark" size={18} color="#079455" /> : null}
              </Pressable>
            ))}
            <View style={styles.customCategoryWrap}>
              <Text style={styles.help}>Add a category not listed above</Text>
              <View style={styles.customCategoryRow}>
                <TextInput
                  value={customCategory}
                  onChangeText={setCustomCategory}
                  placeholder="e.g. Pet Supplies"
                  style={[styles.input, styles.customCategoryInput]}
                />
                <Pressable
                  disabled={!customCategory.trim()}
                  onPress={() => {
                    const next = normalizeCategory(customCategory);
                    setCategory(next);
                    setCustomCategory('');
                    setShowCategoryPicker(false);
                  }}
                  style={[styles.customCategoryButton, !customCategory.trim() && styles.disabled]}
                >
                  <Text style={styles.customCategoryButtonText}>Use</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </Field>

      <Field label="SKU / product code" hint="Optional internal product code.">
        <TextInput value={sku} onChangeText={setSku} placeholder="e.g. SEM-5KG" style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]} />
      </Field>

      <Field label="Customer words / aliases" hint="Optional. Add other names customers may type on WhatsApp, separated by commas.">
        <TextInput
          value={aliases}
          onChangeText={setAliases}
          placeholder="e.g. semo 5kg, big semovita, semo bag"
          style={[styles.input, appearance.dark && darkStyles.input, appearance.dark && darkStyles.inputText]}
        />
      </Field>

      <Field label="Product image" hint="Choose a clear square image from your phone gallery. JPEG, PNG and WebP up to 5 MB.">
        {imageUrl ? (
          <View style={styles.productImagePreviewWrap}>
            <Image source={{ uri: imageUrl }} style={styles.productImagePreview} resizeMode="cover" />
            <Pressable onPress={() => setImageUrl('')} style={styles.removeImageButton}>
              <Ionicons name="trash-outline" size={18} color="#B42318" />
              <Text style={styles.removeImageText}>Remove</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable
          disabled={imageUploading || submitting}
          onPress={() => void chooseProductImage()}
          style={[styles.galleryButton, (imageUploading || submitting) && styles.disabled]}
        >
          {imageUploading ? (
            <ActivityIndicator color="#079455" />
          ) : (
            <Ionicons name="images-outline" size={20} color="#079455" />
          )}
          <Text style={styles.galleryButtonText}>
            {imageUploading ? 'Uploading image…' : imageUrl ? 'Choose another image' : 'Choose from gallery'}
          </Text>
        </Pressable>
      </Field>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.editorActions}>
        <Pressable disabled={submitting || imageUploading} onPress={onCancel} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
        <Pressable disabled={submitting || imageUploading} onPress={() => void save()} style={[styles.primaryButton, imageUploading && styles.disabled]}>
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

const DEFAULT_CATEGORIES = [
  'Apparel',
  'Beauty',
  'Electronics',
  'Food & Drinks',
  'Groceries',
  'Health & Wellness',
  'Home & Living',
  'Pet Supplies',
  'Services',
  'Other',
];

function normalizeCategory(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part)
    .join(' ');
}

function catalogueCategoryOptions(existing: string[]): string[] {
  const map = new Map<string, string>();
  [...DEFAULT_CATEGORIES, ...existing].forEach((value) => {
    const normalized = normalizeCategory(value);
    map.set(normalized.toLowerCase(), normalized);
  });
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

const styles = StyleSheet.create({
  wrap: { gap: 13, marginTop: 6 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  catalogueSummaryRow: { flexDirection: 'row', gap: 7 },
  catalogueSummaryCard: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 11, minWidth: 0, gap: 3 },
  catalogueStatIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  catalogueStatIconPositive: { backgroundColor: '#ECFDF3' },
  catalogueSummaryValue: { color: '#102A43', fontSize: 21, fontWeight: '900' },
  catalogueSummaryLabel: { color: '#667085', fontSize: 10, fontWeight: '900', letterSpacing: 0.3, marginTop: 2 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBox: { flex: 1, minHeight: 50, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInputEmbedded: { flex: 1, minHeight: 48, color: '#102A43', fontSize: 14, paddingVertical: 0 },
  filterIconButton: { width: 50, height: 50, borderRadius: 14, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  filterIconButtonActive: { backgroundColor: '#102A43', borderColor: '#102A43' },
  filterPanel: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 15, padding: 12, gap: 10 },
  filterTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  categoryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryChip: { minHeight: 36, borderRadius: 999, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  categoryChipActive: { borderColor: '#12B76A', backgroundColor: '#ECFDF3' },
  categoryChipText: { color: '#667085', fontSize: 12, fontWeight: '800' },
  categoryChipTextActive: { color: '#079455' },
  whatsappSummaryCard: { backgroundColor: '#ECFDF3', borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  whatsappSummaryCopy: { flex: 1 },
  whatsappSummaryTitle: { color: '#102A43', fontSize: 12, fontWeight: '900', marginTop: 2 },
  whatsappSummaryText: { color: '#475467', fontSize: 9, lineHeight: 14, marginTop: 3 },
  manageMappingButton: { minHeight: 36, borderRadius: 10, backgroundColor: '#FFFFFF', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  manageMappingButtonText: { color: '#079455', fontSize: 10, fontWeight: '900' },
  headingCopy: { flex: 1 },
  eyebrow: { color: '#667085', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 27, lineHeight: 33, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 4 },
  addButton: { backgroundColor: '#12B76A', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  addButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  list: { gap: 9 },
  itemCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 15, padding: 13, gap: 8 },
  itemInactive: { opacity: 0.58 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemImage: { width: 52, height: 52, borderRadius: 13, backgroundColor: '#F2F4F7' },
  itemImageFallback: { width: 52, height: 52, borderRadius: 13, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  itemIdentity: { flex: 1 },
  itemName: { color: '#102A43', fontSize: 16, fontWeight: '900' },
  itemMeta: { color: '#667085', fontSize: 12, marginTop: 2 },
  price: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  aliasLabel: { color: '#667085', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginTop: 3 },
  aliases: { color: '#475467', fontSize: 13, lineHeight: 19 },
  itemActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  actionLinks: { flexDirection: 'row', gap: 14 },
  stateText: { fontSize: 10, fontWeight: '900' },
  activeText: { color: '#027A48' },
  inactiveText: { color: '#667085' },
  link: { color: '#12B76A', fontSize: 11, fontWeight: '800' },
  editorCard: { backgroundColor: '#F9FAFB', borderRadius: 15, borderWidth: 1, borderColor: '#E4E7EC', padding: 13, gap: 10 },
  editorTitle: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingHorizontal: 11, backgroundColor: '#FFFFFF', color: '#102A43' },
  field: { gap: 6 },
  fieldLabel: { color: '#344054', fontSize: 13, fontWeight: '900' },
  help: { color: '#667085', fontSize: 12, lineHeight: 18 },
  categorySelect: { minHeight: 47, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, paddingHorizontal: 12, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  categorySelectText: { color: '#102A43', fontSize: 14, fontWeight: '700' },
  categorySelectPlaceholder: { color: '#98A2B3', fontWeight: '500' },
  categoryPicker: { borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 12, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  categoryOption: { minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E4E7EC' },
  categoryOptionActive: { backgroundColor: '#ECFDF3' },
  categoryOptionText: { color: '#475467', fontSize: 13, fontWeight: '700' },
  categoryOptionTextActive: { color: '#079455', fontWeight: '900' },
  customCategoryWrap: { padding: 10, gap: 7, backgroundColor: '#F9FAFB' },
  customCategoryRow: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  customCategoryInput: { flex: 1 },
  customCategoryButton: { minHeight: 44, borderRadius: 10, backgroundColor: '#12B76A', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  customCategoryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  productImagePreviewWrap: { gap: 8 },
  productImagePreview: { width: 132, height: 132, borderRadius: 14, backgroundColor: '#F2F4F7' },
  removeImageButton: { alignSelf: 'flex-start', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, backgroundColor: '#FEF3F2', paddingHorizontal: 10 },
  removeImageText: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  galleryButton: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: '#ECFDF3', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  galleryButtonText: { color: '#079455', fontSize: 13, fontWeight: '900' },
  editorActions: { flexDirection: 'row', gap: 8 },
  primaryButton: { flex: 1, minHeight: 43, borderRadius: 10, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 },
  secondaryButton: { flex: 1, minHeight: 43, borderRadius: 10, borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryText: { color: '#344054', fontWeight: '900', fontSize: 12 },
  loadingCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 18, alignItems: 'center', gap: 8 },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 15, borderWidth: 1, borderColor: '#E4E7EC', padding: 16, gap: 8 },
  emptyTitle: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  emptyText: { color: '#667085', fontSize: 11, lineHeight: 17 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 12, padding: 11, gap: 4 },
  errorText: { color: '#B42318', fontSize: 11, lineHeight: 16 },
  retryText: { color: '#B42318', fontSize: 11, fontWeight: '900' },
  muted: { color: '#667085', fontSize: 11 },
  whatsappCard: { backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#ABEFC6', borderRadius: 16, padding: 14, gap: 10 },
  whatsappHeading: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  whatsappHeadingCopy: { flex: 1 },
  whatsappEyebrow: { color: '#027A48', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  whatsappTitle: { color: '#102A43', fontSize: 14, fontWeight: '900', marginTop: 3 },
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
