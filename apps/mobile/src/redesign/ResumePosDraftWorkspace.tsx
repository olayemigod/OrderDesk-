import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  completePosSale,
  loadBranchPosPaymentMethods,
  loadCommerceProducts,
  type CommerceBranch,
  type PosPaymentMethod,
} from '../data/commerceRepository';
import { loadBranchStock, type BranchStockRow } from '../data/inventoryRepository';
import { updatePosDraftItems } from '../data/posSaleRepository';
import type { MerchantOrder, OrderItem } from '../domain/order';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import {
  buildResumedPosDraft,
  buildResumedPosDraftEdits,
  type ResumedPosDraftLine,
} from './posDraftResume';

type ResumeStage = 'cart' | 'payment';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  currency: string;
  order: MerchantOrder;
  onCancel: () => void;
  onCompleted: (orderId: string) => void;
};

const STOCK_EPSILON = 0.000001;

export function ResumePosDraftWorkspace({ tenantId, branch, currency, order, onCancel, onCompleted }: Props) {
  const dark = useSellerTrayAppearance().dark;
  const [workingOrder, setWorkingOrder] = useState(order);
  const [lines, setLines] = useState<ResumedPosDraftLine[]>([]);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [stockRows, setStockRows] = useState<BranchStockRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PosPaymentMethod[]>([]);
  const [selectedPaymentKey, setSelectedPaymentKey] = useState('cash');
  const [stage, setStage] = useState<ResumeStage>('cart');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setWorkingOrder(order);
    setStage('cart');
    setLoading(true);
    setError(null);
    setNotice(null);

    if (order.branchId !== branch.id) {
      setLines([]);
      setPaymentMethods([]);
      setError('This saved sale belongs to another Branch. Open that Branch before resuming it.');
      setLoading(false);
      return () => { active = false; };
    }

    void Promise.all([
      loadCommerceProducts(tenantId),
      loadBranchStock(tenantId, branch.id),
      loadBranchPosPaymentMethods(tenantId, branch.id),
    ]).then(([products, stock, methods]) => {
      if (!active) return;
      const resumed = buildResumedPosDraft(order, products);
      setLines(resumed.lines);
      setQuantityDrafts(Object.fromEntries(resumed.lines.map((line) => [line.orderItemId, formatQuantity(line.quantity)])));
      setStockRows(stock);
      setPaymentMethods(methods);
      const preferred = methods.find((method) => method.isDefault) ?? methods[0] ?? null;
      setSelectedPaymentKey(preferred ? paymentKey(preferred) : 'cash');
      setNotice(`Resuming ${order.publicOrderId}. Changes stay on this saved sale.`);
    }).catch((err) => {
      if (!active) return;
      setLines([]);
      setPaymentMethods([]);
      setError(err instanceof Error ? err.message : 'Unable to reopen this saved sale.');
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [branch.id, order, tenantId]);

  const total = lines.reduce((sum, line) => sum + line.quantity * (line.uom.sellingPrice ?? 0), 0);
  const unitCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const selectedPayment = paymentMethods.find((method) => paymentKey(method) === selectedPaymentKey) ?? paymentMethods[0] ?? null;
  const shortage = useMemo(() => findStockShortage(lines, stockRows), [lines, stockRows]);

  function setLineQuantity(line: ResumedPosDraftLine, quantity: number): boolean {
    if (saving || completing) return false;
    if (!Number.isFinite(quantity) || quantity < 0) {
      setError('Enter a valid quantity.');
      return false;
    }
    if (!line.uom.allowFractional && quantity !== Math.trunc(quantity)) {
      setError(`${line.uom.name} does not allow fractional quantity.`);
      return false;
    }
    if (quantity <= 0) {
      if (lines.length <= 1) {
        setError('Keep at least one product in the saved sale.');
        return false;
      }
      setLines((current) => current.filter((candidate) => candidate.orderItemId !== line.orderItemId));
      setQuantityDrafts((current) => {
        const next = { ...current };
        delete next[line.orderItemId];
        return next;
      });
      setError(null);
      setNotice(`${line.product.name} will be removed when you save the sale.`);
      return true;
    }

    const otherRequired = lines.reduce(
      (sum, candidate) => candidate.product.id === line.product.id && candidate.orderItemId !== line.orderItemId
        ? sum + candidate.quantity * candidate.uom.conversionFactor
        : sum,
      0,
    );
    const available = stockRows.find((row) => row.catalogItemId === line.product.id)?.quantityOnHand ?? 0;
    const requested = otherRequired + quantity * line.uom.conversionFactor;
    if (requested > available + STOCK_EPSILON) {
      setError(`Not enough ${line.product.name} at ${branch.name}. ${formatQuantity(available)} ${line.product.stockUom} is available.`);
      return false;
    }

    setLines((current) => current.map((candidate) => candidate.orderItemId === line.orderItemId ? { ...candidate, quantity } : candidate));
    setQuantityDrafts((current) => ({ ...current, [line.orderItemId]: formatQuantity(quantity) }));
    setError(null);
    return true;
  }

  function changeQuantity(line: ResumedPosDraftLine, direction: -1 | 1) {
    const step = line.uom.allowFractional ? 0.5 : 1;
    setLineQuantity(line, Math.max(0, Number((line.quantity + direction * step).toFixed(6))));
  }

  function commitTypedQuantity(line: ResumedPosDraftLine) {
    const value = Number(quantityDrafts[line.orderItemId] ?? formatQuantity(line.quantity));
    if (!setLineQuantity(line, value)) {
      setQuantityDrafts((current) => ({ ...current, [line.orderItemId]: formatQuantity(line.quantity) }));
    }
  }

  async function saveAndContinue() {
    if (saving || completing || !lines.length) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const [products, latestStock] = await Promise.all([
        loadCommerceProducts(tenantId),
        loadBranchStock(tenantId, branch.id),
      ]);
      const current = buildResumedPosDraft(workingOrder, products);
      const quantityByItemId = new Map(lines.map((line) => [line.orderItemId, line.quantity]));
      const nextLines = current.lines
        .map((line) => ({ ...line, quantity: quantityByItemId.get(line.orderItemId) ?? 0 }))
        .filter((line) => line.quantity > 0);
      if (!nextLines.length) throw new Error('Keep at least one product in the saved sale.');

      const latestShortage = findStockShortage(nextLines, latestStock);
      if (latestShortage) {
        throw new Error(`Not enough ${latestShortage.productName} at ${branch.name}. ${formatQuantity(latestShortage.available)} ${latestShortage.stockUom} is available; ${formatQuantity(latestShortage.required)} is needed.`);
      }

      const edits = buildResumedPosDraftEdits(workingOrder, nextLines);
      await updatePosDraftItems({ tenantId, orderId: workingOrder.id, items: edits });

      const nextOrder: MerchantOrder = {
        ...workingOrder,
        items: nextLines.map((line) => updatedOrderItem(workingOrder, line)),
      };
      setWorkingOrder(nextOrder);
      setLines(nextLines);
      setQuantityDrafts(Object.fromEntries(nextLines.map((line) => [line.orderItemId, formatQuantity(line.quantity)])));
      setStockRows(latestStock);
      setStage('payment');
      setNotice('Saved sale updated. Current price, unit conversion and Branch stock were rechecked before payment.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update this saved sale.';
      setError(isLikelyConnectivityError(err)
        ? 'Reconnect to continue this saved sale. SellerTray will not create a second sale while this draft already exists.'
        : message);
    } finally {
      setSaving(false);
    }
  }

  function confirmSelectedPayment() {
    if (!selectedPayment || completing) return;
    if (selectedPayment.methodType === 'bank_transfer') {
      Alert.alert(
        'Record bank transfer?',
        `Record ${formatMoney(total, currency)} against ${selectedPayment.displayName} for verification. The sale remains unpaid and stock is unchanged until the transfer is confirmed.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Record for verification', onPress: () => void completeSelectedSale() },
        ],
      );
      return;
    }
    const confirmation = selectedPayment.methodType === 'cash'
      ? `Confirm that ${formatMoney(total, currency)} cash has been received.`
      : `Confirm the ${selectedPayment.displayName} terminal shows an approved payment of ${formatMoney(total, currency)}.`;
    Alert.alert(`Confirm ${selectedPayment.displayName}`, `${confirmation} Stock will be deducted when the sale completes.`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Payment confirmed', onPress: () => void completeSelectedSale() },
    ]);
  }

  async function completeSelectedSale() {
    if (!selectedPayment || completing) return;
    setCompleting(true);
    setError(null);
    try {
      const checkout = await completePosSale(tenantId, workingOrder.id, selectedPayment.paymentMethodId);
      if (checkout.status === 'awaiting_payment_confirmation') {
        Alert.alert(
          'Transfer awaiting verification',
          'SellerTray saved the sale as unpaid. Stock and collection remain unchanged until the transfer is confirmed in Payment inbox.',
        );
      }
      onCompleted(workingOrder.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process this payment.');
    } finally {
      setCompleting(false);
    }
  }

  if (loading) {
    return <View style={[styles.centerCard, dark && darkStyles.card]}><ActivityIndicator /><Text style={[styles.small, dark && darkStyles.bodyText]}>Opening saved sale…</Text></View>;
  }

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>SELL · {stage === 'cart' ? 'CART' : 'PAYMENT'}</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>{stage === 'cart' ? 'Edit Saved Sale' : 'Take Payment'}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>{workingOrder.publicOrderId} · {branch.name}</Text>
      </View>

      <View style={styles.stepRow}>
        <Step number={1} label="Products" complete />
        <Step number={2} label="Cart" active={stage === 'cart'} complete={stage === 'payment'} />
        <Step number={3} label="Payment" active={stage === 'payment'} />
      </View>

      {notice ? <Notice text={notice} dark={dark} /> : null}
      {error ? <ErrorCard text={error} dark={dark} /> : null}

      {stage === 'cart' ? (
        <View style={styles.stageStack}>
          <Pressable disabled={saving} onPress={onCancel} style={styles.backLink}><Ionicons name="arrow-back" size={19} color={theme.colors.greenDark} /><Text style={styles.backLinkText}>Back to Orders</Text></Pressable>
          <View style={[styles.card, dark && darkStyles.card]}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Saved cart</Text>
                <Text style={[styles.small, dark && darkStyles.bodyText]}>{lines.length} product{lines.length === 1 ? '' : 's'} · {formatQuantity(unitCount)} units</Text>
              </View>
              <Text style={[styles.total, dark && darkStyles.titleText]}>{formatMoney(total, currency)}</Text>
            </View>

            {lines.map((line) => (
              <View key={line.orderItemId} style={[styles.cartLine, dark && darkStyles.subtle]}>
                <View style={styles.flex}>
                  <Text style={[styles.productName, dark && darkStyles.titleText]}>{line.product.name}</Text>
                  <Text style={[styles.small, dark && darkStyles.bodyText]}>{line.uom.name} · {formatQuantity(line.quantity * line.uom.conversionFactor)} {line.product.stockUom}</Text>
                  <Text style={[styles.productPrice, dark && darkStyles.titleText]}>{formatMoney(line.quantity * (line.uom.sellingPrice ?? 0), currency)}</Text>
                </View>
                <View style={styles.qty}>
                  <Pressable disabled={saving} onPress={() => changeQuantity(line, -1)} style={styles.qtyButton}><Ionicons name="remove" size={18} color={theme.colors.navy} /></Pressable>
                  <TextInput
                    value={quantityDrafts[line.orderItemId] ?? formatQuantity(line.quantity)}
                    onChangeText={(value) => setQuantityDrafts((current) => ({ ...current, [line.orderItemId]: value.replace(/[^0-9.]/g, '') }))}
                    onBlur={() => commitTypedQuantity(line)}
                    editable={!saving}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                    style={[styles.qtyInput, dark && darkStyles.input]}
                  />
                  <Pressable disabled={saving} onPress={() => changeQuantity(line, 1)} style={styles.qtyButton}><Ionicons name="add" size={18} color={theme.colors.navy} /></Pressable>
                </View>
              </View>
            ))}

            <View style={[styles.customerCard, dark && darkStyles.subtle]}>
              <Text style={[styles.smallStrong, dark && darkStyles.bodyText]}>Customer</Text>
              <Text style={[styles.productName, dark && darkStyles.titleText]}>{workingOrder.customerId ? workingOrder.customerName : 'Walk-in Customer'}</Text>
              {workingOrder.customerPhone ? <Text style={[styles.small, dark && darkStyles.bodyText]}>{workingOrder.customerPhone}</Text> : null}
            </View>

            {shortage ? <ErrorCard text={`${shortage.productName} exceeds current Branch stock. Reduce the quantity before payment.`} dark={dark} /> : null}
            <Notice text="Current product quantities can be changed or removed. SellerTray will recheck price, unit conversion and Branch stock before payment." dark={dark} />
            <Pressable disabled={saving || Boolean(shortage) || !lines.length} onPress={() => void saveAndContinue()} style={[styles.primaryButton, (saving || Boolean(shortage) || !lines.length) && styles.disabled]}>
              {saving ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="arrow-forward" size={19} color={theme.colors.white} />}
              <Text style={styles.primaryText}>{saving ? 'Rechecking saved sale…' : 'Save changes · Continue to payment'}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.stageStack}>
          <Pressable disabled={completing} onPress={() => setStage('cart')} style={styles.backLink}><Ionicons name="arrow-back" size={19} color={theme.colors.greenDark} /><Text style={styles.backLinkText}>Back to cart</Text></Pressable>
          <View style={[styles.card, dark && darkStyles.card]}>
            <View style={styles.center}>
              <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>AMOUNT DUE</Text>
              <Text style={[styles.paymentAmount, dark && darkStyles.titleText]}>{formatMoney(total, currency)}</Text>
              <Text style={[styles.small, dark && darkStyles.bodyText]}>{lines.length} products · {formatQuantity(unitCount)} units</Text>
              <Text style={[styles.smallStrong, dark && darkStyles.bodyText]}>{workingOrder.customerId ? workingOrder.customerName : 'Walk-in Customer'}</Text>
            </View>

            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Payment method</Text>
            {!paymentMethods.length ? <ErrorCard text="No in-person payment method is available for this Branch." dark={dark} /> : null}
            <View style={styles.paymentList}>{paymentMethods.map((method) => (
              <Pressable key={paymentKey(method)} disabled={completing} onPress={() => setSelectedPaymentKey(paymentKey(method))} style={[styles.paymentMethod, dark && darkStyles.subtle, selectedPaymentKey === paymentKey(method) && styles.paymentMethodActive]}>
                <Ionicons name={method.methodType === 'cash' ? 'cash-outline' : method.methodType === 'card_terminal' ? 'card-outline' : 'business-outline'} size={22} color={theme.colors.greenDark} />
                <View style={styles.flex}><Text style={[styles.productName, dark && darkStyles.titleText]}>{method.displayName}</Text><Text style={[styles.small, dark && darkStyles.bodyText]}>{paymentDescription(method)}</Text></View>
                {selectedPaymentKey === paymentKey(method) ? <Ionicons name="checkmark-circle" size={22} color={theme.colors.green} /> : null}
              </Pressable>
            ))}</View>

            {selectedPayment?.methodType === 'bank_transfer' ? (
              <View style={[styles.customerCard, dark && darkStyles.subtle]}>
                <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>{selectedPayment.bankName ?? selectedPayment.displayName}</Text>
                {selectedPayment.bankAccountName ? <Text style={[styles.small, dark && darkStyles.bodyText]}>{selectedPayment.bankAccountName}</Text> : null}
                {selectedPayment.bankAccountNumber ? <Text selectable style={[styles.accountNumber, dark && darkStyles.titleText]}>{selectedPayment.bankAccountNumber}</Text> : null}
                {selectedPayment.instructions ? <Text style={[styles.small, dark && darkStyles.bodyText]}>{selectedPayment.instructions}</Text> : null}
              </View>
            ) : selectedPayment?.instructions ? <Text style={[styles.small, dark && darkStyles.bodyText]}>{selectedPayment.instructions}</Text> : null}

            <Notice text={selectedPayment?.methodType === 'bank_transfer'
              ? 'Recording a bank transfer does not mark the sale paid or deduct stock. Confirm received funds in Payment inbox before handing over goods.'
              : 'Confirm payment only after cash is received or the terminal shows approval. Payment, completion and stock deduction are committed together.'} dark={dark} />
            <Pressable disabled={completing || !selectedPayment} onPress={confirmSelectedPayment} style={[styles.primaryButton, (completing || !selectedPayment) && styles.disabled]}>
              {completing ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.white} />}
              <Text style={styles.primaryText}>{completing ? 'Processing payment…' : selectedPayment ? `Confirm ${selectedPayment.displayName}` : 'Choose payment method'}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function updatedOrderItem(order: MerchantOrder, line: ResumedPosDraftLine): OrderItem {
  const current = order.items.find((item) => item.id === line.orderItemId);
  if (!current) throw new Error('Saved sale line is no longer available.');
  return {
    ...current,
    catalogItemId: line.product.id,
    name: line.product.name,
    quantity: line.quantity,
    selectedUom: line.uom.name,
    conversionFactor: line.uom.conversionFactor,
    stockQuantity: Number((line.quantity * line.uom.conversionFactor).toFixed(6)),
    unitPrice: line.uom.sellingPrice,
    matchSource: 'manual',
    matchConfidence: 1,
  };
}

function findStockShortage(lines: ResumedPosDraftLine[], rows: BranchStockRow[]): { productName: string; stockUom: string; required: number; available: number } | null {
  const available = new Map(rows.map((row) => [row.catalogItemId, row.quantityOnHand]));
  const requested = new Map<string, { productName: string; stockUom: string; required: number; available: number }>();
  for (const line of lines) {
    const required = line.quantity * line.uom.conversionFactor;
    const current = requested.get(line.product.id);
    if (current) current.required += required;
    else requested.set(line.product.id, { productName: line.product.name, stockUom: line.product.stockUom, required, available: available.get(line.product.id) ?? 0 });
  }
  for (const row of requested.values()) if (row.required > row.available + STOCK_EPSILON) return row;
  return null;
}

function paymentKey(method: PosPaymentMethod): string { return method.paymentMethodId ?? 'cash'; }
function paymentDescription(method: PosPaymentMethod): string {
  if (method.methodType === 'cash') return 'Physical drawer cash';
  if (method.methodType === 'card_terminal') return 'Confirm approval on the payment terminal';
  return 'Record transfer and verify received funds before fulfilment';
}
function isLikelyConnectivityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /network request failed|failed to fetch|fetch failed|networkerror|failed to send a request/i.test(message);
}
function formatMoney(value: number, currency: string): string { return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
function formatQuantity(value: number): string { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))); }

function Step({ number, label, active = false, complete = false }: { number: number; label: string; active?: boolean; complete?: boolean }) {
  return <View style={styles.stepItem}><View style={[styles.stepDot, (active || complete) && styles.stepDotActive]}>{complete && !active ? <Ionicons name="checkmark" size={14} color={theme.colors.white} /> : <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>{number}</Text>}</View><Text style={[styles.stepText, (active || complete) && styles.stepTextActive]}>{label}</Text></View>;
}
function Notice({ text, dark }: { text: string; dark: boolean }) { return <View style={[styles.notice, dark && darkStyles.subtle]}><Ionicons name="information-circle-outline" size={20} color={theme.colors.info} /><Text style={[styles.noticeText, dark && darkStyles.bodyText]}>{text}</Text></View>; }
function ErrorCard({ text, dark }: { text: string; dark: boolean }) { return <View style={[styles.errorCard, dark && darkStyles.error]}><Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} /><Text style={[styles.errorText, dark && darkStyles.bodyText]}>{text}</Text></View>; }

const styles = StyleSheet.create({
  stack:{gap:14},stageStack:{gap:12},heading:{gap:3},eyebrow:{color:theme.colors.muted,fontSize:11,fontWeight:'900',letterSpacing:1.05},title:{color:theme.colors.navy,fontSize:28,lineHeight:34,fontWeight:'900'},subtitle:{color:theme.colors.slate,fontSize:14,lineHeight:20},centerCard:{minHeight:150,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,alignItems:'center',justifyContent:'center',gap:8},small:{color:theme.colors.muted,fontSize:11,lineHeight:16},smallStrong:{color:theme.colors.slate,fontSize:11,fontWeight:'800'},flex:{flex:1,minWidth:0},row:{flexDirection:'row',alignItems:'flex-start',gap:8},center:{alignItems:'center',gap:4},sectionTitle:{color:theme.colors.navy,fontSize:14,fontWeight:'900'},
  stepRow:{flexDirection:'row',gap:8},stepItem:{flex:1,flexDirection:'row',alignItems:'center',gap:6},stepDot:{width:24,height:24,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,alignItems:'center',justifyContent:'center'},stepDotActive:{backgroundColor:theme.colors.green,borderColor:theme.colors.green},stepNumber:{color:theme.colors.muted,fontSize:11,fontWeight:'900'},stepNumberActive:{color:theme.colors.white},stepText:{color:theme.colors.slate,fontSize:11,fontWeight:'800'},stepTextActive:{color:theme.colors.greenDark},
  backLink:{alignSelf:'flex-start',flexDirection:'row',gap:6,alignItems:'center',minHeight:36},backLinkText:{color:theme.colors.greenDark,fontWeight:'900',fontSize:12},card:{borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:14,gap:12},total:{color:theme.colors.navy,fontSize:18,fontWeight:'900'},cartLine:{borderRadius:theme.radius.md,backgroundColor:theme.colors.cloud,padding:12,flexDirection:'row',gap:8,alignItems:'center'},productName:{color:theme.colors.navy,fontSize:13,fontWeight:'900'},productPrice:{color:theme.colors.navy,fontSize:12,fontWeight:'900',marginTop:2},qty:{flexDirection:'row',alignItems:'center',gap:5},qtyButton:{width:36,height:36,borderRadius:10,backgroundColor:theme.colors.mintSoft,alignItems:'center',justifyContent:'center'},qtyInput:{width:58,minHeight:38,borderWidth:1,borderColor:theme.colors.border,borderRadius:10,textAlign:'center',color:theme.colors.navy,backgroundColor:theme.colors.white},customerCard:{borderRadius:theme.radius.md,backgroundColor:theme.colors.cloud,padding:12,gap:4},
  primaryButton:{minHeight:50,borderRadius:theme.radius.md,backgroundColor:theme.colors.green,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:7,paddingHorizontal:12},primaryText:{color:theme.colors.white,fontSize:12,fontWeight:'900'},paymentAmount:{color:theme.colors.navy,fontSize:32,fontWeight:'900'},paymentList:{gap:8},paymentMethod:{minHeight:68,borderRadius:theme.radius.md,borderWidth:1,borderColor:theme.colors.border,padding:11,flexDirection:'row',alignItems:'center',gap:9},paymentMethodActive:{borderColor:theme.colors.green,backgroundColor:theme.colors.mintSoft},accountNumber:{color:theme.colors.navy,fontSize:20,fontWeight:'900',letterSpacing:1},notice:{borderRadius:theme.radius.md,backgroundColor:'#EFF8FF',padding:11,flexDirection:'row',gap:8,alignItems:'flex-start'},noticeText:{flex:1,color:theme.colors.slate,fontSize:11,lineHeight:17},errorCard:{borderRadius:theme.radius.md,borderWidth:1,borderColor:'#FDA29B',backgroundColor:theme.colors.dangerSoft,padding:11,flexDirection:'row',gap:8},errorText:{flex:1,color:'#B42318',fontSize:11,lineHeight:17},disabled:{opacity:0.45},
});

const darkStyles=StyleSheet.create({card:{backgroundColor:theme.colors.navy,borderColor:'#344054'},subtle:{backgroundColor:'#162F46',borderColor:'#344054'},input:{backgroundColor:'#162F46',borderColor:'#344054',color:theme.colors.cloud},titleText:{color:theme.colors.cloud},bodyText:{color:'#D0D5DD'},error:{backgroundColor:'#3A1717',borderColor:'#7A271A'}});
