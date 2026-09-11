import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';

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

  return (
    <View style={styles.wrap}>
      <View>
        <Text style={styles.eyebrow}>WHATSAPP</Text>
        <Text style={styles.title}>WhatsApp connection</Text>
        <Text style={styles.subtitle}>
          Customers keep chatting on WhatsApp. SellerTray turns supported order messages into a merchant order inbox.
        </Text>
      </View>

      <View style={[styles.statusCard, connected && styles.connectedCard]}>
        <View style={[styles.dot, connected && styles.connectedDot]} />
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>{status.title}</Text>
          <Text style={styles.statusText}>{status.text}</Text>
        </View>
      </View>

      {!connected ? (
        <View style={styles.setupCard}>
          <Text style={styles.setupTitle}>How connection will work</Text>
          <Step number="1" title="Use a WhatsApp Business number" text="Choose the number customers already use or a dedicated sales number." />
          <Step number="2" title="Connect through SellerTray" text="SellerTray will launch Meta's approved WhatsApp onboarding flow from this screen." />
          <Step number="3" title="Send a test order" text="After connection, send a real test message from another phone and confirm it appears in Orders." />

          <Pressable disabled style={styles.connectButton}>
            <Text style={styles.connectButtonText}>Connect WhatsApp</Text>
            <Text style={styles.connectButtonHint}>Available after Meta production approval</Text>
          </Pressable>

          <View style={styles.pendingNotice}>
            <Text style={styles.pendingTitle}>Connection activation pending</Text>
            <Text style={styles.pendingText}>
              Meta production verification is still being completed. The self-service Connect WhatsApp action will be enabled here when the Meta connection is approved; merchants should not be asked to configure webhooks or API credentials themselves.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Connection is active</Text>
          <Text style={styles.infoText}>
            To verify the live flow, send a product order from a different WhatsApp number and confirm the order appears in the Orders tab.
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

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  eyebrow: { color: '#98A2B3', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#101828', fontSize: 25, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 19, marginTop: 5 },
  statusCard: {
    borderWidth: 1,
    borderColor: '#FEC84B',
    backgroundColor: '#FFFAEB',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    gap: 11,
    alignItems: 'flex-start',
  },
  connectedCard: { borderColor: '#ABEFC6', backgroundColor: '#ECFDF3' },
  dot: { width: 10, height: 10, borderRadius: 99, backgroundColor: '#F79009', marginTop: 4 },
  connectedDot: { backgroundColor: '#12B76A' },
  statusCopy: { flex: 1 },
  statusTitle: { color: '#101828', fontSize: 14, fontWeight: '900' },
  statusText: { color: '#475467', fontSize: 12, lineHeight: 18, marginTop: 4 },
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
