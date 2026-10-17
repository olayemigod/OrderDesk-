import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import {
  convertChatCatalogueCandidate,
  createChatCatalogueCandidate,
  loadChatCatalogueCaptures,
  previewChatCatalogueCapture,
  rejectChatCatalogueCandidate,
  type ChatCatalogueCapture,
  type ChatCatalogueCandidate,
} from '../data/chatCatalogueRepository';

export function ChatCatalogueReviewSection({
  business,
  onCatalogueChanged,
}: {
  business: MerchantBusiness;
  onCatalogueChanged: () => Promise<void>;
}) {
  const appearance = useSellerTrayAppearance();
  const canEdit = business.role === 'owner' || business.role === 'manager';
  const [captures, setCaptures] = useState<ChatCatalogueCapture[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editorCapture, setEditorCapture] = useState<ChatCatalogueCapture | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!canEdit) {
      setCaptures([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setCaptures(await loadChatCatalogueCaptures(business.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load WhatsApp product-image captures.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [business.id, canEdit]);

  async function review(capture: ChatCatalogueCapture) {
    if (!canEdit || busyId) return;

    setBusyId(capture.mediaId);
    setError(null);
    try {
      let previewUrl = capture.previewUrl;
      if (!previewUrl) {
        previewUrl = await previewChatCatalogueCapture(business.id, capture.inboundMessageId);
      }

      let candidate: ChatCatalogueCandidate | null = capture.candidate;
      if (!candidate) {
        candidate = await createChatCatalogueCandidate(business.id, capture.inboundMessageId);
      }

      const next = { ...capture, previewUrl, candidate };
      setCaptures((current) => current.map((item) => item.mediaId === capture.mediaId ? next : item));
      setEditorCapture(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to prepare this WhatsApp image for review.');
    } finally {
      setBusyId(null);
    }
  }

  if (!canEdit) return null;

  return (
    <View style={[styles.card, appearance.dark && darkStyles.card]}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>FROM WHATSAPP CHATS</Text>
          <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Review product images customers send</Text>
          <Text style={[styles.text, appearance.dark && darkStyles.bodyText]}>
            Images stay private while you review them. SellerTray only publishes an image after you explicitly create the product.
          </Text>
        </View>
        {loading ? <ActivityIndicator size="small" /> : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && captures.length === 0 ? (
        <View style={[styles.empty, appearance.dark && darkStyles.subtleCard]}>
          <Text style={[styles.emptyTitle, appearance.dark && darkStyles.titleText]}>No product-image captures waiting</Text>
          <Text style={[styles.emptyText, appearance.dark && darkStyles.bodyText]}>
            When a customer sends an image on the connected WhatsApp number, eligible captures appear here for Owner or Manager review.
          </Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {captures.map((capture) => (
          <View key={capture.mediaId} style={[styles.capture, appearance.dark && darkStyles.subtleCard]}>
            {capture.previewUrl ? (
              <Image source={{ uri: capture.previewUrl }} style={styles.image} resizeMode="cover" />
            ) : (
              <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>Private preview not loaded</Text>
              </View>
            )}

            <View style={styles.body}>
              <Text style={styles.customer}>
                {capture.customerName || capture.customerWaId || 'WhatsApp customer'}
              </Text>
              <Text style={[styles.caption, appearance.dark && darkStyles.bodyText]}>
                {capture.caption || 'Customer sent a product image without a caption.'}
              </Text>
              <Text style={[styles.meta, appearance.dark && darkStyles.mutedText]}>
                {formatDate(capture.createdAt)} · Expires {formatDate(capture.expiresAt)}
              </Text>

              <Pressable
                disabled={busyId !== null}
                onPress={() => void review(capture)}
                style={[styles.reviewButton, busyId === capture.mediaId && styles.disabled]}
              >
                <Text style={styles.reviewButtonText}>
                  {busyId === capture.mediaId
                    ? 'Preparing…'
                    : capture.candidate
                      ? 'Continue product review'
                      : capture.previewUrl
                        ? 'Use this image as a product'
                        : 'Preview and review'}
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <Pressable disabled={loading || busyId !== null} onPress={() => void refresh()}>
        <Text style={styles.refresh}>Refresh WhatsApp image captures</Text>
      </Pressable>

      {editorCapture?.candidate ? (
        <ProductReviewEditor
          key={editorCapture.candidate.id}
          tenantId={business.id}
          capture={editorCapture as ChatCatalogueCapture & { candidate: ChatCatalogueCandidate }}
          currency={business.currency}
          onCancel={() => setEditorCapture(null)}
          onChanged={async () => {
            setEditorCapture(null);
            await Promise.all([onCatalogueChanged(), refresh()]);
          }}
        />
      ) : null}
    </View>
  );
}

function ProductReviewEditor({
  tenantId,
  capture,
  currency,
  onCancel,
  onChanged,
}: {
  tenantId: string;
  capture: ChatCatalogueCapture & { candidate: ChatCatalogueCandidate };
  currency: string;
  onCancel: () => void;
  onChanged: () => Promise<void>;
}) {
  const appearance = useSellerTrayAppearance();
  const [name, setName] = useState(capture.candidate.suggested_name || capture.caption || '');
  const [price, setPrice] = useState(
    capture.candidate.suggested_price_ngn === null || capture.candidate.suggested_price_ngn === undefined
      ? ''
      : String(capture.candidate.suggested_price_ngn),
  );
  const [category, setCategory] = useState(capture.candidate.suggested_category || '');
  const [sku, setSku] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    const amount = Number(price);
    if (!name.trim()) return setError('Product name is required.');
    if (!price.trim() || !Number.isFinite(amount) || amount < 0) {
      return setError('Enter a valid selling price.');
    }

    setBusy(true);
    setError(null);
    try {
      await convertChatCatalogueCandidate(tenantId, capture.candidate.id, {
        name: name.trim(),
        priceNgn: amount,
        category: category.trim() || null,
        sku: sku.trim() || null,
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create this catalogue product.');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      await rejectChatCatalogueCandidate(
        tenantId,
        capture.candidate.id,
        'Merchant rejected chat-image catalogue candidate',
      );
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to dismiss this catalogue candidate.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.editor, appearance.dark && darkStyles.card]}>
      <Text style={styles.eyebrow}>WHATSAPP PRODUCT REVIEW</Text>
      <Text style={[styles.editorTitle, appearance.dark && darkStyles.titleText]}>Create catalogue product</Text>
      <Text style={[styles.help, appearance.dark && darkStyles.bodyText]}>
        Review the image and details before publishing. Nothing is added to the live catalogue until you tap Create product.
      </Text>

      {capture.previewUrl ? (
        <Image source={{ uri: capture.previewUrl }} style={styles.editorImage} resizeMode="cover" />
      ) : null}

      <Field label="Product name" required>
        <TextInput value={name} onChangeText={setName} placeholder="Product name" style={[styles.input, appearance.dark && darkStyles.input]} />
      </Field>
      <Field label="Selling price" required hint={`Amount charged to the customer in ${currency}.`}>
        <TextInput
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="e.g. 12500"
          style={[styles.input, appearance.dark && darkStyles.input]}
        />
      </Field>
      <Field label="Category" hint="Optional.">
        <TextInput value={category} onChangeText={setCategory} placeholder="e.g. Groceries" style={[styles.input, appearance.dark && darkStyles.input]} />
      </Field>
      <Field label="SKU / product code" hint="Optional.">
        <TextInput value={sku} onChangeText={setSku} placeholder="e.g. SEM-5KG" style={[styles.input, appearance.dark && darkStyles.input]} />
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Pressable disabled={busy} onPress={() => void dismiss()} style={styles.dismissButton}>
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={onCancel} style={[styles.secondaryButton, appearance.dark && darkStyles.outlineButton]}>
          <Text style={[styles.secondaryText, appearance.dark && darkStyles.titleText]}>Cancel</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => void publish()} style={styles.primaryButton}>
          <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Create product'}</Text>
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

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 16, padding: 14, gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headingCopy: { flex: 1 },
  eyebrow: { color: '#079455', fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#102A43', fontSize: 14, fontWeight: '900', marginTop: 3 },
  text: { color: '#475467', fontSize: 12, lineHeight: 16, marginTop: 4 },
  error: { color: '#B42318', fontSize: 12, lineHeight: 15 },
  empty: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 11, gap: 3 },
  emptyTitle: { color: '#344054', fontSize: 13, fontWeight: '900' },
  emptyText: { color: '#667085', fontSize: 12, lineHeight: 14 },
  list: { gap: 10 },
  capture: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 12, overflow: 'hidden' },
  image: { width: '100%', height: 180, backgroundColor: '#F2F4F7' },
  placeholder: { height: 100, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center', padding: 12 },
  placeholderText: { color: '#667085', fontSize: 12, fontWeight: '800' },
  body: { padding: 11, gap: 5 },
  customer: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  caption: { color: '#475467', fontSize: 12, lineHeight: 15 },
  meta: { color: '#667085', fontSize: 12, lineHeight: 18 },
  reviewButton: { minHeight: 40, backgroundColor: '#12B76A', borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  reviewButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  refresh: { color: '#12B76A', fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  editor: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#6CE9A6', borderRadius: 14, padding: 12, gap: 9 },
  editorTitle: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  editorImage: { width: '100%', height: 220, borderRadius: 11, backgroundColor: '#F2F4F7' },
  field: { gap: 6 },
  fieldLabel: { color: '#344054', fontSize: 13, fontWeight: '900' },
  help: { color: '#667085', fontSize: 12, lineHeight: 14 },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingHorizontal: 11, backgroundColor: '#FFFFFF', color: '#102A43' },
  actions: { flexDirection: 'row', gap: 7 },
  dismissButton: { flex: 1, minHeight: 43, borderRadius: 10, backgroundColor: '#FEF3F2', borderWidth: 1, borderColor: '#FECDCA', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  dismissText: { color: '#B42318', fontWeight: '900', fontSize: 13 },
  secondaryButton: { flex: 1, minHeight: 43, borderRadius: 10, borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  secondaryText: { color: '#344054', fontWeight: '900', fontSize: 13 },
  primaryButton: { flex: 1, minHeight: 43, borderRadius: 10, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  primaryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#475467' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  mutedText: { color: '#98A2B3' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#98A2B3', color: '#102A43' },
  outlineButton: { backgroundColor: '#162F46', borderColor: '#475467' },
});
