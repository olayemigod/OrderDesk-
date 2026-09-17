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
          onboardingMethod: callback.onboardingMethod,
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
          {connected && connection?.connection?.onboardingMethod === 'coexistence' ? (
            <Text style={[styles.versionText, appearance.dark && darkStyles.bodyText]}>
              Coexistence is active: this number can remain available in the WhatsApp Business app while SellerTray uses the authorized Cloud API connection.
            </Text>
          ) : null}
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
            <Text style={styles.warningText}>The Owner must accept the current SellerTray Terms of Use and Privacy Notice before WhatsApp processing can be authorized.</Text>
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

        {processingActive && isOwner ? (
          <Pressable
            disabled={consentBusy}
            onPress={() => void revokeConsent()}
            style={[styles.secondaryButton, consentBusy && styles.disabled]}
          >
            <Text style={[styles.secondaryButtonText, appearance.dark && darkStyles.titleText]}>{consentBusy ? 'Updating…' : 'Pause WhatsApp processing'}</Text>
          </Pressable>
        ) : null}
      </View>

      {isOwner ? (
        <View style={[styles.connectionActions, appearance.dark && darkStyles.card]}>
          <Text style={[styles.actionTitle, appearance.dark && darkStyles.titleText]}>{connected ? 'Connection controls' : 'Connect through Meta'}</Text>
          <Text style={[styles.actionText, appearance.dark && darkStyles.bodyText]}>
            {connected
              ? 'SellerTray stores Meta credentials only on the backend. Disconnect here before moving this number to another SellerTray business.'
              : 'If your eligible number is already active in the WhatsApp Business app, Meta can offer Coexistence so you can keep using the app while SellerTray connects.'}
          </Text>
          {connected ? (
            <Pressable disabled={connectionBusy} onPress={() => void disconnectCurrentWhatsApp()} style={[styles.secondaryButton, connectionBusy && styles.disabled]}>
              <Text style={[styles.secondaryButtonText, appearance.dark && darkStyles.titleText]}>{connectionBusy ? 'Updating…' : 'Disconnect WhatsApp'}</Text>
            </Pressable>
          ) : (
            <Pressable disabled={connectionBusy} onPress={() => void connectWhatsApp()} style={[styles.primaryButton, connectionBusy && styles.disabled]}>
              <Text style={styles.primaryButtonText}>{connectionBusy ? 'Opening Meta…' : 'Continue with Meta'}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

function ReadinessItem({ label, ready, text }: { label: string; ready: boolean; text: string }) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={[styles.readinessItem, appearance.dark && darkStyles.card]}>
      <View style={[styles.readinessDot, ready && styles.readinessDotReady]} />
      <Text style={[styles.readinessLabel, appearance.dark && darkStyles.titleText]}>{label}</Text>
      <Text style={[styles.readinessText, appearance.dark && darkStyles.bodyText]}>{text}</Text>
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-NG') : value;
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  eyebrow: { color: '#667085', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: '#102A43', fontSize: 22, fontWeight: '900', marginTop: 2 },
  subtitle: { color: '#475467', fontSize: 13, lineHeight: 19, marginTop: 5 },
  statusCard: { flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: '#E4E7EC', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 13 },
  connectedCard: { borderColor: '#ABEFC6', backgroundColor: '#ECFDF3' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#98A2B3', marginTop: 5 },
  connectedDot: { backgroundColor: '#12B76A' },
  statusCopy: { flex: 1, gap: 3 },
  statusTitle: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  statusText: { color: '#475467', fontSize: 12, lineHeight: 18 },
  pausedText: { color: '#B54708', fontSize: 11, lineHeight: 17, marginTop: 3 },
  connectionErrorCard: { backgroundColor: '#FEF3F2', borderRadius: 12, padding: 11, gap: 4 },
  connectionErrorTitle: { color: '#B42318', fontSize: 12, fontWeight: '900' },
  connectionErrorText: { color: '#B42318', fontSize: 11, lineHeight: 17 },
  refreshText: { color: '#079455', fontSize: 11, fontWeight: '900', marginTop: 3 },
  readinessGrid: { flexDirection: 'row', gap: 8 },
  readinessItem: { flex: 1, borderWidth: 1, borderColor: '#E4E7EC', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 10 },
  readinessDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F04438', marginBottom: 6 },
  readinessDotReady: { backgroundColor: '#12B76A' },
  readinessLabel: { color: '#102A43', fontSize: 12, fontWeight: '900' },
  readinessText: { color: '#667085', fontSize: 10, marginTop: 2 },
  consentCard: { borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 13, gap: 9, backgroundColor: '#FFFFFF' },
  consentActiveCard: { borderColor: '#ABEFC6' },
  consentHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  consentCopy: { flex: 1 },
  consentEyebrow: { color: '#667085', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  consentTitle: { color: '#102A43', fontSize: 14, fontWeight: '900', marginTop: 2 },
  consentText: { color: '#475467', fontSize: 12, lineHeight: 18 },
  versionText: { color: '#667085', fontSize: 10, lineHeight: 15 },
  warningBox: { backgroundColor: '#FFFAEB', borderRadius: 10, padding: 9 },
  warningTitle: { color: '#B54708', fontSize: 11, fontWeight: '900' },
  warningText: { color: '#854A0E', fontSize: 10, lineHeight: 15, marginTop: 2 },
  errorText: { color: '#B42318', fontSize: 11, lineHeight: 16 },
  connectionActions: { borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 14, padding: 13, gap: 9, backgroundColor: '#FFFFFF' },
  actionTitle: { color: '#102A43', fontSize: 14, fontWeight: '900' },
  actionText: { color: '#475467', fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 44, borderRadius: 10, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  secondaryButton: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13 },
  secondaryButtonText: { color: '#344054', fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.5 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  successCard: { backgroundColor: '#163B32', borderColor: '#12B76A' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
});
