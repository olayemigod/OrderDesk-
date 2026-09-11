import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type {
  BusinessProfileInput,
  MerchantBusiness,
} from '../data/businessRepository';

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
    if (!name.trim()) return setError('Business name is required.');
    if (currency.trim().length !== 3) return setError('Currency must be a 3-letter code such as NGN.');
    if (!timezone.trim()) return setError('Timezone is required.');

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
        <Text style={styles.eyebrow}>BUSINESS PROFILE</Text>
        <Text style={styles.title}>Business details</Text>
        <Text style={styles.subtitle}>
          Manage the identity and basic operating defaults for this SellerTray business.
        </Text>
      </View>

      {!canEdit ? (
        <View style={styles.readOnlyNotice}>
          <Text style={styles.readOnlyTitle}>View only</Text>
          <Text style={styles.readOnlyText}>Only an Owner or Manager can change business details.</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Field label="Business name" required hint="The name shown to your team inside SellerTray.">
          <TextInput
            editable={canEdit && !saving}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Pisonmart Enterprises"
            style={[styles.input, !canEdit && styles.inputDisabled]}
          />
        </Field>

        <Field label="Business type" hint="Helps SellerTray tailor guidance to your business.">
          <TextInput
            editable={canEdit && !saving}
            value={businessType}
            onChangeText={setBusinessType}
            placeholder="e.g. Retail, Food vendor, Fashion"
            style={[styles.input, !canEdit && styles.inputDisabled]}
          />
        </Field>

        <Field label="Business email" hint="Operational contact email for this business.">
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

        <Field label="Business phone" hint="Main business contact number.">
          <TextInput
            editable={canEdit && !saving}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+234..."
            style={[styles.input, !canEdit && styles.inputDisabled]}
          />
        </Field>

        <Field label="Currency" required hint="Three-letter currency code used for product prices and orders.">
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

        <Field label="Timezone" required hint="Used for business-day reporting and order timestamps.">
          <TextInput
            editable={canEdit && !saving}
            value={timezone}
            onChangeText={setTimezone}
            autoCapitalize="none"
            placeholder="Africa/Lagos"
            style={[styles.input, !canEdit && styles.inputDisabled]}
          />
        </Field>

        <Field label="Logo URL" hint="Optional for now. Direct logo upload will replace this temporary field.">
          <TextInput
            editable={canEdit && !saving}
            value={logoUrl}
            onChangeText={setLogoUrl}
            autoCapitalize="none"
            placeholder="https://..."
            style={[styles.input, !canEdit && styles.inputDisabled]}
          />
        </Field>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {canEdit ? (
          <Pressable
            disabled={saving}
            onPress={() => void save()}
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}
          >
            <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save business details'}</Text>
          </Pressable>
        ) : null}
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
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}{required ? ' *' : ''}</Text>
      {hint ? <Text style={styles.help}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  heading: { gap: 5 },
  eyebrow: { color: '#98A2B3', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#101828', fontSize: 25, fontWeight: '900' },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 19 },
  readOnlyNotice: { backgroundColor: '#FFF8E7', borderRadius: 14, padding: 14 },
  readOnlyTitle: { color: '#7A2E0E', fontWeight: '900', fontSize: 13 },
  readOnlyText: { color: '#854A0E', fontSize: 12, lineHeight: 18, marginTop: 4 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 18, padding: 16, gap: 15 },
  field: { gap: 6 },
  label: { color: '#344054', fontSize: 12, fontWeight: '900' },
  help: { color: '#667085', fontSize: 10, lineHeight: 15 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, paddingHorizontal: 12, backgroundColor: '#FFFFFF', color: '#101828' },
  inputDisabled: { backgroundColor: '#F9FAFB', color: '#667085' },
  error: { color: '#B42318', fontSize: 12, lineHeight: 17 },
  notice: { color: '#027A48', fontSize: 12, fontWeight: '700' },
  saveButton: { minHeight: 50, borderRadius: 12, backgroundColor: '#246BFD', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  saveButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
