import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type {
  BusinessProfileInput,
  MerchantBusiness,
} from '../data/businessRepository';
import { CatalogueView } from './CatalogueView';
import { CustomerNotificationSettings } from './CustomerNotificationSettings';

type Props = {
  business: MerchantBusiness;
  onSave: (businessId: string, input: BusinessProfileInput) => Promise<void>;
};

export function BusinessProfileView({ business, onSave }: Props) {
  const canEdit = business.role === 'owner' || business.role === 'manager';
  const [name, setName] = useState(business.name);
  const [businessType, setBusinessType] = useState(business.businessType ?? '');
  const [email, setEmail] = useState(business.businessEmail ?? '');
  const [phone, setPhone] = useState(business.businessPhone ?? '');
  const [logoUrl, setLogoUrl] = useState(business.logoUrl ?? '');
  const [currency, setCurrency] = useState(business.currency);
  const [timezone, setTimezone] = useState(business.timezone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setName(business.name);
    setBusinessType(business.businessType ?? '');
    setEmail(business.businessEmail ?? '');
    setPhone(business.businessPhone ?? '');
    setLogoUrl(business.logoUrl ?? '');
    setCurrency(business.currency);
    setTimezone(business.timezone);
    setError(null);
    setNotice(null);
  }, [business]);

  async function save() {
    if (!canEdit) return;
    if (!name.trim()) {
      setError('Business name is required.');
      return;
    }
    if (currency.trim().length !== 3) {
      setError('Currency must be a 3-letter code such as NGN.');
      return;
    }
    if (!timezone.trim()) {
      setError('Timezone is required.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await onSave(business.id, {
        name,
        businessEmail: email || null,
        businessPhone: phone || null,
        businessType: businessType || null,
        logoUrl: logoUrl || null,
        currency,
        timezone,
      });
      setNotice('Business profile saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save business profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>BUSINESS SETTINGS</Text>
        <Text style={styles.title}>Business profile</Text>
        <Text style={styles.subtitle}>
          This information identifies your OrderDesk workspace. Plan, onboarding and WhatsApp connection state are controlled by OrderDesk.
        </Text>
      </View>

      {!canEdit ? (
        <View style={styles.readOnlyNotice}>
          <Text style={styles.readOnlyTitle}>View only</Text>
          <Text style={styles.readOnlyText}>Only an Owner or Manager can change business profile and catalogue details.</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Field label="Business name">
          <TextInput
            editable={canEdit && !saving}
            value={name}
            onChangeText={setName}
            placeholder="Business name"
            style={[styles.input, !canEdit && styles.inputDisabled]}
          />
        </Field>

        <Field label="Business type">
          <TextInput
            editable={canEdit && !saving}
            value={businessType}
            onChangeText={setBusinessType}
            placeholder="e.g. Food vendor, Fashion, Wholesale"
            style={[styles.input, !canEdit && styles.inputDisabled]}
          />
        </Field>

        <Field label="Business email">
          <TextInput
            editable={canEdit && !saving}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="orders@business.com"
            style={[styles.input, !canEdit && styles.inputDisabled]}
          />
        </Field>

        <Field label="Business phone">
          <TextInput
            editable={canEdit && !saving}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="080..."
            style={[styles.input, !canEdit && styles.inputDisabled]}
          />
        </Field>

        <View style={styles.row}>
          <View style={styles.rowField}>
            <Field label="Currency">
              <TextInput
                editable={canEdit && !saving}
                value={currency}
                onChangeText={setCurrency}
                autoCapitalize="characters"
                maxLength={3}
                placeholder="NGN"
                style={[styles.input, !canEdit && styles.inputDisabled]}
              />
            </Field>
          </View>
          <View style={styles.rowFieldWide}>
            <Field label="Timezone">
              <TextInput
                editable={canEdit && !saving}
                value={timezone}
                onChangeText={setTimezone}
                autoCapitalize="none"
                placeholder="Africa/Lagos"
                style={[styles.input, !canEdit && styles.inputDisabled]}
              />
            </Field>
          </View>
        </View>

        <Field label="Logo URL (temporary)">
          <TextInput
            editable={canEdit && !saving}
            value={logoUrl}
            onChangeText={setLogoUrl}
            autoCapitalize="none"
            placeholder="https://..."
            style={[styles.input, !canEdit && styles.inputDisabled]}
          />
          <Text style={styles.help}>Direct logo upload will replace this field in a later onboarding polish slice.</Text>
        </Field>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {canEdit ? (
          <Pressable
            disabled={saving}
            onPress={() => void save()}
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}
          >
            <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save business profile'}</Text>
          </Pressable>
        ) : null}
      </View>

      <CatalogueView business={business} />
      <CustomerNotificationSettings business={business} />

      <View style={styles.platformCard}>
        <Text style={styles.platformTitle}>OrderDesk account</Text>
        <SettingRow label="Role" value={business.role.toUpperCase()} />
        <SettingRow label="Plan status" value={formatLabel(business.subscriptionStatus)} />
        <SettingRow label="WhatsApp" value={formatLabel(business.whatsappConnectionStatus)} />
        <SettingRow label="Setup stage" value={formatLabel(business.onboardingStatus)} />
        <SettingRow label="Workspace" value={business.slug} />
      </View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{value}</Text>
    </View>
  );
}

function formatLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  heading: { gap: 5 },
  eyebrow: { color: '#98A2B3', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#101828', fontSize: 25, fontWeight: '900' },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 19 },
  readOnlyNotice: { backgroundColor: '#FFF8E7', borderRadius: 14, padding: 14 },
  readOnlyTitle: { color: '#7A2E0E', fontWeight: '900', fontSize: 13 },
  readOnlyText: { color: '#854A0E', fontSize: 12, lineHeight: 18, marginTop: 4 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 18, padding: 16, gap: 14 },
  field: { gap: 6 },
  label: { color: '#344054', fontSize: 12, fontWeight: '800' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, paddingHorizontal: 12, backgroundColor: '#FFFFFF', color: '#101828' },
  inputDisabled: { backgroundColor: '#F9FAFB', color: '#667085' },
  row: { flexDirection: 'row', gap: 10 },
  rowField: { flex: 0.7 },
  rowFieldWide: { flex: 1.5 },
  help: { color: '#98A2B3', fontSize: 11, lineHeight: 16 },
  error: { color: '#B42318', fontSize: 12, lineHeight: 17 },
  notice: { color: '#027A48', fontSize: 12, fontWeight: '700' },
  saveButton: { minHeight: 48, borderRadius: 12, backgroundColor: '#246BFD', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  saveButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  platformCard: { backgroundColor: '#F9FAFB', borderRadius: 18, padding: 16, gap: 2 },
  platformTitle: { color: '#101828', fontSize: 15, fontWeight: '900', marginBottom: 8 },
  settingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EAECF0' },
  settingLabel: { color: '#667085', fontSize: 12, fontWeight: '700' },
  settingValue: { color: '#101828', fontSize: 12, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
});
