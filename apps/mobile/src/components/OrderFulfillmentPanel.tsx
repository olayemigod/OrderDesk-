import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { OrderFulfillmentInput } from '../data/ordersRepository';
import type { FulfillmentMethod, MerchantOrder } from '../domain/order';

type Props = {
  order: MerchantOrder;
  onStartDelivery: (input: OrderFulfillmentInput) => Promise<void>;
  onCompleteFulfillment: (input: OrderFulfillmentInput) => Promise<void>;
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
}: Props) {
  const [method, setMethod] = useState<FulfillmentMethod | null>(order.fulfillmentMethod);
  const [provider, setProvider] = useState(order.deliveryProvider ?? '');
  const [reference, setReference] = useState(order.deliveryReference ?? '');
  const [note, setNote] = useState(order.deliveryNote ?? '');
  const [pending, setPending] = useState<'start' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMethod(order.fulfillmentMethod);
    setProvider(order.deliveryProvider ?? '');
    setReference(order.deliveryReference ?? '');
    setNote(order.deliveryNote ?? '');
    setPending(null);
    setError(null);
  }, [
    order.id,
    order.fulfillmentMethod,
    order.fulfillmentStatus,
    order.deliveryProvider,
    order.deliveryReference,
    order.deliveryNote,
  ]);

  if (order.status !== 'ready' && order.status !== 'completed') return null;

  if (order.status === 'completed') {
    return (
      <View style={styles.completedCard}>
        <Text style={styles.eyebrow}>FULFILLMENT</Text>
        <Text style={styles.title}>
          {order.fulfillmentStatus === 'collected'
            ? 'Collected by customer'
            : order.fulfillmentStatus === 'delivered'
              ? 'Delivered'
              : 'Completion method not recorded'}
        </Text>
        {order.fulfillmentMethod ? (
          <Text style={styles.summaryLine}>Method: {methodLabels[order.fulfillmentMethod]}</Text>
        ) : (
          <Text style={styles.help}>
            This order was completed before SellerTray started recording pickup and delivery details.
          </Text>
        )}
        {order.deliveryProvider ? <Text style={styles.summaryLine}>Delivery by: {order.deliveryProvider}</Text> : null}
        {order.deliveryReference ? <Text style={styles.summaryLine}>Reference / phone: {order.deliveryReference}</Text> : null}
        {order.deliveryNote ? <Text style={styles.summaryLine}>Note: {order.deliveryNote}</Text> : null}
        {order.fulfilledAt ? <Text style={styles.timeText}>{formatDateTime(order.fulfilledAt)}</Text> : null}
      </View>
    );
  }

  const inDelivery = order.fulfillmentStatus === 'out_for_delivery';

  async function run(action: 'start' | 'complete', operation: () => Promise<void>) {
    if (pending) return;
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
        note: note.trim() || null,
      }
    : null;

  if (inDelivery) {
    const liveMethod = order.fulfillmentMethod ?? method;
    return (
      <View style={styles.deliveryCard}>
        <Text style={styles.eyebrow}>DELIVERY</Text>
        <Text style={styles.title}>Out for delivery</Text>
        <Text style={styles.help}>SellerTray keeps this order active until the merchant confirms delivery.</Text>
        {liveMethod ? <Text style={styles.summaryLine}>Method: {methodLabels[liveMethod]}</Text> : null}
        {order.deliveryProvider ? <Text style={styles.summaryLine}>Delivery by: {order.deliveryProvider}</Text> : null}
        {order.deliveryReference ? <Text style={styles.summaryLine}>Reference / phone: {order.deliveryReference}</Text> : null}
        {order.deliveryNote ? <Text style={styles.summaryLine}>Note: {order.deliveryNote}</Text> : null}
        {order.dispatchedAt ? <Text style={styles.timeText}>Dispatched {formatDateTime(order.dispatchedAt)}</Text> : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          disabled={pending !== null || !liveMethod}
          onPress={() => {
            if (!liveMethod) return;
            void run('complete', () =>
              onCompleteFulfillment({
                method: liveMethod,
                provider: order.deliveryProvider,
                reference: order.deliveryReference,
                note: order.deliveryNote,
              }),
            );
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            pending !== null && styles.disabled,
            pressed && pending === null && styles.pressed,
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
    <View style={styles.card}>
      <Text style={styles.eyebrow}>FULFILLMENT</Text>
      <Text style={styles.title}>How will this order reach the customer?</Text>
      <Text style={styles.help}>
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
            <Text style={styles.label}>Delivery partner / rider</Text>
            <Text style={styles.fieldHelp}>Optional, e.g. Owner, staff rider, GIG Logistics, Kwik.</Text>
            <TextInput
              value={provider}
              onChangeText={setProvider}
              placeholder="Who is delivering?"
              maxLength={120}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Reference or rider phone</Text>
            <Text style={styles.fieldHelp}>Optional dispatch reference, tracking number or contact.</Text>
            <TextInput
              value={reference}
              onChangeText={setReference}
              placeholder="Reference / phone"
              maxLength={120}
              style={styles.input}
            />
          </View>
        </View>
      ) : null}

      {method ? (
        <View style={styles.field}>
          <Text style={styles.label}>Fulfillment note</Text>
          <Text style={styles.fieldHelp}>Optional instruction or handover note.</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Optional note"
            maxLength={300}
            multiline
            style={[styles.input, styles.noteInput]}
          />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {method === 'customer_pickup' && input ? (
        <Pressable
          disabled={pending !== null}
          onPress={() => void run('complete', () => onCompleteFulfillment(input))}
          style={({ pressed }) => [
            styles.primaryButton,
            pending !== null && styles.disabled,
            pressed && pending === null && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {pending === 'complete' ? 'Completing…' : 'Mark collected & complete'}
          </Text>
        </Pressable>
      ) : null}

      {method && method !== 'customer_pickup' && input ? (
        <Pressable
          disabled={pending !== null}
          onPress={() => void run('start', () => onStartDelivery(input))}
          style={({ pressed }) => [
            styles.primaryButton,
            pending !== null && styles.disabled,
            pressed && pending === null && styles.pressed,
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
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.methodButton,
        active && styles.methodButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.methodText, active && styles.methodTextActive]}>{label}</Text>
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

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 14, padding: 14, gap: 11 },
  deliveryCard: { backgroundColor: '#EFF8FF', borderWidth: 1, borderColor: '#B2DDFF', borderRadius: 14, padding: 14, gap: 8 },
  completedCard: { backgroundColor: '#ECFDF3', borderWidth: 1, borderColor: '#ABEFC6', borderRadius: 14, padding: 14, gap: 6 },
  eyebrow: { color: '#667085', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#101828', fontSize: 16, fontWeight: '900' },
  help: { color: '#667085', fontSize: 11, lineHeight: 17 },
  methodList: { gap: 7 },
  methodButton: { minHeight: 44, justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', paddingHorizontal: 12 },
  methodButtonActive: { borderColor: '#246BFD', backgroundColor: '#EEF4FF' },
  methodText: { color: '#344054', fontSize: 12, fontWeight: '800' },
  methodTextActive: { color: '#175CD3' },
  fields: { gap: 10 },
  field: { gap: 5 },
  label: { color: '#344054', fontSize: 12, fontWeight: '900' },
  fieldHelp: { color: '#667085', fontSize: 10, lineHeight: 15 },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingHorizontal: 11, backgroundColor: '#FFFFFF', color: '#101828' },
  noteInput: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
  summaryLine: { color: '#344054', fontSize: 11, lineHeight: 17, fontWeight: '700' },
  timeText: { color: '#667085', fontSize: 10, marginTop: 2 },
  error: { color: '#B42318', backgroundColor: '#FEF3F2', borderRadius: 8, padding: 9, fontSize: 10, lineHeight: 15 },
  primaryButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#246BFD', paddingHorizontal: 12 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.78 },
});
