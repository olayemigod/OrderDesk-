import { useEffect, useState, type ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';

export type QuickProductDraft = {
  name: string;
  sku: string;
  category: string;
  stockUom: string;
  sellingPrice: string;
  barcode: string;
  allowFractionalStock: boolean;
};

type Props = {
  visible: boolean;
  barcode: string;
  saving: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (draft: QuickProductDraft) => void;
};

const EMPTY = (barcode: string): QuickProductDraft => ({
  name: '',
  sku: '',
  category: '',
  stockUom: 'Each',
  sellingPrice: '',
  barcode,
  allowFractionalStock: false,
});

export function QuickProductCreateSheet({ visible, barcode, saving, error, onClose, onSubmit }: Props) {
  const [draft, setDraft] = useState<QuickProductDraft>(() => EMPTY(barcode));

  useEffect(() => {
    if (visible) setDraft(EMPTY(barcode));
  }, [visible, barcode]);

  const validPrice = draft.sellingPrice.trim() !== '' && Number.isFinite(Number(draft.sellingPrice)) && Number(draft.sellingPrice) >= 0;
  const canSave = Boolean(draft.name.trim() && draft.stockUom.trim() && draft.barcode.trim() && validPrice && !saving);

  function change<K extends keyof QuickProductDraft>(key: K, value: QuickProductDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={saving ? undefined : onClose}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <View><Text style={styles.eyebrow}>New product</Text><Text style={styles.title}>Add scanned product</Text></View>
        <Pressable disabled={saving} accessibilityRole="button" accessibilityLabel="Close product form" onPress={onClose} style={[styles.closeButton, saving && styles.disabled]}>
          <Ionicons name="close" size={24} color={theme.colors.navy} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="barcode-outline" size={22} color={theme.colors.greenDark} />
          <View style={styles.flex}><Text style={styles.infoTitle}>Barcode captured</Text><Text style={styles.barcode}>{barcode}</Text></View>
        </View>
        <Text style={styles.help}>Add only the essentials here. Stock quantity is recorded separately through receiving or stock count, so creating a product never invents stock.</Text>
        {error ? <View style={styles.errorCard}><Ionicons name="alert-circle-outline" size={19} color={theme.colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}

        <Field label="Product name" required value={draft.name} onChangeText={(value) => change('name', value)} placeholder="e.g. Malt Drink 33cl" />
        <View style={styles.twoColumn}>
          <View style={styles.flex}><Field label="Stock unit" required value={draft.stockUom} onChangeText={(value) => change('stockUom', value)} placeholder="Each" /></View>
          <View style={styles.flex}><Field label="Selling price" required value={draft.sellingPrice} onChangeText={(value) => change('sellingPrice', value.replace(/[^0-9.]/g, ''))} placeholder="0.00" keyboardType="decimal-pad" /></View>
        </View>
        <Field label="SKU" value={draft.sku} onChangeText={(value) => change('sku', value)} placeholder="Optional internal code" />
        <Field label="Category" value={draft.category} onChangeText={(value) => change('category', value)} placeholder="Optional category" />
        <Field label="Barcode" required value={draft.barcode} onChangeText={(value) => change('barcode', value)} placeholder="Barcode" keyboardType="number-pad" />

        <View style={styles.switchRow}>
          <View style={styles.flex}><Text style={styles.label}>Allow fractional stock quantity</Text><Text style={styles.muted}>Keep this off for normal pieces, packs and bottles.</Text></View>
          <Switch value={draft.allowFractionalStock} onValueChange={(value) => change('allowFractionalStock', value)} />
        </View>

        <Pressable disabled={!canSave} onPress={() => onSubmit(draft)} style={[styles.saveButton, !canSave && styles.disabled]}>
          <Text style={styles.saveText}>{saving ? 'Adding product…' : 'Add product'}</Text>
        </Pressable>
        <Text style={styles.footerNote}>More units, alternate barcodes and detailed pricing remain available in Products on merchant web.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  </Modal>;
}

function Field({ label, required = false, ...props }: { label: string; required?: boolean } & ComponentProps<typeof TextInput>) {
  return <View style={styles.field}><Text style={styles.label}>{label}{required ? ' *' : ''}</Text><TextInput autoCorrect={false} placeholderTextColor={theme.colors.subtle} {...props} style={styles.input} /></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.cloud, paddingTop: 18 },
  header: { paddingHorizontal: 18, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  content: { paddingHorizontal: 18, paddingBottom: 38, gap: 14 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: theme.colors.navy, fontSize: 25, fontWeight: '900' },
  closeButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.mintSoft, borderRadius: 16, padding: 14 },
  infoTitle: { color: theme.colors.greenDark, fontWeight: '900', fontSize: 12 },
  barcode: { color: theme.colors.navy, fontSize: 17, fontWeight: '900', letterSpacing: 0.5 },
  help: { color: theme.colors.slate, fontSize: 13, lineHeight: 19 },
  errorCard: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderRadius: 14, borderWidth: 1, borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft, padding: 12 },
  errorText: { flex: 1, color: theme.colors.danger, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  field: { gap: 6 },
  label: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  input: { minHeight: 50, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, borderRadius: 14, paddingHorizontal: 13, color: theme.colors.navy, fontSize: 15 },
  twoColumn: { flexDirection: 'row', gap: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, padding: 14 },
  muted: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  saveButton: { minHeight: 52, borderRadius: 15, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  saveText: { color: theme.colors.white, fontSize: 15, fontWeight: '900' },
  footerNote: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  flex: { flex: 1 },
  disabled: { opacity: 0.45 },
});
