import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { PlatformAdminOverview } from '../data/platformAdminRepository';
import { supabase } from '../lib/supabase';

type MessageType = 'update' | 'service' | 'information' | 'promotion';
type Severity = 'info' | 'attention' | 'urgent';
type MerchantRole = 'owner' | 'manager' | 'staff';

type Props = {
  overview: PlatformAdminOverview | null;
};

const messageTypes: Array<{ value: MessageType; label: string }> = [
  { value: 'update', label: 'Product update' },
  { value: 'service', label: 'Service notice' },
  { value: 'information', label: 'Information' },
  { value: 'promotion', label: 'Promotion' },
];

const severities: Array<{ value: Severity; label: string }> = [
  { value: 'info', label: 'Normal' },
  { value: 'attention', label: 'Attention' },
  { value: 'urgent', label: 'Urgent' },
];

const merchantRoles: Array<{ value: MerchantRole; label: string }> = [
  { value: 'owner', label: 'Owners' },
  { value: 'manager', label: 'Managers' },
  { value: 'staff', label: 'Staff' },
];

export function PlatformMerchantMessageComposer({ overview }: Props) {
  const [messageType, setMessageType] = useState<MessageType>('information');
  const [severity, setSeverity] = useState<Severity>('info');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetAll, setTargetAll] = useState(true);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<MerchantRole[]>(['owner', 'manager', 'staff']);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const tenants = overview?.tenants ?? [];
  const visibleTenants = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase();
    if (!clean) return tenants.slice(0, 30);
    return tenants
      .filter((tenant) =>
        tenant.name.toLocaleLowerCase().includes(clean) ||
        tenant.slug.toLocaleLowerCase().includes(clean) ||
        (tenant.businessEmail ?? '').toLocaleLowerCase().includes(clean),
      )
      .slice(0, 30);
  }, [query, tenants]);

  if (!overview || overview.actorRole !== 'admin') return null;

  function toggleTenant(id: string) {
    setSelectedTenantIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function toggleRole(role: MerchantRole) {
    setSelectedRoles((current) => {
      if (current.includes(role)) {
        if (current.length === 1) return current;
        return current.filter((value) => value !== role);
      }
      return [...current, role];
    });
  }

  function chooseMessageType(next: MessageType) {
    setMessageType(next);
    if (next === 'promotion' && severity === 'urgent') setSeverity('attention');
  }

  async function publish() {
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle) return setError('Enter a notification title.');
    if (!cleanBody) return setError('Enter the merchant message.');
    if (!targetAll && selectedTenantIds.length === 0) {
      return setError('Select at least one SellerTray business or switch to All businesses.');
    }
    if (messageType === 'promotion' && severity === 'urgent') {
      return setError('Promotional messages cannot be marked urgent.');
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('platform-merchant-message', {
        body: {
          messageType,
          severity,
          title: cleanTitle,
          body: cleanBody,
          tenantIds: targetAll ? null : selectedTenantIds,
          audienceRoles: selectedRoles.length === 3 ? null : selectedRoles,
        },
      });

      if (invokeError) {
        let message = invokeError.message || 'Unable to publish merchant message.';
        if (invokeError.context && typeof invokeError.context === 'object' && 'clone' in invokeError.context) {
          try {
            const payload = await (invokeError.context as Response).clone().json() as { error?: string };
            if (payload?.error) message = payload.error;
          } catch {
            // Keep SDK message.
          }
        }
        throw new Error(message);
      }

      const count =
        data && typeof data === 'object' && 'notificationCount' in data
          ? Number(data.notificationCount)
          : 0;
      setSuccess(
        count > 0
          ? `Published to ${count} SellerTray business${count === 1 ? '' : 'es'}. Push delivery is queued automatically.`
          : 'Merchant message published. Push delivery is queued automatically.',
      );
      setTitle('');
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to publish merchant message.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>MERCHANT COMMUNICATIONS</Text>
        <Text style={styles.title}>Send SellerTray notifications</Text>
        <Text style={styles.subtitle}>
          Publish product updates, service notices, information or promotions. Merchants receive the message in their notification inbox and, when push is enabled, as a device notification.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Message type</Text>
        <View style={styles.chips}>
          {messageTypes.map((option) => (
            <Pressable
              key={option.value}
              disabled={busy}
              onPress={() => chooseMessageType(option.value)}
              style={[styles.chip, messageType === option.value && styles.chipActive]}
            >
              <Text style={[styles.chipText, messageType === option.value && styles.chipTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Priority</Text>
        <View style={styles.chips}>
          {severities.map((option) => {
            const blocked = messageType === 'promotion' && option.value === 'urgent';
            return (
              <Pressable
                key={option.value}
                disabled={busy || blocked}
                onPress={() => setSeverity(option.value)}
                style={[
                  styles.chip,
                  severity === option.value && styles.chipActive,
                  blocked && styles.disabled,
                ]}
              >
                <Text style={[styles.chipText, severity === option.value && styles.chipTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>Use Urgent only for service or operational information that genuinely needs immediate attention.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Title *</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          editable={!busy}
          maxLength={160}
          placeholder="e.g. New catalogue import is available"
          placeholderTextColor="#98A2B3"
          style={styles.input}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Message *</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          editable={!busy}
          maxLength={1000}
          multiline
          textAlignVertical="top"
          placeholder="Write the message merchants should see in SellerTray."
          placeholderTextColor="#98A2B3"
          style={[styles.input, styles.bodyInput]}
        />
        <Text style={styles.counter}>{body.length}/1000</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Audience roles</Text>
        <View style={styles.chips}>
          {merchantRoles.map((option) => {
            const active = selectedRoles.includes(option.value);
            return (
              <Pressable
                key={option.value}
                disabled={busy}
                onPress={() => toggleRole(option.value)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Businesses</Text>
        <View style={styles.chips}>
          <Pressable
            disabled={busy}
            onPress={() => setTargetAll(true)}
            style={[styles.chip, targetAll && styles.chipActive]}
          >
            <Text style={[styles.chipText, targetAll && styles.chipTextActive]}>All businesses</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => setTargetAll(false)}
            style={[styles.chip, !targetAll && styles.chipActive]}
          >
            <Text style={[styles.chipText, !targetAll && styles.chipTextActive]}>Selected businesses</Text>
          </Pressable>
        </View>

        {!targetAll ? (
          <View style={styles.tenantPicker}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              editable={!busy}
              placeholder="Search business name or email"
              placeholderTextColor="#98A2B3"
              style={styles.input}
            />
            <Text style={styles.hint}>{selectedTenantIds.length} selected</Text>
            <View style={styles.tenantList}>
              {visibleTenants.map((tenant) => {
                const active = selectedTenantIds.includes(tenant.id);
                return (
                  <Pressable
                    key={tenant.id}
                    disabled={busy}
                    onPress={() => toggleTenant(tenant.id)}
                    style={[styles.tenantRow, active && styles.tenantRowActive]}
                  >
                    <View style={styles.tenantCopy}>
                      <Text style={styles.tenantName}>{tenant.name}</Text>
                      <Text style={styles.tenantMeta}>{tenant.businessEmail || tenant.slug}</Text>
                    </View>
                    <Text style={[styles.selectMark, active && styles.selectMarkActive]}>{active ? 'Selected' : 'Select'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <Text style={styles.hint}>Every current SellerTray business will receive this message, filtered by the role selection above.</Text>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}

      <Pressable
        disabled={busy}
        onPress={() => void publish()}
        style={({ pressed }) => [styles.publishButton, pressed && styles.pressed, busy && styles.disabled]}
      >
        <Text style={styles.publishButtonText}>{busy ? 'Publishing…' : 'Publish notification'}</Text>
      </Pressable>

      <Text style={styles.securityNote}>
        Publishing requires a ProcessEdge platform Administrator account with MFA. Each campaign is audited and merchant read/unread state remains per user.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E7EC',
    borderRadius: 18,
    padding: 16,
    gap: 16,
  },
  heading: { gap: 4 },
  eyebrow: { color: '#12B76A', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#102A43', fontSize: 20, fontWeight: '900' },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 20 },
  section: { gap: 7 },
  label: { color: '#344054', fontSize: 13, fontWeight: '900' },
  hint: { color: '#667085', fontSize: 11.5, lineHeight: 17 },
  counter: { color: '#98A2B3', fontSize: 11, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
  },
  chipActive: { borderColor: '#12B76A', backgroundColor: '#ECFDF3' },
  chipText: { color: '#475467', fontSize: 11.5, fontWeight: '800' },
  chipTextActive: { color: '#027A48' },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    color: '#102A43',
    paddingHorizontal: 12,
    fontSize: 13,
  },
  bodyInput: { minHeight: 110, paddingTop: 11, paddingBottom: 11 },
  tenantPicker: { gap: 9 },
  tenantList: { gap: 7 },
  tenantRow: {
    borderWidth: 1,
    borderColor: '#E4E7EC',
    borderRadius: 11,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tenantRowActive: { borderColor: '#12B76A', backgroundColor: '#F0FDF4' },
  tenantCopy: { flex: 1 },
  tenantName: { color: '#102A43', fontSize: 12.5, fontWeight: '900' },
  tenantMeta: { color: '#667085', fontSize: 11, marginTop: 2 },
  selectMark: { color: '#667085', fontSize: 11, fontWeight: '800' },
  selectMarkActive: { color: '#027A48' },
  publishButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#12B76A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  error: { color: '#B42318', fontSize: 12, lineHeight: 18 },
  success: { color: '#027A48', fontSize: 12, lineHeight: 18, fontWeight: '800' },
  securityNote: { color: '#667085', fontSize: 11, lineHeight: 17 },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
});
