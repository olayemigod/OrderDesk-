import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SettingsHub } from '../components/SettingsHub';
import type { BusinessProfileInput, MerchantBusiness } from '../data/businessRepository';
import type { CashShift } from '../data/cashShiftRepository';
import type { CommerceBranch } from '../data/commerceRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { CashShiftWorkspace } from './CashShiftWorkspace';
import { PrinterWorkspace } from './PrinterWorkspace';
import { WhatsAppRuntimeWorkspace } from './WhatsAppRuntimeWorkspace';

type Props = {
  business: MerchantBusiness;
  branch: CommerceBranch;
  activeShift: CashShift | null;
  cashRouteKey?: number;
  whatsappRouteKey?: number;
  onSaveBusiness: (businessId: string, input: BusinessProfileInput) => Promise<void>;
  onShiftChanged: (shift: CashShift | null) => void;
  onOpenOrders?: (customerId?: string) => void;
};

export function MoreWorkspace({
  business,
  branch,
  activeShift,
  cashRouteKey = 0,
  whatsappRouteKey = 0,
  onSaveBusiness,
  onShiftChanged,
  onOpenOrders,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [cashOpen, setCashOpen] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);

  useEffect(() => {
    if (cashRouteKey > 0) {
      setPrinterOpen(false);
      setWhatsappOpen(false);
      setCashOpen(true);
    }
  }, [cashRouteKey]);

  useEffect(() => {
    if (whatsappRouteKey > 0) {
      setCashOpen(false);
      setPrinterOpen(false);
      setWhatsappOpen(true);
    }
  }, [whatsappRouteKey]);

  useEffect(() => {
    setCashOpen(false);
    setPrinterOpen(false);
    setWhatsappOpen(false);
  }, [business.id, branch.id]);

  if (cashOpen) {
    return (
      <CashShiftWorkspace
        tenantId={business.id}
        branch={branch}
        onClose={() => setCashOpen(false)}
        onShiftChanged={onShiftChanged}
      />
    );
  }

  if (printerOpen) {
    return (
      <PrinterWorkspace
        tenantId={business.id}
        branch={branch}
        activeShift={activeShift}
        onClose={() => setPrinterOpen(false)}
      />
    );
  }

  if (whatsappOpen) {
    return (
      <WhatsAppRuntimeWorkspace
        business={business}
        branch={branch}
        onClose={() => setWhatsappOpen(false)}
        onOpenOrders={onOpenOrders}
      />
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>MORE</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>Operations & settings</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>
          Manage today’s store work and business settings from one place.
        </Text>
      </View>

      <Pressable
        onPress={() => setCashOpen(true)}
        style={({ pressed }) => [styles.operationCard, dark && darkStyles.card, pressed && styles.pressed]}
      >
        <View style={[styles.operationIcon, activeShift && styles.operationIconActive]}>
          <Ionicons name="cash-outline" size={23} color={theme.colors.greenDark} />
        </View>
        <View style={styles.operationCopy}>
          <View style={styles.operationTitleRow}>
            <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>Cash & Shift</Text>
            <View style={[styles.statusPill, !activeShift && styles.statusPillClosed]}>
              <Text style={[styles.statusText, !activeShift && styles.statusTextClosed]}>
                {activeShift ? 'Open' : 'Closed'}
              </Text>
            </View>
          </View>
          <Text style={[styles.operationText, dark && darkStyles.bodyText]}>
            {activeShift
              ? `${activeShift.registerName} · Expected cash ${formatMoney(activeShift.expectedCash, activeShift.currency)}`
              : `Open a cashier shift for ${branch.name}, record expenses and reconcile the drawer.`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

      <Pressable
        onPress={() => setWhatsappOpen(true)}
        style={({ pressed }) => [styles.operationCard, dark && darkStyles.card, pressed && styles.pressed]}
      >
        <View style={[styles.operationIcon, styles.operationIconActive]}>
          <Ionicons name="logo-whatsapp" size={23} color={theme.colors.greenDark} />
        </View>
        <View style={styles.operationCopy}>
          <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>WhatsApp</Text>
          <Text style={[styles.operationText, dark && darkStyles.bodyText]}>
            Review WhatsApp order conversations for {branch.name}, unread activity, connection and receiving Branch.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

      <Pressable
        onPress={() => setPrinterOpen(true)}
        style={({ pressed }) => [styles.operationCard, dark && darkStyles.card, pressed && styles.pressed]}
      >
        <View style={[styles.operationIcon, styles.operationIconActive]}>
          <Ionicons name="print-outline" size={23} color={theme.colors.greenDark} />
        </View>
        <View style={styles.operationCopy}>
          <Text style={[styles.operationTitle, dark && darkStyles.titleText]}>Devices & Printers</Text>
          <Text style={[styles.operationText, dark && darkStyles.bodyText]}>
            Set up Bluetooth receipt printers, paper width and test printing for {branch.name}.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={theme.colors.subtle} />
      </Pressable>

      <View style={styles.settingsBlock}>
        <Text style={[styles.sectionLabel, dark && darkStyles.bodyText]}>BUSINESS</Text>
        <SettingsHub business={business} onSaveBusiness={onSaveBusiness} />
      </View>
    </View>
  );
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
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
  operationCard: {
    minHeight: 92,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.white,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  operationIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: theme.colors.cloud,
    alignItems: 'center',
    justifyContent: 'center',
  },
  operationIconActive: { backgroundColor: theme.colors.mintSoft },
  operationCopy: { flex: 1, minWidth: 0 },
  operationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  operationTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900', flexShrink: 1 },
  operationText: { color: theme.colors.slate, fontSize: 11, lineHeight: 17, marginTop: 3 },
  statusPill: { borderRadius: 14, backgroundColor: theme.colors.mintSoft, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillClosed: { backgroundColor: theme.colors.cloud },
  statusText: { color: theme.colors.greenDark, fontSize: 10, fontWeight: '900' },
  statusTextClosed: { color: theme.colors.muted },
  settingsBlock: { gap: 8 },
  sectionLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  pressed: { opacity: 0.76 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  titleText: { color: theme.colors.cloud },
  bodyText: { color: '#D0D5DD' },
});