import { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import { PaymentReconciliationPanel } from './PaymentReconciliationPanel';
import type {
  MerchantPaymentMethod,
  PaymentMethodType,
} from '../data/paymentMethodsRepository';
import { usePaymentMethods } from '../hooks/usePaymentMethods';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  business: MerchantBusiness;
};

type GatewayProvider = 'paystack' | 'flutterwave';

export function PaymentMethodsSettings({ business }: Props) {
  const appearance = useSellerTrayAppearance();
  const payment = usePaymentMethods(business.id);
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankInstructions, setBankInstructions] = useState('');
  const [paystackKey, setPaystackKey] = useState('');
  const [flutterwaveKey, setFlutterwaveKey] = useState('');
  const [flutterwaveHash, setFlutterwaveHash] = useState('');
  const [success, setSuccess] = useState<string | null>(null);
  const [view, setView] = useState<'transactions' | 'methods'>('transactions');

  const banks = useMemo(
    () => payment.methods.filter((method) => method.methodType === 'bank_transfer'),
    [payment.methods],
  );
  const canManage = business.role === 'owner' || business.role === 'manager';
  const canManageGateways = business.role === 'owner';

  const paystack = payment.methods.find((method) => method.methodType === 'paystack') ?? null;
  const flutterwave = payment.methods.find((method) => method.methodType === 'flutterwave') ?? null;
  const cod = payment.methods.find((method) => method.methodType === 'cash_on_delivery') ?? null;
  const pickup = payment.methods.find((method) => method.methodType === 'pay_on_pickup') ?? null;

  async function addBank() {
    if (!canManage || payment.busy) return;
    setSuccess(null);
    await payment.save({
      methodType: 'bank_transfer',
      displayName: bankName.trim() || 'Bank transfer',
      isEnabled: true,
      isDefault: payment.methods.every((method) => !method.isDefault),
      sortOrder: 10 + banks.length,
      mode: 'live',
      bankName,
      bankAccountName: accountName,
      bankAccountNumber: accountNumber,
      instructions: bankInstructions,
    });
    setBankName('');
    setAccountName('');
    setAccountNumber('');
    setBankInstructions('');
    setShowBankForm(false);
    setSuccess('Bank account added.');
  }

  async function updateMethod(
    method: MerchantPaymentMethod,
    patch: Partial<{
      isEnabled: boolean;
      isDefault: boolean;
    }>,
  ) {
    if (!canManage || payment.busy) return;
    const nextEnabled = patch.isEnabled ?? method.isEnabled;
    const nextDefault = nextEnabled ? (patch.isDefault ?? method.isDefault) : false;
    await payment.save({
      methodId: method.id,
      methodType: method.methodType,
      displayName: method.displayName,
      isEnabled: nextEnabled,
      isDefault: nextDefault,
      sortOrder: method.sortOrder,
      mode: method.mode,
      bankName: method.bankName,
      bankAccountName: method.bankAccountName,
      bankAccountNumber: method.bankAccountNumber,
      bankCode: method.bankCode,
      instructions: method.instructions,
    });
    setSuccess('Payment method updated.');
  }

  async function toggleSimple(
    type: Extract<PaymentMethodType, 'cash_on_delivery' | 'pay_on_pickup'>,
    method: MerchantPaymentMethod | null,
    displayName: string,
  ) {
    if (!canManage || payment.busy) return;
    setSuccess(null);
    if (method) {
      await updateMethod(method, { isEnabled: !method.isEnabled });
      return;
    }

    await payment.save({
      methodType: type,
      displayName,
      isEnabled: true,
      isDefault: payment.methods.every((candidate) => !candidate.isDefault),
      sortOrder: type === 'cash_on_delivery' ? 80 : 90,
      mode: 'live',
    });
    setSuccess(displayName + ' enabled.');
  }

  async function connectGateway(provider: GatewayProvider) {
    if (!canManageGateways || payment.busy) return;
    setSuccess(null);

    const existing = provider === 'paystack' ? paystack : flutterwave;
    let methodId = existing?.id ?? null;

    if (!methodId) {
      methodId = await payment.save({
        methodType: provider,
        displayName: provider === 'paystack' ? 'Paystack' : 'Flutterwave',
        isEnabled: false,
        isDefault: false,
        sortOrder: provider === 'paystack' ? 30 : 40,
        mode: 'live',
      });
    }

    if (provider === 'paystack') {
      if (!paystackKey.trim()) return;
      await payment.connectGateway(methodId, 'paystack', paystackKey);
      setPaystackKey('');
      setSuccess('Paystack credentials connected. Enable Paystack when ready to offer it to customers.');
    } else {
      if (!flutterwaveKey.trim() || !flutterwaveHash.trim()) return;
      await payment.connectGateway(methodId, 'flutterwave', flutterwaveKey, flutterwaveHash);
      setFlutterwaveKey('');
      setFlutterwaveHash('');
      setSuccess('Flutterwave credentials connected. Enable Flutterwave when ready to offer it to customers.');
    }
  }

  async function disconnectGateway(method: MerchantPaymentMethod) {
    if (!canManageGateways || payment.busy) return;
    setSuccess(null);
    await payment.disconnectGateway(method.id);
    setSuccess(method.displayName + ' disconnected and disabled.');
  }

  if (payment.loading && payment.methods.length === 0) {
    return (
      <View style={[styles.loadingCard, appearance.dark && darkStyles.card]}>
        <ActivityIndicator />
        <Text style={[styles.muted, appearance.dark && darkStyles.bodyText]}>Loading customer payment methods…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, appearance.dark && darkStyles.surface]}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>CUSTOMER PAYMENTS</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText, appearance.textSize === 'large' && styles.titleLarge]}>How customers can pay</Text>
        <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>
          SellerTray keeps order, payment and fulfilment states separate. A financial receipt is issued only after payment is confirmed.
        </Text>
      </View>

      <Pressable
        onPress={() => setView('transactions')}
        style={({ pressed }) => [styles.paymentHero, pressed && styles.pressed]}
      >
        <View style={styles.paymentHeroIcon}>
          <Ionicons name="card-outline" size={25} color="#FFFFFF" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.paymentHeroEyebrow}>PAYMENT CONTROL</Text>
          <Text style={styles.paymentHeroValue}>{payment.methods.filter((method) => method.isEnabled).length} active methods</Text>
          <Text style={styles.paymentHeroMeta}>
            Default: {payment.methods.find((method) => method.isDefault)?.displayName ?? 'None'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
      </Pressable>

      <View style={styles.paymentSummaryRow}>
        <PaymentSummary icon="checkmark-circle-outline" label="Active methods" value={String(payment.methods.filter((method) => method.isEnabled).length)} />
        <PaymentSummary icon="star-outline" label="Default" value={payment.methods.find((method) => method.isDefault)?.displayName ?? 'None'} compact />
      </View>

      <View style={[styles.segmentedControl, appearance.dark && darkStyles.subtleCard]}>
        <Pressable onPress={() => setView('transactions')} style={[styles.segmentButton, view === 'transactions' && styles.segmentButtonActive, view === 'transactions' && appearance.dark && darkStyles.card]}>
          <Ionicons name="swap-horizontal-outline" size={18} color={view === 'transactions' ? '#079455' : appearance.dark ? '#D0D5DD' : '#667085'} />
          <Text style={[styles.segmentText, appearance.dark && darkStyles.bodyText, view === 'transactions' && styles.segmentTextActive]}>Transactions</Text>
        </Pressable>
        <Pressable onPress={() => setView('methods')} style={[styles.segmentButton, view === 'methods' && styles.segmentButtonActive, view === 'methods' && appearance.dark && darkStyles.card]}>
          <Ionicons name="wallet-outline" size={18} color={view === 'methods' ? '#079455' : appearance.dark ? '#D0D5DD' : '#667085'} />
          <Text style={[styles.segmentText, appearance.dark && darkStyles.bodyText, view === 'methods' && styles.segmentTextActive]}>Payment methods</Text>
        </Pressable>
      </View>

      {business.role === 'staff' ? (
        <View style={[styles.readOnlyCard, appearance.dark && darkStyles.subtleCard]}>
          <Text style={[styles.readOnlyTitle, appearance.dark && darkStyles.titleText]}>View only</Text>
          <Text style={[styles.readOnlyText, appearance.dark && darkStyles.bodyText]}>Payment method configuration is view-only for Staff. Staff can still review and verify existing payments from the reconciliation inbox where applicable.</Text>
        </View>
      ) : null}

      {payment.error ? (
        <View style={[styles.errorCard, appearance.dark && darkStyles.errorCard]}>
          <Text style={styles.errorTitle}>Payment settings problem</Text>
          <Text style={styles.errorText}>{payment.error}</Text>
          <Pressable onPress={() => void payment.refresh()}>
            <Text style={styles.retryText}>Refresh</Text>
          </Pressable>
        </View>
      ) : null}

      {success ? (
        <View style={[styles.successCard, appearance.dark && darkStyles.mintCard]}>
          <Text style={styles.successText}>{success}</Text>
        </View>
      ) : null}

      {view === 'transactions' ? (
        <View style={styles.viewStack}>
          <View style={[styles.infoCard, appearance.dark && darkStyles.mintCard]}>
            <Text style={styles.infoTitle}>Payment activity & reconciliation</Text>
            <Text style={[styles.infoText, appearance.dark && darkStyles.bodyText]}>
              Review customer payment claims, confirmations and exceptions without changing how customers are allowed to pay.
            </Text>
          </View>
          <PaymentReconciliationPanel tenantId={business.id} />
        </View>
      ) : (
        <View style={styles.viewStack}>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Direct merchant settlement</Text>
            <Text style={styles.infoText}>
              Bank transfers and connected gateways belong to this business. SellerTray does not collect card details or hold customer funds.
            </Text>
          </View>

      <Section title="BANK TRANSFER" helper="Add one or more merchant bank accounts.">
        {banks.length === 0 ? <Text style={styles.emptyText}>No bank account configured yet.</Text> : null}
        {banks.map((method) => (
          <MethodCard
            key={method.id}
            method={method}
            canManage={canManage}
            busy={payment.busy}
            onToggle={() => void updateMethod(method, { isEnabled: !method.isEnabled })}
            onDefault={() => void updateMethod(method, { isEnabled: true, isDefault: true })}
          >
            <Text style={styles.accountName}>{method.bankAccountName}</Text>
            <Text style={styles.accountMeta}>{method.bankName} · {method.bankAccountNumber}</Text>
            {method.instructions ? <Text style={styles.methodNote}>{method.instructions}</Text> : null}
          </MethodCard>
        ))}

        {canManage ? (
          showBankForm ? (
            <View style={styles.formCard}>
              <Field label="Bank name" value={bankName} onChangeText={setBankName} placeholder="e.g. GTBank" />
              <Field label="Account name" value={accountName} onChangeText={setAccountName} placeholder={business.name} />
              <Field
                label="Account number"
                value={accountNumber}
                onChangeText={setAccountNumber}
                placeholder="0123456789"
                keyboardType="number-pad"
              />
              <Field
                label="Customer instruction (optional)"
                value={bankInstructions}
                onChangeText={setBankInstructions}
                placeholder="Use your SellerTray order reference as narration"
              />
              <View style={styles.row}>
                <Button label="Cancel" secondary disabled={payment.busy} onPress={() => setShowBankForm(false)} />
                <Button
                  label={payment.busy ? 'Saving…' : 'Add bank'}
                  disabled={payment.busy || !bankName.trim() || !accountName.trim() || !accountNumber.trim()}
                  onPress={() => void addBank()}
                />
              </View>
            </View>
          ) : (
            <Button label="+ Add bank account" secondary disabled={payment.busy} onPress={() => setShowBankForm(true)} />
          )
        ) : null}
      </Section>

      <Section title="ONLINE GATEWAYS" helper="Merchant-owned Paystack and Flutterwave accounts.">
        <GatewayCard
          provider="paystack"
          label="Paystack"
          method={paystack}
          role={business.role}
          busy={payment.busy}
          secretKey={paystackKey}
          onSecretKey={setPaystackKey}
          onConnect={() => void connectGateway('paystack')}
          onToggle={() => paystack && void updateMethod(paystack, { isEnabled: !paystack.isEnabled })}
          onDefault={() => paystack && void updateMethod(paystack, { isEnabled: true, isDefault: true })}
          onDisconnect={() => paystack && void disconnectGateway(paystack)}
        />

        <GatewayCard
          provider="flutterwave"
          label="Flutterwave"
          method={flutterwave}
          role={business.role}
          busy={payment.busy}
          secretKey={flutterwaveKey}
          secretHash={flutterwaveHash}
          onSecretKey={setFlutterwaveKey}
          onSecretHash={setFlutterwaveHash}
          onConnect={() => void connectGateway('flutterwave')}
          onToggle={() => flutterwave && void updateMethod(flutterwave, { isEnabled: !flutterwave.isEnabled })}
          onDefault={() => flutterwave && void updateMethod(flutterwave, { isEnabled: true, isDefault: true })}
          onDisconnect={() => flutterwave && void disconnectGateway(flutterwave)}
        />
      </Section>

      <Section title="PAY ON FULFILMENT" helper="Optional merchant-controlled offline payment choices.">
        <SimpleMethodCard
          title="Cash on delivery"
          description="Customer pays when a delivery reaches them."
          method={cod}
          canManage={canManage}
          busy={payment.busy}
          onToggle={() => void toggleSimple('cash_on_delivery', cod, 'Cash on delivery')}
          onDefault={() => cod && void updateMethod(cod, { isEnabled: true, isDefault: true })}
        />
        <SimpleMethodCard
          title="Pay on pickup"
          description="Customer pays when collecting the order."
          method={pickup}
          canManage={canManage}
          busy={payment.busy}
          onToggle={() => void toggleSimple('pay_on_pickup', pickup, 'Pay on pickup')}
          onDefault={() => pickup && void updateMethod(pickup, { isEnabled: true, isDefault: true })}
        />
      </Section>
        </View>
      )}
    </View>
  );
}

function PaymentSummary({ icon, label, value, compact = false }: { icon: string; label: string; value: string; compact?: boolean }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.paymentSummaryCard, appearance.dark && darkStyles.card]}>
      <View style={[styles.paymentSummaryIcon, appearance.dark && darkStyles.mintCard]}>
        <Ionicons name={icon as never} size={19} color="#079455" />
      </View>
      <Text numberOfLines={1} style={[compact ? styles.paymentSummaryValueSmall : styles.paymentSummaryValue, appearance.dark && darkStyles.titleText]}>
        {value}
      </Text>
      <Text style={[styles.paymentSummaryLabel, appearance.dark && darkStyles.bodyText]}>{label}</Text>
    </View>
  );
}

function GatewayCard({
  provider,
  label,
  method,
  role,
  busy,
  secretKey,
  secretHash,
  onSecretKey,
  onSecretHash,
  onConnect,
  onToggle,
  onDefault,
  onDisconnect,
}: {
  provider: GatewayProvider;
  label: string;
  method: MerchantPaymentMethod | null;
  role: MerchantBusiness['role'];
  busy: boolean;
  secretKey: string;
  secretHash?: string;
  onSecretKey: (value: string) => void;
  onSecretHash?: (value: string) => void;
  onConnect: () => void;
  onToggle: () => void;
  onDefault: () => void;
  onDisconnect: () => void;
}) {
  const owner = role === 'owner';
  const connected = method?.configurationStatus === 'configured';

  return (
    <View style={styles.methodCard}>
      <View style={styles.methodHeader}>
        <View style={styles.flex}>
          <Text style={styles.methodTitle}>{label}</Text>
          <Text style={styles.methodNote}>
            {connected ? 'Credentials connected securely' : 'Not connected'}
          </Text>
        </View>
        <Pill label={method?.isEnabled ? 'Enabled' : connected ? 'Connected' : 'Off'} positive={Boolean(method?.isEnabled)} />
      </View>

      {method?.isDefault ? <Text style={styles.defaultText}>Default customer payment method</Text> : null}

      {owner && !connected ? (
        <View style={styles.gatewayForm}>
          <Field
            label={label + ' secret key'}
            value={secretKey}
            onChangeText={onSecretKey}
            placeholder="Paste merchant secret key"
            secureTextEntry
            autoCapitalize="none"
          />
          {provider === 'flutterwave' && onSecretHash ? (
            <Field
              label="Flutterwave webhook secret hash"
              value={secretHash ?? ''}
              onChangeText={onSecretHash}
              placeholder="Paste webhook secret hash"
              secureTextEntry
              autoCapitalize="none"
            />
          ) : null}
          <Text style={styles.secretHint}>SellerTray stores an encrypted server-side copy. Raw credentials are never shown again.</Text>
          <Button
            label={busy ? 'Connecting…' : 'Connect ' + label}
            disabled={busy || !secretKey.trim() || (provider === 'flutterwave' && !(secretHash ?? '').trim())}
            onPress={onConnect}
          />
        </View>
      ) : null}

      {owner && connected ? (
        <View style={styles.actionWrap}>
          <Button
            label={method?.isEnabled ? 'Disable' : 'Enable'}
            secondary={Boolean(method?.isEnabled)}
            disabled={busy}
            onPress={onToggle}
          />
          {method && !method.isDefault && method.isEnabled ? (
            <Button label="Make default" secondary disabled={busy} onPress={onDefault} />
          ) : null}
          <Button label="Disconnect" destructive secondary disabled={busy} onPress={onDisconnect} />
        </View>
      ) : null}

      {!owner ? <Text style={styles.secretHint}>Only the business Owner can connect or change gateway credentials.</Text> : null}
    </View>
  );
}

function SimpleMethodCard({
  title,
  description,
  method,
  canManage,
  busy,
  onToggle,
  onDefault,
}: {
  title: string;
  description: string;
  method: MerchantPaymentMethod | null;
  canManage: boolean;
  busy: boolean;
  onToggle: () => void;
  onDefault: () => void;
}) {
  return (
    <View style={styles.methodCard}>
      <View style={styles.methodHeader}>
        <View style={styles.flex}>
          <Text style={styles.methodTitle}>{title}</Text>
          <Text style={styles.methodNote}>{description}</Text>
        </View>
        <Pill label={method?.isEnabled ? 'Enabled' : 'Off'} positive={Boolean(method?.isEnabled)} />
      </View>
      {method?.isDefault ? <Text style={styles.defaultText}>Default customer payment method</Text> : null}
      {canManage ? (
        <View style={styles.actionWrap}>
          <Button
            label={method?.isEnabled ? 'Disable' : 'Enable'}
            secondary={Boolean(method?.isEnabled)}
            disabled={busy}
            onPress={onToggle}
          />
          {method?.isEnabled && !method.isDefault ? (
            <Button label="Make default" secondary disabled={busy} onPress={onDefault} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function MethodCard({
  method,
  canManage,
  busy,
  onToggle,
  onDefault,
  children,
}: {
  method: MerchantPaymentMethod;
  canManage: boolean;
  busy: boolean;
  onToggle: () => void;
  onDefault: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.methodCard}>
      <View style={styles.methodHeader}>
        <View style={styles.flex}>
          <Text style={styles.methodTitle}>{method.displayName}</Text>
          {children}
        </View>
        <Pill label={method.isEnabled ? 'Enabled' : 'Off'} positive={method.isEnabled} />
      </View>
      {method.isDefault ? <Text style={styles.defaultText}>Default customer payment method</Text> : null}
      {canManage ? (
        <View style={styles.actionWrap}>
          <Button
            label={method.isEnabled ? 'Disable' : 'Enable'}
            secondary={method.isEnabled}
            disabled={busy}
            onPress={onToggle}
          />
          {method.isEnabled && !method.isDefault ? (
            <Button label="Make default" secondary disabled={busy} onPress={onDefault} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Section({
  title,
  helper,
  children,
}: {
  title: string;
  helper: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionHelper}>{helper}</Text>
      </View>
      {children}
    </View>
  );
}

function Field({
  label,
  ...props
}: {
  label: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput {...props} style={[styles.input, props.multiline && styles.inputMultiline]} />
    </View>
  );
}

function Button({
  label,
  onPress,
  secondary = false,
  destructive = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        destructive && styles.buttonDestructive,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[
        styles.buttonText,
        secondary && styles.buttonSecondaryText,
        destructive && styles.buttonDestructiveText,
      ]}>{label}</Text>
    </Pressable>
  );
}

function Pill({ label, positive }: { label: string; positive: boolean }) {
  return (
    <View style={[styles.pill, positive ? styles.pillPositive : styles.pillNeutral]}>
      <Text style={[styles.pillText, positive ? styles.pillTextPositive : styles.pillTextNeutral]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  flex: { flex: 1 },
  eyebrow: { color: '#667085', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#102A43', fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 3 },
  titleLarge: { fontSize: 31, lineHeight: 38 },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 5 },
  muted: { color: '#667085', fontSize: 12 },
  loadingCard: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10 },
  paymentHero: { minHeight: 104, borderRadius: 18, backgroundColor: '#12B76A', padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  paymentHeroIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  paymentHeroEyebrow: { color: '#E8FFF3', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  paymentHeroValue: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', marginTop: 3 },
  paymentHeroMeta: { color: '#E8FFF3', fontSize: 12, marginTop: 3 },
  paymentSummaryRow: { flexDirection: 'row', gap: 8 },
  paymentSummaryCard: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 12, gap: 3 },
  paymentSummaryIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  paymentSummaryValue: { color: '#102A43', fontSize: 21, fontWeight: '900' },
  paymentSummaryValueSmall: { color: '#102A43', fontSize: 13, fontWeight: '900', marginTop: 4 },
  paymentSummaryLabel: { color: '#667085', fontSize: 10, fontWeight: '900', letterSpacing: 0.3, marginTop: 3 },
  segmentedControl: { flexDirection: 'row', backgroundColor: '#F2F4F7', borderRadius: 12, padding: 3, gap: 3 },
  segmentButton: { flex: 1, minHeight: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  segmentButtonActive: { backgroundColor: '#FFFFFF' },
  segmentText: { color: '#667085', fontSize: 12, fontWeight: '900' },
  segmentTextActive: { color: '#079455' },
  viewStack: { gap: 16 },
  infoCard: { backgroundColor: '#ECFDF3', borderRadius: 14, padding: 13, gap: 4 },
  infoTitle: { color: '#079455', fontSize: 12, fontWeight: '900' },
  infoText: { color: '#1849A9', fontSize: 11, lineHeight: 17 },
  readOnlyCard: { backgroundColor: '#F9FAFB', borderRadius: 14, padding: 13, gap: 4 },
  readOnlyTitle: { color: '#344054', fontSize: 12, fontWeight: '900' },
  readOnlyText: { color: '#667085', fontSize: 11, lineHeight: 17 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 14, padding: 13, gap: 4 },
  errorTitle: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 11, lineHeight: 17 },
  retryText: { color: '#12B76A', fontSize: 11, fontWeight: '900', marginTop: 4 },
  successCard: { backgroundColor: '#ECFDF3', borderRadius: 14, padding: 12 },
  successText: { color: '#027A48', fontSize: 11, lineHeight: 17, fontWeight: '800' },
  section: { gap: 10 },
  sectionTitle: { color: '#344054', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  sectionHelper: { color: '#667085', fontSize: 10, lineHeight: 15, marginTop: 2 },
  methodCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 15, padding: 13, gap: 9 },
  methodHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  methodTitle: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  methodNote: { color: '#667085', fontSize: 10, lineHeight: 15, marginTop: 3 },
  accountName: { color: '#344054', fontSize: 11, fontWeight: '800', marginTop: 4 },
  accountMeta: { color: '#667085', fontSize: 10, marginTop: 2 },
  defaultText: { color: '#079455', fontSize: 10, fontWeight: '900' },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  pillPositive: { backgroundColor: '#ECFDF3' },
  pillNeutral: { backgroundColor: '#F2F4F7' },
  pillText: { fontSize: 9, fontWeight: '900' },
  pillTextPositive: { color: '#027A48' },
  pillTextNeutral: { color: '#667085' },
  formCard: { backgroundColor: '#F9FAFB', borderRadius: 14, padding: 12, gap: 10 },
  gatewayForm: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 10, gap: 9 },
  field: { gap: 5 },
  fieldLabel: { color: '#344054', fontSize: 10, fontWeight: '800' },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingHorizontal: 11, backgroundColor: '#FFFFFF', color: '#102A43', fontSize: 12 },
  inputMultiline: { minHeight: 78, textAlignVertical: 'top', paddingTop: 10 },
  secretHint: { color: '#667085', fontSize: 9, lineHeight: 14 },
  row: { flexDirection: 'row', gap: 8 },
  actionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  button: { minHeight: 42, borderRadius: 10, backgroundColor: '#12B76A', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  buttonSecondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD' },
  buttonDestructive: { borderColor: '#FDA29B', backgroundColor: '#FFFBFA' },
  buttonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  buttonSecondaryText: { color: '#344054' },
  buttonDestructiveText: { color: '#B42318' },
  emptyText: { color: '#667085', fontSize: 11, lineHeight: 17 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});

const darkStyles = StyleSheet.create({
  surface: { backgroundColor: '#081825' },
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46', borderColor: '#344054' },
  mintCard: { backgroundColor: '#12372C', borderColor: '#1C6B4A' },
  errorCard: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
});
