import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { SellerTrayText as Text } from './SellerTrayText';
import { SellerTrayTextInput } from './SellerTrayTextInput';

export type SellerTraySelectOption = {
  id: string;
  name: string;
};

type Props = {
  label: string;
  value: string | null;
  options: SellerTraySelectOption[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  createLabel?: string;
  onCreate?: (name: string) => Promise<void>;
};

export function SellerTraySelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select',
  disabled = false,
  allowEmpty = false,
  emptyLabel = 'None',
  createLabel,
  onCreate,
}: Props) {
  const { dark } = useSellerTrayAppearance();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? options.filter((option) => option.name.toLowerCase().includes(needle))
      : options;
  }, [options, query]);

  function choose(next: string | null) {
    onChange(next);
    setOpen(false);
    setQuery('');
    setError(null);
  }

  async function create() {
    const clean = newName.trim();
    if (!onCreate || !clean || creating) return;
    setCreating(true);
    setError(null);
    try {
      await onCreate(clean);
      onChange(clean);
      setNewName('');
      setQuery('');
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create this option.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.field}>
      <Text style={[styles.label, dark && styles.darkBody]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || placeholder}`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.control, dark && styles.darkControl, disabled && styles.disabled]}
      >
        <Text style={[styles.value, !value && styles.placeholder, dark && styles.darkValue]}>{value || placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={theme.colors.subtle} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
          <View style={[styles.sheet, dark && styles.darkSheet]}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleCopy}>
                <Text style={[styles.sheetTitle, dark && styles.darkValue]}>{label}</Text>
                <Text style={[styles.help, dark && styles.darkBody]}>Choose from the governed Business list.</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} style={styles.closeButton}>
                <Ionicons name="close" size={21} color={theme.colors.navy} />
              </Pressable>
            </View>

            <SellerTrayTextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor={theme.colors.subtle}
              style={[styles.input, dark && styles.darkControl, dark && styles.darkInputText]}
            />

            <ScrollView style={styles.options} contentContainerStyle={styles.optionContent} keyboardShouldPersistTaps="handled">
              {allowEmpty ? (
                <Pressable onPress={() => choose(null)} style={styles.option}>
                  <Text style={[styles.optionText, dark && styles.darkValue]}>{emptyLabel}</Text>
                  {!value ? <Ionicons name="checkmark" size={20} color={theme.colors.greenDark} /> : null}
                </Pressable>
              ) : null}
              {filtered.map((option) => {
                const selected = option.name.toLowerCase() === (value ?? '').toLowerCase();
                return (
                  <Pressable key={option.id} onPress={() => choose(option.name)} style={styles.option}>
                    <Text style={[styles.optionText, dark && styles.darkValue]}>{option.name}</Text>
                    {selected ? <Ionicons name="checkmark" size={20} color={theme.colors.greenDark} /> : null}
                  </Pressable>
                );
              })}
              {!filtered.length ? <Text style={[styles.help, dark && styles.darkBody]}>No matching options.</Text> : null}
            </ScrollView>

            {onCreate ? (
              <View style={styles.createBox}>
                <Text style={[styles.createTitle, dark && styles.darkValue]}>{createLabel ?? `Add ${label.toLowerCase()}`}</Text>
                <View style={styles.createRow}>
                  <SellerTrayTextInput
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="Name"
                    placeholderTextColor={theme.colors.subtle}
                    style={[styles.input, styles.createInput, dark && styles.darkControl, dark && styles.darkInputText]}
                  />
                  <Pressable disabled={creating || !newName.trim()} onPress={() => void create()} style={[styles.createButton, (creating || !newName.trim()) && styles.disabled]}>
                    <Text style={styles.createButtonText}>{creating ? 'Adding…' : 'Add'}</Text>
                  </Pressable>
                </View>
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '800', color: theme.colors.slate },
  control: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 13,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  value: { flex: 1, fontSize: 14, color: theme.colors.navy, fontWeight: '700' },
  placeholder: { color: theme.colors.subtle, fontWeight: '500' },
  disabled: { opacity: 0.55 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10, 22, 35, 0.45)' },
  sheet: {
    maxHeight: '78%',
    backgroundColor: theme.colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    gap: 14,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sheetTitleCopy: { flex: 1, gap: 3 },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: theme.colors.navy },
  closeButton: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  help: { fontSize: 12, lineHeight: 18, color: theme.colors.muted },
  input: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 13, paddingHorizontal: 12, color: theme.colors.navy, backgroundColor: theme.colors.white },
  options: { maxHeight: 280 },
  optionContent: { gap: 4 },
  option: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 10, borderRadius: 10 },
  optionText: { flex: 1, fontSize: 14, fontWeight: '700', color: theme.colors.navy },
  createBox: { borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 14, gap: 8 },
  createTitle: { fontSize: 13, fontWeight: '900', color: theme.colors.navy },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  createInput: { flex: 1 },
  createButton: { minHeight: 48, minWidth: 74, paddingHorizontal: 14, borderRadius: 13, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center' },
  createButtonText: { color: theme.colors.white, fontWeight: '900' },
  error: { fontSize: 12, color: '#B42318', fontWeight: '700' },
  darkSheet: { backgroundColor: '#111827' },
  darkControl: { backgroundColor: '#182230', borderColor: '#344054' },
  darkInputText: { color: '#F8FAFC' },
  darkValue: { color: '#F8FAFC' },
  darkBody: { color: '#CBD5E1' },
});
