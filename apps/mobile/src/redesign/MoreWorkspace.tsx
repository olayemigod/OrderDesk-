import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { SettingsHub } from '../components/SettingsHub';
import { SellerTrayText as Text } from '../components/SellerTrayText';
import type { BusinessProfileInput, MerchantBusiness } from '../data/businessRepository';
import type { CashShift } from '../data/cashShiftRepository';
import type { CommerceBranch } from '../data/commerceRepository';
import { loadSellerTrayFeedbackState, type SellerTrayFeedbackState } from '../data/feedbackRepository';
import type { OfflinePosSale } from '../data/offlineSalesRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { CashShiftWorkspace } from './CashShiftWorkspace';
import { FeedbackWorkspace } from './FeedbackWorkspace';
import { PrinterWorkspace } from './PrinterWorkspace';
import { PurchaseReceivingWorkspace } from './PurchaseReceivingWorkspace';
import { SyncStatusWorkspace } from './SyncStatusWorkspace';
import { WhatsAppRuntimeWorkspace } from './WhatsAppRuntimeWorkspace';

type Props = {
  business: MerchantBusiness;
  branch: CommerceBranch;
  activeShift: CashShift | null;
  offlineSales: OfflinePosSale[];
  offlineSyncing: boolean;
  cashRouteKey?: number;
  whatsappRouteKey?: number;
  syncRouteKey?: number;
  onSaveBusiness: (businessId: string, input: BusinessProfileInput) => Promise<void>;
  onShiftChanged: (shift: CashShift | null) => void;
  onOpenOrders?: (customerId?: string) => void;
  onSyncOfflineSales: () => Promise<void>;
  onDiscardOfflineSale: (clientReference: string) => Promise<void>;
};

export function MoreWorkspace({
  business,
  branch,
  activeShift,
  offlineSales,
  offlineSyncing,
  cashRouteKey = 0,
  whatsappRouteKey = 0,
  syncRouteKey = 0,
  onSaveBusiness,
  onShiftChanged,
  onOpenOrders,
  onSyncOfflineSales,
  onDiscardOfflineSale,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [cashOpen, setCashOpen] = useState(false);
  const [purchaseReceivingOpen, setPurchaseReceivingOpen] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackState, setFeedbackState] = useState<SellerTrayFeedbackState | null>(null);
  const openSyncCount = offlineSales.filter((sale) => sale.status !== 'synced').length;
  const reviewCount = offlineSales.filter((sale) => sale.status === 'needs_review' || sale.status === 'failed').length;
  const canManagePurchasing = business.role === 'owner' || business.role === 'manager';

  function closeOperationalWorkspaces() {
    setCashOpen(false);
    setPurchaseReceivingOpen(false);
    setPrinterOpen(false);
    setWhatsappOpen(false);
    setSyncOpen(false);
    setFeedbackOpen(false);
  }

  useEffect(() => {
    if (cashRouteKey > 0) {
      closeOperationalWorkspaces();
      setCashOpen(true);
    }
  }, [cashRouteKey]);

  useEffect(() => {
    if (whatsappRouteKey > 0) {
      closeOperationalWorkspaces();
      setWhatsappOpen(true);
    }
  }, [whatsappRouteKey]);

  useEffect(() => {
    if (syncRouteKey > 0) {
      closeOperationalWorkspaces();
      setSyncOpen(true);
    }
  }, [syncRouteKey]);

  useEffect(() => {
    closeOperationalWorkspaces();
    setFeedbackState(null);
    let active = true;
    void loadSellerTrayFeedbackState(business.id)
      .then((state) => {
        if (active) setFeedbackState(state);
      })
      .catch(() => {
        if (active) setFeedbackState(null);
      });
    return () => { active = false; };
  }, [business.id, branch.id]);

  if (cashOpen) {
    return <CashShiftWorkspace tenantId={business.id} branch={branch} onClose={() => setCashOpen(false)} onShiftChanged={onShiftChanged} />;
  }

  if (purchaseReceivingOpen && canManagePurchasing) {
    return <PurchaseReceivingWorkspace tenantId={business.id} branch={branch} onClose={() => setPurchaseReceivingOpen(false)} />;
  }

  if (printerOpen) {
    return <PrinterWorkspace tenantId={business.id} branch={branch} activeShift={activeShift} onClose={() => setPrinterOpen(false)} />;
  }

  if (whatsappOpen) {
    return <WhatsAppRuntimeWorkspace business={business} branch={branch} onClose={() => setWhatsappOpen(false)} onOpenOrders={onOpenOrders} />;
  }

  if (syncOpen) {
    return <SyncStatusWorkspace sales={offlineSales} syncing={offlineSyncing} onSync={onSyncOfflineSales} onDiscard={onDiscardOfflineSale} onClose={() => setSyncOpen(false)} />;
  }

  if (feedbackOpen) {
    return <FeedbackWorkspace tenantId={business.id} branch={branch} onClose={() => setFeedbackOpen(false)} onStateChanged={setFeedbackState} />;
  }

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>MORE</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>Operations & settings</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Manage today's store work and business settings from one place.
        </Text>
      </View>

      <Pressable onPress={() => { closeOperationalWorkspaces(); setCashOpen(true); }} style={({ pressed }) => [styles.operationCard, dark && darkStyles.card, pressed && styles.pressed]}>
        <View style={[styles.operationIcon, activeShift && styles.operationIconActive]}>
          <Ionicons name="cash-outline" size={23} color={theme.colors.greenDark} />
        </View>
        <View style={styles.operationCopy}>
          <View style={styles.operationTitleRow}>
            <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>Cash & Shift</Text>
            <View style={[styles.statusPill, !activeShift && styles.statusPillClosed]}><Text style={[styles.statusText, !activeShift && styles.statusTextClosed]}>{activeShift ? 'Open' : 'Closed'}</Text></View>
          </View>
          <Text style={[styles.operationText, dark && darkStyles.bodyText]}>
            {activeShift ? `${activeShift.registerName} · Expected cash ${formatMoney(activeShift.expectedCash, activeShift.currency)}` : `Open a cashier shift for ${branch.name}, record expenses and reconcile the drawer.`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

      <Pressable onPress={() => { closeOperationalWorkspaces(); setSyncOpen(true); }} style={({ pressed }) => [styles.operationCard, dark && darkStyles.card, pressed && styles.pressed]}>
        <View style={[styles.operationIcon, openSyncCount > 0 && styles.operationIconWarning]}>
          <Ionicons name={offlineSyncing ? 'sync-outline' : openSyncCount > 0 ? 'cloud-upload-outline' : 'cloud-done-outline'} size={23} color={openSyncCount > 0 ? theme.colors.warning : theme.colors.greenDark} />
        </View>
        <View style={styles.operationCopy}>
          <View style={styles.operationTitleRow}>
            <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>Sync Status</Text>
            {openSyncCount > 0 ? <View style={[styles.statusPill, reviewCount > 0 && styles.statusPillWarning]}><Text style={[styles.statusText, reviewCount > 0 && styles.statusTextWarning]}>{openSyncCount} waiting</Text></View> : null}
          </View>
          <Text style={[styles.operationText, dark && darkStyles.bodyText]}>
            {offlineSyncing ? 'SellerTray is revalidating held sales with the server.' : openSyncCount > 0 ? `${openSyncCount} held sale${openSyncCount === 1 ? '' : 's'} need sync or review. No held sale is treated as paid.` : 'No held sales are waiting to sync.'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

      {canManagePurchasing ? (
        <Pressable onPress={() => { closeOperationalWorkspaces(); setPurchaseReceivingOpen(true); }} style={({ pressed }) => [styles.operationCard, dark && darkStyles.card, pressed && styles.pressed]}>
          <View style={[styles.operationIcon, styles.operationIconActive]}><Ionicons name="cube-outline" size={23} color={theme.colors.greenDark} /></View>
          <View style={styles.operationCopy}>
            <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>Purchase Receiving</Text>
            <Text style={[styles.operationText, dark && darkStyles.bodyText]}>Receive placed Purchase Orders for {branch.name} and post only confirmed quantities into stock.</Text>
          </View>
          <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
        </Pressable>
      ) : null}

      <Pressable onPress={() => { closeOperationalWorkspaces(); setWhatsappOpen(true); }} style={({ pressed }) => [styles.operationCard, dark && darkStyles.card, pressed && styles.pressed]}>
        <View style={[styles.operationIcon, styles.operationIconActive]}><Ionicons name="logo-whatsapp" size={23} color={theme.colors.greenDark} /></View>
        <View style={styles.operationCopy}>
          <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>WhatsApp</Text>
          <Text style={[styles.operationText, dark && darkStyles.bodyText]}>Review WhatsApp order conversations for {branch.name}, unread activity, connection and receiving Branch.</Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

      <Pressable onPress={() => { closeOperationalWorkspaces(); setPrinterOpen(true); }} style={({ pressed }) => [styles.operationCard, dark && darkStyles.card, pressed && styles.pressed]}>
        <View style={[styles.operationIcon, styles.operationIconActive]}><Ionicons name="print-outline" size={23} color={theme.colors.greenDark} /></View>
        <View style={styles.operationCopy}>
          <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>Devices & Printers</Text>
          <Text style={[styles.operationText, dark && darkStyles.bodyText]}>Set up Bluetooth receipt printers, paper width and test printing for {branch.name}.</Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

      <Pressable onPress={() => { closeOperationalWorkspaces(); setFeedbackOpen(true); }} style={({ pressed }) => [styles.operationCard, dark && darkStyles.card, pressed && styles.pressed]}>
        <View style={[styles.operationIcon, feedbackState?.hasSubmitted && styles.operationIconActive]}><Ionicons name={feedbackState?.hasSubmitted ? 'checkmark-circle-outline' : 'chatbubble-ellipses-outline'} size={23} color={theme.colors.greenDark} /></View>
        <View style={styles.operationCopy}>
          <View style={styles.operationTitleRow}>
            <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>Feedback</Text>
            {feedbackState ? <View style={[styles.statusPill, !feedbackState.hasSubmitted && styles.statusPillClosed]}><Text style={[styles.statusText, !feedbackState.hasSubmitted && styles.statusTextClosed]}>{feedbackState.hasSubmitted ? 'Shared' : 'Not yet'}</Text></View> : null}
          </View>
          <Text style={[styles.operationText, dark && darkStyles.bodyText]}>{feedbackState?.hasSubmitted ? 'Send another update about what is working or what SellerTray should improve.' : 'Tell us what is working, what is difficult, and what would make SellerTray better.'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

      <View style={styles.settingsBlock}>
        <Text style={[styles.sectionLabel, dark && darkStyles.bodyText]}>BUSINESS</Text>
        <SettingsHub business={business} onSaveBusiness={onSaveBusiness} />
      </View>

      <Text style={[styles.buildStamp, dark && darkStyles.bodyText]}>SellerTray 1.0.0 · Android build 22</Text>
    </View>
  );
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  heading: { gap: 3 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  title: { color: theme.colors.navy, fontSize: 27, lineHeight: 33, fontWeight: '900' },
  subtitle: { color: theme.colors.slate, fontSize: 13, lineHeight: 19 },
  operationCard: { minHeight: 92, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  operationIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: theme.colors.cloud, alignItems: 'center', justifyContent: 'center' },
  operationIconActive: { backgroundColor: theme.colors.mintSoft },
  operationIconWarning: { backgroundColor: '#FFFAEB' },
  operationCopy: { flex: 1, minWidth: 0 },
  operationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  operationTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900', flexShrink: 1 },
  operationText: { color: theme.colors.slate, fontSize: 11, lineHeight: 17, marginTop: 3 },
  statusPill: { borderRadius: 14, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillClosed: { backgroundColor: theme.colors.cloud },
  statusPillWarning: { backgroundColor: '#FEF0C7' },
  statusText: { color: theme.colors.greenDark, fontSize: 10, fontWeight: '900' },
  statusTextClosed: { color: theme.colors.muted },
  statusTextWarning: { color: '#B54708' },
  settingsBlock: { gap: 8 },
  sectionLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  buildStamp: { color: theme.colors.muted, fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  pressed: { opacity: 0.76 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});
