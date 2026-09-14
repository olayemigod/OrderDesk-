import { useEffect, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { BusinessProfileInput, MerchantBusiness } from '../data/businessRepository';
import { usePlatformAdmin } from '../hooks/usePlatformAdmin';
import { useSubscriptionAccess } from '../hooks/useSubscriptionAccess';
import { AccountDataControls } from './AccountDataControls';
import { BusinessProfileView } from './BusinessProfileView';
import { CommercialActionAuditView } from './CommercialActionAuditView';
import { CustomersView } from './CustomersView';
import { CustomerNotificationSettings } from './CustomerNotificationSettings';
import { CustomerEnquiriesView } from './CustomerEnquiriesView';
import { PaymentMethodsSettings } from './PaymentMethodsSettings';
import { OperationalPolicySettings } from './OperationalPolicySettings';
import { ReportsView } from './ReportsView';
import { MfaSecurityCard } from './MfaSecurityCard';
import { PlatformAdminView } from './PlatformAdminView';
import { SubscriptionStatusCard } from './SubscriptionStatusCard';
import { TeamManagementView } from './TeamManagementView';
import { WhatsAppConnectionView } from './WhatsAppConnectionView';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Section =
  | 'menu'
  | 'business'
  | 'customers'
  | 'enquiries'
  | 'whatsapp'
  | 'notifications'
  | 'payments'
  | 'operations'
  | 'reports'
  | 'audit'
  | 'team'
  | 'subscription'
  | 'security'
  | 'account'
  | 'support'
  | 'appearance'
  | 'admin';

type Props = {
  business: MerchantBusiness;
  onSaveBusiness: (businessId: string, input: BusinessProfileInput) => Promise<void>;
};

export function SettingsHub({ business, onSaveBusiness }: Props) {
  const [section, setSection] = useState<Section>('menu');
  const subscription = useSubscriptionAccess(business.id);
  const platformAdmin = usePlatformAdmin();
  const appearance = useSellerTrayAppearance();

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
      <View style={[styles.detailWrap, appearance.dark && darkStyles.surface]}>
        <Pressable onPress={() => setSection('menu')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={[styles.backText, appearance.dark && darkStyles.greenText]}>← More</Text>
        </Pressable>

        {section === 'business' ? <BusinessProfileView business={business} onSave={onSaveBusiness} /> : null}
        {section === 'customers' ? <CustomersView business={business} /> : null}
        {section === 'enquiries' ? <CustomerEnquiriesView business={business} /> : null}
        {section === 'whatsapp' ? <WhatsAppConnectionView business={business} /> : null}
        {section === 'notifications' ? <CustomerNotificationSettings business={business} /> : null}
        {section === 'payments' ? <PaymentMethodsSettings business={business} /> : null}
        {section === 'operations' ? <OperationalPolicySettings business={business} /> : null}
        {section === 'reports' ? <ReportsView business={business} /> : null}
        {section === 'audit' ? <CommercialActionAuditView business={business} /> : null}
        {section === 'team' ? <TeamManagementView business={business} /> : null}
        {section === 'subscription' ? (
          <View style={styles.detailSection}>
            <View>
              <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>PLAN & BILLING</Text>
              <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Subscription</Text>
              <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>Review the current SellerTray plan and billing state for this business.</Text>
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
              <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>SECURITY</Text>
              <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Multi-factor authentication</Text>
              <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>Enroll or verify your authenticator for sensitive SellerTray access.</Text>
            </View>
            <MfaSecurityCard />
          </View>
        ) : null}
        {section === 'support' ? <SupportView /> : null}
        {section === 'appearance' ? (
          <AppearanceView
            mode={appearance.mode}
            textSize={appearance.textSize}
            onMode={appearance.setMode}
            onTextSize={appearance.setTextSize}
          />
        ) : null}
        {section === 'account' ? (
          <View style={styles.detailSection}>
            <View>
              <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>ACCOUNT & PRIVACY</Text>
              <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Your SellerTray account</Text>
              <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>Session controls, data export, legal information and account closure.</Text>
            </View>
            <AccountDataControls business={business} />
          </View>
        ) : null}
        {section === 'admin' && platformAdmin.overview ? (
          <PlatformAdminView
            overview={platformAdmin.overview}
            audit={platformAdmin.audit}
            readiness={platformAdmin.readiness}
            probe={platformAdmin.probe}
            loading={platformAdmin.loading}
            busy={platformAdmin.busy}
            error={platformAdmin.error}
            onRefresh={platformAdmin.refresh}
            onRunAiProbe={platformAdmin.runAiProbe}
            onMutate={platformAdmin.mutate}
            standalone
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, appearance.dark && darkStyles.surface]}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>MERCHANT SETTINGS</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText, appearance.textSize === 'large' && styles.titleLarge]}>More</Text>
        <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>
          Manage your business profile, payments, WhatsApp, catalogue, team and account preferences.
        </Text>
      </View>

      <View style={[styles.summaryCard, appearance.dark && darkStyles.summaryCard]}>
        <Text style={styles.summaryName}>{business.name}</Text>
        <Text style={styles.summaryMeta}>{business.role.toUpperCase()} · {formatLabel(business.subscriptionStatus)}</Text>
      </View>

      <View style={styles.menuSection}>
        <Text style={[styles.groupLabel, appearance.dark && darkStyles.bodyText]}>SELLING & CUSTOMERS</Text>
        <View style={[styles.menuGroup, appearance.dark && darkStyles.card]}>
          <MenuRow
            icon="people-outline"
            title="Customers"
            text="Customer directory, history and profile details"
            onPress={() => setSection('customers')}
          />
          <MenuRow
            icon="chatbubble-ellipses-outline"
            title="Customer enquiries"
            text="Price and product questions kept separate from actual orders"
            onPress={() => setSection('enquiries')}
          />
          <MenuRow
            icon="card-outline"
            title="Customer payments"
            text="Payment methods, reconciliation and customer payment choices"
            onPress={() => setSection('payments')}
          />
          <MenuRow
            icon="options-outline"
            title="Payment & delivery policy"
            text="Payment gates, delivery evidence and merchant WhatsApp alert rules"
            onPress={() => setSection('operations')}
          />
          <MenuRow
            icon="logo-whatsapp"
            title="WhatsApp connection"
            text={
              business.whatsappReadiness.messagingReady
                ? 'Inbound and outbound messaging verified'
                : business.whatsappConnectionStatus === 'connected'
                  ? 'Connected, but outbound messaging still needs verification'
                  : 'Connect and verify your WhatsApp Business number'
            }
            status={
              business.whatsappReadiness.messagingReady
                ? 'Ready'
                : business.whatsappConnectionStatus === 'connected'
                  ? 'Check'
                  : 'Setup'
            }
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
        <Text style={[styles.groupLabel, appearance.dark && darkStyles.bodyText]}>BUSINESS</Text>
        <View style={[styles.menuGroup, appearance.dark && darkStyles.card]}>
          {business.role !== 'staff' ? (
            <>
              <MenuRow
                icon="stats-chart-outline"
                title="Reports"
                text="Orders, payments, products and fulfilment performance"
                onPress={() => setSection('reports')}
              />
              <MenuRow
                icon="shield-checkmark-outline"
                title="Commercial action audit"
                text="Trace AI, customer, policy and workflow actions"
                onPress={() => setSection('audit')}
              />
            </>
          ) : null}
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
        <Text style={[styles.groupLabel, appearance.dark && darkStyles.bodyText]}>ACCOUNT & SECURITY</Text>
        <View style={[styles.menuGroup, appearance.dark && darkStyles.card]}>
          <MenuRow
            icon="moon-outline"
            title="Appearance"
            text="Dark mode and comfortable text size"
            onPress={() => setSection('appearance')}
          />
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

      <Text style={[styles.buildStamp, appearance.dark && darkStyles.bodyText]}>SellerTray 1.0.0 · Android build 13</Text>

      {platformAdmin.overview ? (
        <View style={styles.adminGroup}>
          <Text style={[styles.groupLabel, appearance.dark && darkStyles.bodyText]}>PROCESSEDGE ADMIN</Text>
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

function AppearanceView({
  mode,
  textSize,
  onMode,
  onTextSize,
}: {
  mode: 'system' | 'light' | 'dark';
  textSize: 'standard' | 'large';
  onMode: (mode: 'system' | 'light' | 'dark') => Promise<void>;
  onTextSize: (size: 'standard' | 'large') => Promise<void>;
}) {
  const appearance = useSellerTrayAppearance();
  return (
    <View style={styles.detailSection}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>APPEARANCE</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Make SellerTray comfortable</Text>
        <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>Choose the display mode and text size that works best for you.</Text>
      </View>

      <View style={[styles.preferenceCard, appearance.dark && darkStyles.card]}>
        <View style={styles.preferenceHeading}>
          <View style={[styles.menuIcon, appearance.dark && darkStyles.mintCard]}>
            <Ionicons name="moon-outline" size={21} color="#079455" />
          </View>
          <View style={styles.menuCopy}>
            <Text style={[styles.menuTitle, appearance.dark && darkStyles.titleText]}>Display mode</Text>
            <Text style={[styles.menuText, appearance.dark && darkStyles.bodyText]}>Follow your phone or choose light/dark explicitly.</Text>
          </View>
        </View>
        <View style={styles.preferenceOptions}>
          {(['system', 'light', 'dark'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => void onMode(option)}
              style={[styles.preferenceOption, mode === option && styles.preferenceOptionActive]}
            >
              <Ionicons
                name={option === 'system' ? 'phone-portrait-outline' : option === 'light' ? 'sunny-outline' : 'moon-outline'}
                size={19}
                color={mode === option ? '#FFFFFF' : '#475467'}
              />
              <Text style={[styles.preferenceOptionText, mode === option && styles.preferenceOptionTextActive]}>
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.preferenceCard, appearance.dark && darkStyles.card]}>
        <View style={styles.preferenceHeading}>
          <View style={styles.menuIcon}>
            <Ionicons name="text-outline" size={21} color="#079455" />
          </View>
          <View style={styles.menuCopy}>
            <Text style={[styles.menuTitle, appearance.dark && darkStyles.titleText]}>Text size</Text>
            <Text style={[styles.menuText, appearance.dark && darkStyles.bodyText]}>SellerTray now uses a larger readable baseline; Large adds extra emphasis.</Text>
          </View>
        </View>
        <View style={styles.preferenceOptions}>
          {(['standard', 'large'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => void onTextSize(option)}
              style={[styles.preferenceOption, textSize === option && styles.preferenceOptionActive]}
            >
              <Text style={[styles.preferenceOptionText, textSize === option && styles.preferenceOptionTextActive]}>
                {option === 'standard' ? 'Standard' : 'Large'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function SupportView() {
  const appearance = useSellerTrayAppearance();
  const configuredChatUrl = process.env.EXPO_PUBLIC_SUPPORT_CHAT_URL?.trim() || '';
  const whatsappUrl = 'https://wa.me/2348096086857?text=Hello%20SellerTray%20Support';
  const chatUrl = configuredChatUrl || whatsappUrl;

  return (
    <View style={styles.detailSection}>
      <View>
        <Text style={[styles.eyebrow, appearance.dark && darkStyles.bodyText]}>HELP & SUPPORT</Text>
        <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>Need help?</Text>
        <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>Choose the fastest way to reach the SellerTray support team.</Text>
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
      <Pressable
        onPress={() => void Linking.openURL(chatUrl)}
        style={({ pressed }) => [styles.liveChatButton, pressed && styles.pressed]}
      >
        <View style={styles.liveChatIcon}>
          <Ionicons name="chatbubbles-outline" size={24} color="#FFFFFF" />
        </View>
        <View style={styles.menuCopy}>
          <Text style={styles.liveChatTitle}>Chat with SellerTray Support</Text>
          <Text style={styles.liveChatText}>
            {configuredChatUrl ? 'Open live customer-service chat' : 'Chat immediately on WhatsApp while live-chat inbox setup is completed'}
          </Text>
        </View>
        <Ionicons name="arrow-forward-circle" size={25} color="#FFFFFF" />
      </Pressable>

      <View style={[styles.menuGroup, appearance.dark && darkStyles.card]}>
        <SupportRow icon="chatbubbles-outline" title="Live chat" text={configuredChatUrl ? 'Dedicated SellerTray chat inbox' : 'Currently routed to WhatsApp support'} url={chatUrl} />
        <SupportRow icon="logo-whatsapp" title="WhatsApp" text="+234 809 608 6857" url={whatsappUrl} />
        <SupportRow icon="call-outline" title="Call support" text="+234 809 608 6857" url="tel:+2348096086857" />
        <SupportRow icon="mail-outline" title="Email" text="processedgeng@gmail.com" url="mailto:processedgeng@gmail.com?subject=SellerTray%20Support" />
      </View>
      <View style={[styles.supportNote, appearance.dark && darkStyles.mintCard]}>
        <Ionicons name="information-circle-outline" size={20} color="#079455" />
        <Text style={[styles.supportNoteText, appearance.dark && darkStyles.bodyText]}>
          SellerTray support chat uses EXPO_PUBLIC_SUPPORT_CHAT_URL when configured. Until then, Chat opens the ProcessEdge WhatsApp support conversation so merchants always have a working support channel.
        </Text>
      </View>
    </View>
  );
}

function SupportRow({ icon, title, text, url }: { icon: string; title: string; text: string; url: string }) {
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable onPress={() => void Linking.openURL(url)} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
      <View style={[styles.menuIcon, appearance.dark && darkStyles.mintCard]}>
        <Ionicons name={icon as never} size={21} color="#079455" />
      </View>
      <View style={styles.menuCopy}>
        <Text style={[styles.menuTitle, appearance.dark && darkStyles.titleText]}>{title}</Text>
        <Text style={[styles.menuText, appearance.dark && darkStyles.bodyText]}>{text}</Text>
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
  const appearance = useSellerTrayAppearance();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, appearance.dark && darkStyles.rowBorder, pressed && styles.pressed]}>
      <View style={styles.menuIcon}>
        <Ionicons name={icon as never} size={21} color="#079455" />
      </View>
      <View style={styles.menuCopy}>
        <View style={styles.menuTitleRow}>
          <Text style={[styles.menuTitle, appearance.dark && darkStyles.titleText]}>{title}</Text>
          {status ? <Text style={styles.status}>{status}</Text> : null}
        </View>
        <Text style={[styles.menuText, appearance.dark && darkStyles.bodyText]}>{text}</Text>
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
  eyebrow: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#102A43', fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 3 },
  titleLarge: { fontSize: 31, lineHeight: 38 },
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
  status: { color: '#079455', backgroundColor: '#ECFDF3', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, fontSize: 12, fontWeight: '900' },
  chevron: { color: '#667085', fontSize: 27, fontWeight: '400' },
  backButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', paddingRight: 12 },
  backText: { color: '#12B76A', fontSize: 13, fontWeight: '900' },
  buildStamp: { color: '#667085', fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  adminGroup: { gap: 7 },
  groupLabel: { color: '#667085', fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  supportHero: { backgroundColor: '#102A43', borderRadius: 17, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  supportHeroIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: '#12B76A', alignItems: 'center', justifyContent: 'center' },
  supportHeroTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  supportHeroText: { color: '#D0D5DD', fontSize: 12, lineHeight: 18, marginTop: 2 },
  liveChatButton: { minHeight: 76, borderRadius: 16, backgroundColor: '#12B76A', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  liveChatIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  liveChatTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  liveChatText: { color: '#E8FFF3', fontSize: 12, lineHeight: 16, marginTop: 2 },
  supportNote: { backgroundColor: '#ECFDF3', borderRadius: 14, padding: 12, flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  supportNoteText: { flex: 1, color: '#475467', fontSize: 12, lineHeight: 18 },
  preferenceCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 16, padding: 13, gap: 12 },
  preferenceHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  preferenceOptions: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  preferenceOption: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#D0D5DD', paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FFFFFF' },
  preferenceOptionActive: { backgroundColor: '#102A43', borderColor: '#102A43' },
  preferenceOptionText: { color: '#475467', fontSize: 12, fontWeight: '900' },
  preferenceOptionTextActive: { color: '#FFFFFF' },
  pressed: { opacity: 0.72 },
});

const darkStyles = StyleSheet.create({
  surface: { backgroundColor: '#081825' },
  card: { backgroundColor: '#102A43', borderColor: '#344054' },
  summaryCard: { backgroundColor: '#0B2035', borderWidth: 1, borderColor: '#344054' },
  mintCard: { backgroundColor: '#12372C' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
  greenText: { color: '#6CE9A6' },
  rowBorder: { borderBottomColor: '#344054' },
});
