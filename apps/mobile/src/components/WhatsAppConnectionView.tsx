import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import {
  acceptWhatsAppConsent,
  loadWhatsAppConsent,
  revokeWhatsAppConsent,
  type WhatsAppConsentStatus,
} from '../data/whatsappConsentRepository';

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
  const status = statusCopy[business.whatsappConnectionStatus];
  const connected = business.whatsappConnectionStatus === 'connected';
  const [consent, setConsent] = useState<WhatsAppConsentStatus | null>(null);
  const [consentLoading, setConsentLoading] = useState(true);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const isOwner = business.role === 'owner';

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
  }, [business.id]);

  const processingPolicy = useMemo(
    () => consent?.policies.find((policy) => policy.policy_key === 'whatsapp_data_processing') ?? null,
    [consent?.policies],
  );

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
  const connectionOperational = connected && processingActive;

  return (
    <View style={styles.wrap}>
      <View>
        <Text style={styles.eyebrow}>WHATSAPP</Text>
        <Text style={styles.title}>WhatsApp connection</Text>
        <Text style={styles.subtitle}>
          Customers keep chatting on WhatsApp. SellerTray turns supported order messages into a merchant order inbox.
        </Text>
      </View>

      <View style={[styles.statusCard, connectionOperational && styles.connectedCard]}>
        <View style={[styles.dot, connectionOperational && styles.connectedDot]} />
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>{status.title}</Text>
          <Text style={styles.statusText}>{status.text}</Text>
          {connected && !processingActive ? (
            <Text style={styles.pausedText}>
              Message processing is paused until the business Owner authorizes the current WhatsApp data-processing terms.
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.consentCard, processingActive && styles.consentActiveCard]}>
        <View style={styles.consentHeading}>
          <View style={styles.consentCopy}>
            <Text style={styles.consentEyebrow}>DATA PROCESSING</Text>
            <Text style={styles.consentTitle}>
              {processingActive ? 'WhatsApp processing authorized' : 'Owner authorization required'}
            </Text>
          </View>
          {consentLoading ? <ActivityIndicator size="small" /> : null}
        </View>

        <Text style={styles.consentText}>
          {processingPolicy?.summary ??
            'SellerTray only processes connected WhatsApp conversations for the approved order, customer, payment, notification and catalogue workflows.'}
        </Text>

        {processingPolicy ? (
          <Text style={styles.versionText}>
            Policy version {processingPolicy.version} · Effective {formatDate(processingPolicy.effective_at)}
          </Text>
        ) : null}

        {consent?.consent ? (
          <Text style={styles.versionText}>
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
          <Pressable disabled={consentBusy} onPress={() => void revokeConsent()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{consentBusy ? 'Updating…' : 'Revoke authorization'}</Text>
          </Pressable>
        ) : null}

        {!consentLoading && !isOwner ? (
          <Text style={styles.ownerOnlyText}>
            Only the business Owner can accept or revoke this authorization. Managers and Staff can view its status.
          </Text>
        ) : null}

        <Pressable onPress={() => void refreshConsent()} disabled={consentLoading || consentBusy}>
          <Text style={styles.refreshText}>Refresh authorization status</Text>
        </Pressable>
      </View>

      {!connected ? (
        <View style={styles.setupCard}>
          <Text style={styles.setupTitle}>How connection will work</Text>
          <Step number="1" title="Use a WhatsApp Business number" text="Choose the number customers already use or a dedicated sales number." />
          <Step number="2" title="Connect through SellerTray" text="SellerTray will launch Meta's approved WhatsApp onboarding flow from this screen." />
          <Step number="3" title="Send a test order" text="After connection and authorization, send a real test message from another phone and confirm it appears in Orders." />

          <Pressable disabled style={styles.connectButton}>
            <Text style={styles.connectButtonText}>Connect WhatsApp</Text>
            <Text style={styles.connectButtonHint}>Merchant self-service connection is being enabled</Text>
          </Pressable>

          <View style={styles.pendingNotice}>
            <Text style={styles.pendingTitle}>Self-service onboarding is being enabled</Text>
            <Text style={styles.pendingText}>
              SellerTray's WhatsApp integration can already operate for configured businesses. Meta Embedded Signup will be enabled here for additional merchants after the required app review, access and onboarding configuration are completed. Merchants should never be asked to configure SellerTray webhooks or API credentials themselves.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>{processingActive ? 'Connection is active' : 'Connection is connected but paused'}</Text>
          <Text style={styles.infoText}>
            {processingActive
              ? 'Send a product order from a different WhatsApp number and confirm the order appears in the Orders tab.'
              : 'No customer conversation content will be stored or interpreted by SellerTray until the current authorization is active.'}
          </Text>
        </View>
      )}
    </View>
  );
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View>
      <View style={styles.stepCopy}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepText}>{text}</Text>
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
  eyebrow: { color: '#98A2B3', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#101828', fontSize: 25, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 19, marginTop: 5 },
  statusCard: {
    borderWidth: 1, borderColor: '#FEC84B', backgroundColor: '#FFFAEB', borderRadius: 16,
    padding: 14, flexDirection: 'row', gap: 11, alignItems: 'flex-start',
  },
  connectedCard: { borderColor: '#ABEFC6', backgroundColor: '#ECFDF3' },
  dot: { width: 10, height: 10, borderRadius: 99, backgroundColor: '#F79009', marginTop: 4 },
  connectedDot: { backgroundColor: '#12B76A' },
  statusCopy: { flex: 1 },
  statusTitle: { color: '#101828', fontSize: 14, fontWeight: '900' },
  statusText: { color: '#475467', fontSize: 12, lineHeight: 18, marginTop: 4 },
  pausedText: { color: '#B54708', fontSize: 10, lineHeight: 15, fontWeight: '800', marginTop: 6 },
  consentCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#FEC84B', borderRadius: 16, padding: 14, gap: 9 },
  consentActiveCard: { borderColor: '#ABEFC6' },
  consentHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  consentCopy: { flex: 1 },
  consentEyebrow: { color: '#98A2B3', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  consentTitle: { color: '#101828', fontSize: 14, fontWeight: '900', marginTop: 2 },
  consentText: { color: '#475467', fontSize: 11, lineHeight: 17 },
  versionText: { color: '#667085', fontSize: 9, lineHeight: 14 },
  warningBox: { backgroundColor: '#FFFAEB', borderRadius: 10, padding: 10, gap: 3 },
  warningTitle: { color: '#B54708', fontSize: 10, fontWeight: '900' },
  warningText: { color: '#7A2E0E', fontSize: 9, lineHeight: 14 },
  errorText: { color: '#B42318', fontSize: 10, lineHeight: 15 },
  primaryButton: { minHeight: 46, borderRadius: 11, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  secondaryButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#D0D5DD', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#344054', fontSize: 10, fontWeight: '900' },
  ownerOnlyText: { color: '#667085', fontSize: 10, lineHeight: 15 },
  refreshText: { color: '#246BFD', fontSize: 10, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  setupCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAECF0', borderRadius: 18, padding: 16, gap: 14 },
  setupTitle: { color: '#101828', fontSize: 15, fontWeight: '900' },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNumber: { width: 28, height: 28, borderRadius: 99, backgroundColor: '#EEF4FF', alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: '#175CD3', fontWeight: '900', fontSize: 11 },
  stepCopy: { flex: 1 },
  stepTitle: { color: '#344054', fontSize: 12, fontWeight: '900' },
  stepText: { color: '#667085', fontSize: 11, lineHeight: 17, marginTop: 2 },
  connectButton: { minHeight: 52, borderRadius: 12, backgroundColor: '#E4E7EC', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, opacity: 0.8 },
  connectButtonText: { color: '#475467', fontSize: 13, fontWeight: '900' },
  connectButtonHint: { color: '#667085', fontSize: 9, fontWeight: '700', marginTop: 2 },
  pendingNotice: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12, gap: 4 },
  pendingTitle: { color: '#344054', fontSize: 12, fontWeight: '900' },
  pendingText: { color: '#667085', fontSize: 11, lineHeight: 17 },
  infoCard: { backgroundColor: '#F9FAFB', borderRadius: 14, padding: 14 },
  infoTitle: { color: '#101828', fontSize: 13, fontWeight: '900' },
  infoText: { color: '#667085', fontSize: 11, lineHeight: 17, marginTop: 4 },
});
