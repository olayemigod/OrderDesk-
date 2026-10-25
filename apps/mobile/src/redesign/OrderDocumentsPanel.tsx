import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadActiveCashShift } from '../data/cashShiftRepository';
import {
  loadOrderFinancials,
  type OrderFinancialDocument,
  type OrderPaymentAttempt,
} from '../data/orderPaymentsRepository';
import {
  loadPrinters,
  loadPrintingCapabilities,
  requestBusinessDocumentPrint,
  type SellerTrayPrinter,
} from '../data/printerRepository';
import type { MerchantOrder } from '../domain/order';
import { executePreparedPrintJob } from '../printing/printExecutor';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  currency: string;
  order: MerchantOrder;
};

type FinancialState = {
  documents: OrderFinancialDocument[];
  payments: OrderPaymentAttempt[];
};

export function OrderDocumentsPanel({ tenantId, currency, order }: Props) {
  const dark = useSellerTrayAppearance().dark;
  const [financials, setFinancials] = useState<FinancialState | null>(null);
  const [loading, setLoading] = useState(false);
  const [printingKey, setPrintingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const confirmedPayments = useMemo(
    () => (financials?.payments ?? []).filter((payment) => payment.status === 'confirmed' && payment.exceptionState === 'none'),
    [financials],
  );
  const unsettledPayments = useMemo(
    () => (financials?.payments ?? []).filter((payment) => payment.status !== 'confirmed' || payment.exceptionState !== 'none'),
    [financials],
  );
  const invoice = useMemo(
    () => financials?.documents.find((document) => document.documentType === 'invoice' && document.status === 'issued') ?? null,
    [financials],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadOrderFinancials(tenantId, order.id)
      .then((next) => { if (active) setFinancials(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load sale documents.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId, order.id, order.amountPaid, order.paymentStatus]);

  async function refreshFinancials(): Promise<FinancialState> {
    const next = await loadOrderFinancials(tenantId, order.id);
    setFinancials(next);
    return next;
  }

  async function loadPrinter(): Promise<SellerTrayPrinter> {
    const [capabilities, activeShift] = await Promise.all([
      loadPrintingCapabilities(tenantId, order.branchId),
      loadActiveCashShift(tenantId, order.branchId),
    ]);
    if (!capabilities.canPrintReceipt) throw new Error('Printing is not available for your role.');
    const printers = await loadPrinters(tenantId, order.branchId, null);
    const printer = choosePrinter(printers, activeShift?.registerId ?? null);
    if (!printer) throw new Error('No active printer is available for this Branch. Set one printer as default in Devices & printers, then try again.');
    return printer;
  }

  async function printSalesInvoice() {
    if (printingKey) return;
    setPrintingKey('invoice');
    setError(null);
    setNotice(null);
    try {
      const [printer, latest] = await Promise.all([loadPrinter(), refreshFinancials()]);
      const latestInvoice = latest.documents.find((document) => document.documentType === 'invoice' && document.status === 'issued');
      if (!latestInvoice) throw new Error('This sale does not have an issued Sales Invoice.');
      const job = await requestBusinessDocumentPrint({
        tenantId,
        printerId: printer.id,
        orderId: order.id,
        documentType: 'sales_invoice',
      });
      if (job.contentSnapshot.documentType !== 'sales_invoice') throw new Error('SellerTray prepared the wrong sale document.');
      await executePreparedPrintJob(tenantId, job);
      setNotice(`Sales Invoice sent to ${printer.displayName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to print this Sales Invoice.');
    } finally {
      setPrintingKey(null);
    }
  }

  async function printPaymentReceipt(paymentId: string) {
    if (printingKey) return;
    setPrintingKey(paymentId);
    setError(null);
    setNotice(null);
    try {
      const [printer, latest] = await Promise.all([loadPrinter(), refreshFinancials()]);
      const payment = latest.payments.find((entry) => entry.id === paymentId);
      if (!payment || payment.status !== 'confirmed' || payment.exceptionState !== 'none') {
        throw new Error('This payment is not currently eligible for a Payment Receipt.');
      }
      const job = await requestBusinessDocumentPrint({
        tenantId,
        printerId: printer.id,
        orderId: order.id,
        documentType: 'payment_receipt',
        paymentId,
      });
      if (job.contentSnapshot.documentType !== 'payment_receipt' || job.contentSnapshot.paymentId !== paymentId) {
        throw new Error('SellerTray prepared the wrong payment receipt.');
      }
      await executePreparedPrintJob(tenantId, job);
      setNotice(`Payment Receipt sent to ${printer.displayName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to print this Payment Receipt.');
    } finally {
      setPrintingKey(null);
    }
  }

  if (order.source !== 'pos' || order.status !== 'completed') return null;

  return (
    <View style={[styles.panel, dark && darkStyles.panel]}>
      <View style={styles.headingRow}>
        <View style={styles.flex}>
          <Text style={[styles.title, dark && darkStyles.title]}>Sale documents</Text>
          <Text style={[styles.helper, dark && darkStyles.body]}>The Sales Invoice stays the sale document. Each confirmed collection has its own Payment Receipt.</Text>
        </View>
        {loading ? <ActivityIndicator size="small" /> : null}
      </View>

      {error ? <Banner text={error} error dark={dark} onDismiss={() => setError(null)} /> : null}
      {notice ? <Banner text={notice} dark={dark} onDismiss={() => setNotice(null)} /> : null}

      <View style={[styles.documentRow, dark && darkStyles.row]}>
        <View style={styles.flex}>
          <Text style={[styles.documentTitle, dark && darkStyles.title]}>Sales Invoice</Text>
          <Text style={[styles.meta, dark && darkStyles.body]}>{invoice?.documentReference ?? 'Issued sale invoice'} · {formatMoney(invoice?.amount ?? 0, invoice?.currency ?? currency)}</Text>
        </View>
        <Pressable disabled={Boolean(printingKey) || !invoice} onPress={() => void printSalesInvoice()} style={[styles.printButton, (Boolean(printingKey) || !invoice) && styles.disabled]}>
          {printingKey === 'invoice' ? <ActivityIndicator size="small" color={theme.colors.greenDark} /> : <Ionicons name="print-outline" size={17} color={theme.colors.greenDark} />}
          <Text style={styles.printText}>{printingKey === 'invoice' ? 'Printing…' : 'Print Sales Invoice'}</Text>
        </Pressable>
      </View>

      <View style={styles.receiptHeader}>
        <Text style={[styles.sectionTitle, dark && darkStyles.title]}>Payment receipts</Text>
        <Text style={[styles.helper, dark && darkStyles.body]}>Only confirmed money received can be printed. Pending bank verification never produces a receipt.</Text>
      </View>

      {confirmedPayments.length === 0 && !loading ? <Text style={[styles.empty, dark && darkStyles.body]}>No confirmed payment receipt is available yet.</Text> : null}
      {confirmedPayments.map((payment) => (
        <View key={payment.id} style={[styles.paymentRow, dark && darkStyles.row]}>
          <View style={styles.flex}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={[styles.amount, dark && darkStyles.title]}>{formatMoney(payment.amount, payment.currency)}</Text>
            <Text style={[styles.meta, dark && darkStyles.body]}>{titleCase(payment.methodType)} · {formatDate(payment.confirmedAt ?? payment.createdAt)}</Text>
            <Text style={[styles.meta, dark && darkStyles.body]}>{payment.providerReference ?? payment.providerTransactionId ?? `Payment ${payment.id.slice(0, 8).toUpperCase()}`}</Text>
          </View>
          <Pressable disabled={Boolean(printingKey)} onPress={() => void printPaymentReceipt(payment.id)} style={[styles.printButton, Boolean(printingKey) && styles.disabled]}>
            {printingKey === payment.id ? <ActivityIndicator size="small" color={theme.colors.greenDark} /> : <Ionicons name="receipt-outline" size={17} color={theme.colors.greenDark} />}
            <Text style={styles.printText}>{printingKey === payment.id ? 'Printing…' : 'Print receipt'}</Text>
          </Pressable>
        </View>
      ))}

      {unsettledPayments.map((payment) => (
        <View key={payment.id} style={[styles.pendingRow, dark && darkStyles.row]}>
          <Ionicons name="time-outline" size={17} color={theme.colors.muted} />
          <View style={styles.flex}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={[styles.pendingAmount, dark && darkStyles.title]}>{formatMoney(payment.amount, payment.currency)}</Text>
            <Text style={[styles.meta, dark && darkStyles.body]}>{titleCase(payment.methodType)} · {paymentStateLabel(payment)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function choosePrinter(printers: SellerTrayPrinter[], preferredRegisterId: string | null): SellerTrayPrinter | null {
  const active = printers.filter((printer) => printer.isActive);
  if (active.length === 0) return null;
  if (preferredRegisterId) {
    const registerPrinters = active.filter((printer) => printer.registerId === preferredRegisterId);
    const registerDefaults = registerPrinters.filter((printer) => printer.isDefault);
    if (registerDefaults.length === 1) return registerDefaults[0] ?? null;
    if (registerPrinters.length === 1) return registerPrinters[0] ?? null;
  }
  const branchDefaults = active.filter((printer) => printer.isDefault);
  if (branchDefaults.length === 1) return branchDefaults[0] ?? null;
  if (active.length === 1) return active[0] ?? null;
  return null;
}

function paymentStateLabel(payment: OrderPaymentAttempt): string {
  if (payment.exceptionState !== 'none') return titleCase(payment.exceptionState);
  if (payment.status === 'pending_verification') return 'Pending verification';
  return titleCase(payment.status);
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').split(' ').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function formatMoney(value: number, currency: string): string {
  try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Banner({ text, error, dark, onDismiss }: { text: string; error?: boolean; dark: boolean; onDismiss: () => void }) {
  return <View style={[error ? styles.errorCard : styles.noticeCard, dark && darkStyles.row]}><Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={18} color={error ? theme.colors.danger : theme.colors.greenDark} /><Text style={[error ? styles.errorText : styles.noticeText, dark && darkStyles.body]}>{text}</Text><Pressable onPress={onDismiss}><Ionicons name="close" size={18} color={theme.colors.muted} /></Pressable></View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: theme.colors.cloud, borderRadius: 16, gap: 10, padding: 12 },
  headingRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  helper: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  documentRow: { alignItems: 'center', backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 10 },
  documentTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  meta: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  printButton: { alignItems: 'center', borderColor: theme.colors.greenDark, borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 5, minHeight: 38, paddingHorizontal: 10, paddingVertical: 7 },
  printText: { color: theme.colors.greenDark, fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  receiptHeader: { gap: 2, marginTop: 2 },
  sectionTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  empty: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, paddingVertical: 4 },
  paymentRow: { alignItems: 'center', backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 10 },
  pendingRow: { alignItems: 'center', backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 8, padding: 10 },
  amount: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  pendingAmount: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  errorCard: { alignItems: 'center', backgroundColor: theme.colors.dangerSoft, borderRadius: 12, flexDirection: 'row', gap: 8, padding: 10 },
  errorText: { color: theme.colors.danger, flex: 1, fontSize: 12, lineHeight: 17 },
  noticeCard: { alignItems: 'center', backgroundColor: theme.colors.mintSoft, borderRadius: 12, flexDirection: 'row', gap: 8, padding: 10 },
  noticeText: { color: theme.colors.greenDark, flex: 1, fontSize: 12, lineHeight: 17 },
});

const darkStyles = StyleSheet.create({
  panel: { backgroundColor: '#162F46' },
  row: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  title: { color: theme.colors.white },
  body: { color: '#D0D5DD' },
});
