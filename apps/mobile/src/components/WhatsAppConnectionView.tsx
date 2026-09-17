import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import {
  acceptWhatsAppConsent,
  loadWhatsAppConsent,
  revokeWhatsAppConsent,
  type WhatsAppConsentStatus,
} from '../data/whatsappConsentRepository';
import {
  completeWhatsAppEmbeddedSignup,
  disconnectWhatsApp,
  loadWhatsAppConnectionStatus,
  parseEmbeddedSignupCallback,
  startWhatsAppEmbeddedSignup,
  type WhatsAppConnectionStatusPayload,
} from '../data/whatsappConnectionRepository';

const statusCopy: Record<MerchantBusiness['whatsappConnectionStatus'], { title: string; text: string }> = {
  not_connected: {
    title: 'WhatsApp is not connected',
    text: 'Connect a WhatsApp Business number so customer messages can create SellerTray orders automatically.',
  },
  pending: {
    title: 'WhatsApp connection pending',
    text: 'Your connection request is waiting for provider activation or verification.',
  },
  connected: {
    title: 'WhatsApp connected',
    text: 'SellerTray can receive supported customer order messages from your connected WhatsApp Business number.',
  },
  error: {
    title: 'WhatsApp needs attention',
    text: 'The current connection needs to be checked before new WhatsApp orders can arrive reliably.',
  },
};

export function WhatsAppConnectionView({ business }: { business: MerchantBusiness }) {
  const appearance = useSellerTrayAppearance();
  const [connection, setConnection] = useState<WhatsAppConnectionStatusPayload | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const effectiveStatus =
    connection?.connection?.connectionStatus === 'connected'
      ? 'connected'
      : connection?.connection?.connectionStatus === 'pending'
        ? 'pending'
        : connection?.connection?.connectionStatus === 'error'
          ? 'error'
          : connection?.connection?.connectionStatus === 'disconnected'
            ? 'not_connected'
            : business.whatsappConnectionStatus;
  const status = statusCopy[effectiveStatus];
  const connected = effectiveStatus === 'connected';
  const messagingReady = connection?.readiness.messagingReady ?? business.whatsappReadiness.messagingReady;
  const inboundReady = connection?.readiness.inboundReady ?? business.whatsappReadiness.inboundReady;
  const outboundReady = connection?.readiness.outboundReady ?? business.whatsappReadiness.outboundReady;
  const readinessReason = connection?.readiness.reason ?? business.whatsappReadiness.reason;
  const [consent, setConsent] = useState<WhatsAppConsentStatus | null>(null);
  const [consentLoading, setConsentLoading] = useState(true);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const isOwner = business.role === 'owner';

  async function refreshConnection() {
    setConnectionLoading(true);
    setConnectionError(null);
    try {
      setConnection(await loadWhatsAppConnectionStatus(business.id));
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to load WhatsApp connection status.');
    } finally {
      setConnectionLoading(false);
    }
  }

  async function refreshConsent() {
    setConsentLoading(true);
    setConsentError(null);
    try {
      setConsent(await loadWhatsAppConsent(business.id));
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : 'Unable to load WhatsApp data-processing status.');
    } finally {
      setConsentLoading(false);
    }
  }

  useEffect(() => {
    void refreshConsent();
    void refreshConnection();

    let active = true;

    async function handleUrl(url: string | null) {
      if (!active || !url) return;
      try {
        const callback = await parseEmbeddedSignupCallback(url);
        if (!callback) return;

        if (callback.status !== 'success') {
          setConnectionError(
            callback.status === 'cancelled'
              ? 'WhatsApp connection was cancelled. No changes were made.'
              : callback.message || 'Meta could not complete WhatsApp signup.',
          );
          return;
        }
        if (callback.tenantId !== business.id) return;

        setConnectionBusy(true);
        setConnectionError(null);
        const updated = await completeWhatsAppEmbeddedSignup({
          tenantId: business.id,
          authorizationCode: callback.authorizationCode,
          wabaId: callback.wabaId,
          phoneNumberId: callback.phoneNumberId,
          metaBusinessId: callback.metaBusinessId,
        });
        if (active) setConnection(updated);
      } catch (error) {
        if (active) {
          setConnectionError(error instanceof Error ? error.message : 'Unable to complete WhatsApp connection.');
        }
      } finally {
        if (active) setConnectionBusy(false);
      }
    }

    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [business.id]);

  const processingPolicy = useMemo(
    () => consent?.policies.find((policy) => policy.policy_key === 'whatsapp_data_processing') ?? null,
    [consent?.policies],
  );

  async function connectWhatsApp() {
    if (!isOwner || connectionBusy) return;
    setConnectionBusy(true);
    setConnectionError(null);
    try {
      await startWhatsAppEmbeddedSignup(business.id);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to start WhatsApp connection.');
    } finally {
      setConnectionBusy(false);
    }
  }

  async function disconnectCurrentWhatsApp() {
    if (!isOwner || connectionBusy) return;
    setConnectionBusy(true);
    setConnectionError(null);
    try {
      setConnection(await disconnectWhatsApp(business.id));
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to disconnect WhatsApp.');
    } finally {
      setConnectionBusy(false);
    }
  }

  async function acceptConsent() {
    if (!isOwner || consentBusy) return;
    setConsentBusy(true);
    setConsentError(null);
    try {
      setConsent(await acceptWhatsAppConsent(business.id));
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : 'Unable to authorize WhatsApp processing.');
    } finally {
      setConsentBusy(false);
    }
  }

  async function revokeConsent() {
    if (!isOwner || consentBusy) return;
    setConsentBusy(true);
    setConsentError(null);
    try {
      setConsent(await revokeWhatsAppConsent(business.id));
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : 'Unable to revoke WhatsApp processing authorization.');
    } finally {
      setConsentBusy(false);
    }
  }

  const processingActive = consent?.consentActive === true;

  return (
    <View style={styles.wrap}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>WHATSAPP</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>WhatsApp connection</Text>
        <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>
          Customers keep chatting on WhatsApp. SellerTray turns supported order messages into a merchant order inbox.
        </Text>
      </View>

      <View style={[styles.statusCard, messagingReady && styles.connectedCard, appearance.dark && darkStyles.card, appearance.dark && messagingReady && darkStyles.successCard]}>
        <View style={[styles.dot, messagingReady && styles.connectedDot]} />
        <View style={styles.statusCopy}>
          <Text style={[styles.statusTitle, appearance.dark && darkStyles.titleText]}>
            {messagingReady
              ? 'WhatsApp messaging ready'
              : connected
                ? 'WhatsApp connected · messaging setup incomplete'
                : status.title}
          </Text>
          <Text style={[styles.statusText, appearance.dark && darkStyles.bodyText]}>
            {messagingReady
              ? 'SellerTray has verified both inbound order capture and outbound customer updates for this WhatsApp number.'
              : connected
                ? readinessReason ?? 'SellerTray is still verifying outbound messaging readiness.'
                : status.text}
          </Text>
          {connected && !processingActive ? (
            <Text style={styles.pausedText}>
              Message processing is paused until the business Owner authorizes the current WhatsApp data-processing terms.
            </Text>
          ) : null}
        </View>
      </View>

      {connectionError ? (
        <View style={styles.connectionErrorCard}>
          <Text style={styles.connectionErrorTitle}>WhatsApp connection needs attention</Text>
          <Text style={styles.connectionErrorText}>{connectionError}</Text>
          <Pressable disabled={connectionLoading || connectionBusy} onPress={() => void refreshConnection()}>
            <Text style={styles.refreshText}>Refresh connection status</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.readinessGrid}>
        <ReadinessItem label="Inbound" ready={inboundReady} text={inboundReady ? 'Webhook ready' : 'Needs attention'} />
        <ReadinessItem label="Outbound" ready={outboundReady} text={outboundReady ? 'Messaging active' : 'Needs attention'} />
      </View>

      <View style={[styles.consentCard, processingActive && styles.consentActiveCard, appearance.dark && darkStyles.card]}>
        <View style={styles.consentHeading}>
          <View style={styles.consentCopy}>
            <Text style={[styles.consentEyebrow, appearance.dark && darkStyles.bodyText]}>DATA PROCESSING</Text>
            <Text style={[styles.consentTitle, appearance.dark && darkStyles.titleText]}>
              {processingActive ? 'WhatsApp processing authorized' : 'Owner authorization required'}
            </Text>
          </View>
          {consentLoading ? <ActivityIndicator size="small" /> : null}
        </View>

        <Text style={[styles.consentText, appearance.dark && darkStyles.bodyText]}>
          {processingPolicy?.summary ??
            'SellerTray only processes connected WhatsApp conversations for the approved order, customer, payment, notification and catalogue workflows.'}
        </Text>

        {processingPolicy ? (
          <Text style={[styles.versionText, appearance.dark && darkStyles.bodyText]}>
            Policy version {processingPolicy.version} · Effective {formatDate(processingPolicy.effective_at)}
          </Text>
        ) : null}

        {consent?.consent ? (
          <Text style={[styles.versionText, appearance.dark && darkStyles.bodyText]}>
            Accepted {formatDate(consent.consent.accepted_at)} · {consent.consent.scopes.length} approved processing scopes
          </Text>
        ) : null}

        {consent && !consent.termsPrivacyAccepted ? (
          <View style={styles.warningBox}>
            <Text style={styles.warningTitle}>Current Terms and Privacy acceptance is required first</Text>
            <Text style={styles.warningText}>
              The Owner must accept the current SellerTray Terms of Use and Privacy Notice before WhatsApp processing can be authorized.
            </Text>
          </View>
        ) : null}

        {consentError ? <Text style={styles.errorText}>{consentError}</Text> : null}

        {!consentLoading && !processingActive && isOwner ? (
          <Pressable
            disabled={consentBusy || !consent?.termsPrivacyAccepted}
            onPress={() => void acceptConsent()}
            style={[styles.primaryButton, (consentBusy || !consent?.termsPrivacyAccepted) && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>{consentBusy ? 'Authorizing…' : 'Authorize WhatsApp processing'}</Text>
          </Pressable>
        ) : null}

        {!consentLoading && processingActive && isOwner ? (
          <Pressable disabled={consentBusy} onPress={() => void revokeConsent()} style={[styles.secondaryButton, appearance.dark && darkStyles.secondaryButton]}>
            <Text style={[styles.secondaryButtonText, appearance.dark && darkStyles.titleText]}>{consentBusy ? 'Updating…' : 'Revoke authorization'}</Text>
          </Pressable>
        ) : null}

        {!consentLoading && !isOwner ? (
          <Text style={[styles.ownerOnlyText, appearance.dark && darkStyles.bodyText]}>
            Only the business Owner can accept or revoke this authorization. Managers and Staff can view its status.
          </Text>
        ) : null}

        <Pressable onPress={() => void refreshConsent()} disabled={consentLoading || consentBusy}>
          <Text style={styles.refreshText}>Refresh authorization status</Text>
        </Pressable>
      </View>

      {!connected ? (
        <View style={[styles.setupCard, appearance.dark && darkStyles.card]}>
          <Text style={[styles.setupTitle, appearance.dark && darkStyles.titleText]}>How connection will work</Text>
          <Step number="1" title="Use a WhatsApp Business number" text="Choose the number customers already use or a dedicated sales number." />
          <Step number="2" title="Connect through SellerTray" text="SellerTray will launch Meta's approved WhatsApp onboarding flow from this screen." />
          <Step number="3" title="Send a test order" text="After connection and authorization, send a real test message from another phone and confirm it appears in Orders." />

          {isOwner ? (
            <Pressable
              disabled={connectionBusy || connectionLoading}
              onPress={() => void connectWhatsApp()}
              style={[styles.connectButton, (connectionBusy || connectionLoading) && styles.disabled]}
            >
              {connectionBusy ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
              <Text style={styles.connectButtonText}>
                {connectionBusy ? 'Opening Meta…' : 'Connect WhatsApp'}
              </Text>
              <Text style={styles.connectButtonHint}>
                Continue with Meta's approved WhatsApp Business onboarding
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.ownerOnlyText, appearance.dark && darkStyles.bodyText]}>
              Only the business Owner can connect a WhatsApp Business Account.
            </Text>
          )}

          <View style={styles.pendingNotice}>
            <Text style={styles.pendingTitle}>Your Meta credentials stay off this phone</Text>
            <Text style={styles.pendingText}>
              SellerTray opens Meta's secure signup flow, verifies the selected WhatsApp Business Account and phone number on the server, subscribes the authorized WABA to SellerTray webhooks, and stores the business integration credential encrypted on the backend.
            </Text>
          </View>
        </View>
      ) : (
        <View style={[styles.infoCard, appearance.dark && darkStyles.card]}>
          <Text style={[styles.infoTitle, appearance.dark && darkStyles.titleText]}>{processingActive ? 'Connection is active' : 'Connection is connected but paused'}</Text>
          <Text style={[styles.infoText, appearance.dark && darkStyles.bodyText]}>
            {processingActive
              ? messagingReady
                ? 'Inbound and outbound WhatsApp messaging are ready. Send a test order and confirm both the order capture and customer update.'
                : 'The number is connected, but SellerTray has not verified outbound customer messaging yet.'
              : 'No customer conversation content will be stored or interpreted by SellerTray until the current authorization is active.'}
          </Text>

          {connection?.connection ? (
            <View style={styles.connectionDetails}>
              {connection.connection.verifiedName ? (
                <Detail label="Business name" value={connection.connection.verifiedName} dark={appearance.dark} />
              ) : null}
              {connection.connection.displayPhoneNumber ? (
                <Detail label="WhatsApp number" value={connection.connection.displayPhoneNumber} dark={appearance.dark} />
              ) : null}
              {connection.connection.wabaId ? (
                <Detail label="WABA" value={connection.connection.wabaId} dark={appearance.dark} />
              ) : null}
            </View>
          ) : null}

          {isOwner ? (
            <Pressable
              disabled={connectionBusy}
              onPress={() => void disconnectCurrentWhatsApp()}
              style={[styles.disconnectButton, appearance.dark && darkStyles.secondaryButton, connectionBusy && styles.disabled]}
            >
              <Text style={[styles.disconnectButtonText, appearance.dark && darkStyles.titleText]}>
                {connectionBusy ? 'Updating…' : 'Disconnect WhatsApp'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function Detail({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, dark && darkStyles.bodyText]}>{label}</Text>
      <Text selectable style={[styles.detailValue, dark && darkStyles.titleText]}>{value}</Text>
    </View>
  );
}

function ReadinessItem({ label, ready, text }: { label: string; ready: boolean; text: string }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.readinessItem, ready && styles.readinessItemReady, appearance.dark && darkStyles.card, appearance.dark && ready && darkStyles.successCard]}>
      <View style={[styles.readinessIcon, ready && styles.readinessIconReady]}>
        <Text style={[styles.readinessIconText, ready && styles.readinessIconTextReady]}>{ready ? '✓' : '!'}</Text>
      </View>
      <View style={styles.readinessCopy}>
        <Text style={[styles.readinessLabel, appearance.dark && darkStyles.titleText]}>{label}</Text>
        <Text style={[styles.readinessText, appearance.dark && darkStyles.bodyText]}>{text}</Text>
      </View>
    </View>
  );
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View>
      <View style={styles.stepCopy}>
        <Text style={[styles.stepTitle, appearance.dark && darkStyles.titleText]}>{title}</Text>
        <Text style={[styles.stepText, appearance.dark && darkStyles.bodyText]}>{text}</Text>
      </View>
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  eyebrow: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#102A43', fontSize: 28, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 5 },
  statusCard: {
    borderWidth: 1, borderColor: '#FEC84B', backgroundColor: '#FFFAEB', borderRadius: 16,
    padding: 14, flexDirection: 'row', gap: 11, alignItems: 'flex-start',
  },
  connectedCard: { borderColor: '#ABEFC6', backgroundColor: '#ECFDF3' },
  dot: { width: 10, height: 10, borderRadius: 99, backgroundColor: '#F79009', marginTop: 4 },
  connectedDot: { backgroundColor: '#12B76A' },
  statusCopy: { flex: 1 },
  statusTitle: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  statusText: { color: '#475467', fontSize: 13, lineHeight: 19, marginTop: 4 },
  pausedText: { color: '#B54708', fontSize: 12, lineHeight: 15, fontWeight: '800', marginTop: 6 },
  readinessGrid: { flexDirection: 'row', gap: 8 },
  readinessItem: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#FEC84B', backgroundColor: '#FFFAEB', borderRadius: 13, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  readinessItemReady: { borderColor: '#ABEFC6', backgroundColor: '#ECFDF3' },
  readinessIcon: { width: 26, height: 26, borderRadius: 99, backgroundColor: '#FEF0C7', alignItems: 'center', justifyContent: 'center' },
  readinessIconReady: { backgroundColor: '#D1FADF' },
  readinessIconText: { color: '#B54708', fontSize: 12, fontWeight: '900' },
  readinessIconTextReady: { color: '#027A48' },
  readinessCopy: { flex: 1, minWidth: 0 },
  readinessLabel: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  readinessText: { color: '#667085', fontSize: 12, lineHeight: 16, marginTop: 1 },
  consentCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#FEC84B', borderRadius: 16, padding: 14, gap: 9 },
  consentActiveCard: { borderColor: '#ABEFC6' },
  consentHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  consentCopy: { flex: 1 },
  consentEyebrow: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  consentTitle: { color: '#102A43', fontSize: 16, fontWeight: '900', marginTop: 2 },
  consentText: { color: '#475467', fontSize: 13, lineHeight: 20 },
  versionText: { color: '#667085', fontSize: 12, lineHeight: 17 },
  warningBox: { backgroundColor: '#FFFAEB', borderRadius: 10, padding: 10, gap: 3 },
  warningTitle: { color: '#B54708', fontSize: 12, fontWeight: '900' },
  warningText: { color: '#7A2E0E', fontSize: 12, lineHeight: 14 },
  errorText: { color: '#B42318', fontSize: 12, lineHeight: 15 },
  connectionErrorCard: { backgroundColor: '#FEF3F2', borderWidth: 1, borderColor: '#FECDCA', borderRadius: 14, padding: 12, gap: 5 },
  connectionErrorTitle: { color: '#B42318', fontSize: 13, fontWeight: '900' },
  connectionErrorText: { color: '#912018', fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 46, borderRadius: 11, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  secondaryButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#344054', fontSize: 12, fontWeight: '900' },
  ownerOnlyText: { color: '#667085', fontSize: 12, lineHeight: 15 },
  refreshText: { color: '#12B76A', fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  setupCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 18, padding: 16, gap: 14 },
  setupTitle: { color: '#102A43', fontSize: 15, fontWeight: '900' },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNumber: { width: 28, height: 28, borderRadius: 99, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: '#079455', fontWeight: '900', fontSize: 12 },
  stepCopy: { flex: 1 },
  stepTitle: { color: '#344054', fontSize: 12, fontWeight: '900' },
  stepText: { color: '#667085', fontSize: 12, lineHeight: 17, marginTop: 2 },
  connectButton: { minHeight: 58, borderRadius: 12, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, gap: 3 },
  connectButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  connectButtonHint: { color: '#E8FFF3', fontSize: 11.5, fontWeight: '700', marginTop: 1, textAlign: 'center' },
  pendingNotice: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12, gap: 4 },
  pendingTitle: { color: '#344054', fontSize: 12, fontWeight: '900' },
  pendingText: { color: '#667085', fontSize: 12, lineHeight: 17 },
  infoCard: { backgroundColor: '#F9FAFB', borderRadius: 14, padding: 14, gap: 10 },
  infoTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  infoText: { color: '#667085', fontSize: 12, lineHeight: 17, marginTop: 4 },
  connectionDetails: { gap: 7, paddingTop: 3 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14 },
  detailLabel: { color: '#667085', fontSize: 11.5, fontWeight: '700' },
  detailValue: { color: '#102A43', fontSize: 11.5, fontWeight: '900', flexShrink: 1, textAlign: 'right' },
  disconnectButton: { minHeight: 42, borderWidth: 1, borderColor: '#FDA29B', borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  disconnectButtonText: { color: '#B42318', fontSize: 12, fontWeight: '900' },
});


const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  successCard: { backgroundColor: '#12372C', borderColor: '#1C6B4A' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  secondaryButton: { backgroundColor: '#162F46', borderColor: '#667085' },
});
