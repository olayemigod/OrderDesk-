import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  commitCatalogueImport,
  previewCatalogueImport,
  type CatalogueImportPreview,
} from '../data/catalogueImportRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { MetaCatalogueImport } from './MetaCatalogueImport';

type Props = {
  tenantId: string;
  currency: string;
  onImported: () => Promise<void> | void;
};

const starterTemplate =
  'Product Name,Selling Price,SKU,Category,Customer Words\n' +
  'Semo 5kg,12500,SEM-5KG,Food,semo 5kg|small semo\n' +
  'Semo 25kg,52000,SEM-25KG,Food,semo 25kg|big semo';

export function CatalogueBulkImport(props: Props) {
  return (
    <View style={styles.importStack}>
      <MetaCatalogueImport {...props} />
      <SpreadsheetCatalogueImport {...props} />
    </View>
  );
}

function SpreadsheetCatalogueImport({ tenantId, currency, onImported }: Props) {
  const appearance = useSellerTrayAppearance();
  const [sourceText, setSourceText] = useState('');
  const [preview, setPreview] = useState<CatalogueImportPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runPreview() {
    if (busy) return;
    if (!sourceText.trim()) {
      setError('Paste catalogue rows before previewing.');
      return;
    }

    setBusy('preview');
    setError(null);
    setMessage(null);
    try {
      const result = await previewCatalogueImport(tenantId, sourceText);
      setPreview(result);
      setMessage(
        result.summary.error > 0
          ? 'Preview found ' + result.summary.error + ' row' + (result.summary.error === 1 ? '' : 's') + ' that need attention.'
          : 'Preview is ready. No changes have been made yet.',
      );
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Unable to preview catalogue import.');
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
      const result = await commitCatalogueImport(tenantId, sourceText);
      await onImported();
      setPreview(null);
      setSourceText('');
      setMessage(
        'Import complete: ' +
        result.summary.create + ' created, ' +
        result.summary.update + ' updated.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import catalogue products.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.card, appearance.dark && darkStyles.card]}>
      <Text style={[styles.eyebrow, appearance.dark && darkStyles.muted]}>SPREADSHEET / CSV</Text>
      <Text style={[styles.title, appearance.dark && darkStyles.title]}>Paste from Excel, Sheets or CSV</Text>
      <Text style={[styles.body, appearance.dark && darkStyles.body]}>
        Copy rows directly from a spreadsheet or paste CSV. SellerTray previews creates, updates and conflicts before changing your catalogue.
      </Text>

      <View style={[styles.rulesCard, appearance.dark && darkStyles.subtle]}>
        <Text style={[styles.ruleTitle, appearance.dark && darkStyles.title]}>Required columns</Text>
        <Text style={[styles.ruleText, appearance.dark && darkStyles.body]}>
          Product Name and Selling Price. Optional: SKU, Category, Customer Words and Image URL.
        </Text>
        <Text style={[styles.ruleText, appearance.dark && darkStyles.body]}>
          SKU is the safest update key. Without SKU, SellerTray updates only when one existing product has the same name.
        </Text>
        <Text style={[styles.ruleText, appearance.dark && darkStyles.body]}>
          Customer Words can contain multiple aliases separated with | or ;.
        </Text>
      </View>

      <Pressable
        onPress={() => {
          setSourceText(starterTemplate);
          setPreview(null);
          setError(null);
          setMessage('Example loaded. Replace the sample rows with your catalogue.');
        }}
        style={styles.templateButton}
      >
        <Text style={styles.templateButtonText}>Load example format</Text>
      </Pressable>

      <TextInput
        value={sourceText}
        onChangeText={(value) => {
          setSourceText(value);
          setPreview(null);
          setMessage(null);
          setError(null);
        }}
        placeholder={'Product Name,Selling Price,SKU,Category,Customer Words\nSemo 5kg,12500,SEM-5KG,Food,semo|semovita'}
        placeholderTextColor="#98A2B3"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical="top"
        style={[styles.input, appearance.dark && darkStyles.input]}
      />

      <Text style={[styles.helper, appearance.dark && darkStyles.muted]}>
        Prices are imported in {currency}. Maximum 500 products per import.
      </Text>

      <Pressable
        disabled={Boolean(busy) || !sourceText.trim()}
        onPress={() => void runPreview()}
        style={[styles.previewButton, (Boolean(busy) || !sourceText.trim()) && styles.disabled]}
      >
        {busy === 'preview' ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
        <Text style={styles.previewButtonText}>{busy === 'preview' ? 'Checking…' : 'Preview import'}</Text>
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
          <View style={styles.summaryRow}>
            <Summary label="Rows" value={preview.summary.total} />
            <Summary label="Create" value={preview.summary.create} />
            <Summary label="Update" value={preview.summary.update} />
            <Summary label="Errors" value={preview.summary.error} attention={preview.summary.error > 0} />
          </View>

          <View style={styles.previewList}>
            {preview.rows.slice(0, 30).map((row) => (
              <View
                key={row.rowNumber}
                style={[
                  styles.previewRow,
                  appearance.dark && darkStyles.row,
                  row.operation === 'error' && styles.previewRowError,
                ]}
              >
                <View style={styles.previewIdentity}>
                  <Text style={[styles.rowName, appearance.dark && darkStyles.title]}>
                    Row {row.rowNumber} · {row.name || 'Missing name'}
                  </Text>
                  <Text style={[styles.rowMeta, appearance.dark && darkStyles.body]}>
                    {row.sku ? 'SKU ' + row.sku + ' · ' : ''}
                    {row.category ? row.category + ' · ' : ''}
                    {Number.isFinite(row.price) ? formatMoney(row.price, currency) : 'Invalid price'}
                  </Text>
                  {row.aliases.length ? (
                    <Text style={[styles.rowMeta, appearance.dark && darkStyles.muted]}>
                      Customer words: {row.aliases.join(', ')}
                    </Text>
                  ) : null}
                  {row.errors.map((item) => (
                    <Text key={item} style={styles.rowError}>• {item}</Text>
                  ))}
                </View>
                <View
                  style={[
                    styles.operationPill,
                    row.operation === 'create' && styles.createPill,
                    row.operation === 'update' && styles.updatePill,
                    row.operation === 'error' && styles.errorPill,
                  ]}
                >
                  <Text
                    style={[
                      styles.operationText,
                      row.operation === 'error' && styles.errorPillText,
                    ]}
                  >
                    {row.operation === 'create'
                      ? 'Create'
                      : row.operation === 'update'
                        ? 'Update'
                        : 'Fix'}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {preview.rows.length > 30 ? (
            <Text style={[styles.helper, appearance.dark && darkStyles.muted]}>
              Showing first 30 of {preview.rows.length} rows.
            </Text>
          ) : null}

          <Pressable
            disabled={Boolean(busy) || preview.summary.error > 0}
            onPress={() => void commit()}
            style={[
              styles.commitButton,
              (Boolean(busy) || preview.summary.error > 0) && styles.disabled,
            ]}
          >
            {busy === 'commit' ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
            <Text style={styles.commitButtonText}>
              {busy === 'commit'
                ? 'Importing…'
                : preview.summary.error > 0
                  ? 'Fix errors before import'
                  : 'Import ' + preview.summary.total + ' products'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Summary({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: number;
  attention?: boolean;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.summaryCard, appearance.dark && darkStyles.subtle, attention && styles.summaryAttention]}>
      <Text style={[styles.summaryValue, appearance.dark && darkStyles.title]}>{value}</Text>
      <Text style={[styles.summaryLabel, appearance.dark && darkStyles.body]}>{label}</Text>
    </View>
  );
}

function formatMoney(value: number, currency: string): string {
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
  importStack: { gap: 12 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E7EC',
    borderRadius: 16,
    padding: 15,
    gap: 11,
  },
  eyebrow: { color: '#667085', fontSize: 11, fontWeight: '900', letterSpacing: 0.9 },
  title: { color: '#102A43', fontSize: 18, fontWeight: '900' },
  body: { color: '#475467', fontSize: 13, lineHeight: 19 },
  rulesCard: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 11, gap: 5 },
  ruleTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  ruleText: { color: '#475467', fontSize: 12, lineHeight: 18 },
  templateButton: { alignSelf: 'flex-start', paddingVertical: 3 },
  templateButtonText: { color: '#079455', fontSize: 13, fontWeight: '900' },
  input: {
    minHeight: 170,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 11,
    color: '#102A43',
    fontSize: 12,
    lineHeight: 18,
  },
  helper: { color: '#667085', fontSize: 11, lineHeight: 16 },
  previewButton: {
    minHeight: 45,
    backgroundColor: '#102A43',
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  previewButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  messageCard: { backgroundColor: '#ECFDF3', padding: 10, borderRadius: 10 },
  messageText: { color: '#344054', fontSize: 12, lineHeight: 18 },
  errorCard: { backgroundColor: '#FEF3F2', padding: 10, borderRadius: 10 },
  errorText: { color: '#B42318', fontSize: 12, lineHeight: 18 },
  previewSection: { gap: 11 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  summaryCard: {
    minWidth: 70,
    flexGrow: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 11,
    padding: 9,
  },
  summaryAttention: { backgroundColor: '#FEF3F2' },
  summaryValue: { color: '#102A43', fontSize: 18, fontWeight: '900' },
  summaryLabel: { color: '#667085', fontSize: 10, marginTop: 2 },
  previewList: { gap: 7 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    borderRadius: 11,
    padding: 10,
  },
  previewRowError: { borderColor: '#FDA29B', backgroundColor: '#FFFBFA' },
  previewIdentity: { flex: 1, minWidth: 0 },
  rowName: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  rowMeta: { color: '#475467', fontSize: 11, lineHeight: 16, marginTop: 2 },
  rowError: { color: '#B42318', fontSize: 11, lineHeight: 16, marginTop: 2 },
  operationPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#F2F4F7' },
  createPill: { backgroundColor: '#ECFDF3' },
  updatePill: { backgroundColor: '#EFF8FF' },
  errorPill: { backgroundColor: '#FEE4E2' },
  operationText: { color: '#344054', fontSize: 10, fontWeight: '900' },
  errorPillText: { color: '#B42318' },
  commitButton: {
    minHeight: 47,
    backgroundColor: '#12B76A',
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  commitButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  title: { color: '#F8FAFC' },
  body: { color: '#D0D5DD' },
  muted: { color: '#98A2B3' },
  subtle: { backgroundColor: '#162F46' },
  input: { backgroundColor: '#0B2035', borderColor: '#475467', color: '#F8FAFC' },
  row: { borderColor: '#344054', backgroundColor: '#102A43' },
});
