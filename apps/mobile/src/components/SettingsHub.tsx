import { useEffect, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { BusinessProfileInput, MerchantBusiness } from '../data/businessRepository';
import { usePlatformAdmin } from '../hooks/usePlatformAdmin';
import { useSubscriptionAccess } from '../hooks/useSubscriptionAccess';
import { AccountDataControls } from './AccountDataControls';
import { BusinessProfileView } from './BusinessProfileView';
import { CustomersView } from './CustomersView';
import { CustomerNotificationSettings } from './CustomerNotificationSettings';
import { PaymentMethodsSettings } from './PaymentMethodsSettings';
import { MfaSecurityCard } from './MfaSecurityCard';
import { PlatformAdminView } from './PlatformAdminView';
import { SubscriptionStatusCard } from './SubscriptionStatusCard';
import { TeamManagementView } from './TeamManagementView';
import { WhatsAppConnectionView } from './WhatsAppConnectionView';

type Section =
  | 'menu'
  | 'business'
  | 'customers'
  | 'whatsapp'
  | 'notifications'
  | 'payments'
  | 'team'
  | 'subscription'
  | 'security'
  | 'account'
  | 'support'
  | 'admin';

type Props = {
  business: MerchantBusiness;
  onSaveBusiness: (businessId: string, input: BusinessProfileInput) => Promise<void>;
};

export function SettingsHub({ business, onSaveBusiness }: Props) {
  const [section, setSection] = useState<Section>('menu');
  const subscription = useSubscriptionAccess(business.id);
  const platformAdmin = usePlatformAdmin();

  useEffect(() => {
    if (Platform.OS !== 'android' || section === 'menu') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSection('menu');
      return true;
    });

    return () => subscription.remove();
  }, [section]);

  if (section !== 'menu') {
    return (
      <View style={styles.detailWrap}>
        <Pressable onPress={() => setSection('menu')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>← More</Text>
        </Pressable>

        {section === 'business' ? <BusinessProfileView business={business} onSave={onSaveBusiness} /> : null}
        {section === 'customers' ? <CustomersView business={business} /> : null}
        {section === 'whatsapp' ? <WhatsAppConnectionView business={business} /> : null}
        {section === 'notifications' ? <CustomerNotificationSettings business={business} /> : null}
        {section === 'payments' ? <PaymentMethodsSettings business={business} /> : null}
        {section === 'team' ? <TeamManagementView business={business} /> : null}
        {section === 'subscription' ? (
          <View style={styles.detailSection}>
            <View>
              <Text style={styles.eyebrow}>PLAN & BILLING</Text>
              <Text style={styles.title}>Subscription</Text>
              <Text style={styles.subtitle}>Review the current SellerTray plan and billing state for this business.</Text>
            </View>
            <SubscriptionStatusCard
              tenantId={business.id}
              role={business.role}
              subscription={subscription.subscription}
              loading={subscription.loading}
              error={subscription.error}
            />
          </View>
        ) : null}
        {section === 'security' ? (
          <View style={styles.detailSection}>
            <View>
              <Text style={styles.eyebrow}>SECURITY</Text>
              <Text style={styles.title}>Multi-factor authentication</Text>
              <Text style={styles.subtitle}>Enroll or verify your authenticator for sensitive SellerTray access.</Text>
            </View>
            <MfaSecurityCard />
          </View>
        ) : null}
        {section === 'support' ? <SupportView /> : null}
        {section === 'account' ? (
          <View style={styles.detailSection}>
            <View>
              <Text style={styles.eyebrow}>ACCOUNT & PRIVACY</Text>
              <Text style={styles.title}>Your SellerTray account</Text>
              <Text style={styles.subtitle}>Session controls, data export, legal information and account closure.</Text>
            </View>
            <AccountDataControls business={business} />
          </View>
        ) : null}
        {section === 'admin' && platformAdmin.overview ? (
          <PlatformAdminView
            overview={platformAdmin.overview}
            audit={platformAdmin.audit}
            loading={platformAdmin.loading}
            busy={platformAdmin.busy}
            error={platformAdmin.error}
            onRefresh={platformAdmin.refresh}
            onMutate={platformAdmin.mutate}
            standalone
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View>
        <Text style={styles.eyebrow}>MERCHANT SETTINGS</Text>
        <Text style={styles.title}>More</Text>
        <Text style={styles.subtitle}>
          Manage your business profile, payments, WhatsApp, catalogue, team and account preferences.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryName}>{business.name}</Text>
        <Text style={styles.summaryMeta}>{business.role.toUpperCase()} · {formatLabel(business.subscriptionStatus)}</Text>
      </View>

      <View style={styles.menuSection}>
        <Text style={styles.groupLabel}>SELLING & CUSTOMERS</Text>
        <View style={styles.menuGroup}>
          <MenuRow
            icon="people-outline"
            title="Customers"
            text="Customer directory, history and profile details"
            onPress={() => setSection('customers')}
          />
          <MenuRow
            icon="card-outline"
            title="Customer payments"
            text="Payment methods, reconciliation and customer payment choices"
            onPress={() => setSection('payments')}
          />
          <MenuRow
            icon="logo-whatsapp"
            title="WhatsApp connection"
            text={business.whatsappConnectionStatus === 'connected' ? 'Connected and receiving supported activity' : 'Connect and verify your WhatsApp Business number'}
            status={business.whatsappConnectionStatus === 'connected' ? 'Connected' : 'Setup'}
            onPress={() => setSection('whatsapp')}
          />
          <MenuRow
            icon="notifications-outline"
            title="Customer notifications"
            text="Control automated order and payment updates"
            onPress={() => setSection('notifications')}
          />
        </View>
      </View>

      <View style={styles.menuSection}>
        <Text style={styles.groupLabel}>BUSINESS</Text>
        <View style={styles.menuGroup}>
          <MenuRow
            icon="business-outline"
            title="Business profile"
            text="Business name, contact details, currency and timezone"
            onPress={() => setSection('business')}
          />
          <MenuRow
            icon="people-circle-outline"
            title="Team & access"
            text="Owners, managers, staff and invitations"
            onPress={() => setSection('team')}
          />
          <MenuRow
            icon="wallet-outline"
            title="Plan & billing"
            text="Subscription status and SellerTray billing controls"
            onPress={() => setSection('subscription')}
          />
        </View>
      </View>

      <View style={styles.menuSection}>
        <Text style={styles.groupLabel}>ACCOUNT & SECURITY</Text>
        <View style={styles.menuGroup}>
          <MenuRow
            icon="shield-checkmark-outline"
            title="Security & MFA"
            text="Authenticator enrollment and high-assurance session verification"
            onPress={() => setSection('security')}
          />
          <MenuRow
            icon="lock-closed-outline"
            title="Account & privacy"
            text="Sign out, export data, legal information and account closure"
            onPress={() => setSection('account')}
          />
          <MenuRow
            icon="help-circle-outline"
            title="Help & support"
            text="Live chat, WhatsApp, phone and email support"
            onPress={() => setSection('support')}
          />
        </View>
      </View>

      <Text style={styles.buildStamp}>SellerTray 1.0.0 · Android build 7</Text>

      {platformAdmin.overview ? (
        <View style={styles.adminGroup}>
          <Text style={styles.groupLabel}>PROCESSEDGE ADMIN</Text>
          <MenuRow
            icon="construct-outline"
            title="Platform operations"
            text="Administrative operations and audit tools"
            onPress={() => setSection('admin')}
          />
        </View>
      ) : null}
    </View>
  );
}

function SupportView() {
  const chatUrl = process.env.EXPO_PUBLIC_SUPPORT_CHAT_URL?.trim() || 'https://processedge.com.ng/contact';

  return (
    <View style={styles.detailSection}>
      <View>
        <Text style={styles.eyebrow}>HELP & SUPPORT</Text>
        <Text style={styles.title}>Need help?</Text>
        <Text style={styles.subtitle}>Choose the fastest way to reach the SellerTray support team.</Text>
      </View>
      <View style={styles.supportHero}>
        <View style={styles.supportHeroIcon}>
          <Ionicons name="headset-outline" size={27} color="#FFFFFF" />
        </View>
        <View style={styles.menuCopy}>
          <Text style={styles.supportHeroTitle}>SellerTray Customer Service</Text>
          <Text style={styles.supportHeroText}>Support for sign-in, setup, orders, payments and WhatsApp connection.</Text>
        </View>
      </View>
      <View style={styles.menuGroup}>
        <SupportRow icon="chatbubbles-outline" title="Live chat" text="Open SellerTray support chat" url={chatUrl} />
        <SupportRow icon="logo-whatsapp" title="WhatsApp" text="+234 809 608 6857" url="https://wa.me/2348096086857?text=Hello%20SellerTray%20Support" />
        <SupportRow icon="call-outline" title="Call support" text="+234 809 608 6857" url="tel:+2348096086857" />
        <SupportRow icon="mail-outline" title="Email" text="processedgeng@gmail.com" url="mailto:processedgeng@gmail.com?subject=SellerTray%20Support" />
      </View>
      <View style={styles.supportNote}>
        <Ionicons name="information-circle-outline" size={20} color="#079455" />
        <Text style={styles.supportNoteText}>Live chat is wired through a configurable support URL so ProcessEdge can use Chatwoot without rebuilding the app when the inbox URL changes.</Text>
      </View>
    </View>
  );
}

function SupportRow({ icon, title, text, url }: { icon: string; title: string; text: string; url: string }) {
  return (
    <Pressable onPress={() => void Linking.openURL(url)} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
      <View style={styles.menuIcon}>
        <Ionicons name={icon as never} size={21} color="#079455" />
      </View>
      <View style={styles.menuCopy}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuText}>{text}</Text>
      </View>
      <Ionicons name="open-outline" size={19} color="#667085" />
    </Pressable>
  );
}

function MenuRow({
  icon,
  title,
  text,
  status,
  onPress,
}: {
  icon: string;
  title: string;
  text: string;
  status?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
      <View style={styles.menuIcon}>
        <Ionicons name={icon as never} size={21} color="#079455" />
      </View>
      <View style={styles.menuCopy}>
        <View style={styles.menuTitleRow}>
          <Text style={styles.menuTitle}>{title}</Text>
          {status ? <Text style={styles.status}>{status}</Text> : null}
        </View>
        <Text style={styles.menuText}>{text}</Text>
      </View>
      <Ionicons name="chevron-forward" size={21} color="#667085" />
    </Pressable>
  );
}

function formatLabel(value: string) {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  detailWrap: { gap: 14 },
  detailSection: { gap: 16 },
  eyebrow: { color: '#667085', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#102A43', fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 14, lineHeight: 21, marginTop: 5 },
  summaryCard: { backgroundColor: '#102A43', borderRadius: 17, padding: 16 },
  summaryName: { color: '#FFFFFF', fontSize: 21, fontWeight: '900' },
  summaryMeta: { color: '#D0D5DD', fontSize: 13, fontWeight: '800', marginTop: 4 },
  menuSection: { gap: 7 },
  menuGroup: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 18, overflow: 'hidden' },
  menuRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E7EC',
  },
  menuIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  menuCopy: { flex: 1 },
  menuTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuTitle: { color: '#102A43', fontSize: 15, fontWeight: '900', flexShrink: 1 },
  menuText: { color: '#667085', fontSize: 13, lineHeight: 19, marginTop: 3 },
  status: { color: '#079455', backgroundColor: '#ECFDF3', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, fontSize: 9, fontWeight: '900' },
  chevron: { color: '#667085', fontSize: 27, fontWeight: '400' },
  backButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', paddingRight: 12 },
  backText: { color: '#12B76A', fontSize: 13, fontWeight: '900' },
  buildStamp: { color: '#667085', fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  adminGroup: { gap: 7 },
  groupLabel: { color: '#667085', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  supportHero: { backgroundColor: '#102A43', borderRadius: 17, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  supportHeroIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center' },
  supportHeroTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  supportHeroText: { color: '#D0D5DD', fontSize: 12, lineHeight: 18, marginTop: 2 },
  supportNote: { backgroundColor: '#ECFDF3', borderRadius: 14, padding: 12, flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  supportNoteText: { flex: 1, color: '#475467', fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.72 },
});
