import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import type { NotificationSettings } from '../data/notificationRepository';
import { useNotificationSettings } from '../hooks/useNotificationSettings';

type Props = {
  business: MerchantBusiness;
};

export function CustomerNotificationSettings({ business }: Props) {
  const canEdit = business.role === 'owner' || business.role === 'manager';
  const { settings, loading, saving, error, save } = useNotificationSettings(business.id);
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
    setNotice(null);
  }, [settings, business.id]);

  if (loading && !draft) {
    return (
      <View style={styles.card}>
        <View style={styles.loadingRow}>
          <ActivityIndicator />
          <Text style={styles.helper}>Loading customer notification settings…</Text>
        </View>
      </View>
    );
  }

  if (!draft) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Customer notifications</Text>
        <Text style={styles.error}>{error ?? 'Notification settings are unavailable.'}</Text>
      </View>
    );
  }

  const dirty = settings ? !sameSettings(settings, draft) : false;

  async function persist() {
    if (!canEdit || !draft || !dirty) return;
    setNotice(null);
    try {
      await save(draft);
      setNotice('Customer notification settings saved.');
    } catch {
      // Hook surfaces the actionable error below.
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>WHATSAPP AUTOMATION</Text>
        <Text style={styles.title}>Customer notifications</Text>
        <Text style={styles.helper}>
          Choose which order updates OrderDesk should queue for customers. Delivery still depends on WhatsApp availability and Meta policy.
        </Text>
      </View>

      {!canEdit ? (
        <View style={styles.readOnlyCard}>
          <Text style={styles.readOnlyTitle}>View only</Text>
          <Text style={styles.readOnlyText}>Only an Owner or Manager can change these notification rules.</Text>
        </View>
      ) : null}

      <NotificationToggle
        label="Order received"
        helper="Tell the customer their WhatsApp order reached your business."
        value={draft.notifyReceived}
        disabled={!canEdit || saving}
        onChange={(value) => setDraft((current) => current ? { ...current, notifyReceived: value } : current)}
      />
      <NotificationToggle
        label="Order accepted"
        helper="Confirm the order and include the known order total."
        value={draft.notifyAccepted}
        disabled={!canEdit || saving}
        onChange={(value) => setDraft((current) => current ? { ...current, notifyAccepted: value } : current)}
      />
      <NotificationToggle
        label="Order ready"
        helper="Tell the customer when fulfilment is ready."
        value={draft.notifyReady}
        disabled={!canEdit || saving}
        onChange={(value) => setDraft((current) => current ? { ...current, notifyReady: value } : current)}
      />
      <NotificationToggle
        label="Order rejected"
        helper="Send a neutral rejection message without exposing the merchant's internal reason."
        value={draft.notifyRejected}
        disabled={!canEdit || saving}
        onChange={(value) => setDraft((current) => current ? { ...current, notifyRejected: value } : current)}
      />
      <NotificationToggle
        label="Order cancelled"
        helper="Tell the customer when an accepted order is cancelled."
        value={draft.notifyCancelled}
        disabled={!canEdit || saving}
        onChange={(value) => setDraft((current) => current ? { ...current, notifyCancelled: value } : current)}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {canEdit ? (
        <Pressable
          disabled={!dirty || saving}
          onPress={() => void persist()}
          style={({ pressed }) => [
            styles.saveButton,
            (!dirty || saving) && styles.disabled,
            pressed && dirty && !saving && styles.pressed,
          ]}
        >
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save notification settings'}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.policyNote}>
        OrderDesk does not send free-form WhatsApp messages outside the active customer-service window. Those events are held as “Template required” until an approved template path is configured.
      </Text>
    </View>
  );
}

function NotificationToggle({
  label,
  helper,
  value,
  disabled,
  onChange,
}: {
  label: string;
  helper: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHelper}>{helper}</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onChange} />
    </View>
  );
}

function sameSettings(left: NotificationSettings, right: NotificationSettings): boolean {
  return (
    left.notifyReceived === right.notifyReceived &&
    left.notifyAccepted === right.notifyAccepted &&
    left.notifyReady === right.notifyReady &&
    left.notifyRejected === right.notifyRejected &&
    left.notifyCancelled === right.notifyCancelled
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 18, padding: 16, gap: 13 },
  heading: { gap: 4 },
  eyebrow: { color: '#98A2B3', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#101828', fontSize: 16, fontWeight: '900' },
  helper: { color: '#667085', fontSize: 11, lineHeight: 17 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  readOnlyCard: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 11 },
  readOnlyTitle: { color: '#344054', fontSize: 11, fontWeight: '900' },
  readOnlyText: { color: '#667085', fontSize: 10, lineHeight: 15, marginTop: 2 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EAECF0' },
  toggleCopy: { flex: 1 },
  toggleLabel: { color: '#101828', fontSize: 12, fontWeight: '800' },
  toggleHelper: { color: '#667085', fontSize: 10, lineHeight: 15, marginTop: 2 },
  saveButton: { minHeight: 46, borderRadius: 12, backgroundColor: '#246BFD', alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  policyNote: { color: '#667085', fontSize: 10, lineHeight: 15 },
  error: { color: '#B42318', fontSize: 11, lineHeight: 16 },
  notice: { color: '#027A48', fontSize: 11, fontWeight: '800' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});
