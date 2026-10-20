import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { SellerTrayText as Text } from './SellerTrayText';
import { SellerTrayTextInput } from './SellerTrayTextInput';

export type CatalogueMasterPickerOption = { id: string; name: string };

type Props = {
  visible: boolean;
  title: string;
  value: string | null;
  options: CatalogueMasterPickerOption[];
  allowEmpty?: boolean;
  canCreate?: boolean;
  creating?: boolean;
  onClose: () => void;
  onSelect: (name: string | null) => void;
  onCreate?: (name: string) => Promise<void> | void;
};

export function CatalogueMasterPickerSheet({
  visible,
  title,
  value,
  options,
  allowEmpty = false,
  canCreate = false,
  creating = false,
  onClose,
  onSelect,
  onCreate,
}: Props) {
  const dark = useSellerTrayAppearance().dark;
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (visible) {
      setQuery('');
      setNewName('');
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options.filter((option) => !needle || option.name.toLowerCase().includes(needle));
  }, [options, query]);

  async function create() {
    const clean = newName.trim();
    if (!clean || !onCreate || creating) return;
    await onCreate(clean);
    setNewName('');
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={creating ? undefined : onClose}>
      <View style={[styles.screen, dark && darkStyles.screen]}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, dark && darkStyles.body]}>CATALOGUE</Text>
            <Text style={[styles.title, dark && darkStyles.title]}>{title}</Text>
          </View>
          <Pressable disabled={creating} onPress={onClose} style={[styles.close, dark && darkStyles.control, creating && styles.disabled]} accessibilityRole="button" accessibilityLabel="Close selection">
            <Ionicons name="close" size={22} color={dark ? theme.colors.cloud : theme.colors.navy} />
          </Pressable>
        </View>

        <SellerTrayTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={theme.colors.subtle}
          style={[styles.input, dark && darkStyles.control, dark && darkStyles.title]}
        />

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
          {allowEmpty ? (
            <OptionRow
              label="No category"
              selected={!value}
              dark={dark}
              onPress={() => { onSelect(null); onClose(); }}
            />
          ) : null}
          {filtered.map((option) => (
            <OptionRow
              key={option.id}
              label={option.name}
              selected={value?.trim().toLowerCase() === option.name.trim().toLowerCase()}
              dark={dark}
              onPress={() => { onSelect(option.name); onClose(); }}
            />
          ))}
          {filtered.length === 0 ? <Text style={[styles.empty, dark && darkStyles.body]}>No matching options.</Text> : null}
        </ScrollView>

        {canCreate && onCreate ? (
          <View style={[styles.createCard, dark && darkStyles.card]}>
            <Text style={[styles.createTitle, dark && darkStyles.title]}>Create new</Text>
            <View style={styles.createRow}>
              <SellerTrayTextInput
                value={newName}
                onChangeText={setNewName}
                editable={!creating}
                placeholder={`New ${title.toLowerCase()}`}
                placeholderTextColor={theme.colors.subtle}
                style={[styles.input, styles.createInput, dark && darkStyles.control, dark && darkStyles.title]}
              />
              <Pressable disabled={!newName.trim() || creating} onPress={() => void create()} style={[styles.addButton, (!newName.trim() || creating) && styles.disabled]}>
                <Text style={styles.addText}>{creating ? 'Adding…' : 'Add'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function OptionRow({ label, selected, dark, onPress }: { label: string; selected: boolean; dark: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.option, dark && darkStyles.card, selected && styles.optionSelected]}>
      <Text style={[styles.optionText, dark && darkStyles.title, selected && styles.optionTextSelected]}>{label}</Text>
      {selected ? <Ionicons name="checkmark-circle" size={20} color={theme.colors.green} /> : <Ionicons name="chevron-forward" size={18} color={theme.colors.subtle} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.cloud, padding: 18, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerCopy: { flex: 1 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: theme.colors.navy, fontSize: 24, fontWeight: '900' },
  close: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 13, paddingHorizontal: 12, color: theme.colors.navy, backgroundColor: theme.colors.white },
  list: { gap: 8, paddingBottom: 12 },
  option: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionSelected: { borderColor: theme.colors.green, backgroundColor: theme.colors.mintSoft },
  optionText: { flex: 1, color: theme.colors.navy, fontWeight: '800' },
  optionTextSelected: { color: theme.colors.greenDark },
  empty: { color: theme.colors.muted, textAlign: 'center', paddingVertical: 24 },
  createCard: { borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 12, gap: 9 },
  createTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  createRow: { flexDirection: 'row', gap: 8 },
  createInput: { flex: 1 },
  addButton: { minWidth: 78, borderRadius: 13, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  addText: { color: theme.colors.white, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});

const darkStyles = StyleSheet.create({
  screen: { backgroundColor: '#0B1F33' },
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  control: { backgroundColor: '#162F46', borderColor: '#344054' },
  title: { color: theme.colors.cloud },
  body: { color: '#D0D5DD' },
});
