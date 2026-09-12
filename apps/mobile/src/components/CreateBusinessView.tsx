import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { InitialBusinessInput } from '../data/businessRepository';

type Props = {
  onCreate: (input: InitialBusinessInput) => Promise<string>;
};

export function CreateBusinessView({ onCreate }: Props) {
  const [name, setName] = useState('');
  const [merchantCode, setMerchantCode] = useState('');
  const [merchantCodeTouched, setMerchantCodeTouched] = useState(false);
  const [businessType, setBusinessType] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) {
      setError('Enter your business name.');
      return;
    }
    const cleanMerchantCode = merchantCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(cleanMerchantCode)) {
      setError('Choose a 3-character Merchant ID using letters or numbers.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name,
        merchantCode: cleanMerchantCode,
        businessType: businessType || null,
        businessEmail: email || null,
        businessPhone: phone || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create your SellerTray workspace.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>CREATE ACCOUNT & BUSINESS SETUP</Text>
        <Text style={styles.title}>Set up your business</Text>
        <Text style={styles.subtitle}>
          Create your SellerTray workspace and get ready to manage orders, payments and customer conversations.
        </Text>
      </View>

      <View style={styles.card}>
        <Field label="Business name" required>
          <TextInput
            autoFocus
            editable={!submitting}
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (!merchantCodeTouched) setMerchantCode(suggestMerchantCode(value));
            }}
            placeholder="e.g. Pisonmart Enterprises"
            style={styles.input}
          />
        </Field>

        <Field
          label="Merchant ID"
          required
        >
          <Text style={styles.help}>
            A unique permanent 3-character code used in customer order and receipt references. Example: PIS/000001.
          </Text>
          <TextInput
            editable={!submitting}
            value={merchantCode}
            onChangeText={(value) => {
              setMerchantCodeTouched(true);
              setMerchantCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3));
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={3}
            placeholder="PIS"
            style={styles.input}
          />
          {merchantCode.length === 3 ? (
            <Text style={styles.referencePreview}>Your first order reference will look like {merchantCode}/000001</Text>
          ) : null}
        </Field>

        <Field label="Business type">
          <TextInput
            editable={!submitting}
            value={businessType}
            onChangeText={setBusinessType}
            placeholder="e.g. Retail, Food vendor, Fashion"
            style={styles.input}
          />
        </Field>

        <Field label="Business email">
          <TextInput
            editable={!submitting}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="orders@business.com"
            style={styles.input}
          />
        </Field>

        <Field label="Business phone">
          <TextInput
            editable={!submitting}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="080..."
            style={styles.input}
          />
        </Field>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          disabled={submitting}
          onPress={() => void create()}
          style={({ pressed }) => [styles.button, pressed && styles.pressed, submitting && styles.disabled]}
        >
          <Text style={styles.buttonText}>{submitting ? 'Creating workspace…' : 'Continue'}</Text>
        </Pressable>
      </View>

      <View style={styles.nextCard}>
        <Text style={styles.nextTitle}>What happens next</Text>
        <Text style={styles.nextText}>1. Add your products and selling prices.</Text>
        <Text style={styles.nextText}>2. Connect your WhatsApp Business number.</Text>
        <Text style={styles.nextText}>3. Send a test order and start receiving real orders.</Text>
      </View>
    </View>
  );
}

function suggestMerchantCode(value: string): string {
  const words = value
    .trim()
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

  if (words.length >= 3) return words.slice(0, 3).map((word) => word.charAt(0)).join('');
  if (words.length === 2) {
    const first = words[0] ?? '';
    const second = words[1] ?? '';
    if (first.length >= 3) return first.slice(0, 3);
    return `${first}${second}`.slice(0, 3);
  }

  return (words[0] ?? '').slice(0, 3);
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}{required ? ' *' : ''}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16, padding: 20 },
  hero: { gap: 6, paddingTop: 8 },
  eyebrow: { color: '#12B76A', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: '#102A43', fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 20 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 18, padding: 16, gap: 14 },
  field: { gap: 6 },
  label: { color: '#344054', fontSize: 12, fontWeight: '800' },
  help: { color: '#667085', fontSize: 10, lineHeight: 15 },
  referencePreview: { color: '#079455', fontSize: 10, fontWeight: '800' },
  input: { minHeight: 47, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, paddingHorizontal: 12, backgroundColor: '#FFFFFF', color: '#102A43' },
  error: { color: '#B42318', fontSize: 12, lineHeight: 17 },
  button: { minHeight: 50, borderRadius: 12, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  buttonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  nextCard: { backgroundColor: '#ECFDF3', borderRadius: 16, padding: 15, gap: 5 },
  nextTitle: { color: '#079455', fontSize: 13, fontWeight: '900', marginBottom: 2 },
  nextText: { color: '#475467', fontSize: 12, lineHeight: 18 },
});
