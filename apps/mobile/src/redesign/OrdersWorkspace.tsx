import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { loadActiveCashShift } from '../data/cashShiftRepository';
import {
  createPosCommandId,
  deletePosDraft,
  loadPosReturnableItems,
  returnPosSaleItems,
  updatePosDraftItems,
  type PosRefundSource,
  type PosReturnableSale,
} from '../data/posSaleRepository';
import {
  loadPrinters,
  loadPrintingCapabilities,
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
  onResumeDraft: (order: MerchantOrder) => void;
};

type PendingAction = {
  orderId: string;
  action: 'return' | 'delete_draft';
  commandId: string;
};

export function OrdersWorkspace({
  tenantId,
  businessCurrency,
  orders,
  loading,
  onChanged,
  onResumeDraft,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnLoadingOrderId, setReturnLoadingOrderId] = useState<string | null>(null);
  const [returnableSale, setReturnableSale] = useState<PosReturnableSale | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [refundSource, setRefundSource] = useState<PosRefundSource>('cash');
  const [refundPaymentMethodId, setRefundPaymentMethodId] = useState('');
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Record<string, boolean>>({});
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [draftQuantities, setDraftQuantities] = useState<Record<string, string>>({});

  function beginDelete(order: MerchantOrder) {
    setPending({
      orderId: order.id,
      action: 'delete_draft',
      commandId: createPosCommandId('delete_draft', order.id),
    });
    setReason('');
    setReturnableSale(null);
    setReturnQuantities({});
    setRefundSource('cash');
    setRefundPaymentMethodId('');
    setError(null);
  }

  async function beginReturn(order: MerchantOrder) {
    if (returnLoadingOrderId) return;
    setReturnLoadingOrderId(order.id);
    setError(null);
    try {
      const details = await loadPosReturnableItems(tenantId, order.id);
      setReturnableSale(details);
      setReturnQuantities(Object.fromEntries(details.items.map((item) => [item.orderItemId, '0'])));
      setRefundSource('cash');
      setRefundPaymentMethodId(details.bankAccounts[0]?.id ?? '');
      setPending({
        orderId: order.id,
        action: 'return',
        commandId: createPosCommandId('return', order.id),
      });
      setReason('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load returnable items.');
    } finally {
      setReturnLoadingOrderId(null);
    }
  }

  function cancelAction() {
    if (saving) return;
    setPending(null);
    setReason('');
    setReturnableSale(null);
    setReturnQuantities({});
    setRefundSource('cash');
    setRefundPaymentMethodId('');
    setError(null);
  }

  function toggleExpanded(orderId: string) {
    setExpandedOrderIds((current) => ({ ...current, [orderId]: !current[orderId] }));
  }

  function beginDraftEdit(order: MerchantOrder) {
    setEditingOrderId(order.id);
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
    const items = order.items.map((item) => ({
      orderItemId: item.id,
      quantity: Number(draftQuantities[item.id] ?? item.quantity),
    }));
    if (items.some((item) => !Number.isFinite(item.quantity) || item.quantity < 0)) {
      setError('Enter a valid quantity for every draft item.');
      return;
    }
    if (items.every((item) => item.quantity === 0)) {
      setError('A draft sale must keep at least one item. Delete the draft instead if it is no longer needed.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updatePosDraftItems({ tenantId, orderId: order.id, items });
      setEditingOrderId(null);
      setDraftQuantities({});
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update this draft sale.');
    } finally {
      setSaving(false);
    }
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
      if (pending.action === 'return') {
        if (!returnableSale || returnableSale.orderId !== order.id) {
          throw new Error('Reload the returnable items before continuing.');
        }
        const items = returnableSale.items
          .map((item) => ({
            orderItemId: item.orderItemId,
            quantity: Number(returnQuantities[item.orderItemId] ?? 0),
            remainingQuantity: item.remainingQuantity,
          }))
          .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);
        if (items.length === 0) throw new Error('Enter a return quantity for at least one item.');
        if (items.some((item) => item.quantity > item.remainingQuantity)) {
          throw new Error('A return quantity cannot be greater than the quantity still available to return.');
        }

        const settlement = selectedReturnSettlement(returnableSale, returnQuantities);
        if (settlement.refundDue > 0) {
          if (!returnableSale.canCompleteMonetaryRefund) {
            throw new Error('Only a Manager or Owner can complete a monetary refund.');
          }
          if (refundSource === 'cash' && returnableSale.cashRefundAvailableAmount + 0.005 < settlement.refundDue) {
            throw new Error('The available cash drawer cannot cover this refund. Choose Bank or reduce the return.');
          }
          if (refundSource === 'bank' && !refundPaymentMethodId) {
            throw new Error('Choose the Business bank account for this refund.');
          }
        }

        await returnPosSaleItems({
          tenantId,
          orderId: order.id,
          reason: cleanReason,
          commandId: pending.commandId,
          items: items.map(({ orderItemId, quantity }) => ({ orderItemId, quantity })),
          refundSource: settlement.refundDue > 0 ? refundSource : null,
          refundPaymentMethodId: settlement.refundDue > 0 && refundSource === 'bank' ? refundPaymentMethodId : null,
        });
      } else {
        await deletePosDraft({
          tenantId,
          orderId: order.id,
          reason: cleanReason,
          commandId: pending.commandId,
        });
      }
      setPending(null);
      setReason('');
      setReturnableSale(null);
      setReturnQuantities({});
      setRefundSource('cash');
      setRefundPaymentMethodId('');
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to apply this order action.');
    } finally {
      setSaving(false);
    }
  }

  async function printReceipt(order: MerchantOrder) {
    if (printingOrderId) return;
    setPrintingOrderId(order.id);
    setPrintError(null);
    setPrintNotice(null);
    try {
      const capabilities = await loadPrintingCapabilities(tenantId, order.branchId);
      if (!capabilities.canPrintReceipt) throw new Error('Receipt printing is not available for your role.');
      const activeShift = await loadActiveCashShift(tenantId, order.branchId);
      const printers = await loadPrinters(tenantId, order.branchId, null);
      const printer = chooseReceiptPrinter(printers, activeShift?.registerId ?? null);
      if (!printer) {
        throw new Error('No active receipt printer is available for this branch. Set one printer as default in Devices & printers, then try again.');
      }
      const printJob = await requestPrintJob({
        tenantId,
        printerId: printer.id,
        jobType: 'receipt',
        orderId: order.id,
      });
      await executePreparedPrintJob(tenantId, printJob);
      setPrintNotice(`Receipt sent to ${printer.displayName}.`);
    } catch (cause) {
      setPrintError(cause instanceof Error ? cause.message : 'Unable to print this receipt.');
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
        const canManageDraft = order.source === 'pos' && order.status === 'draft' && order.paymentStatus === 'unpaid' && order.amountPaid === 0;
        const isReturnablePosSale = order.source === 'pos'
          && order.status === 'completed'
          && order.fulfillmentStatus === 'collected'
          && (order.returnStatus === 'none' || order.returnStatus === 'partial');
        const canReturn = isReturnablePosSale;
        const canPrintReceipt = order.paymentStatus === 'paid';
        const action = pending?.orderId === order.id ? pending.action : null;
        const printing = printingOrderId === order.id;
        const loadingReturn = returnLoadingOrderId === order.id;
        const expanded = expandedOrderIds[order.id] === true;
        const editing = editingOrderId === order.id;
        const settlement = action === 'return' && returnableSale?.orderId === order.id
          ? selectedReturnSettlement(returnableSale, returnQuantities)
          : null;
        const cashAvailable = Boolean(settlement && settlement.refundDue > 0 && returnableSale
          && returnableSale.cashRefundAvailableAmount + 0.005 >= settlement.refundDue);
        const bankAvailable = Boolean(returnableSale?.bankAccounts.length);
        const monetaryRefundBlocked = Boolean(settlement && settlement.refundDue > 0 && returnableSale && !returnableSale.canCompleteMonetaryRefund);
        const refundSelectionInvalid = Boolean(settlement && settlement.refundDue > 0 && (
          (refundSource === 'cash' && !cashAvailable)
          || (refundSource === 'bank' && (!bankAvailable || !refundPaymentMethodId))
        ));

        return (
          <View key={order.id} style={[styles.orderCard, dark && darkStyles.card]}>
            <Pressable onPress={() => toggleExpanded(order.id)} style={styles.orderTopRow}>
              <View style={styles.orderIdentity}>
                <Text style={[styles.customerName, dark && darkStyles.titleText]}>{order.customerName}</Text>
                <Text style={[styles.orderMeta, dark && darkStyles.bodyText]}>{order.publicOrderId} · {sourceLabel(order.source)} · {order.items.length} {order.items.length === 1 ? 'item' : 'items'}</Text>
                <Text style={[styles.orderAttribution, dark && darkStyles.bodyText]}>
                  {order.branchName}{order.source === 'pos' && order.posOperatorName ? ` · Cashier: ${order.posOperatorName}` : ''}
                </Text>
              </View>
              <View style={styles.orderValueWrap}>
                <Text style={[styles.orderValue, dark && darkStyles.titleText]}>{total === null ? 'Needs pricing' : formatMoney(total, businessCurrency)}</Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.muted} />
              </View>
            </Pressable>

            <View style={styles.orderStateRow}>
              <StatePill
                label={order.returnStatus === 'returned' ? 'Returned' : order.returnStatus === 'partial' ? 'Partially returned' : titleCase(order.status)}
                positive={order.returnStatus !== 'none'}
              />
              <StatePill label={titleCase(order.paymentStatus)} positive={order.paymentStatus === 'paid'} />
              <StatePill label={titleCase(order.fulfillmentStatus)} positive={order.fulfillmentStatus === 'delivered' || order.fulfillmentStatus === 'collected'} />
            </View>

            {expanded ? (
              <View style={[styles.itemsPanel, dark && darkStyles.subtleCard]}>
                <View style={styles.itemsHeading}>
                  <View style={styles.flexCopy}>
                    <Text style={[styles.itemsTitle, dark && darkStyles.titleText]}>Order items</Text>
                    <Text style={[styles.itemsHelper, dark && darkStyles.bodyText]}>
                      {canManageDraft ? 'Draft quantities can be changed. Enter 0 to remove a line.' : 'Finalised order lines are historical snapshots and cannot be edited.'}
                    </Text>
                  </View>
                  {canManageDraft && !editing ? (
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
                        <Text style={[styles.itemMeta, dark && darkStyles.bodyText]}>{item.selectedUom} · {formatQuantity(item.stockQuantity)} stock qty</Text>
                        <Text style={[styles.itemPrice, dark && darkStyles.titleText]}>{item.unitPrice === null ? 'Needs pricing' : `${formatMoney(item.unitPrice, businessCurrency)} × ${formatQuantity(item.quantity)}`}</Text>
                      </View>
                      {editing ? (
                        <TextInput
                          value={draftQuantities[item.id] ?? formatQuantity(item.quantity)}
                          onChangeText={(value) => setDraftQuantities((current) => ({ ...current, [item.id]: cleanDecimalInput(value) }))}
                          keyboardType="decimal-pad"
                          selectTextOnFocus
                          accessibilityLabel={`Quantity for ${item.name}`}
                          style={[styles.quantityInput, dark && darkStyles.input]}
                        />
                      ) : <Text style={[styles.quantityText, dark && darkStyles.titleText]}>{formatQuantity(item.quantity)}</Text>}
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

            {order.returnStatus !== 'none' ? (
              <View style={[styles.returnedNotice, dark && darkStyles.subtleCard]}>
                <Ionicons name="return-down-back-outline" size={18} color={theme.colors.greenDark} />
                <Text style={[styles.returnedText, dark && darkStyles.bodyText]}>
                  {formatMoney(order.returnedAmount, businessCurrency)} returned{order.returnStatus === 'partial' ? '; remaining quantities can still be returned.' : '.'} Historical sale, payment and return settlement remain in audit history.
                </Text>
              </View>
            ) : null}

            {!action && !editing && (canManageDraft || canReturn || canPrintReceipt) ? (
              <View style={styles.actionRow}>
                {canManageDraft ? <Pressable disabled={saving || printingOrderId !== null} onPress={() => onResumeDraft(order)} style={[styles.outlineAction, styles.resumeAction, dark && darkStyles.outlineButton]}><Ionicons name="cart-outline" size={17} color={theme.colors.greenDark} /><Text style={styles.resumeActionText}>Resume sale</Text></Pressable> : null}
                {canPrintReceipt ? <Pressable disabled={saving || printingOrderId !== null} onPress={() => void printReceipt(order)} style={[styles.outlineAction, styles.printAction, dark && darkStyles.outlineButton, (saving || printingOrderId !== null) && styles.disabled]}>{printing ? <ActivityIndicator size="small" color={theme.colors.greenDark} /> : <Ionicons name="print-outline" size={17} color={theme.colors.greenDark} />}<Text style={styles.printActionText}>{printing ? 'Printing…' : 'Print receipt'}</Text></Pressable> : null}
                {canManageDraft ? <Pressable disabled={saving || printingOrderId !== null} onPress={() => beginDelete(order)} style={[styles.outlineAction, styles.deleteAction, dark && darkStyles.outlineButton]}><Ionicons name="trash-outline" size={17} color={theme.colors.danger} /><Text style={styles.deleteActionText}>Delete draft</Text></Pressable> : null}
                {canReturn ? <Pressable disabled={saving || printingOrderId !== null || loadingReturn} onPress={() => void beginReturn(order)} style={[styles.outlineAction, styles.returnAction, dark && darkStyles.outlineButton]}>{loadingReturn ? <ActivityIndicator size="small" color={theme.colors.greenDark} /> : <Ionicons name="return-down-back-outline" size={17} color={theme.colors.greenDark} />}<Text style={styles.returnActionText}>{loadingReturn ? 'Loading…' : 'Return items'}</Text></Pressable> : null}
              </View>
            ) : null}

            {action ? (
              <View style={[styles.actionPanel, dark && darkStyles.subtleCard]}>
                <View style={styles.actionPanelHeading}>
                  <Ionicons name={action === 'return' ? 'return-down-back-outline' : 'trash-outline'} size={20} color={action === 'return' ? theme.colors.greenDark : theme.colors.danger} />
                  <View style={styles.actionPanelCopy}>
                    <Text style={[styles.actionPanelTitle, dark && darkStyles.titleText]}>{action === 'return' ? 'Return items' : 'Delete this draft'}</Text>
                    <Text style={[styles.actionPanelText, dark && darkStyles.bodyText]}>
                      {action === 'return'
                        ? 'Returned value reduces outstanding receivable first. SellerTray refunds only any excess already paid, while stock is restored from the original sale history.'
                        : 'This removes the unwanted unpaid draft from normal work and reports while keeping its deletion audit record.'}
                    </Text>
                  </View>
                </View>

                {action === 'return' && returnableSale && settlement ? (
                  <View style={styles.returnItems}>
                    {returnableSale.items.map((item) => (
                      <View key={item.orderItemId} style={[styles.returnItemRow, dark && darkStyles.card]}>
                        <View style={styles.flexCopy}>
                          <Text style={[styles.itemName, dark && darkStyles.titleText]}>{item.name}</Text>
                          <Text style={[styles.itemMeta, dark && darkStyles.bodyText]}>
                            Sold {formatQuantity(item.soldQuantity)} · Already returned {formatQuantity(item.returnedQuantity)} · Available {formatQuantity(item.remainingQuantity)} {item.selectedUom}
                          </Text>
                        </View>
                        <TextInput
                          value={returnQuantities[item.orderItemId] ?? '0'}
                          onChangeText={(value) => setReturnQuantities((current) => ({ ...current, [item.orderItemId]: cleanDecimalInput(value) }))}
                          keyboardType="decimal-pad"
                          selectTextOnFocus
                          accessibilityLabel={`Return quantity for ${item.name}`}
                          style={[styles.quantityInput, dark && darkStyles.input]}
                        />
                      </View>
                    ))}

                    <SettlementRow label="Returned value" value={formatMoney(settlement.returnedValue, returnableSale.currency)} dark={dark} />
                    <SettlementRow label="Receivable reduction" value={formatMoney(settlement.receivableReduction, returnableSale.currency)} dark={dark} />
                    <SettlementRow label="Refund due" value={formatMoney(settlement.refundDue, returnableSale.currency)} dark={dark} />
                    <SettlementRow label="Outstanding after" value={formatMoney(settlement.outstandingAfter, returnableSale.currency)} dark={dark} />

                    {settlement.refundDue > 0 ? <View style={styles.refundPanel}>
                      <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Refund source</Text>
                      <View style={styles.actionRow}>
                        <Pressable onPress={() => setRefundSource('cash')} style={[styles.refundSourceButton, dark && darkStyles.outlineButton, refundSource === 'cash' && styles.refundSourceActive]}>
                          <Ionicons name="cash-outline" size={16} color={theme.colors.greenDark} />
                          <Text style={styles.refundSourceText}>Cash</Text>
                        </Pressable>
                        <Pressable onPress={() => setRefundSource('bank')} style={[styles.refundSourceButton, dark && darkStyles.outlineButton, refundSource === 'bank' && styles.refundSourceActive]}>
                          <Ionicons name="business-outline" size={16} color={theme.colors.greenDark} />
                          <Text style={styles.refundSourceText}>Bank</Text>
                        </Pressable>
                      </View>

                      {refundSource === 'cash' ? <Text style={[styles.actionPanelText, dark && darkStyles.bodyText]}>
                        {cashAvailable
                          ? `Cash available in your open drawer: ${formatMoney(returnableSale.cashRefundAvailableAmount, returnableSale.currency)}.`
                          : `Cash is not currently sufficient in your open drawer for ${formatMoney(settlement.refundDue, returnableSale.currency)}. Choose Bank or reduce the return.`}
                      </Text> : null}

                      {refundSource === 'bank' ? <>
                        {returnableSale.bankAccounts.length === 0
                          ? <Text style={[styles.actionPanelText, dark && darkStyles.bodyText]}>No enabled Business bank account is available for this refund.</Text>
                          : <View style={styles.bankList}>{returnableSale.bankAccounts.map((bank) => <Pressable key={bank.id} onPress={() => setRefundPaymentMethodId(bank.id)} style={[styles.bankOption, dark && darkStyles.outlineButton, refundPaymentMethodId === bank.id && styles.refundSourceActive]}><View style={styles.flexCopy}><Text style={[styles.itemName, dark && darkStyles.titleText]}>{bank.displayName}</Text><Text style={[styles.itemMeta, dark && darkStyles.bodyText]}>{[bank.bankName, bank.accountNumber].filter(Boolean).join(' · ')}</Text></View><Ionicons name={refundPaymentMethodId === bank.id ? 'radio-button-on' : 'radio-button-off'} size={18} color={theme.colors.greenDark} /></Pressable>)}</View>}
                      </> : null}

                      {!returnableSale.canCompleteMonetaryRefund ? <View style={[styles.returnedNotice, dark && darkStyles.card]}><Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.muted} /><Text style={[styles.returnedText, dark && darkStyles.bodyText]}>You can prepare this return and choose the available refund source, but only a Manager or Owner can complete a monetary refund.</Text></View> : null}
                    </View> : <Text style={[styles.actionPanelText, dark && darkStyles.bodyText]}>No money is refunded for this selection. The returned value only reduces the customer’s outstanding balance.</Text>}
                  </View>
                ) : null}

                <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Reason</Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  editable={!saving}
                  placeholder={action === 'return' ? 'Why are these items being returned?' : 'Why is this draft being deleted?'}
                  placeholderTextColor={theme.colors.subtle}
                  multiline
                  maxLength={500}
                  style={[styles.reasonInput, dark && darkStyles.input]}
                />
                {error ? <Banner text={error} error dark={dark} onDismiss={() => setError(null)} /> : null}
                <View style={styles.confirmRow}>
                  <Pressable disabled={saving} onPress={cancelAction} style={[styles.cancelButton, dark && darkStyles.outlineButton]}><Text style={[styles.cancelText, dark && darkStyles.bodyText]}>Cancel</Text></Pressable>
                  <Pressable disabled={saving || !reason.trim() || monetaryRefundBlocked || refundSelectionInvalid} onPress={() => void confirmAction(order)} style={[styles.confirmButton, (saving || !reason.trim() || monetaryRefundBlocked || refundSelectionInvalid) && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.white} /> : null}<Text style={styles.confirmText}>{saving ? 'Applying…' : action === 'return' ? 'Confirm return' : 'Delete draft'}</Text></Pressable>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function selectedReturnSettlement(sale: PosReturnableSale, quantities: Record<string, string>) {
  const returnedValue = sale.items.reduce((sum, item) => {
    const quantity = Number(quantities[item.orderItemId] ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || item.remainingQuantity <= 0) return sum;
    const boundedQuantity = Math.min(quantity, item.remainingQuantity);
    return sum + (item.remainingValue * boundedQuantity / item.remainingQuantity);
  }, 0);
  const normalizedValue = Math.round(returnedValue * 100) / 100;
  const receivableReduction = Math.min(normalizedValue, sale.outstandingAmount);
  const refundDue = Math.max(normalizedValue - receivableReduction, 0);
  const outstandingAfter = Math.max(sale.outstandingAmount - receivableReduction, 0);
  return {
    returnedValue: normalizedValue,
    receivableReduction: Math.round(receivableReduction * 100) / 100,
    refundDue: Math.round(refundDue * 100) / 100,
    outstandingAfter: Math.round(outstandingAfter * 100) / 100,
  };
}

function SettlementRow({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return <View style={styles.returnSummaryRow}><Text style={[styles.returnSummaryLabel, dark && darkStyles.bodyText]}>{label}</Text><Text style={[styles.returnSummaryValue, dark && darkStyles.titleText]}>{value}</Text></View>;
}

function cleanDecimalInput(value: string): string {
  const clean = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...rest] = clean.split('.');
  return rest.length === 0 ? whole : `${whole}.${rest.join('')}`;
}

function Banner({ text, error, dark, onDismiss }: { text: string; error?: boolean; dark: boolean; onDismiss: () => void }) {
  return <View style={[error ? styles.errorCard : styles.noticeCard, dark && (error ? darkStyles.errorCard : darkStyles.subtleCard)]}><Ionicons name={error ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={18} color={error ? theme.colors.danger : theme.colors.greenDark} /><Text style={[error ? styles.errorText : styles.noticeText, dark && darkStyles.bodyText]}>{text}</Text><Pressable onPress={onDismiss}><Ionicons name="close" size={18} color={theme.colors.muted} /></Pressable></View>;
}

function chooseReceiptPrinter(
  printers: SellerTrayPrinter[],
  preferredRegisterId: string | null,
): SellerTrayPrinter | null {
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
  return value
    .replaceAll('_', ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  heading: { gap: 4 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  pageTitle: { color: theme.colors.navy, fontSize: 28, fontWeight: '900' },
  pageSubtitle: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
  emptyCard: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 18, borderWidth: 1, gap: 9, padding: 22 },
  emptyTitle: { color: theme.colors.navy, fontSize: 17, fontWeight: '900' },
  emptyText: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  muted: { color: theme.colors.muted, fontSize: 13 },
  orderCard: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 20, borderWidth: 1, gap: 13, padding: 16 },
  orderTopRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  orderIdentity: { flex: 1, gap: 3 },
  customerName: { color: theme.colors.navy, fontSize: 16, fontWeight: '900' },
  orderMeta: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  orderAttribution: { color: theme.colors.slate, fontSize: 11, fontWeight: '700', lineHeight: 17 },
  orderValueWrap: { alignItems: 'flex-end', flexDirection: 'row', gap: 7 },
  orderValue: { color: theme.colors.navy, fontSize: 15, fontWeight: '900' },
  orderStateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  statePill: { backgroundColor: theme.colors.cloud, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statePillPositive: { backgroundColor: theme.colors.mintSoft },
  statePillText: { color: theme.colors.slate, fontSize: 11, fontWeight: '800' },
  statePillTextPositive: { color: theme.colors.greenDark },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  outlineAction: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingVertical: 9 },
  resumeAction: { borderColor: theme.colors.greenDark },
  resumeActionText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  printAction: { borderColor: theme.colors.greenDark },
  printActionText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  deleteAction: { borderColor: '#F1C5C5' },
  deleteActionText: { color: theme.colors.danger, fontSize: 12, fontWeight: '900' },
  returnAction: { borderColor: theme.colors.greenDark },
  returnActionText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.55 },
  itemsPanel: { backgroundColor: theme.colors.mint, borderRadius: 16, gap: 11, padding: 12 },
  itemsHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  itemsTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  itemsHelper: { color: theme.colors.muted, fontSize: 12, lineHeight: 17 },
  editButton: { alignItems: 'center', flexDirection: 'row', gap: 5, paddingVertical: 3 },
  editButtonText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  itemList: { gap: 8 },
  itemRow: { alignItems: 'center', backgroundColor: theme.colors.white, borderRadius: 13, flexDirection: 'row', gap: 10, padding: 10 },
  flexCopy: { flex: 1, gap: 2 },
  itemName: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  itemMeta: { color: theme.colors.muted, fontSize: 11, lineHeight: 16 },
  itemPrice: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  quantityText: { color: theme.colors.navy, fontSize: 13, fontWeight: '900' },
  quantityInput: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 10, borderWidth: 1, color: theme.colors.navy, fontSize: 14, fontWeight: '800', minWidth: 72, paddingHorizontal: 10, paddingVertical: 8, textAlign: 'right' },
  editActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  returnedNotice: { alignItems: 'flex-start', backgroundColor: theme.colors.mintSoft, borderRadius: 14, flexDirection: 'row', gap: 8, padding: 11 },
  returnedText: { color: theme.colors.slate, flex: 1, fontSize: 12, lineHeight: 18 },
  actionPanel: { backgroundColor: theme.colors.mint, borderRadius: 16, gap: 12, padding: 13 },
  actionPanelHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 9 },
  actionPanelCopy: { flex: 1, gap: 3 },
  actionPanelTitle: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  actionPanelText: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  returnItems: { gap: 8 },
  returnItemRow: { alignItems: 'center', backgroundColor: theme.colors.white, borderRadius: 13, flexDirection: 'row', gap: 10, padding: 10 },
  returnSummaryRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  returnSummaryLabel: { color: theme.colors.slate, fontSize: 12, fontWeight: '800' },
  returnSummaryValue: { color: theme.colors.navy, fontSize: 14, fontWeight: '900' },
  refundPanel: { borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth, gap: 9, paddingTop: 10 },
  refundSourceButton: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingVertical: 9 },
  refundSourceActive: { backgroundColor: theme.colors.mintSoft, borderColor: theme.colors.green },
  refundSourceText: { color: theme.colors.greenDark, fontSize: 12, fontWeight: '900' },
  bankList: { gap: 7 },
  bankOption: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 8, padding: 10 },
  fieldLabel: { color: theme.colors.slate, fontSize: 12, fontWeight: '900' },
  reasonInput: { backgroundColor: theme.colors.white, borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, color: theme.colors.navy, fontSize: 14, minHeight: 78, padding: 11, textAlignVertical: 'top' },
  confirmRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  cancelButton: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 10 },
  cancelText: { color: theme.colors.slate, fontSize: 12, fontWeight: '900' },
  confirmButton: { alignItems: 'center', backgroundColor: theme.colors.green, borderRadius: 12, flexDirection: 'row', gap: 7, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  confirmText: { color: theme.colors.white, fontSize: 12, fontWeight: '900' },
  errorCard: { alignItems: 'center', backgroundColor: theme.colors.dangerSoft, borderRadius: 12, flexDirection: 'row', gap: 8, padding: 10 },
  errorText: { color: theme.colors.danger, flex: 1, fontSize: 12, lineHeight: 17 },
  noticeCard: { alignItems: 'center', backgroundColor: theme.colors.mintSoft, borderRadius: 12, flexDirection: 'row', gap: 8, padding: 10 },
  noticeText: { color: theme.colors.greenDark, flex: 1, fontSize: 12, lineHeight: 17 },
});

const darkStyles = StyleSheet.create({
  page: { backgroundColor: '#081825' },
  card: { backgroundColor: theme.colors.navy, borderColor: '#344054' },
  subtleCard: { backgroundColor: '#162F46' },
  input: { backgroundColor: '#162F46', borderColor: '#344054', color: theme.colors.white },
  outlineButton: { borderColor: '#344054' },
  titleText: { color: theme.colors.white },
  bodyText: { color: '#D0D5DD' },
  errorCard: { backgroundColor: '#3B2024' },
});