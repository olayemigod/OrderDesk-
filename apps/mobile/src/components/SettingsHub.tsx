import { useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

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
            title="Customers"
            text="Customer directory, history and profile details"
            onPress={() => setSection('customers')}
          />
          <MenuRow
            title="Customer payments"
            text="Payment methods, reconciliation and customer payment choices"
            onPress={() => setSection('payments')}
          />
          <MenuRow
            title="WhatsApp connection"
            text={business.whatsappConnectionStatus === 'connected' ? 'Connected and receiving supported activity' : 'Connect and verify your WhatsApp Business number'}
            status={business.whatsappConnectionStatus === 'connected' ? 'Connected' : 'Setup'}
            onPress={() => setSection('whatsapp')}
          />
          <MenuRow
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
            title="Business profile"
            text="Business name, contact details, currency and timezone"
            onPress={() => setSection('business')}
          />
          <MenuRow
            title="Team & access"
            text="Owners, managers, staff and invitations"
            onPress={() => setSection('team')}
          />
          <MenuRow
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
            title="Security & MFA"
            text="Authenticator enrollment and high-assurance session verification"
            onPress={() => setSection('security')}
          />
          <MenuRow
            title="Account & privacy"
            text="Sign out, export data, legal information and account closure"
            onPress={() => setSection('account')}
          />
        </View>
      </View>

      <Text style={styles.buildStamp}>SellerTray 1.0.0 · Android build 7</Text>

      {platformAdmin.overview ? (
        <View style={styles.adminGroup}>
          <Text style={styles.groupLabel}>PROCESSEDGE ADMIN</Text>
          <MenuRow
            title="Platform operations"
            text="Administrative operations and audit tools"
            onPress={() => setSection('admin')}
          />
        </View>
      ) : null}
    </View>
  );
}

function MenuRow({
  title,
  text,
  status,
  onPress,
}: {
  title: string;
  text: string;
  status?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
      <View style={styles.menuCopy}>
        <View style={styles.menuTitleRow}>
          <Text style={styles.menuTitle}>{title}</Text>
          {status ? <Text style={styles.status}>{status}</Text> : null}
        </View>
        <Text style={styles.menuText}>{text}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
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
  eyebrow: { color: '#667085', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#102A43', fontSize: 25, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 19, marginTop: 5 },
  summaryCard: { backgroundColor: '#102A43', borderRadius: 17, padding: 16 },
  summaryName: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  summaryMeta: { color: '#D0D5DD', fontSize: 11, fontWeight: '800', marginTop: 4 },
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
  menuCopy: { flex: 1 },
  menuTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuTitle: { color: '#102A43', fontSize: 14, fontWeight: '900', flexShrink: 1 },
  menuText: { color: '#667085', fontSize: 11, lineHeight: 16, marginTop: 3 },
  status: { color: '#079455', backgroundColor: '#ECFDF3', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, fontSize: 9, fontWeight: '900' },
  chevron: { color: '#667085', fontSize: 27, fontWeight: '400' },
  backButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', paddingRight: 12 },
  backText: { color: '#12B76A', fontSize: 13, fontWeight: '900' },
  buildStamp: { color: '#667085', fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  adminGroup: { gap: 7 },
  groupLabel: { color: '#667085', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  pressed: { opacity: 0.72 },
});
