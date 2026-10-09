import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';
import { loadAccessibleBranches, type CommerceBranch } from '../data/commerceRepository';
import { useOrders } from '../hooks/useOrders';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { WhatsAppWorkspace } from './WhatsAppWorkspace';

type Props = {
  business: MerchantBusiness;
  branch: CommerceBranch;
  onClose: () => void;
  onOpenOrders?: () => void;
};

export function WhatsAppRuntimeWorkspace({ business, branch, onClose, onOpenOrders }: Props) {
  const appearance = useSellerTrayAppearance();
  const orders = useOrders(business.id);
  const [branches, setBranches] = useState<CommerceBranch[]>([branch]);
  const [branchError, setBranchError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setBranchError(null);
    void loadAccessibleBranches(business.id)
      .then((rows) => {
        if (mounted) setBranches(rows.length > 0 ? rows : [branch]);
      })
      .catch((error) => {
        if (!mounted) return;
        setBranches([branch]);
        setBranchError(error instanceof Error ? error.message : 'Unable to load Branch routing details.');
      });
    return () => {
      mounted = false;
    };
  }, [business.id, branch.id]);

  return (
    <View style={styles.stack}>
      {orders.error || branchError ? (
        <View style={[styles.warningCard, appearance.dark && darkStyles.card]}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.colors.danger} />
          <Text style={[styles.warningText, appearance.dark && darkStyles.bodyText]}>
            {orders.error || branchError}
          </Text>
        </View>
      ) : null}
      <WhatsAppWorkspace
        business={business}
        branch={branch}
        branches={branches}
        orders={orders.orders}
        onClose={onClose}
        onOpenOrders={onOpenOrders ?? onClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  warningCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDA29B',
    backgroundColor: theme.colors.dangerSoft,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  warningText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#3A1717', borderColor: '#7A271A' },
  bodyText: { color: '#D0D5DD' },
});
