import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { loadActiveCashShift } from '../data/cashShiftRepository';
import {
  applyPosSaleAction,
  updatePosDraftItems,
  type PosSaleAction,
} from '../data/posSaleRepository';
import {
  loadPrinters,
  loadPrintingCapabilities,
  loadReceiptPrintReference,
  requestPrintJob,
  type SellerTrayPrinter,
} from '../data/printerRepository';
import type { MerchantOrder, OrderSource } from '../domain/order';
import { orderTotal } from '../domain/order';
import { executePreparedPrintJob } from '../printing/printExecutor';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  tenantId: string;
  businessCurrency: string;
  orders: MerchantOrder[];
  loading: boolean;
  canReturnCompletedSale: boolean;
  onChanged: () => Promise<void>;
};

type PendingAction = {
  orderId: string;
  action: PosSaleAction;
};

export function OrdersWorkspace({
  tenantId,
  businessCurrency,
  orders,
  loading,
  canReturnCompletedSale,
  onChanged,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Record<string, boolean>>({});
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [draftQuantities, setDraftQuantities] = useState<Record<string, string>>({});

  function beginAction(order: MerchantOrder, action: PosSaleAction) {
    setPending({ orderId: order.id, action });
    setReason('');
    setError(null);
  }

  function cancelAction() {
    if (saving) return;
    setPending(null);
    setReason('');
    setError(null);
  }

  async function confirmAction(order: MerchantOrder) {
    if (!pending || pending.orderId !== order.id || saving) return;
    const cleanReason = reason.trim();
    if (!cleanReason) {
      setError('Enter a reason before continuing.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await applyPosSaleAction({ tenantId, orderId: order.id, action: pending.action, reason: cleanReason });
      setPending(null);
      setReason('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SellerTray could not update this sale.');
    } finally {
      setSaving(false);
    }
  }

  function toggleExpanded(orderId: string) {
    setExpandedOrderIds((current) => ({ ...current, [orderId]: !current[orderId] }));
  }

  function beginDraftEdit(order: MerchantOrder) {
    setEditingOrderId(order.id);
    setExpandedOrderIds((current) => ({ ...current, [order.id]: true }));
    setDraftQuantities(Object.fromEntries(order.items.map((item) => [item.id, formatQuantity(item.quantity)])));
    setError(null);
  }

  function cancelDraftEdit() {
    if (saving) return;
    setEditingOrderId(null);
    setDraftQuantities({});
    setError(null);
  }

  async function saveDraftEdit(order: MerchantOrder) {
    if (saving || editingOrderId !== order.id) return;
    const edits = order.items.map((item) => ({
      orderItemId: item.id,
      quantity: Number(draftQuantities[item.id] ?? item.quantity),
    }));
    if (edits.some((item) => !Number.isFinite(item.quantity) || item.quantity < 0)) {
      setError('Every draft item needs a valid quantity.');
      return;
    }
    if (!edits.some((item) => item.quantity > 0)) {
      setError('Keep at least one item in the draft sale.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updatePosDraftItems({ tenantId, orderId: order.id, items: edits });
      setEditingOrderId(null);
      setDraftQuantities({});
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SellerTray could not edit this draft sale.');
    } finally {
      setSaving(false);
    }
  }

  async function printReceipt(order: MerchantOrder) {
    if (printingOrderId) return;
    const branchId = order.branchId;
    if (!branchId) {
      setPrintError('This order has no branch for receipt printing.');
      return;
    }

    setPrintingOrderId(order.id);
    setPrintError(null);
    setPrintNotice(null);
    try {
      const capabilities = await loadPrintingCapabilities(tenantId, branchId);
      if (!capabilities.canPrintReceipt) {
        throw new Error('You do not have permission to print receipts for this branch.');
      }

      const receipt = await loadReceiptPrintReference(tenantId, order.id);
      if (!receipt) throw new Error('This order does not have an issued payment receipt yet.');

      const activeShift = await loadActiveCashShift(tenantId, branchId);
      const printers = await loadPrinters(tenantId, branchId, activeShift?.registerId ?? null);
      const printer = chooseReceiptPrinter(printers, Boolean(activeShift));
      if (!printer) {
        throw new Error(
          activeShift
            ? 'No active receipt printer is configured for this register. Set one up in More > Devices & Printers.'
            : 'Open the cashier shift for this register, or configure one unambiguous active default printer in More > Devices & Printers.',
        );
      }

      const job = await requestPrintJob({ tenantId, printerId: printer.id, jobType: 'receipt', orderId: order.id });
      await executePreparedPrintJob(tenantId, job);
      setPrintNotice(`Receipt ${receipt.documentReference} printed on ${printer.displayName}.`);
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'The receipt could not be printed.');
    } finally {
      setPrintingOrderId(null);
    }
  }

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>ORDERS</Text>
        <Text style={[styles.pageTitle, dark && darkStyles.titleText]}>Orders</Text>
        <Text style={[styles.pageSubtitle, dark && darkStyles.bodyText]}>Review order items, payment state and fulfilment progress.</Text>
      </View>

      {printError ? <Banner text={printError} error dark={dark} onDismiss={() => setPrintError(null)} /> : null}
      {printNotice ? <Banner text={printNotice} dark={dark} onDismiss={() => setPrintNotice(null)} /> : null}

      {loading && orders.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}><ActivityIndicator /><Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading orders…</Text></View>
      ) : null}

      {!loading && orders.length === 0 ? (
        <View style={[styles.emptyCard, dark && darkStyles.card]}><Ionicons name="receipt-outline" size={28} color={theme.colors.greenDark} /><Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No orders here yet</Text><Text style={[styles.emptyText, dark && darkStyles.bodyText]}>Walk-in, POS and WhatsApp orders for this branch will appear here.</Text></View>
      ) : null}

      {orders.map((order) => {
        const total = orderTotal(order);
        const canVoid = order.source === 'pos' && order.status === 'draft' && order.paymentStatus === 'unpaid' && order.amountPaid === 0;
        const canEditDraft = canVoid;
        const canReturn = canReturnCompletedSale && order.source === 'pos' && order.status === 'completed' && order.paymentStatus === 'paid' && order.fulfillmentStatus === 'collected' && order.returnStatus === 'none';
        const canPrintReceipt = order.paymentStatus === 'paid';
        const action = pending?.orderId === order.id ? pending.action : null;
        const printing = printingOrderId === order.id;
        const expanded = expandedOrderIds[order.id] === true;
        const editing = editingOrderId === order.id;

        return (
          <View key={order.id} style={[styles.orderCard, dark && darkStyles.card]}>
            <Pressable onPress={() => toggleExpanded(order.id)} style={styles.orderTopRow}>
              <View style={styles.orderIdentity}>
                <Text style={[styles.customerName, dark && darkStyles.titleText]}>{order.customerName}</Text>
                <Text style={[styles.orderMeta, dark && darkStyles.bodyText]}>{order.publicOrderId} · {sourceLabel(order.source)} · {order.items.length} {order.items.length === 1 ? 'item' : 'items'}</Text>
              </View>
              <View style={styles.orderValueWrap}>
                <Text style={[styles.orderValue, dark && darkStyles.titleText]}>{total === null ? 'Needs pricing' : formatMoney(total, businessCurrency)}</Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.muted} />
              </View>
            </Pressable>

            <View style={styles.orderStateRow}>
              <StatePill label={order.returnStatus === 'returned' ? 'Returned' : titleCase(order.status)} positive={order.returnStatus === 'returned'} />
              <StatePill label={titleCase(order.paymentStatus)} positive={order.paymentStatus === 'paid'} />
              <StatePill label={titleCase(order.fulfillmentStatus)} positive={order.fulfillmentStatus === 'delivered' || order.fulfillmentStatus === 'collected'} />
            </View>

            {expanded ? (
              <View style={[styles.itemsPanel, dark && darkStyles.subtleCard]}>
                <View style={styles.itemsHeading}>
                  <View style={styles.flexCopy}>
                    <Text style={[styles.itemsTitle, dark && darkStyles.titleText]}>Order items</Text>
                    <Text style={[styles.itemsHelper, dark && darkStyles.bodyText]}>
                      {canEditDraft ? 'Draft quantities can be changed. Enter 0 to remove a line.' : 'Finalised order lines are historical snapshots and cannot be edited.'}
                    </Text>
                  </View>
                  {canEditDraft && !editing ? (
                    <Pressable disabled={saving} onPress={() => beginDraftEdit(order)} style={styles.editButton}>
                      <Ionicons name="create-outline" size={16} color={theme.colors.greenDark} />
                      <Text style={styles.editButtonText}>Edit draft</Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.itemList}>
                  {order.items.map((item) => (
                    <View key={item.id} style={[styles.itemRow, dark && darkStyles.card]}>
                      <View style={styles.flexCopy}>
                        <Text style={[styles.itemName, dark && darkStyles.titleText]}>{item.name}</Text>
                        <Text style={[styles.itemMeta, dark && darkStyles.bodyText]}>
                          {item.selectedUom} · {formatQuantity(item.stockQuantity)} stock qty
                        </Text>
                        <Text style={[styles.itemPrice, dark && darkStyles.titleText]}>
                          {item.unitPrice === null ? 'Needs pricing' : `${formatMoney(item.unitPrice, businessCurrency)} × ${formatQuantity(item.quantity)}`}
                        </Text>
                      </View>
                      {editing ? (
                        <TextInput
                          value={draftQuantities[item.id] ?? formatQuantity(item.quantity)}
                          onChangeText={(value) => setDraftQuantities((current) => ({ ...current, [item.id]: value.replace(/[^0-9.]/g, '') }))}
                          keyboardType="decimal-pad"
                          selectTextOnFocus
                          accessibilityLabel={`Quantity for ${item.name}`}
                          style={[styles.quantityInput, dark && darkStyles.input]}
                        />
                      ) : (
                        <Text style={[styles.quantityText, dark && darkStyles.titleText]}>{formatQuantity(item.quantity)}</Text>
                      )}
                    </View>
                  ))}
                </View>

                {editing ? (
                  <View style={styles.editActions}>
                    <Pressable disabled={saving} onPress={cancelDraftEdit} style={[styles.cancelButton, dark && darkStyles.outlineButton]}><Text style={[styles.cancelText, dark && darkStyles.bodyText]}>Cancel</Text></Pressable>
                    <Pressable disabled={saving} onPress={() => void saveDraftEdit(order)} style={[styles.confirmButton, saving && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.white} /> : null}<Text style={styles.confirmText}>{saving ? 'Saving…' : 'Save draft changes'}</Text></Pressable>
                  </View>
                ) : null}

                {editing && error ? <Banner text={error} error dark={dark} onDismiss={() => setError(null)} /> : null}
              </View>
            ) : null}

            {order.returnStatus === 'returned' ? (
              <View style={[styles.returnedNotice, dark && darkStyles.subtleCard]}><Ionicons name="return-down-back-outline" size={18} color={theme.colors.greenDark} /><Text style={[styles.returnedText, dark && darkStyles.bodyText]}>{formatMoney(order.returnedAmount, businessCurrency)} returned. The original sale and payment remain in history.</Text></View>
            ) : null}

            {!action && !editing && (canVoid || canReturn || canPrintReceipt) ? (
              <View style={styles.actionRow}>
                {canPrintReceipt ? <Pressable disabled={saving || printingOrderId !== null} onPress={() => void printReceipt(order)} style={[styles.outlineAction, styles.printAction, dark && darkStyles.outlineButton, (saving || printingOrderId !== null) && styles.disabled]}>{printing ? <ActivityIndicator size="small" color={theme.colors.greenDark} /> : <Ionicons name="print-outline" size={17} color={theme.colors.greenDark} />}<Text style={styles.printActionText}>{printing ? 'Printing…' : 'Print receipt'}</Text></Pressable> : null}
                {canVoid ? <Pressable disabled={saving || printingOrderId !== null} onPress={() => beginAction(order, 'void')} style={[styles.outlineAction, dark && darkStyles.outlineButton]}><Ionicons name="close-circle-outline" size={17} color={theme.colors.slate} /><Text style={[styles.outlineActionText, dark && darkStyles.bodyText]}>Void sale</Text></Pressable> : null}
                {canReturn ? <Pressable disabled={saving || printingOrderId !== null} onPress={() => beginAction(order, 'return')} style={[styles.outlineAction, styles.returnAction, dark && darkStyles.outlineButton]}><Ionicons name="return-down-back-outline" size={17} color={theme.colors.greenDark} /><Text style={styles.returnActionText}>Return sale</Text></Pressable> : null}
              </View>
            ) : null}

            {action ? (
              <View style={[styles.actionPanel, dark && darkStyles.subtleCard]}>
                <View style={styles.actionPanelHeading}>
                  <Ionicons name={action === 'return' ? 'return-down-back-outline' : 'close-circle-outline'} size={20} color={action === 'return' ? theme.colors.greenDark : theme.colors.danger} />
                  <View style={styles.actionPanelCopy}><Text style={[styles.actionPanelTitle, dark && darkStyles.titleText]}>{action === 'return' ? 'Return this sale' : 'Void this draft sale'}</Text><Text style={[styles.actionPanelText, dark && darkStyles.bodyText]}>{action === 'return' ? 'This returns the full counter sale, records the cash refund and restores stock. The original sale stays in history.' : 'This closes the unpaid draft. No payment or stock movement will be created.'}</Text></View>
                </View>
                <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Reason</Text>
                <TextInput value={reason} onChangeText={setReason} editable={!saving} placeholder={action === 'return' ? 'Why is the customer returning this sale?' : 'Why is this draft being voided?'} placeholderTextColor={theme.colors.subtle} multiline maxLength={500} style={[styles.reasonInput, dark && darkStyles.input]} />
                {error ? <Banner text={error} error dark={dark} onDismiss={() => setError(null)} /> : null}
                <View style={styles.confirmRow}><Pressable disabled={saving} onPress={cancelAction} style={[styles.cancelButton, dark && darkStyles.outlineButton]}><Text style={[styles.cancelText, dark && darkStyles.bodyText]}>Cancel</Text></Pressable><Pressable disabled={saving || !reason.trim()} onPress={() => void confirmAction(order)} style={[styles.confirmButton, (saving || !reason.trim()) && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.white} /> : null}<Text style={styles.confirmText}>{saving ? 'Applying…' : action === 'return' ? 'Confirm return' : 'Confirm void'}</Text></Pressable></View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Banner({ text, error, dark, onDismiss }: { text: string; error?: boolean; dark: boolean; onDismiss: () => void }) {
  return <View style={[error ? styles.errorCard : styles.noticeCard, dark && (error ? darkStyles.errorCard : darkStyles.subtleCard)]}><Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={18} color={error ? theme.colors.danger : theme.colors.greenDark} /><Text style={[error ? styles.errorText : styles.noticeText, dark && darkStyles.bodyText]}>{text}</Text><Pressable onPress={onDismiss}><Ionicons name="close" size={18} color={theme.colors.muted} /></Pressable></View>;
}

function chooseReceiptPrinter(printers: SellerTrayPrinter[], registerResolved: boolean): SellerTrayPrinter | null {
  const active = printers.filter((printer) => printer.isActive);
  if (active.length === 0) return null;
  if (registerResolved) return active.find((printer) => printer.isDefault) ?? active[0] ?? null;
  if (active.length === 1) return active[0] ?? null;
  const defaults = active.filter((printer) => printer.isDefault);
  return defaults.length === 1 ? defaults[0] ?? null : null;
}

function StatePill({ label, positive = false }: { label: string; positive?: boolean }) {
  const appearance = useSellerTrayAppearance();
  return <View style={[styles.statePill, appearance.dark && darkStyles.subtleCard, positive && styles.statePillPositive]}><Text style={[styles.statePillText, appearance.dark && darkStyles.bodyText, positive && styles.statePillTextPositive]}>{label}</Text></View>;
}

function sourceLabel(source: OrderSource): string {
  if (source === 'whatsapp') return 'WhatsApp';
  if (source === 'pos') return 'POS';
  return 'Manual';
}

function titleCase(value: string): string {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  stack:{gap:12},heading:{gap:3},eyebrow:{color:theme.colors.muted,fontSize:11,fontWeight:'900',letterSpacing:1.05},pageTitle:{color:theme.colors.navy,fontSize:28,lineHeight:34,fontWeight:'900'},pageSubtitle:{color:theme.colors.slate,fontSize:14,lineHeight:20},emptyCard:{minHeight:140,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:18,alignItems:'center',justifyContent:'center',gap:7},emptyTitle:{color:theme.colors.navy,fontSize:15,fontWeight:'900'},emptyText:{color:theme.colors.muted,fontSize:12,lineHeight:18,textAlign:'center'},muted:{color:theme.colors.muted,fontSize:12},orderCard:{borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:13,gap:10},orderTopRow:{flexDirection:'row',alignItems:'flex-start',gap:10},orderIdentity:{flex:1,minWidth:0},customerName:{color:theme.colors.navy,fontSize:15,fontWeight:'900'},orderMeta:{color:theme.colors.muted,fontSize:11,marginTop:3},orderValueWrap:{alignItems:'flex-end',gap:5},orderValue:{color:theme.colors.navy,fontSize:14,fontWeight:'900'},orderStateRow:{flexDirection:'row',flexWrap:'wrap',gap:6},statePill:{borderRadius:theme.radius.pill,backgroundColor:'#F2F4F7',paddingHorizontal:9,paddingVertical:5},statePillPositive:{backgroundColor:theme.colors.mintSoft},statePillText:{color:theme.colors.slate,fontSize:10,fontWeight:'900'},statePillTextPositive:{color:theme.colors.greenDark},itemsPanel:{borderRadius:theme.radius.md,borderWidth:1,borderColor:theme.colors.border,backgroundColor:'#F9FAFB',padding:11,gap:9},itemsHeading:{flexDirection:'row',alignItems:'flex-start',gap:8},flexCopy:{flex:1,minWidth:0},itemsTitle:{color:theme.colors.navy,fontSize:13,fontWeight:'900'},itemsHelper:{color:theme.colors.muted,fontSize:10.5,lineHeight:16,marginTop:2},editButton:{minHeight:34,borderRadius:10,backgroundColor:theme.colors.mintSoft,paddingHorizontal:9,flexDirection:'row',alignItems:'center',gap:4},editButtonText:{color:theme.colors.greenDark,fontSize:10.5,fontWeight:'900'},itemList:{gap:7},itemRow:{borderRadius:11,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:10,flexDirection:'row',alignItems:'center',gap:8},itemName:{color:theme.colors.navy,fontSize:12.5,fontWeight:'900'},itemMeta:{color:theme.colors.muted,fontSize:10.5,lineHeight:15,marginTop:2},itemPrice:{color:theme.colors.navy,fontSize:11.5,fontWeight:'800',marginTop:3},quantityText:{color:theme.colors.navy,fontSize:14,fontWeight:'900'},quantityInput:{width:74,minHeight:42,borderRadius:11,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,color:theme.colors.navy,textAlign:'center',fontSize:13,fontWeight:'900',paddingHorizontal:6},editActions:{flexDirection:'row',gap:8},actionRow:{flexDirection:'row',flexWrap:'wrap',gap:8},outlineAction:{minHeight:39,borderRadius:11,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,paddingHorizontal:10,flexDirection:'row',alignItems:'center',gap:5},outlineActionText:{color:theme.colors.slate,fontSize:10.5,fontWeight:'900'},printAction:{borderColor:'#ABEFC6'},printActionText:{color:theme.colors.greenDark,fontSize:10.5,fontWeight:'900'},returnAction:{borderColor:'#ABEFC6'},returnActionText:{color:theme.colors.greenDark,fontSize:10.5,fontWeight:'900'},returnedNotice:{borderRadius:11,backgroundColor:theme.colors.mintSoft,padding:9,flexDirection:'row',gap:6,alignItems:'flex-start'},returnedText:{flex:1,color:theme.colors.slate,fontSize:10.5,lineHeight:16},actionPanel:{borderRadius:theme.radius.md,borderWidth:1,borderColor:theme.colors.border,backgroundColor:'#F9FAFB',padding:11,gap:9},actionPanelHeading:{flexDirection:'row',alignItems:'flex-start',gap:7},actionPanelCopy:{flex:1},actionPanelTitle:{color:theme.colors.navy,fontSize:13,fontWeight:'900'},actionPanelText:{color:theme.colors.slate,fontSize:10.5,lineHeight:16,marginTop:2},fieldLabel:{color:theme.colors.slate,fontSize:11,fontWeight:'900'},reasonInput:{minHeight:76,borderRadius:11,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,color:theme.colors.navy,padding:10,textAlignVertical:'top',fontSize:12},confirmRow:{flexDirection:'row',gap:8},cancelButton:{flex:1,minHeight:43,borderRadius:11,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,alignItems:'center',justifyContent:'center'},cancelText:{color:theme.colors.slate,fontSize:11,fontWeight:'900'},confirmButton:{flex:1,minHeight:43,borderRadius:11,backgroundColor:theme.colors.green,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5},confirmText:{color:theme.colors.white,fontSize:11,fontWeight:'900'},errorCard:{borderRadius:theme.radius.md,borderWidth:1,borderColor:'#FDA29B',backgroundColor:theme.colors.dangerSoft,padding:10,flexDirection:'row',alignItems:'flex-start',gap:7},errorText:{flex:1,color:'#912018',fontSize:11.5,lineHeight:17},noticeCard:{borderRadius:theme.radius.md,borderWidth:1,borderColor:'#ABEFC6',backgroundColor:theme.colors.mintSoft,padding:10,flexDirection:'row',alignItems:'flex-start',gap:7},noticeText:{flex:1,color:theme.colors.slate,fontSize:11.5,lineHeight:17},disabled:{opacity:0.42}
});

const darkStyles=StyleSheet.create({titleText:{color:'#F8FAFC'},bodyText:{color:'#CBD5E1'},card:{backgroundColor:'#111827',borderColor:'#334155'},subtleCard:{backgroundColor:'#172033',borderColor:'#334155'},outlineButton:{backgroundColor:'#111827',borderColor:'#334155'},input:{backgroundColor:'#111827',borderColor:'#334155',color:'#F8FAFC'},errorCard:{backgroundColor:'#3F1D1D',borderColor:'#7F1D1D'}});
