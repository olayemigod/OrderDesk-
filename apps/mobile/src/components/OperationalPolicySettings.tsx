import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import type {
  OperationalPolicy,
  PaymentGate,
  WhatsAppPushMode,
} from '../data/operationalPolicyRepository';
import { useOperationalPolicy } from '../hooks/useOperationalPolicy';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

export function OperationalPolicySettings({ business }: { business: MerchantBusiness }) {
  const appearance = useSellerTrayAppearance();
  const { policy, loading, saving, error, save } = useOperationalPolicy(business.id);
  const [draft, setDraft] = useState<OperationalPolicy>(policy);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = business.role === 'owner' || business.role === 'manager';

  useEffect(() => {
    setDraft(policy);
    setNotice(null);
  }, [policy, business.id]);

  if (loading) {
    return (
      <View style={[styles.loadingCard, appearance.dark && darkStyles.card]}>
        <ActivityIndicator />
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>Loading order and delivery policy…</Text>
      </View>
    );
  }

  async function persist() {
    if (!canEdit || saving) return;
    setNotice(null);
    try {
      await save(draft);
      setNotice('Operational policy saved.');
    } catch {
      // Hook exposes the error below.
    }
  }

  return (
    <View style={styles.wrap}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>ORDER CONTROLS</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Payment & delivery policy</Text>
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>
          Decide when payment becomes a hard gate and what evidence staff must capture before dispatch or completion.
        </Text>
      </View>

      <View style={[styles.card, appearance.dark && darkStyles.card]}>
        <Text style={[styles.cardTitle, appearance.dark && darkStyles.titleText]}>Payment gate</Text>
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>
          SellerTray enforces this policy on the server, not only in the app.
        </Text>
        <GateOption label="No compulsory payment gate" value="none" active={draft.paymentGate === 'none'} disabled={!canEdit || saving} onPress={setPaymentGate} />
        <GateOption label="Before processing starts" value="before_processing" active={draft.paymentGate === 'before_processing'} disabled={!canEdit || saving} onPress={setPaymentGate} />
        <GateOption label="Before order is marked ready" value="before_ready" active={draft.paymentGate === 'before_ready'} disabled={!canEdit || saving} onPress={setPaymentGate} />
        <GateOption label="Before fulfilment / dispatch" value="before_fulfillment" active={draft.paymentGate === 'before_fulfillment'} disabled={!canEdit || saving} onPress={setPaymentGate} />

        <PolicyToggle
          label="Allow unpaid cash-on-delivery dispatch"
          helper="Delivery may start, but payment can still be required before the order is completed."
          value={draft.allowCodDispatchUnpaid}
          disabled={!canEdit || saving}
          onChange={(value) => setDraft((current) => ({ ...current, allowCodDispatchUnpaid: value }))}
        />
        <PolicyToggle
          label="Require COD payment before completion"
          helper="Staff must confirm the cash payment before marking delivery complete."
          value={draft.requireCodPaymentBeforeCompletion}
          disabled={!canEdit || saving}
          onChange={(value) => setDraft((current) => ({ ...current, requireCodPaymentBeforeCompletion: value }))}
        />
        <PolicyToggle
          label="Allow unpaid pay-on-pickup orders to become ready"
          helper="The customer can arrive before payment is recorded."
          value={draft.allowPickupReadyUnpaid}
          disabled={!canEdit || saving}
          onChange={(value) => setDraft((current) => ({ ...current, allowPickupReadyUnpaid: value }))}
        />
        <PolicyToggle
          label="Require pickup payment before completion"
          helper="Payment must be confirmed before the collection is closed."
          value={draft.requirePickupPaymentBeforeCompletion}
          disabled={!canEdit || saving}
          onChange={(value) => setDraft((current) => ({ ...current, requirePickupPaymentBeforeCompletion: value }))}
        />
      </View>

      <View style={[styles.card, appearance.dark && darkStyles.card]}>
        <Text style={[styles.cardTitle, appearance.dark && darkStyles.titleText]}>Delivery evidence</Text>
        <PolicyToggle
          label="Require delivery partner / rider"
          helper="Prevents dispatch until a rider, staff member or logistics partner is recorded."
          value={draft.requireDeliveryProvider}
          disabled={!canEdit || saving}
          onChange={(value) => setDraft((current) => ({ ...current, requireDeliveryProvider: value }))}
        />
        <PolicyToggle
          label="Require dispatch reference / rider phone"
          helper="Useful for logistics references, tracking IDs or rider contact numbers."
          value={draft.requireDeliveryReference}
          disabled={!canEdit || saving}
          onChange={(value) => setDraft((current) => ({ ...current, requireDeliveryReference: value }))}
        />
        <PolicyToggle
          label="Require customer WhatsApp confirmation"
          helper="Merchant-only completion is blocked until the customer confirms receipt on WhatsApp."
          value={draft.requireCustomerDeliveryConfirmation}
          disabled={!canEdit || saving}
          onChange={(value) => setDraft((current) => ({ ...current, requireCustomerDeliveryConfirmation: value }))}
        />
      </View>

      <View style={[styles.card, appearance.dark && darkStyles.card]}>
        <Text style={[styles.cardTitle, appearance.dark && darkStyles.titleText]}>Merchant WhatsApp push</Text>
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>
          Conversation unread counts always include unread messages. This setting controls which WhatsApp events also become SellerTray bell / phone notifications.
        </Text>
        <PushOption label="Actionable only" helper="Recommended: orders, change requests and payment events." value="actionable_only" active={draft.whatsappPushMode === 'actionable_only'} disabled={!canEdit || saving} onPress={setPushMode} />
        <PushOption label="All customer messages" helper="Every processed WhatsApp message may also create a SellerTray alert." value="all_messages" active={draft.whatsappPushMode === 'all_messages'} disabled={!canEdit || saving} onPress={setPushMode} />
      </View>

      {!canEdit ? (
        <Text style={[styles.body, appearance.dark && darkStyles.bodyText]}>Only an Owner or Manager can change these rules.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {canEdit ? (
        <Pressable disabled={saving} onPress={() => void persist()} style={[styles.saveButton, saving && styles.disabled]}>
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save operational policy'}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  function setPaymentGate(value: PaymentGate) {
    setDraft((current) => ({ ...current, paymentGate: value }));
  }

  function setPushMode(value: WhatsAppPushMode) {
    setDraft((current) => ({ ...current, whatsappPushMode: value }));
  }
}

function GateOption({ label, value, active, disabled, onPress }: {
  label: string;
  value: PaymentGate;
  active: boolean;
  disabled: boolean;
  onPress: (value: PaymentGate) => void;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable disabled={disabled} onPress={() => onPress(value)} style={[styles.option, appearance.dark && darkStyles.option, active && styles.optionActive, appearance.dark && active && darkStyles.optionActive]}>
      <View style={[styles.radio, active && styles.radioActive]}>{active ? <View style={styles.radioDot} /> : null}</View>
      <Text style={[styles.optionText, appearance.dark && darkStyles.titleText]}>{label}</Text>
    </Pressable>
  );
}

function PushOption({ label, helper, value, active, disabled, onPress }: {
  label: string;
  helper: string;
  value: WhatsAppPushMode;
  active: boolean;
  disabled: boolean;
  onPress: (value: WhatsAppPushMode) => void;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable disabled={disabled} onPress={() => onPress(value)} style={[styles.option, styles.pushOption, appearance.dark && darkStyles.option, active && styles.optionActive, appearance.dark && active && darkStyles.optionActive]}>
      <View style={[styles.radio, active && styles.radioActive]}>{active ? <View style={styles.radioDot} /> : null}</View>
      <View style={styles.flex}>
        <Text style={[styles.optionText, appearance.dark && darkStyles.titleText]}>{label}</Text>
        <Text style={[styles.optionHelper, appearance.dark && darkStyles.bodyText]}>{helper}</Text>
      </View>
    </Pressable>
  );
}

function PolicyToggle({ label, helper, value, disabled, onChange }: {
  label: string;
  helper: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.toggleRow, appearance.dark && darkStyles.rowBorder]}>
      <View style={styles.flex}>
        <Text style={[styles.toggleLabel, appearance.dark && darkStyles.titleText]}>{label}</Text>
        <Text style={[styles.optionHelper, appearance.dark && darkStyles.bodyText]}>{helper}</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  flex: { flex: 1 },
  eyebrow: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 26, lineHeight: 32, fontWeight: '900', marginTop: 3 },
  body: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 4 },
  loadingCard: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 16 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, padding: 14, gap: 10 },
  cardTitle: { color: '#102A43', fontSize: 17, fontWeight: '900' },
  option: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  pushOption: { alignItems: 'flex-start' },
  optionActive: { borderColor: '#12B76A', backgroundColor: '#ECFDF3' },
  optionText: { color: '#344054', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  optionHelper: { color: '#667085', fontSize: 13, lineHeight: 19, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 99, borderWidth: 2, borderColor: '#98A2B3', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioActive: { borderColor: '#12B76A' },
  radioDot: { width: 10, height: 10, borderRadius: 99, backgroundColor: '#12B76A' },
  toggleRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E4E7EC' },
  toggleLabel: { color: '#344054', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  saveButton: { minHeight: 50, borderRadius: 12, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  error: { color: '#F97066', fontSize: 13, lineHeight: 19 },
  notice: { color: '#32D583', fontSize: 13, lineHeight: 19, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  option: { backgroundColor: '#162F46', borderColor: '#475467' },
  optionActive: { backgroundColor: '#12372C', borderColor: '#12B76A' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  rowBorder: { borderBottomColor: '#344054' },
});
