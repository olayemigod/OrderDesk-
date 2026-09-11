import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type {
  PlatformAdminAuditEvent,
  PlatformAdminMutationAction,
  PlatformAdminOverview,
  PlatformSubscriptionStatus,
  PlatformTenantSummary,
  PlatformWhatsappStatus,
} from '../data/platformAdminRepository';

type Props = {
  overview: PlatformAdminOverview | null;
  audit: PlatformAdminAuditEvent[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onMutate: (
    tenantId: string,
    action: PlatformAdminMutationAction,
    value: string | number | null,
  ) => Promise<void>;
  standalone?: boolean;
};

export function PlatformAdminView({
  overview,
  audit,
  loading,
  busy,
  error,
  onRefresh,
  onMutate,
  standalone = false,
}: Props) {
  const [query, setQuery] = useState('');

  const tenants = useMemo(() => {
    if (!overview) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return overview.tenants;
    return overview.tenants.filter((tenant) => [
      tenant.name,
      tenant.slug,
      tenant.businessEmail ?? '',
      tenant.businessPhone ?? '',
      tenant.subscriptionStatus,
      tenant.whatsappStatus,
    ].join(' ').toLowerCase().includes(normalized));
  }, [overview, query]);

  if (loading && !overview) {
    return (
      <View style={styles.loadingCard}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading ProcessEdge admin console…</Text>
      </View>
    );
  }

  if (!overview) {
    return (
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>Platform admin unavailable</Text>
        <Text style={styles.errorText}>{error ?? 'This account does not have ProcessEdge platform-admin access.'}</Text>
        <Pressable onPress={() => void onRefresh()} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const readOnlyTenants = overview.tenants.filter((tenant) => tenant.accessMode === 'read_only').length;
  const reviewOrders = overview.tenants.reduce((sum, tenant) => sum + tenant.needsReview, 0);
  const notificationIssues = overview.tenants.reduce((sum, tenant) => sum + tenant.notificationExceptions, 0);
  const aiUsage = overview.tenants.reduce((sum, tenant) => sum + tenant.usageUnitsPeriod, 0);
  const failedUsageSettlements = overview.tenants.reduce((sum, tenant) => sum + tenant.usageFailedSettlements, 0);
  const aiParserAttempts = overview.tenants.reduce((sum, tenant) => sum + tenant.aiParserAttemptsPeriod, 0);
  const aiParserFailures = overview.tenants.reduce((sum, tenant) => sum + tenant.aiParserNonSuccessPeriod, 0);
  const canMutate = overview.actorRole === 'admin';

  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>PROCESSEDGE OPERATIONS</Text>
        <Text style={styles.title}>{standalone ? 'SellerTray Admin' : 'SaaS Admin'}</Text>
        <Text style={styles.subtitle}>
          Tenant health, subscriptions, AI usage, WhatsApp readiness and support controls. Merchant roles cannot access this console.
        </Text>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>{overview.actorRole.toUpperCase()}</Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Admin sync problem</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void onRefresh()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.statsGrid}>
        <Metric label="Businesses" value={overview.tenants.length} />
        <Metric label="Read only" value={readOnlyTenants} />
        <Metric label="Need review" value={reviewOrders} />
        <Metric label="WA issues" value={notificationIssues} />
        <Metric label="AI usage" value={aiUsage} />
        <Metric label="AI attempts" value={aiParserAttempts} />
        <Metric label="AI fallbacks/errors" value={aiParserFailures} />
        <Metric label="Usage failures" value={failedUsageSettlements} />
      </View>

      {!canMutate ? (
        <View style={styles.supportNotice}>
          <Text style={styles.supportTitle}>Support access is read-only</Text>
          <Text style={styles.supportText}>Only a ProcessEdge platform Admin can change subscription, WhatsApp or support-note state.</Text>
        </View>
      ) : null}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search business, email, phone or status"
        autoCorrect={false}
        style={styles.searchInput}
      />

      <Text style={styles.resultMeta}>Showing {tenants.length} of {overview.tenants.length} businesses</Text>

      <View style={styles.tenantList}>
        {tenants.map((tenant) => (
          <TenantAdminCard
            key={tenant.id}
            tenant={tenant}
            canMutate={canMutate}
            busy={busy}
            onMutate={onMutate}
          />
        ))}
      </View>

      <View style={styles.auditSection}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.eyebrow}>AUDIT</Text>
            <Text style={styles.sectionTitle}>Recent platform actions</Text>
          </View>
          <Pressable onPress={() => void onRefresh()} disabled={loading || busy}>
            <Text style={styles.refreshText}>{loading ? 'Refreshing…' : 'Refresh'}</Text>
          </Pressable>
        </View>

        {audit.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.muted}>No platform-admin mutations have been recorded yet.</Text>
          </View>
        ) : (
          <View style={styles.auditList}>
            {audit.map((event) => (
              <View key={event.id} style={styles.auditRow}>
                <Text style={styles.auditAction}>{humanize(event.action)}</Text>
                <Text style={styles.auditMeta}>
                  {event.tenantName ?? 'Platform'} · {formatDateTime(event.createdAt)}
                </Text>
                <Text style={styles.auditActor}>{event.actorEmail || 'ProcessEdge administrator'}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function TenantAdminCard({
  tenant,
  canMutate,
  busy,
  onMutate,
}: {
  tenant: PlatformTenantSummary;
  canMutate: boolean;
  busy: boolean;
  onMutate: Props['onMutate'];
}) {
  const [note, setNote] = useState(tenant.supportNote ?? '');
  const [confirmStatus, setConfirmStatus] = useState<'suspended' | 'cancelled' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setNote(tenant.supportNote ?? '');
    setConfirmStatus(null);
    setLocalError(null);
    setNotice(null);
  }, [tenant.id, tenant.supportNote, tenant.subscriptionStatus, tenant.whatsappStatus]);

  async function mutate(action: PlatformAdminMutationAction, value: string | number | null, success: string) {
    setLocalError(null);
    setNotice(null);
    try {
      await onMutate(tenant.id, action, value);
      setNotice(success);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Admin update failed.');
    }
  }

  async function setSubscription(status: PlatformSubscriptionStatus) {
    if (status === 'suspended' || status === 'cancelled') {
      if (confirmStatus !== status) {
        setConfirmStatus(status);
        setNotice(null);
        return;
      }
    }
    setConfirmStatus(null);
    await mutate('set_subscription_status', status, `Subscription marked ${humanize(status)}.`);
  }

  async function setWhatsApp(status: PlatformWhatsappStatus) {
    await mutate('set_whatsapp_status', status, `WhatsApp marked ${humanize(status)}.`);
  }

  return (
    <View style={[styles.tenantCard, tenant.accessMode === 'read_only' && styles.tenantCardBlocked]}>
      <View style={styles.tenantHeader}>
        <View style={styles.tenantIdentity}>
          <Text style={styles.tenantName}>{tenant.name}</Text>
          <Text style={styles.tenantMeta}>{tenant.businessEmail ?? tenant.slug}</Text>
          {tenant.businessPhone ? <Text style={styles.tenantMeta}>{tenant.businessPhone}</Text> : null}
        </View>
        <View style={styles.statusStack}>
          <StatePill label={humanize(tenant.subscriptionStatus)} warning={tenant.accessMode === 'read_only'} />
          <StatePill label={humanize(tenant.whatsappStatus)} warning={tenant.whatsappStatus === 'error'} />
        </View>
      </View>

      <View style={styles.healthGrid}>
        <SmallMetric label="30d orders" value={tenant.orders30d} />
        <SmallMetric label="Need review" value={tenant.needsReview} />
        <SmallMetric label="AI usage" value={tenant.usageUnitsPeriod} />
        <SmallMetric label="WA issues" value={tenant.notificationExceptions} />
        <SmallMetric label="Team" value={tenant.teamMembers} />
      </View>

      <View style={styles.detailRows}>
        <DetailRow label="Access" value={tenant.accessMode === 'full' ? 'Full access' : 'Read only'} />
        <DetailRow label="Setup" value={humanize(tenant.onboardingStatus)} />
        <DetailRow label="Trial ends" value={formatOptionalDate(tenant.trialEndsAt)} />
        <DetailRow
          label="AI usage rate"
          value={tenant.usageUnitPrice === null ? 'Not active' : `${formatMoney(tenant.usageUnitPrice, tenant.currency)} / activity`}
        />
        <DetailRow label="AI usage amount" value={formatMoney(tenant.usageAmountPeriod, tenant.currency)} />
        <DetailRow
          label="Usage payment"
          value={tenant.usageAuthorizationReady ? 'Reusable authorization ready' : 'Authorization not ready'}
        />
        <DetailRow label="Usage outstanding" value={formatMoney(tenant.usageOutstandingAmount, tenant.currency)} />
        <DetailRow label="Usage failures" value={String(tenant.usageFailedSettlements)} />
        <DetailRow label="AI parser model" value={tenant.aiParserModel ?? 'No external AI attempt yet'} />
        <DetailRow
          label="AI parser attempts"
          value={`${tenant.aiParserAttemptsPeriod} attempts · ${tenant.aiParserSuccessesPeriod} success · ${tenant.aiParserNonSuccessPeriod} fallback/error`}
        />
        <DetailRow
          label="AI parser tokens"
          value={`${tenant.aiInputTokensPeriod} input · ${tenant.aiOutputTokensPeriod} output · ${tenant.aiReasoningTokensPeriod} reasoning · ${tenant.aiTotalTokensPeriod} total`}
        />
        <DetailRow label="Last order" value={formatOptionalDateTime(tenant.lastOrderAt)} />
        <DetailRow label="Last WhatsApp" value={formatOptionalDateTime(tenant.lastInboundAt)} />
      </View>

      {canMutate ? (
        <View style={styles.controls}>
          <Text style={styles.controlTitle}>Subscription</Text>
          <View style={styles.buttonRow}>
            {(['active', 'past_due', 'suspended', 'cancelled'] as PlatformSubscriptionStatus[]).map((status) => (
              <Pressable
                key={status}
                disabled={busy}
                onPress={() => void setSubscription(status)}
                style={[
                  styles.controlButton,
                  tenant.subscriptionStatus === status && styles.controlButtonActive,
                  confirmStatus === status && styles.dangerConfirmButton,
                ]}
              >
                <Text style={[
                  styles.controlButtonText,
                  tenant.subscriptionStatus === status && styles.controlButtonTextActive,
                  confirmStatus === status && styles.dangerConfirmText,
                ]}>
                  {confirmStatus === status ? `Confirm ${humanize(status)}` : humanize(status)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              disabled={busy}
              onPress={() => void mutate('extend_trial_days', 7, 'Trial extended by 7 days.')}
              style={styles.controlButton}
            >
              <Text style={styles.controlButtonText}>+7 trial days</Text>
            </Pressable>
          </View>

          {confirmStatus ? (
            <Pressable onPress={() => setConfirmStatus(null)}>
              <Text style={styles.cancelConfirm}>Cancel {humanize(confirmStatus)} confirmation</Text>
            </Pressable>
          ) : null}

          <Text style={styles.controlTitle}>WhatsApp state</Text>
          <View style={styles.buttonRow}>
            {(['not_connected', 'pending', 'connected', 'error'] as PlatformWhatsappStatus[]).map((status) => (
              <Pressable
                key={status}
                disabled={busy}
                onPress={() => void setWhatsApp(status)}
                style={[styles.controlButton, tenant.whatsappStatus === status && styles.controlButtonActive]}
              >
                <Text style={[styles.controlButtonText, tenant.whatsappStatus === status && styles.controlButtonTextActive]}>
                  {humanize(status)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.controlTitle}>Internal support note</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            editable={!busy}
            multiline
            maxLength={4000}
            placeholder="ProcessEdge-only support context"
            style={styles.noteInput}
          />
          <Pressable
            disabled={busy || note === (tenant.supportNote ?? '')}
            onPress={() => void mutate('set_support_note', note, 'Support note saved.')}
            style={[styles.saveNoteButton, (busy || note === (tenant.supportNote ?? '')) && styles.disabled]}
          >
            <Text style={styles.saveNoteText}>{busy ? 'Updating…' : 'Save support note'}</Text>
          </Pressable>
        </View>
      ) : tenant.supportNote ? (
        <View style={styles.noteReadOnly}>
          <Text style={styles.controlTitle}>Internal support note</Text>
          <Text style={styles.noteReadOnlyText}>{tenant.supportNote}</Text>
        </View>
      ) : null}

      {localError ? <Text style={styles.localError}>{localError}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function SmallMetric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.smallMetric}>
      <Text style={styles.smallMetricValue}>{value}</Text>
      <Text style={styles.smallMetricLabel}>{label}</Text>
    </View>
  );
}

function StatePill({ label, warning = false }: { label: string; warning?: boolean }) {
  return (
    <View style={[styles.statePill, warning && styles.statePillWarning]}>
      <Text style={[styles.statePillText, warning && styles.statePillTextWarning]}>{label}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function humanize(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatOptionalDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatOptionalDateTime(value: string | null): string {
  return value ? formatDateTime(value) : '—';
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  heading: { gap: 5 },
  eyebrow: { color: '#98A2B3', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#101828', fontSize: 25, fontWeight: '900' },
  subtitle: { color: '#667085', fontSize: 12, lineHeight: 18 },
  rolePill: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: '#EEF4FF', paddingHorizontal: 9, paddingVertical: 5, marginTop: 3 },
  rolePillText: { color: '#175CD3', fontSize: 9, fontWeight: '900' },
  loadingCard: { padding: 22, alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 16 },
  muted: { color: '#667085', fontSize: 11, lineHeight: 17 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: { flexGrow: 1, flexBasis: '45%', minWidth: 130, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#EAECF0', padding: 13 },
  metricLabel: { color: '#667085', fontSize: 10, fontWeight: '800' },
  metricValue: { color: '#101828', fontSize: 24, fontWeight: '900', marginTop: 3 },
  supportNotice: { backgroundColor: '#FFF8E7', borderRadius: 13, padding: 13, gap: 4 },
  supportTitle: { color: '#7A2E0E', fontSize: 12, fontWeight: '900' },
  supportText: { color: '#854A0E', fontSize: 10, lineHeight: 16 },
  searchInput: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#D0D5DD', backgroundColor: '#FFFFFF', paddingHorizontal: 12, color: '#101828' },
  resultMeta: { color: '#98A2B3', fontSize: 10, fontWeight: '700' },
  tenantList: { gap: 12 },
  tenantCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 17, padding: 15, gap: 13 },
  tenantCardBlocked: { borderColor: '#FDA29B' },
  tenantHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  tenantIdentity: { flex: 1 },
  tenantName: { color: '#101828', fontSize: 16, fontWeight: '900' },
  tenantMeta: { color: '#667085', fontSize: 10, marginTop: 3 },
  statusStack: { alignItems: 'flex-end', gap: 5 },
  statePill: { borderRadius: 999, backgroundColor: '#ECFDF3', paddingHorizontal: 8, paddingVertical: 4 },
  statePillWarning: { backgroundColor: '#FEF3F2' },
  statePillText: { color: '#027A48', fontSize: 9, fontWeight: '900' },
  statePillTextWarning: { color: '#B42318' },
  healthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  smallMetric: { flexGrow: 1, flexBasis: '22%', minWidth: 72, backgroundColor: '#F9FAFB', borderRadius: 11, padding: 9 },
  smallMetricValue: { color: '#101828', fontSize: 17, fontWeight: '900' },
  smallMetricLabel: { color: '#667085', fontSize: 8, marginTop: 2 },
  detailRows: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EAECF0' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EAECF0' },
  detailLabel: { color: '#667085', fontSize: 10, fontWeight: '700' },
  detailValue: { color: '#101828', fontSize: 10, fontWeight: '800', textAlign: 'right', flexShrink: 1 },
  controls: { gap: 8 },
  controlTitle: { color: '#344054', fontSize: 10, fontWeight: '900', marginTop: 2 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  controlButton: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: '#FFFFFF' },
  controlButtonActive: { borderColor: '#246BFD', backgroundColor: '#EEF4FF' },
  controlButtonText: { color: '#667085', fontSize: 9, fontWeight: '800' },
  controlButtonTextActive: { color: '#175CD3' },
  dangerConfirmButton: { borderColor: '#D92D20', backgroundColor: '#FEF3F2' },
  dangerConfirmText: { color: '#B42318' },
  cancelConfirm: { color: '#B42318', fontSize: 9, fontWeight: '800' },
  noteInput: { minHeight: 72, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 11, padding: 10, textAlignVertical: 'top', color: '#101828', backgroundColor: '#FFFFFF' },
  saveNoteButton: { minHeight: 39, borderRadius: 10, backgroundColor: '#246BFD', alignItems: 'center', justifyContent: 'center' },
  saveNoteText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  noteReadOnly: { backgroundColor: '#F9FAFB', borderRadius: 11, padding: 10, gap: 4 },
  noteReadOnlyText: { color: '#475467', fontSize: 10, lineHeight: 16 },
  localError: { color: '#B42318', fontSize: 10, lineHeight: 15 },
  notice: { color: '#027A48', fontSize: 10, fontWeight: '800' },
  auditSection: { gap: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  sectionTitle: { color: '#101828', fontSize: 16, fontWeight: '900', marginTop: 2 },
  refreshText: { color: '#246BFD', fontSize: 10, fontWeight: '900' },
  auditList: { backgroundColor: '#FFFFFF', borderRadius: 15, borderWidth: 1, borderColor: '#EAECF0', overflow: 'hidden' },
  auditRow: { padding: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EAECF0' },
  auditAction: { color: '#101828', fontSize: 11, fontWeight: '900' },
  auditMeta: { color: '#667085', fontSize: 9, marginTop: 3 },
  auditActor: { color: '#98A2B3', fontSize: 8, marginTop: 2 },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#EAECF0', padding: 14 },
  errorCard: { backgroundColor: '#FEF3F2', borderRadius: 13, padding: 13, gap: 5 },
  errorTitle: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  errorText: { color: '#912018', fontSize: 10, lineHeight: 16 },
  retryButton: { alignSelf: 'flex-start', marginTop: 3 },
  retryText: { color: '#B42318', fontSize: 10, fontWeight: '900' },
});
