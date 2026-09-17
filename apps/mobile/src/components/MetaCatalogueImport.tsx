import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  commitMetaCatalogueImport,
  previewMetaCatalogueImport,
  type MetaCatalogueImportPreview,
  type MetaCatalogueImportOperation,
} from '../data/metaCatalogueImportRepository';
import {
  loadWhatsAppCatalogueStatus,
  type WhatsAppCatalogueStatus,
} from '../data/whatsappCatalogueRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  currency: string;
  onImported: () => Promise<void> | void;
};

export function MetaCatalogueImport({ tenantId, currency, onImported }: Props) {
  const appearance = useSellerTrayAppearance();
  const [status, setStatus] = useState<WhatsAppCatalogueStatus | null>(null);
  const [preview, setPreview] = useState<MetaCatalogueImportPreview | null>(null);
  const [busy, setBusy] = useState<'status' | 'preview' | 'commit' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus() {
    setBusy('status');
    setError(null);
    try {
      setStatus(await loadWhatsAppCatalogueStatus(tenantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify Meta catalogue readiness.');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, [tenantId]);

  async function runPreview() {
    if (busy) return;
    setBusy('preview');
    setError(null);
    setMessage(null);
    try {
      const result = await previewMetaCatalogueImport(tenantId);
      setPreview(result);
      setMessage(
        result.summary.error > 0
          ? 'Preview found ' + result.summary.error + ' conflict' + (result.summary.error === 1 ? '' : 's') + '. Nothing has been changed.'
          : 'Preview is ready. SellerTray has not changed your catalogue yet.',
      );
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Unable to preview the Meta catalogue.');
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (busy || !preview || preview.summary.error > 0) return;
    setBusy('commit');
    setError(null);
    setMessage(null);
    try {
      const result = await commitMetaCatalogueImport(tenantId, preview.fingerprint);
      await onImported();
      const nextStatus = await loadWhatsAppCatalogueStatus(tenantId);
      setStatus(nextStatus);
      setPreview(null);
      setMessage(
        'Meta import complete: ' +
        result.summary.create + ' created, ' +
        result.summary.update + ' updated, ' +
        result.summary.link + ' linked by SKU, ' +
        result.summary.preserveManual + ' manual mapping' + (result.summary.preserveManual === 1 ? '' : 's') + ' preserved.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import the Meta catalogue.');
    } finally {
      setBusy(null);
    }
  }

  const readiness = status?.importReadiness;
  const ready = readiness?.importReady === true;

  return (
    <View style={[styles.card, appearance.dark && darkStyles.card]}>
      <Text style={[styles.eyebrow, appearance.dark && darkStyles.muted]}>META CATALOGUE</Text>
      <Text style={[styles.title, appearance.dark && darkStyles.title]}>Import from WhatsApp / Meta catalogue</Text>
      <Text style={[styles.body, appearance.dark && darkStyles.body]}>
        SellerTray reads the catalogue connected to this business, previews every change, and imports only after you confirm. Manual mappings are never overwritten automatically.
      </Text>

      <View style={[styles.readinessCard, ready && styles.readinessReady, appearance.dark && darkStyles.subtle]}>
        <Text style={[styles.readinessTitle, appearance.dark && darkStyles.title]}>
          {ready ? 'Meta catalogue access verified' : 'Meta catalogue import not ready'}
        </Text>
        <Text style={[styles.readinessText, appearance.dark && darkStyles.body]}>
          {ready
            ? 'SellerTray verified the tenant credential, Meta catalogue permissions and read access to the configured catalogue.'
            : readiness?.reason ?? 'Checking WhatsApp and Meta catalogue permissions…'}
        </Text>
        {!ready ? (
          <Pressable disabled={Boolean(busy)} onPress={() => void refreshStatus()} style={styles.linkButton}>
            <Text style={styles.linkButtonText}>{busy === 'status' ? 'Checking…' : 'Refresh readiness'}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.rulesCard, appearance.dark && darkStyles.subtle]}>
        <Text style={[styles.ruleTitle, appearance.dark && darkStyles.title]}>Safe import rules</Text>
        <Text style={[styles.ruleText, appearance.dark && darkStyles.body]}>• Meta retailer ID is the external product identity.</Text>
        <Text style={[styles.ruleText, appearance.dark && darkStyles.body]}>• Existing SKU can link only when it exactly matches the Meta retailer ID.</Text>
        <Text style={[styles.ruleText, appearance.dark && darkStyles.body]}>• Same-name products are never merged automatically.</Text>
        <Text style={[styles.ruleText, appearance.dark && darkStyles.body]}>• Out-of-stock or discontinued Meta products import as inactive.</Text>
        <Text style={[styles.ruleText, appearance.dark && darkStyles.body]}>• SellerTray re-checks Meta at commit time; changed previews must be reviewed again.</Text>
      </View>

      <Pressable
        disabled={Boolean(busy) || !ready}
        onPress={() => void runPreview()}
        style={[styles.previewButton, (Boolean(busy) || !ready) && styles.disabled]}
      >
        {busy === 'preview' ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
        <Text style={styles.previewButtonText}>{busy === 'preview' ? 'Reading Meta…' : 'Preview Meta catalogue'}</Text>
      </Pressable>

      {message ? (
        <View style={[styles.messageCard, appearance.dark && darkStyles.subtle]}>
          <Text style={[styles.messageText, appearance.dark && darkStyles.body]}>{message}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {preview ? (
        <View style={styles.previewSection}>
          <Text style={[styles.catalogName, appearance.dark && darkStyles.title]}>
            {preview.catalog.name || 'Meta catalogue'} · {preview.catalog.currency || currency}
          </Text>

          <View style={styles.summaryRow}>
            <Summary label="Products" value={preview.summary.total} />
            <Summary label="Create" value={preview.summary.create} />
            <Summary label="Update" value={preview.summary.update} />
            <Summary label="Link" value={preview.summary.link} />
            <Summary label="Keep manual" value={preview.summary.preserveManual} />
            <Summary label="Inactive" value={preview.summary.inactive} />
            <Summary label="Conflicts" value={preview.summary.error} attention={preview.summary.error > 0} />
          </View>

          <View style={styles.previewList}>
            {preview.rows.slice(0, 30).map((row) => (
              <View
                key={(row.metaProductId || row.retailerId) + ':' + row.name}
                style={[
                  styles.previewRow,
                  appearance.dark && darkStyles.row,
                  row.operation === 'error' && styles.previewRowError,
                ]}
              >
                <View style={styles.previewIdentity}>
                  <Text style={[styles.rowName, appearance.dark && darkStyles.title]}>{row.name || 'Unnamed Meta product'}</Text>
                  <Text style={[styles.rowMeta, appearance.dark && darkStyles.body]}>
                    Retailer ID {row.retailerId || 'missing'} · {formatMoney(row.price, row.currency || currency)}
                  </Text>
                  <Text style={[styles.rowMeta, appearance.dark && darkStyles.muted]}>
                    {row.category ? row.category + ' · ' : ''}{row.isActive ? 'Active' : 'Inactive from Meta availability'}
                  </Text>
                  {row.errors.map((item) => (
                    <Text key={item} style={styles.rowError}>• {item}</Text>
                  ))}
                </View>
                <OperationPill operation={row.operation} />
              </View>
            ))}
          </View>

          {preview.rows.length > 30 ? (
            <Text style={[styles.helper, appearance.dark && darkStyles.muted]}>
              Showing first 30 of {preview.rows.length} products.
            </Text>
          ) : null}

          <Pressable
            disabled={Boolean(busy) || preview.summary.error > 0}
            onPress={() => void commit()}
            style={[styles.commitButton, (Boolean(busy) || preview.summary.error > 0) && styles.disabled]}
          >
            {busy === 'commit' ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
            <Text style={styles.commitButtonText}>
              {busy === 'commit'
                ? 'Re-checking and importing…'
                : preview.summary.error > 0
                  ? 'Resolve conflicts before import'
                  : 'Import ' + preview.summary.total + ' Meta products'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function OperationPill({ operation }: { operation: MetaCatalogueImportOperation }) {
  const labels: Record<MetaCatalogueImportOperation, string> = {
    create: 'Create',
    update: 'Update',
    link: 'Link SKU',
    preserve_manual: 'Keep manual',
    error: 'Conflict',
  };
  return (
    <View style={[
      styles.operationPill,
      operation === 'create' && styles.createPill,
      operation === 'update' && styles.updatePill,
      operation === 'link' && styles.linkPill,
      operation === 'preserve_manual' && styles.manualPill,
      operation === 'error' && styles.errorPill,
    ]}>
      <Text style={[styles.operationText, operation === 'error' && styles.errorPillText]}>{labels[operation]}</Text>
    </View>
  );
}

function Summary({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.summaryCard, appearance.dark && darkStyles.subtle, attention && styles.summaryAttention]}>
      <Text style={[styles.summaryValue, appearance.dark && darkStyles.title]}>{value}</Text>
      <Text style={[styles.summaryLabel, appearance.dark && darkStyles.body]}>{label}</Text>
    </View>
  );
}

function formatMoney(value: number, currency: string): string {
  if (!Number.isFinite(value)) return 'Invalid price';
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: currency || 'NGN',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return (currency || 'NGN') + ' ' + value.toFixed(2);
  }
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#B7E4CC', borderRadius: 16, padding: 15, gap: 11 },
  eyebrow: { color: '#087A49', fontSize: 11, fontWeight: '900', letterSpacing: 0.9 },
  title: { color: '#102A43', fontSize: 18, fontWeight: '900' },
  body: { color: '#475467', fontSize: 13, lineHeight: 19 },
  readinessCard: { backgroundColor: '#FFFAEB', borderRadius: 12, padding: 11, gap: 5 },
  readinessReady: { backgroundColor: '#ECFDF3' },
  readinessTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  readinessText: { color: '#475467', fontSize: 12, lineHeight: 18 },
  rulesCard: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 11, gap: 4 },
  ruleTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  ruleText: { color: '#475467', fontSize: 12, lineHeight: 18 },
  linkButton: { alignSelf: 'flex-start', paddingVertical: 3 },
  linkButtonText: { color: '#079455', fontSize: 12, fontWeight: '900' },
  previewButton: { minHeight: 45, backgroundColor: '#102A43', borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  previewButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  messageCard: { backgroundColor: '#ECFDF3', padding: 10, borderRadius: 10 },
  messageText: { color: '#344054', fontSize: 12, lineHeight: 18 },
  errorCard: { backgroundColor: '#FEF3F2', padding: 10, borderRadius: 10 },
  errorText: { color: '#B42318', fontSize: 12, lineHeight: 18 },
  previewSection: { gap: 11 },
  catalogName: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  summaryCard: { minWidth: 70, flexGrow: 1, backgroundColor: '#F8FAFC', borderRadius: 11, padding: 9 },
  summaryAttention: { backgroundColor: '#FEF3F2' },
  summaryValue: { color: '#102A43', fontSize: 18, fontWeight: '900' },
  summaryLabel: { color: '#667085', fontSize: 10, marginTop: 2 },
  previewList: { gap: 7 },
  previewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 11, padding: 10 },
  previewRowError: { borderColor: '#FDA29B', backgroundColor: '#FFFBFA' },
  previewIdentity: { flex: 1, minWidth: 0 },
  rowName: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  rowMeta: { color: '#475467', fontSize: 11, lineHeight: 16, marginTop: 2 },
  rowError: { color: '#B42318', fontSize: 11, lineHeight: 16, marginTop: 2 },
  operationPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#F2F4F7' },
  createPill: { backgroundColor: '#ECFDF3' },
  updatePill: { backgroundColor: '#EFF8FF' },
  linkPill: { backgroundColor: '#F4F3FF' },
  manualPill: { backgroundColor: '#FFF8E7' },
  errorPill: { backgroundColor: '#FEE4E2' },
  operationText: { color: '#344054', fontSize: 10, fontWeight: '900' },
  errorPillText: { color: '#B42318' },
  helper: { color: '#667085', fontSize: 11, lineHeight: 16 },
  commitButton: { minHeight: 47, backgroundColor: '#12B76A', borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  commitButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#1C6B4A' },
  title: { color: '#F8FAFC' },
  body: { color: '#D0D5DD' },
  muted: { color: '#98A2B3' },
  subtle: { backgroundColor: '#162F46' },
  row: { borderColor: '#344054', backgroundColor: '#102A43' },
});
