import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { GateDecision } from '../data/orderGateRepository';
import type { OrderFulfillmentInput } from '../data/ordersRepository';
import type { FulfillmentMethod, MerchantOrder } from '../domain/order';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  order: MerchantOrder;
  onStartDelivery: (input: OrderFulfillmentInput) => Promise<void>;
  onCompleteFulfillment: (input: OrderFulfillmentInput) => Promise<void>;
  dispatchGate?: GateDecision | null;
  completeGate?: GateDecision | null;
};

const methodLabels: Record<FulfillmentMethod, string> = {
  customer_pickup: 'Customer pickup',
  merchant_delivery: 'Merchant / own rider',
  third_party_delivery: 'Third-party dispatch',
};

export function OrderFulfillmentPanel({
  order,
  onStartDelivery,
  onCompleteFulfillment,
  dispatchGate = null,
  completeGate = null,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const [method, setMethod] = useState<FulfillmentMethod | null>(order.fulfillmentMethod);
  const [provider, setProvider] = useState(order.deliveryProvider ?? '');
  const [reference, setReference] = useState(order.deliveryReference ?? '');
  const [contactName, setContactName] = useState(order.deliveryContactName ?? '');
  const [contactPhone, setContactPhone] = useState(order.deliveryContactPhone ?? '');
  const [etaDate, setEtaDate] = useState(formatEtaDate(order.estimatedDeliveryAt));
  const [etaTime, setEtaTime] = useState(formatEtaTime(order.estimatedDeliveryAt));
  const [note, setNote] = useState(order.deliveryNote ?? '');
  const [pending, setPending] = useState<'start' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMethod(order.fulfillmentMethod);
    setProvider(order.deliveryProvider ?? '');
    setReference(order.deliveryReference ?? '');
    setContactName(order.deliveryContactName ?? '');
    setContactPhone(order.deliveryContactPhone ?? '');
    setEtaDate(formatEtaDate(order.estimatedDeliveryAt));
    setEtaTime(formatEtaTime(order.estimatedDeliveryAt));
    setNote(order.deliveryNote ?? '');
    setPending(null);
    setError(null);
  }, [
    order.id,
    order.fulfillmentMethod,
    order.fulfillmentStatus,
    order.deliveryProvider,
    order.deliveryReference,
    order.deliveryContactName,
    order.deliveryContactPhone,
    order.estimatedDeliveryAt,
    order.deliveryNote,
  ]);

  if (order.status !== 'ready' && order.status !== 'completed') return null;

  if (order.status === 'completed') {
    return (
      <View style={[styles.completedCard, appearance.dark && darkStyles.successCard]}>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>FULFILLMENT</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>
          {order.fulfillmentStatus === 'collected'
            ? 'Collected by customer'
            : order.fulfillmentStatus === 'delivered'
              ? 'Delivered'
              : 'Completion method not recorded'}
        </Text>
        {order.fulfillmentMethod ? (
          <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Method: {methodLabels[order.fulfillmentMethod]}</Text>
        ) : (
          <Text style={[styles.help, appearance.dark && darkStyles.bodyText]}>
            This order was completed before SellerTray started recording pickup and delivery details.
          </Text>
        )}
        {order.deliveryProvider ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Delivery by: {order.deliveryProvider}</Text> : null}
        {order.deliveryContactName ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Contact: {order.deliveryContactName}</Text> : null}
        {order.deliveryContactPhone ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Phone: {order.deliveryContactPhone}</Text> : null}
        {order.deliveryReference ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Reference: {order.deliveryReference}</Text> : null}
        {order.estimatedDeliveryAt ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Estimated delivery: {formatDateTime(order.estimatedDeliveryAt)}</Text> : null}
        {order.deliveryNote ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Note: {order.deliveryNote}</Text> : null}
        {order.fulfillmentConfirmedBy === 'customer_whatsapp' ? (
          <Text style={styles.customerConfirmed}>Customer confirmed receipt on WhatsApp</Text>
        ) : order.fulfillmentConfirmedBy === 'merchant' ? (
          <Text style={[styles.merchantConfirmed, appearance.dark && darkStyles.bodyText]}>Confirmed by merchant</Text>
        ) : null}
        {order.customerConfirmedAt ? (
          <Text style={[styles.timeText, appearance.dark && darkStyles.bodyText]}>Customer confirmed {formatDateTime(order.customerConfirmedAt)}</Text>
        ) : order.fulfilledAt ? (
          <Text style={[styles.timeText, appearance.dark && darkStyles.bodyText]}>{formatDateTime(order.fulfilledAt)}</Text>
        ) : null}
      </View>
    );
  }

  const inDelivery = order.fulfillmentStatus === 'out_for_delivery';

  const eta = parseLocalEta(etaDate, etaTime);

  async function run(action: 'start' | 'complete', operation: () => Promise<void>) {
    if (pending) return;
    if (eta.error) {
      setError(eta.error);
      return;
    }
    setPending(action);
    setError(null);
    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SellerTray could not update fulfillment.');
    } finally {
      setPending(null);
    }
  }

  const input: OrderFulfillmentInput | null = method
    ? {
        method,
        provider: provider.trim() || null,
        reference: reference.trim() || null,
        contactName: contactName.trim() || null,
        contactPhone: contactPhone.trim() || null,
        estimatedDeliveryAt: eta.value,
        note: note.trim() || null,
      }
    : null;

  if (inDelivery) {
    const liveMethod = order.fulfillmentMethod ?? method;
    return (
      <View style={[styles.deliveryCard, appearance.dark && darkStyles.infoCard]}>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>DELIVERY</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Out for delivery</Text>
        <Text style={[styles.help, appearance.dark && darkStyles.bodyText]}>SellerTray keeps this order active until the merchant confirms delivery.</Text>
        {liveMethod ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Method: {methodLabels[liveMethod]}</Text> : null}
        {order.deliveryProvider ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Delivery by: {order.deliveryProvider}</Text> : null}
        {order.deliveryContactName ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Contact: {order.deliveryContactName}</Text> : null}
        {order.deliveryContactPhone ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Phone: {order.deliveryContactPhone}</Text> : null}
        {order.deliveryReference ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Reference: {order.deliveryReference}</Text> : null}
        {order.estimatedDeliveryAt ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>ETA: {formatDateTime(order.estimatedDeliveryAt)}</Text> : null}
        {order.deliveryNote ? <Text style={[styles.summaryLine, appearance.dark && darkStyles.bodyText]}>Note: {order.deliveryNote}</Text> : null}
        {order.dispatchedAt ? <Text style={[styles.timeText, appearance.dark && darkStyles.bodyText]}>Dispatched {formatDateTime(order.dispatchedAt)}</Text> : null}

        {completeGate && !completeGate.allowed ? (
          <View style={[styles.gateCard, appearance.dark && darkStyles.warningCard]}>
            <Text style={[styles.gateTitle, appearance.dark && darkStyles.warningTitle]}>Payment gate active</Text>
            <Text style={[styles.gateText, appearance.dark && darkStyles.warningText]}>
              {completeGate.reason ?? 'Payment must be resolved before this delivery can be completed.'}
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          disabled={pending !== null || !liveMethod || (completeGate ? !completeGate.allowed : false)}
          onPress={() => {
            if (!liveMethod) return;
            void run('complete', () =>
              onCompleteFulfillment({
                method: liveMethod,
                provider: order.deliveryProvider,
                reference: order.deliveryReference,
                contactName: order.deliveryContactName,
                contactPhone: order.deliveryContactPhone,
                estimatedDeliveryAt: order.estimatedDeliveryAt,
                note: order.deliveryNote,
              }),
            );
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            (pending !== null || (completeGate ? !completeGate.allowed : false)) && styles.disabled,
            pressed && pending === null && (!completeGate || completeGate.allowed) && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {pending === 'complete' ? 'Completing…' : 'Mark delivered & complete'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, appearance.dark && darkStyles.card]}>
      <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>FULFILLMENT</Text>
      <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>How will this order reach the customer?</Text>
      <Text style={[styles.help, appearance.dark && darkStyles.bodyText]}>
        Record the handover method so completed orders show whether they were collected, delivered by your team, or sent with a dispatch partner.
      </Text>

      <View style={styles.methodList}>
        <MethodButton
          label="Customer pickup"
          active={method === 'customer_pickup'}
          onPress={() => setMethod('customer_pickup')}
        />
        <MethodButton
          label="Merchant / own rider"
          active={method === 'merchant_delivery'}
          onPress={() => setMethod('merchant_delivery')}
        />
        <MethodButton
          label="Third-party dispatch"
          active={method === 'third_party_delivery'}
          onPress={() => setMethod('third_party_delivery')}
        />
      </View>

      {method && method !== 'customer_pickup' ? (
        <View style={styles.fields}>
          <View style={styles.field}>
            <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>Delivery partner / rider</Text>
            <Text style={[styles.fieldHelp, appearance.dark && darkStyles.bodyText]}>Optional, e.g. Owner, staff rider, GIG Logistics, Kwik.</Text>
            <TextInput
              value={provider}
              onChangeText={setProvider}
              placeholder="Who is delivering?"
              placeholderTextColor={appearance.dark ? '#667085' : '#98A2B3'}
              maxLength={120}
              style={[styles.input, appearance.dark && darkStyles.input]}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>Delivery contact name</Text>
            <Text style={[styles.fieldHelp, appearance.dark && darkStyles.bodyText]}>Optional rider, staff member or dispatch contact.</Text>
            <TextInput
              value={contactName}
              onChangeText={setContactName}
              placeholder="Contact name"
              placeholderTextColor={appearance.dark ? '#667085' : '#98A2B3'}
              maxLength={120}
              style={[styles.input, appearance.dark && darkStyles.input]}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>Contact phone</Text>
            <Text style={[styles.fieldHelp, appearance.dark && darkStyles.bodyText]}>Optional number the merchant or customer can use for this delivery.</Text>
            <TextInput
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="Phone number"
              placeholderTextColor={appearance.dark ? '#667085' : '#98A2B3'}
              keyboardType="phone-pad"
              maxLength={50}
              style={[styles.input, appearance.dark && darkStyles.input]}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>Dispatch reference</Text>
            <Text style={[styles.fieldHelp, appearance.dark && darkStyles.bodyText]}>Optional tracking or dispatch reference.</Text>
            <TextInput
              value={reference}
              onChangeText={setReference}
              placeholder="Tracking / dispatch reference"
              placeholderTextColor={appearance.dark ? '#667085' : '#98A2B3'}
              maxLength={120}
              style={[styles.input, appearance.dark && darkStyles.input]}
            />
          </View>

          <View style={styles.etaRow}>
            <View style={styles.etaField}>
              <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>ETA date</Text>
              <TextInput
                value={etaDate}
                onChangeText={setEtaDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={appearance.dark ? '#667085' : '#98A2B3'}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                style={[styles.input, appearance.dark && darkStyles.input]}
              />
            </View>
            <View style={styles.etaField}>
              <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>ETA time</Text>
              <TextInput
                value={etaTime}
                onChangeText={setEtaTime}
                placeholder="HH:MM"
                placeholderTextColor={appearance.dark ? '#667085' : '#98A2B3'}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                style={[styles.input, appearance.dark && darkStyles.input]}
              />
            </View>
          </View>
          <Text style={[styles.fieldHelp, appearance.dark && darkStyles.bodyText]}>
            ETA is optional. Enter both date and time if you want SellerTray to record it.
          </Text>
        </View>
      ) : null}

      {method ? (
        <View style={styles.field}>
          <Text style={[styles.label, appearance.dark && darkStyles.titleText]}>Fulfillment note</Text>
          <Text style={[styles.fieldHelp, appearance.dark && darkStyles.bodyText]}>Optional instruction or handover note.</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Optional note"
            placeholderTextColor={appearance.dark ? '#667085' : '#98A2B3'}
            maxLength={300}
            multiline
            style={[styles.input, styles.noteInput, appearance.dark && darkStyles.input]}
          />
        </View>
      ) : null}

      {method === 'customer_pickup' && completeGate && !completeGate.allowed ? (
        <View style={[styles.gateCard, appearance.dark && darkStyles.warningCard]}>
          <Text style={[styles.gateTitle, appearance.dark && darkStyles.warningTitle]}>Payment gate active</Text>
          <Text style={[styles.gateText, appearance.dark && darkStyles.warningText]}>
            {completeGate.reason ?? 'Payment must be resolved before pickup can be completed.'}
          </Text>
        </View>
      ) : null}

      {method && method !== 'customer_pickup' && dispatchGate && !dispatchGate.allowed ? (
        <View style={[styles.gateCard, appearance.dark && darkStyles.warningCard]}>
          <Text style={[styles.gateTitle, appearance.dark && darkStyles.warningTitle]}>Dispatch blocked by payment policy</Text>
          <Text style={[styles.gateText, appearance.dark && darkStyles.warningText]}>
            {dispatchGate.reason ?? 'Payment must be resolved before this order can be dispatched.'}
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {method === 'customer_pickup' && input ? (
        <Pressable
          disabled={pending !== null || (completeGate ? !completeGate.allowed : false)}
          onPress={() => void run('complete', () => onCompleteFulfillment(input))}
          style={({ pressed }) => [
            styles.primaryButton,
            (pending !== null || (completeGate ? !completeGate.allowed : false)) && styles.disabled,
            pressed && pending === null && (!completeGate || completeGate.allowed) && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {pending === 'complete' ? 'Completing…' : 'Mark collected & complete'}
          </Text>
        </Pressable>
      ) : null}

      {method && method !== 'customer_pickup' && input ? (
        <Pressable
          disabled={pending !== null || (dispatchGate ? !dispatchGate.allowed : false)}
          onPress={() => void run('start', () => onStartDelivery(input))}
          style={({ pressed }) => [
            styles.primaryButton,
            (pending !== null || (dispatchGate ? !dispatchGate.allowed : false)) && styles.disabled,
            pressed && pending === null && (!dispatchGate || dispatchGate.allowed) && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {pending === 'start' ? 'Starting delivery…' : 'Start delivery'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function MethodButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.methodButton,
        appearance.dark && darkStyles.secondaryButton,
        active && styles.methodButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.methodText, appearance.dark && darkStyles.titleText, active && styles.methodTextActive]}>{label}</Text>
    </Pressable>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatEtaDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function formatEtaTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function parseLocalEta(dateValue: string, timeValue: string): { value: string | null; error: string | null } {
  const dateText = dateValue.trim();
  const timeText = timeValue.trim();
  if (!dateText && !timeText) return { value: null, error: null };
  if (!dateText || !timeText) return { value: null, error: 'Enter both ETA date and ETA time, or leave both blank.' };

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeText);
  if (!dateMatch || !timeMatch) {
    return { value: null, error: 'ETA must use YYYY-MM-DD and HH:MM.' };
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return { value: null, error: 'Enter a valid ETA date and time.' };
  }

  return { value: date.toISOString(), error: null };
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 14, padding: 14, gap: 11 },
  deliveryCard: { backgroundColor: '#EFF8FF', borderWidth: 1, borderColor: '#B2DDFF', borderRadius: 14, padding: 14, gap: 8 },
  completedCard: { backgroundColor: '#ECFDF3', borderWidth: 1, borderColor: '#ABEFC6', borderRadius: 14, padding: 14, gap: 6 },
  eyebrow: { color: '#667085', fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 16, fontWeight: '900' },
  help: { color: '#667085', fontSize: 13, lineHeight: 20 },
  methodList: { gap: 7 },
  methodButton: { minHeight: 44, justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', paddingHorizontal: 12 },
  methodButtonActive: { borderColor: '#12B76A', backgroundColor: '#ECFDF3' },
  methodText: { color: '#344054', fontSize: 14, fontWeight: '800' },
  methodTextActive: { color: '#079455' },
  fields: { gap: 10 },
  field: { gap: 5 },
  etaRow: { flexDirection: 'row', gap: 10 },
  etaField: { flex: 1, gap: 5 },
  label: { color: '#344054', fontSize: 14, fontWeight: '900' },
  fieldHelp: { color: '#667085', fontSize: 12, lineHeight: 18 },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingHorizontal: 11, backgroundColor: '#FFFFFF', color: '#102A43' },
  noteInput: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
  summaryLine: { color: '#344054', fontSize: 13, lineHeight: 20, fontWeight: '700' },
  customerConfirmed: { color: '#027A48', fontSize: 13, lineHeight: 17, fontWeight: '900', marginTop: 3 },
  merchantConfirmed: { color: '#344054', fontSize: 13, lineHeight: 17, fontWeight: '800', marginTop: 3 },
  timeText: { color: '#667085', fontSize: 12, marginTop: 2 },
  gateCard: { backgroundColor: '#FFF8E7', borderRadius: 10, padding: 10, gap: 3 },
  gateTitle: { color: '#7A2E0E', fontSize: 13, fontWeight: '900' },
  gateText: { color: '#854A0E', fontSize: 12, lineHeight: 18 },
  error: { color: '#B42318', backgroundColor: '#FEF3F2', borderRadius: 8, padding: 9, fontSize: 12, lineHeight: 15 },
  primaryButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#12B76A', paddingHorizontal: 12 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.78 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#475467' },
  infoCard: { backgroundColor: '#102D45', borderColor: '#344054' },
  successCard: { backgroundColor: '#12372C', borderColor: '#1C6B4A' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  input: { backgroundColor: '#F8FAFC', borderColor: '#98A2B3', color: '#102A43' },
  secondaryButton: { backgroundColor: '#162F46', borderColor: '#667085' },
  warningCard: { backgroundColor: '#3D2A12', borderColor: '#B54708' },
  warningTitle: { color: '#FEDF89' },
  warningText: { color: '#FEC84B' },
});
