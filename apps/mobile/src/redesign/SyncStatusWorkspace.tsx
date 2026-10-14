import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import type { OfflinePosSale } from '../data/offlineSalesRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  sales: OfflinePosSale[];
  syncing: boolean;
  onSync: () => Promise<void>;
  onDiscard: (clientReference: string) => Promise<void>;
  onClose: () => void;
};

export function SyncStatusWorkspace({ sales, syncing, onSync, onDiscard, onClose }: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const pending = sales.filter((sale) => sale.status === 'pending' || sale.status === 'syncing').length;
  const needsReview = sales.filter((sale) => sale.status === 'needs_review').length;
  const failed = sales.filter((sale) => sale.status === 'failed').length;
  const synced = sales.filter((sale) => sale.status === 'synced').length;

  function confirmDiscard(sale: OfflinePosSale) {
    Alert.alert(
      'Discard held sale?',
      'This removes the device copy. No payment or stock movement was created for this held sale.',
      [
        { text: 'Keep sale', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => void onDiscard(sale.clientReference),
        },
      ],
    );
  }

  return <View style={styles.stack}>
    <View style={styles.topRow}>
      <Pressable onPress={onClose} style={[styles.backButton, dark && darkStyles.outline]}>
        <Ionicons name="arrow-back" size={19} color={dark ? theme.colors.cloud : theme.colors.navy} />
      </Pressable>
      <View style={styles.headingCopy}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SYNC STATUS</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>Held sales</Text>
      </View>
    </View>

    <View style={[styles.safetyCard, dark && darkStyles.safetyCard]}>
      <Ionicons name="shield-checkmark-outline" size={22} color={theme.colors.greenDark} />
      <Text style={[styles.safetyText, dark && darkStyles.bodyText]}>
        A held sale is not paid or completed. Sync creates a server draft only after SellerTray rechecks Branch access, price, unit conversion and stock. Payment completion always stays online.
      </Text>
    </View>

    <View style={styles.metrics}>
      <Metric label="Waiting" value={pending} dark={dark} />
      <Metric label="Needs review" value={needsReview} dark={dark} />
      <Metric label="Failed" value={failed} dark={dark} />
      <Metric label="Synced" value={synced} dark={dark} />
    </View>

    <Pressable
      disabled={syncing || pending + failed === 0}
      onPress={() => void onSync()}
      style={({ pressed }) => [styles.syncButton, (syncing || pending + failed === 0) && styles.disabled, pressed && !syncing && styles.pressed]}
    >
      {syncing ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="sync-outline" size={19} color={theme.colors.white} />}
      <Text style={styles.syncButtonText}>{syncing ? 'Syncing held sales…' : 'Sync now'}</Text>
    </Pressable>

    {sales.length === 0 ? <View style={[styles.emptyCard, dark && darkStyles.card]}>
      <Ionicons name="cloud-done-outline" size={30} color={theme.colors.greenDark} />
      <Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>Nothing waiting to sync</Text>
      <Text style={[styles.body, dark && darkStyles.bodyText]}>Held sales will appear here if SellerTray cannot reach the server while you are selling.</Text>
    </View> : <View style={styles.list}>
      {sales.map((sale) => <View key={sale.clientReference} style={[styles.saleCard, dark && darkStyles.card]}>
        <View style={styles.saleHead}>
          <View style={styles.saleHeadCopy}>
            <Text style={[styles.saleTitle, dark && darkStyles.titleText]}>{formatMoney(sale.total, sale.currency)}</Text>
            <Text style={[styles.meta, dark && darkStyles.bodyText]}>{sale.branchName} · {formatDate(sale.createdAt)}</Text>
          </View>
          <Status status={sale.status} />
        </View>
        <Text style={[styles.lines, dark && darkStyles.bodyText]} numberOfLines={3}>
          {sale.lines.map((line) => `${formatQty(line.quantity)} ${line.uomName} ${line.productName}`).join(' · ')}
        </Text>
        {sale.lastError ? <Text style={[styles.errorText, dark && darkStyles.bodyText]}>{sale.lastError}</Text> : null}
        <View style={styles.saleFoot}>
          <Text style={[styles.reference, dark && darkStyles.bodyText]}>Ref {sale.clientReference.slice(0, 8)} · {sale.attempts} sync attempt{sale.attempts === 1 ? '' : 's'}</Text>
          {sale.status !== 'synced' ? <Pressable onPress={() => confirmDiscard(sale)}><Text style={styles.discardText}>Discard</Text></Pressable> : null}
        </View>
      </View>)}
    </View>}
  </View>;
}

function Metric({ label, value, dark }: { label: string; value: number; dark: boolean }) {
  return <View style={[styles.metric, dark && darkStyles.card]}><Text style={[styles.metricValue, dark && darkStyles.titleText]}>{value}</Text><Text style={[styles.metricLabel, dark && darkStyles.bodyText]}>{label}</Text></View>;
}

function Status({ status }: { status: OfflinePosSale['status'] }) {
  const label = status === 'pending' ? 'Waiting'
    : status === 'syncing' ? 'Syncing'
      : status === 'needs_review' ? 'Needs review'
        : status === 'failed' ? 'Failed'
          : 'Synced';
  const tone = status === 'synced' ? styles.statusGood
    : status === 'needs_review' || status === 'failed' ? styles.statusBad
      : styles.statusWaiting;
  const textTone = status === 'synced' ? styles.statusGoodText
    : status === 'needs_review' || status === 'failed' ? styles.statusBadText
      : styles.statusWaitingText;
  return <View style={[styles.status, tone]}><Text style={[styles.statusText, textTone]}>{label}</Text></View>;
}

function formatMoney(value: number, currency: string): string {
  try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Saved earlier' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function formatQty(value: number): string { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))); }

const styles = StyleSheet.create({
  stack: { gap: 14 }, topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, backButton: { width: 42, height: 42, borderRadius: 13, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' }, headingCopy: { flex: 1 }, eyebrow: { color: theme.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, title: { color: theme.colors.navy, fontSize: 25, fontWeight: '900' }, safetyCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: '#ABEFC6', backgroundColor: theme.colors.mintSoft, padding: 12, flexDirection: 'row', gap: 9, alignItems: 'flex-start' }, safetyText: { flex: 1, color: theme.colors.slate, fontSize: 11, lineHeight: 17 }, metrics: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' }, metric: { minWidth: '22%', flexGrow: 1, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 10 }, metricValue: { color: theme.colors.navy, fontSize: 18, fontWeight: '900' }, metricLabel: { color: theme.colors.muted, fontSize: 10, marginTop: 2 }, syncButton: { minHeight: 48, borderRadius: 14, backgroundColor: theme.colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, syncButtonText: { color: theme.colors.white, fontSize: 13, fontWeight: '900' }, disabled: { opacity: .45 }, pressed: { opacity: .75 }, list: { gap: 9 }, saleCard: { borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 12, gap: 8 }, saleHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, saleHeadCopy: { flex: 1 }, saleTitle: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' }, meta: { color: theme.colors.muted, fontSize: 10.5, marginTop: 2 }, lines: { color: theme.colors.slate, fontSize: 11, lineHeight: 17 }, errorText: { color: '#B42318', fontSize: 11, lineHeight: 16 }, saleFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, reference: { color: theme.colors.muted, fontSize: 9.5, flex: 1 }, discardText: { color: theme.colors.danger, fontSize: 11, fontWeight: '900' }, status: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }, statusText: { fontSize: 9.5, fontWeight: '900' }, statusGood: { backgroundColor: theme.colors.mintSoft }, statusGoodText: { color: theme.colors.greenDark }, statusWaiting: { backgroundColor: theme.colors.infoSoft }, statusWaitingText: { color: '#175CD3' }, statusBad: { backgroundColor: theme.colors.dangerSoft }, statusBadText: { color: '#B42318' }, emptyCard: { minHeight: 130, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 7 }, emptyTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' }, body: { color: theme.colors.slate, fontSize: 11, lineHeight: 17, textAlign: 'center' },
});

const darkStyles = StyleSheet.create({ card: { backgroundColor: theme.colors.navy, borderColor: '#344054' }, outline: { backgroundColor: theme.colors.navy, borderColor: '#475467' }, safetyCard: { backgroundColor: '#123524', borderColor: '#067647' }, titleText: { color: theme.colors.cloud }, bodyText: { color: '#D0D5DD' } });
