import { useEffect, useState, type ReactNode } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type {
  BusinessProfileInput,
  MerchantBusiness,
} from '../data/businessRepository';
import {
  governedBusinessLogoPath,
  removeBusinessLogo,
  uploadBusinessLogo,
} from '../data/businessLogoRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  business: MerchantBusiness;
  onSave: (businessId: string, input: BusinessProfileInput) => Promise<void>;
};

type SelectedLogo = {
  uri: string;
  mimeType: string;
};

export function BusinessProfileView({ business, onSave }: Props) {
  const appearance = useSellerTrayAppearance();
  const canEdit = business.role === 'owner' || business.role === 'manager';
  const [name, setName] = useState(business.name);
  const [businessType, setBusinessType] = useState(business.businessType ?? '');
  const [email, setEmail] = useState(business.businessEmail ?? '');
  const [phone, setPhone] = useState(business.businessPhone ?? '');
  const [currency, setCurrency] = useState(business.currency);
  const [timezone, setTimezone] = useState(business.timezone);
  const [selectedLogo, setSelectedLogo] = useState<SelectedLogo | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setName(business.name);
    setBusinessType(business.businessType ?? '');
    setEmail(business.businessEmail ?? '');
    setPhone(business.businessPhone ?? '');
    setCurrency(business.currency);
    setTimezone(business.timezone);
    setSelectedLogo(null);
    setRemoveLogo(false);
    setError(null);
    setNotice(null);
  }, [business]);

  async function chooseBusinessLogo() {
    if (!canEdit || saving) return;
    setError(null);
    setNotice(null);

    if (Platform.OS === 'ios') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Allow photo access to choose your business logo.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const mimeType = (asset.mimeType ?? 'image/jpeg').toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
      setError('Business logo must be a PNG, JPG, or WebP image.');
      return;
    }
    if (typeof asset.fileSize === 'number' && asset.fileSize > 5 * 1024 * 1024) {
      setError('Choose a business logo that is 5 MB or smaller.');
      return;
    }

    setSelectedLogo({ uri: asset.uri, mimeType });
    setRemoveLogo(false);
  }

  async function save() {
    if (!canEdit) return;
    if (!name.trim()) return setError('Business name is required.');
    if (currency.trim().length !== 3) return setError('Currency must be a 3-letter code such as NGN.');
    if (!timezone.trim()) return setError('Timezone is required.');

    setSaving(true);
    setError(null);
    setNotice(null);

    const previousLogoUrl = business.logoUrl?.trim() || null;
    const previousLogoPath = governedBusinessLogoPath(business.id, previousLogoUrl);
    let uploadedLogoPath: string | null = null;
    let nextLogoUrl = removeLogo ? null : previousLogoUrl;

    try {
      if (selectedLogo) {
        const uploaded = await uploadBusinessLogo(business.id, selectedLogo.uri, selectedLogo.mimeType);
        uploadedLogoPath = uploaded.objectPath;
        nextLogoUrl = uploaded.publicUrl;
      }

      await onSave(business.id, {
        name,
        businessEmail: email || null,
        businessPhone: phone || null,
        businessType: businessType || null,
        logoUrl: nextLogoUrl,
        currency,
        timezone,
      });

      setSelectedLogo(null);
      setRemoveLogo(false);
      setNotice('Business profile saved.');

      if (previousLogoPath && previousLogoUrl !== nextLogoUrl && previousLogoPath !== uploadedLogoPath) {
        void removeBusinessLogo(previousLogoPath).catch((cleanupError) => {
          console.warn('Unable to remove the previous SellerTray business logo.', cleanupError);
        });
      }
    } catch (err) {
      if (uploadedLogoPath) {
        void removeBusinessLogo(uploadedLogoPath).catch((cleanupError) => {
          console.warn('Unable to clean up an uncommitted SellerTray business logo.', cleanupError);
        });
      }
      setError(err instanceof Error ? err.message : 'Unable to save business profile.');
    } finally {
      setSaving(false);
    }
  }

  const previewLogo = removeLogo ? null : selectedLogo?.uri ?? business.logoUrl ?? null;

  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>BUSINESS PROFILE</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Business details</Text>
        <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>
          Manage the identity and basic operating defaults for this SellerTray business.
        </Text>
      </View>

      {!canEdit ? (
        <View style={[styles.readOnlyNotice, appearance.dark && darkStyles.warningCard]}>
          <Text style={[styles.readOnlyTitle, appearance.dark && darkStyles.warningTitle]}>View only</Text>
          <Text style={[styles.readOnlyText, appearance.dark && darkStyles.warningText]}>Only an Owner or Manager can change business details.</Text>
        </View>
      ) : null}

      <View style={[styles.card, appearance.dark && darkStyles.card]}>
        <Field label="Business name" required hint="The name shown to your team inside SellerTray.">
          <TextInput
            editable={canEdit && !saving}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Pisonmart Enterprises"
            placeholderTextColor={appearance.dark ? theme.dark.textSubtle : theme.colors.muted}
            style={[styles.input, appearance.dark && darkStyles.input, !canEdit && styles.inputDisabled, !canEdit && appearance.dark && darkStyles.inputDisabled]}
          />
        </Field>

        <Field
          label="Merchant ID"
          hint={`Permanent customer reference prefix. Orders and receipts use this ID, for example ${business.merchantCode}/000001.`}
        >
          <TextInput
            editable={false}
            value={business.merchantCode}
            autoCapitalize="characters"
            style={[styles.input, appearance.dark && darkStyles.input, styles.inputDisabled, appearance.dark && darkStyles.inputDisabled]}
          />
        </Field>

        <Field label="Business type" hint="Helps SellerTray tailor guidance to your business.">
          <TextInput
            editable={canEdit && !saving}
            value={businessType}
            onChangeText={setBusinessType}
            placeholder="e.g. Retail, Food vendor, Fashion"
            placeholderTextColor={appearance.dark ? theme.dark.textSubtle : theme.colors.muted}
            style={[styles.input, appearance.dark && darkStyles.input, !canEdit && styles.inputDisabled, !canEdit && appearance.dark && darkStyles.inputDisabled]}
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
            placeholderTextColor={appearance.dark ? theme.dark.textSubtle : theme.colors.muted}
            style={[styles.input, appearance.dark && darkStyles.input, !canEdit && styles.inputDisabled, !canEdit && appearance.dark && darkStyles.inputDisabled]}
          />
        </Field>

        <Field label="Business phone" hint="Main business contact number.">
          <TextInput
            editable={canEdit && !saving}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+234..."
            placeholderTextColor={appearance.dark ? theme.dark.textSubtle : theme.colors.muted}
            style={[styles.input, appearance.dark && darkStyles.input, !canEdit && styles.inputDisabled, !canEdit && appearance.dark && darkStyles.inputDisabled]}
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
            placeholderTextColor={appearance.dark ? theme.dark.textSubtle : theme.colors.muted}
            style={[styles.input, appearance.dark && darkStyles.input, !canEdit && styles.inputDisabled, !canEdit && appearance.dark && darkStyles.inputDisabled]}
          />
        </Field>

        <Field label="Timezone" required hint="Used for business-day reporting and order timestamps.">
          <TextInput
            editable={canEdit && !saving}
            value={timezone}
            onChangeText={setTimezone}
            autoCapitalize="none"
            placeholder="Africa/Lagos"
            placeholderTextColor={appearance.dark ? theme.dark.textSubtle : theme.colors.muted}
            style={[styles.input, appearance.dark && darkStyles.input, !canEdit && styles.inputDisabled, !canEdit && appearance.dark && darkStyles.inputDisabled]}
          />
        </Field>

        <Field label="Business logo" hint="PNG, JPG or WebP. Maximum 5 MB. Square logos work best.">
          {previewLogo ? (
            <View style={[styles.logoPreview, appearance.dark && darkStyles.logoPreview]}>
              <Image source={{ uri: previewLogo }} style={styles.logoImage} resizeMode="contain" />
            </View>
          ) : (
            <View style={[styles.logoPlaceholder, appearance.dark && darkStyles.logoPreview]}>
              <Text style={[styles.logoPlaceholderText, appearance.dark && darkStyles.bodyText]}>No logo uploaded</Text>
            </View>
          )}

          {canEdit ? (
            <View style={styles.logoActions}>
              <Pressable
                disabled={saving}
                onPress={() => void chooseBusinessLogo()}
                style={({ pressed }) => [styles.secondaryButton, appearance.dark && darkStyles.secondaryButton, pressed && styles.pressed, saving && styles.disabled]}
              >
                <Text style={[styles.secondaryButtonText, appearance.dark && darkStyles.secondaryButtonText]}>{previewLogo ? 'Change logo' : 'Choose logo'}</Text>
              </Pressable>
              {previewLogo ? (
                <Pressable
                  disabled={saving}
                  onPress={() => {
                    setSelectedLogo(null);
                    setRemoveLogo(true);
                    setNotice(null);
                    setError(null);
                  }}
                  style={({ pressed }) => [styles.removeButton, appearance.dark && darkStyles.removeButton, pressed && styles.pressed, saving && styles.disabled]}
                >
                  <Text style={[styles.removeButtonText, appearance.dark && darkStyles.removeButtonText]}>Remove logo</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {removeLogo ? <Text style={[styles.pendingLogoText, appearance.dark && darkStyles.bodyText]}>The current logo will be removed when you save.</Text> : null}
        </Field>

        {error ? <Text style={[styles.error, appearance.dark && darkStyles.errorText]}>{error}</Text> : null}
        {notice ? <Text style={[styles.notice, appearance.dark && darkStyles.noticeText]}>{notice}</Text> : null}

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
  const appearance = useSellerTrayAppearance();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>{label}{required ? ' *' : ''}</Text>
      {hint ? <Text style={[styles.help, appearance.dark && darkStyles.bodyText]}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  heading: { gap: 5 },
  eyebrow: { color: theme.colors.muted, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: theme.colors.navy, fontSize: 25, fontWeight: '900' },
  subtitle: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  readOnlyNotice: { backgroundColor: '#FFF8E7', borderRadius: 14, padding: 14 },
  readOnlyTitle: { color: '#7A2E0E', fontWeight: '900', fontSize: 13 },
  readOnlyText: { color: '#854A0E', fontSize: 12, lineHeight: 18, marginTop: 4 },
  card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 16, gap: 15 },
  field: { gap: 6 },
  label: { color: '#344054', fontSize: 12, fontWeight: '900' },
  help: { color: theme.colors.muted, fontSize: 12, lineHeight: 15 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, paddingHorizontal: 12, backgroundColor: theme.colors.white, color: theme.colors.navy },
  inputDisabled: { backgroundColor: '#F9FAFB', color: theme.colors.muted },
  logoPreview: { width: 112, height: 112, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.cloud, padding: 8, alignItems: 'center', justifyContent: 'center' },
  logoImage: { width: '100%', height: '100%' },
  logoPlaceholder: { minHeight: 72, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D0D5DD', backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  logoPlaceholderText: { color: theme.colors.muted, fontSize: 12, fontWeight: '700' },
  logoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  secondaryButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: theme.colors.white, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  removeButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#FDA29B', backgroundColor: theme.colors.dangerSoft, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  removeButtonText: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  pendingLogoText: { color: theme.colors.muted, fontSize: 11, lineHeight: 16 },
  error: { color: '#B42318', fontSize: 12, lineHeight: 17 },
  notice: { color: '#027A48', fontSize: 12, fontWeight: '700' },
  saveButton: { minHeight: 50, borderRadius: 12, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  saveButtonText: { color: theme.colors.white, fontWeight: '900', fontSize: 14 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.dark.surface, borderColor: theme.dark.border },
  titleText: { color: theme.dark.text },
  bodyText: { color: theme.dark.textMuted },
  input: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.borderStrong, color: theme.dark.text },
  inputDisabled: { backgroundColor: theme.dark.disabledSurface, color: theme.dark.disabledText },
  logoPreview: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.borderStrong },
  secondaryButton: { backgroundColor: theme.dark.surfaceSubtle, borderColor: theme.dark.borderStrong },
  secondaryButtonText: { color: theme.dark.text },
  removeButton: { backgroundColor: theme.dark.dangerSurface, borderColor: theme.dark.dangerBorder },
  removeButtonText: { color: theme.dark.dangerText },
  errorText: { color: theme.dark.dangerText },
  noticeText: { color: theme.dark.accentText },
  warningCard: { backgroundColor: theme.dark.warningSurface },
  warningTitle: { color: '#FEDF89' },
  warningText: { color: '#FEC84B' },
});
