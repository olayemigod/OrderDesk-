import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  loadAccessibleBranches,
  type CommerceBranch,
  type CommerceProduct,
  type CommerceUom,
} from '../data/commerceRepository';
import {
  cancelStockTransfer,
  createStockTransfer,
  dispatchStockTransfer,
  loadBranchStock,
  loadStockTransfer,
  loadStockTransfers,
  receiveStockTransfer,
  type BranchStockRow,
  type InventoryCapabilities,
  type StockTransferDetail,
  type StockTransferListRow,
} from '../data/inventoryRepository';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { createOperationalReference } from './operationalReference';

type Props = {
  tenantId: string;
  branch: CommerceBranch;
  products: CommerceProduct[];
  capabilities: InventoryCapabilities;
  onClose: () => void;
  onInventoryChanged: () => Promise<void> | void;
};

type DraftLine = {
  key: string;
  productId: string;
  uomId: string;
  quantity: string;
};

export function StockTransferWorkspace({
  tenantId,
  branch,
  products,
  capabilities,
  onClose,
  onInventoryChanged,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const dark = appearance.dark;
  const [transfers, setTransfers] = useState<StockTransferListRow[]>([]);
  const [branches, setBranches] = useState<CommerceBranch[]>([]);
  const [stock, setStock] = useState<BranchStockRow[]>([]);
  const [detail, setDetail] = useState<StockTransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [destinationBranchId, setDestinationBranchId] = useState('');
  const [reference, setReference] = useState(() => createOperationalReference('stock_transfer'));
  const [reason, setReason] = useState('Branch replenishment');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [confirmAction, setConfirmAction] = useState<'dispatch' | 'receive' | null>(null);
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  async function refreshWorkspace() {
    setLoading(true);
    setError(null);
    try {
      const [nextTransfers, nextBranches, nextStock] = await Promise.all([
        loadStockTransfers(tenantId, branch.id, 50),
        loadAccessibleBranches(tenantId),
        loadBranchStock(tenantId, branch.id),
      ]);
      setTransfers(nextTransfers);
      setBranches(nextBranches);
      setStock(nextStock);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load stock transfers.');
    } finally {
      setLoading(false);
    }
  }

  async function openTransfer(transferId: string) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      setDetail(await loadStockTransfer(tenantId, transferId));
      setCreateMode(false);
      setCancelMode(false);
      setConfirmAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load this stock transfer.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDetail(null);
    setCreateMode(false);
    setDestinationBranchId('');
    setReference(createOperationalReference('stock_transfer'));
    setReason('Branch replenishment');
    setLines([]);
    setConfirmAction(null);
    setCancelMode(false);
    void refreshWorkspace();
  }, [tenantId, branch.id]);

  const destinationBranches = branches.filter((row) => row.id !== branch.id);
  const stockByProduct = useMemo(
    () => new Map(stock.map((row) => [row.catalogItemId, row])),
    [stock],
  );
  const normalizedProductQuery = productQuery.trim().toLowerCase();
  const productChoices = useMemo(() => {
    const unused = products.filter((product) => !lines.some((line) => line.productId === product.id));
    if (!normalizedProductQuery) return unused;
    return unused.filter((product) => [product.name, product.sku ?? '', product.category ?? ''].join(' ').toLowerCase().includes(normalizedProductQuery));
  }, [products, lines, normalizedProductQuery]);

  function beginCreate() {
    setDetail(null);
    setCreateMode(true);
    setDestinationBranchId(destinationBranches[0]?.id ?? '');
    setReference(createOperationalReference('stock_transfer'));
    setReason('Branch replenishment');
    setLines([]);
    setProductQuery('');
    setError(null);
    setNotice(null);
  }

  function addProduct(product: CommerceProduct) {
    const defaultUom = findStockUom(product) ?? product.uoms[0] ?? null;
    if (!defaultUom) {
      setError(`${product.name} has no unit configured.`);
      return;
    }
    setLines((current) => [...current, {
      key: `${product.id}:${Date.now()}:${Math.random()}`,
      productId: product.id,
      uomId: defaultUom.id,
      quantity: '1',
    }]);
    setProductQuery('');
    setError(null);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
  }

  async function saveTransfer() {
    if (saving) return;
    if (!destinationBranchId) {
      setError('Choose a destination branch.');
      return;
    }
    if (!reference.trim()) {
      setError('Reference is required. Generate one or enter an external reference.');
      return;
    }
    if (!reason.trim()) {
      setError('Enter a reason for this transfer.');
      return;
    }
    const commandLines = lines.map((line) => ({
      catalogItemId: line.productId,
      uomId: line.uomId,
      quantity: Number(line.quantity),
    }));
    if (!commandLines.length || commandLines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      setError('Add at least one product with a positive quantity.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createStockTransfer({
        tenantId,
        sourceBranchId: branch.id,
        destinationBranchId,
        reference,
        reason,
        items: commandLines,
      });
      await Promise.all([refreshWorkspace(), openTransfer(result.transferId)]);
      setNotice(result.idempotentReplay ? 'This stock transfer was already created.' : 'Stock transfer saved as draft. Stock has not moved yet.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this stock transfer.');
    } finally {
      setSaving(false);
    }
  }

  async function performAction(action: 'dispatch' | 'receive') {
    if (!detail || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = action === 'dispatch'
        ? await dispatchStockTransfer(tenantId, detail.transferId)
        : await receiveStockTransfer(tenantId, detail.transferId);
      await Promise.all([
        openTransfer(detail.transferId),
        refreshWorkspace(),
        Promise.resolve(onInventoryChanged()),
      ]);
      setConfirmAction(null);
      setNotice(
        action === 'dispatch'
          ? `Transfer dispatched. ${result.inventoryMovementCount ?? detail.items.length} stock movement${(result.inventoryMovementCount ?? detail.items.length) === 1 ? '' : 's'} reduced ${detail.sourceBranchName} stock.`
          : `Transfer received. ${result.inventoryMovementCount ?? detail.items.length} stock movement${(result.inventoryMovementCount ?? detail.items.length) === 1 ? '' : 's'} increased ${detail.destinationBranchName} stock.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} this stock transfer.`);
    } finally {
      setSaving(false);
    }
  }

  async function cancelTransfer() {
    if (!detail || saving) return;
    if (!cancelReason.trim()) {
      setError('Enter why this stock transfer is being cancelled.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await cancelStockTransfer(tenantId, detail.transferId, cancelReason);
      await Promise.all([openTransfer(detail.transferId), refreshWorkspace()]);
      setCancelMode(false);
      setCancelReason('');
      setNotice('Stock transfer cancelled. No new stock movement was created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel this stock transfer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.stack}>
      <Pressable onPress={onClose} style={styles.backButton}>
        <Ionicons name="arrow-back" size={18} color={theme.colors.greenDark} />
        <Text style={styles.backText}>Inventory</Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={[styles.eyebrow, dark && darkStyles.bodyText]}>STOCK TRANSFERS</Text>
        <Text style={[styles.title, dark && darkStyles.titleText]}>{branch.name}</Text>
        <Text style={[styles.subtitle, dark && darkStyles.bodyText]}>Move stock between branches with separate dispatch and receipt ledger movements.</Text>
      </View>

      {error ? <Message text={error} error dark={dark} /> : null}
      {notice ? <Message text={notice} dark={dark} /> : null}

      {!createMode && !detail ? (
        <>
          <View style={styles.toolbarRow}>
            <Text style={[styles.sectionTitle, dark && darkStyles.titleText]}>Transfer history</Text>
            <Pressable disabled={!capabilities.canTransferStock || destinationBranches.length === 0} onPress={beginCreate} style={[styles.newButton, (!capabilities.canTransferStock || destinationBranches.length === 0) && styles.disabled]}>
              <Ionicons name="add" size={17} color={theme.colors.white} />
              <Text style={styles.newButtonText}>New transfer</Text>
            </Pressable>
          </View>
          {loading && transfers.length === 0 ? <View style={[styles.emptyCard, dark && darkStyles.card]}><ActivityIndicator /><Text style={[styles.muted, dark && darkStyles.bodyText]}>Loading transfers…</Text></View> : null}
          {!loading && transfers.length === 0 ? <View style={[styles.emptyCard, dark && darkStyles.card]}><Ionicons name="swap-horizontal-outline" size={30} color={theme.colors.greenDark} /><Text style={[styles.emptyTitle, dark && darkStyles.titleText]}>No stock transfers yet</Text><Text style={[styles.muted, dark && darkStyles.bodyText]}>Create a transfer when stock needs to move to another branch.</Text></View> : null}
          <View style={styles.transferList}>
            {transfers.map((row) => (
              <Pressable key={row.id} onPress={() => void openTransfer(row.id)} style={({ pressed }) => [styles.transferCard, dark && darkStyles.card, pressed && styles.pressed]}>
                <View style={styles.flexCopy}><Text style={[styles.transferReference, dark && darkStyles.titleText]}>{row.reference}</Text><Text style={[styles.muted, dark && darkStyles.bodyText]}>{row.sourceBranchName} → {row.destinationBranchName} · {row.itemCount} {row.itemCount === 1 ? 'item' : 'items'}</Text></View>
                <StatusPill status={row.status} />
                <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {createMode ? (
        <View style={[styles.formCard, dark && darkStyles.card]}>
          <View style={styles.formHead}><View style={styles.flexCopy}><Text style={[styles.formTitle, dark && darkStyles.titleText]}>New stock transfer</Text><Text style={[styles.muted, dark && darkStyles.bodyText]}>Source: {branch.name}. Saving a draft does not move stock.</Text></View><Pressable onPress={() => setCreateMode(false)} style={styles.iconButton}><Ionicons name="close" size={20} color={theme.colors.slate} /></Pressable></View>

          <Text style={[styles.label, dark && darkStyles.bodyText]}>Destination branch</Text>
          <View style={styles.branchChoices}>
            {destinationBranches.map((candidate) => (
              <Pressable key={candidate.id} onPress={() => setDestinationBranchId(candidate.id)} style={[styles.choiceButton, dark && darkStyles.outlineButton, destinationBranchId === candidate.id && styles.choiceButtonActive]}><Text style={[styles.choiceText, dark && darkStyles.bodyText, destinationBranchId === candidate.id && styles.choiceTextActive]}>{candidate.name}</Text></Pressable>
            ))}
          </View>

          <View style={styles.fieldHeadingRow}><Text style={[styles.label, dark && darkStyles.bodyText]}>Reference</Text><Pressable onPress={() => setReference(createOperationalReference('stock_transfer'))} style={styles.generateButton}><Ionicons name="refresh-outline" size={15} color={theme.colors.greenDark} /><Text style={styles.generateText}>Generate</Text></Pressable></View>
          <TextInput value={reference} onChangeText={setReference} autoCapitalize="characters" style={[styles.input, dark && darkStyles.input]} />
          <Text style={[styles.helper, dark && darkStyles.bodyText]}>Generated by default; replace it only when a delivery or dispatch reference is more useful.</Text>
          <Text style={[styles.label, dark && darkStyles.bodyText]}>Reason</Text>
          <TextInput value={reason} onChangeText={setReason} placeholder="Reason for transfer" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />

          <Text style={[styles.label, dark && darkStyles.bodyText]}>Products</Text>
          <View style={[styles.searchBox, dark && darkStyles.input]}><Ionicons name="search-outline" size={18} color={theme.colors.muted} /><TextInput value={productQuery} onChangeText={setProductQuery} placeholder="Add product" placeholderTextColor={theme.colors.subtle} style={[styles.searchInput, dark && darkStyles.inputText]} /></View>
          {productQuery.trim() ? (
            <View style={[styles.productMenu, dark && darkStyles.card]}>
              {productChoices.slice(0, 8).map((product) => (
                <Pressable key={product.id} onPress={() => addProduct(product)} style={styles.productOption}><View style={styles.flexCopy}><Text style={[styles.itemName, dark && darkStyles.titleText]}>{product.name}</Text><Text style={[styles.muted, dark && darkStyles.bodyText]}>{formatQuantity(stockByProduct.get(product.id)?.quantityOnHand ?? 0)} {product.stockUom} available</Text></View><Ionicons name="add-circle-outline" size={20} color={theme.colors.greenDark} /></Pressable>
              ))}
              {productChoices.length === 0 ? <Text style={[styles.muted, dark && darkStyles.bodyText]}>No matching product available to add.</Text> : null}
            </View>
          ) : null}

          <View style={styles.lineList}>
            {lines.map((line) => {
              const product = products.find((entry) => entry.id === line.productId) ?? null;
              if (!product) return null;
              const selectedUom = product.uoms.find((uom) => uom.id === line.uomId) ?? null;
              return (
                <View key={line.key} style={[styles.lineCard, dark && darkStyles.subtleCard]}>
                  <View style={styles.lineHead}><View style={styles.flexCopy}><Text style={[styles.itemName, dark && darkStyles.titleText]}>{product.name}</Text><Text style={[styles.muted, dark && darkStyles.bodyText]}>{formatQuantity(stockByProduct.get(product.id)?.quantityOnHand ?? 0)} {product.stockUom} in {branch.name}</Text></View><Pressable onPress={() => removeLine(line.key)} style={styles.removeButton}><Ionicons name="trash-outline" size={18} color={theme.colors.danger} /></Pressable></View>
                  <View style={styles.uomRow}>{product.uoms.map((uom) => <Pressable key={uom.id} onPress={() => updateLine(line.key,{uomId:uom.id})} style={[styles.uomChip, dark && darkStyles.outlineButton, line.uomId === uom.id && styles.uomChipActive]}><Text style={[styles.uomText, dark && darkStyles.bodyText, line.uomId === uom.id && styles.uomTextActive]}>{uom.name}</Text></Pressable>)}</View>
                  <TextInput value={line.quantity} onChangeText={(value) => updateLine(line.key,{quantity:value.replace(/[^0-9.]/g,'')})} keyboardType="decimal-pad" placeholder="Quantity" placeholderTextColor={theme.colors.subtle} style={[styles.input, dark && darkStyles.input]} />
                  {selectedUom && Number(line.quantity) > 0 ? <Text style={[styles.helper, dark && darkStyles.bodyText]}>Moves {formatQuantity(Number(line.quantity) * selectedUom.conversionFactor)} {product.stockUom} when dispatched.</Text> : null}
                </View>
              );
            })}
          </View>

          <Pressable disabled={saving || !lines.length} onPress={() => void saveTransfer()} style={[styles.primaryButton, (saving || !lines.length) && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.white} /> : <Ionicons name="save-outline" size={18} color={theme.colors.white} />}<Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save transfer draft'}</Text></Pressable>
        </View>
      ) : null}

      {detail ? (
        <View style={[styles.detailCard, dark && darkStyles.card]}>
          <View style={styles.detailHead}><Pressable onPress={() => setDetail(null)} style={styles.iconButton}><Ionicons name="arrow-back" size={19} color={theme.colors.slate} /></Pressable><View style={styles.flexCopy}><Text style={[styles.detailTitle, dark && darkStyles.titleText]}>{detail.reference}</Text><Text style={[styles.muted, dark && darkStyles.bodyText]}>{detail.sourceBranchName} → {detail.destinationBranchName}</Text></View><StatusPill status={detail.status} /></View>
          <View style={[styles.ruleCard, dark && darkStyles.subtleCard]}><Ionicons name="information-circle-outline" size={20} color={theme.colors.info} /><Text style={[styles.ruleText, dark && darkStyles.bodyText]}>{detail.status === 'draft' ? 'Draft transfer: no stock has moved yet.' : detail.status === 'dispatched' ? `Dispatched: stock has left ${detail.sourceBranchName} and will enter ${detail.destinationBranchName} only when received.` : detail.status === 'received' ? `Received: destination stock has been posted to ${detail.destinationBranchName}.` : 'Cancelled transfer: no further stock movement is permitted.'}</Text></View>
          <Text style={[styles.reasonText, dark && darkStyles.bodyText]}>{detail.reason}</Text>
          <View style={styles.lineList}>{detail.items.map((item) => <View key={item.itemId} style={[styles.detailLine, dark && darkStyles.subtleCard]}><View style={styles.flexCopy}><Text style={[styles.itemName, dark && darkStyles.titleText]}>{item.productName}</Text><Text style={[styles.muted, dark && darkStyles.bodyText]}>{formatQuantity(item.quantity)} {item.selectedUom} = {formatQuantity(item.stockQuantity)} {item.stockUom}</Text></View></View>)}</View>

          {detail.status === 'draft' ? (
            <View style={styles.actionRow}><Pressable disabled={saving} onPress={() => setCancelMode(true)} style={[styles.secondaryButton, dark && darkStyles.outlineButton]}><Text style={[styles.secondaryText, dark && darkStyles.bodyText]}>Cancel transfer</Text></Pressable><Pressable disabled={saving || !capabilities.canTransferStock} onPress={() => setConfirmAction('dispatch')} style={[styles.primaryButton, (saving || !capabilities.canTransferStock) && styles.disabled]}><Text style={styles.primaryText}>Dispatch</Text></Pressable></View>
          ) : null}
          {detail.status === 'dispatched' && detail.destinationBranchId === branch.id ? <Pressable disabled={saving || !capabilities.canTransferStock} onPress={() => setConfirmAction('receive')} style={[styles.primaryButton, (saving || !capabilities.canTransferStock) && styles.disabled]}><Text style={styles.primaryText}>Receive into {branch.name}</Text></Pressable> : null}

          {confirmAction ? <View style={[styles.confirmCard, dark && darkStyles.subtleCard]}><Text style={[styles.confirmText, dark && darkStyles.bodyText]}>{confirmAction === 'dispatch' ? `Dispatch now? This immediately reduces stock in ${detail.sourceBranchName}.` : `Confirm physical receipt? This immediately increases stock in ${detail.destinationBranchName}.`}</Text><View style={styles.actionRow}><Pressable disabled={saving} onPress={() => setConfirmAction(null)} style={[styles.secondaryButton, dark && darkStyles.outlineButton]}><Text style={[styles.secondaryText, dark && darkStyles.bodyText]}>Not yet</Text></Pressable><Pressable disabled={saving} onPress={() => void performAction(confirmAction)} style={[styles.primaryButton, saving && styles.disabled]}>{saving ? <ActivityIndicator color={theme.colors.white} /> : null}<Text style={styles.primaryText}>{confirmAction === 'dispatch' ? 'Confirm dispatch' : 'Confirm receipt'}</Text></Pressable></View></View> : null}

          {cancelMode ? <View style={[styles.confirmCard, dark && darkStyles.subtleCard]}><Text style={[styles.formTitle, dark && darkStyles.titleText]}>Cancel transfer</Text><TextInput value={cancelReason} onChangeText={setCancelReason} multiline placeholder="Reason for cancellation" placeholderTextColor={theme.colors.subtle} style={[styles.input,styles.multilineInput,dark&&darkStyles.input]} /><View style={styles.actionRow}><Pressable disabled={saving} onPress={() => setCancelMode(false)} style={[styles.secondaryButton,dark&&darkStyles.outlineButton]}><Text style={[styles.secondaryText,dark&&darkStyles.bodyText]}>Keep transfer</Text></Pressable><Pressable disabled={saving||!cancelReason.trim()} onPress={() => void cancelTransfer()} style={[styles.dangerButton,(saving||!cancelReason.trim())&&styles.disabled]}><Text style={styles.dangerText}>Cancel transfer</Text></Pressable></View></View> : null}
        </View>
      ) : null}
    </View>
  );
}

function findStockUom(product: CommerceProduct): CommerceUom | null {
  return product.uoms.find((uom) => uom.isStockUom) ?? null;
}

function StatusPill({ status }: { status: StockTransferListRow['status'] }) {
  return <View style={styles.statusPill}><Text style={styles.statusText}>{status === 'dispatched' ? 'In transit' : status.charAt(0).toUpperCase() + status.slice(1)}</Text></View>;
}

function Message({ text, error, dark }: { text: string; error?: boolean; dark: boolean }) {
  return <View style={[error ? styles.errorCard : styles.noticeCard,dark&&(error?darkStyles.errorCard:darkStyles.noticeCard)]}><Ionicons name={error?'alert-circle-outline':'checkmark-circle-outline'} size={19} color={error?theme.colors.danger:theme.colors.greenDark}/><Text style={[error?styles.errorText:styles.noticeText,dark&&darkStyles.bodyText]}>{text}</Text></View>;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  stack:{gap:14},heading:{gap:3},eyebrow:{color:theme.colors.muted,fontSize:11,fontWeight:'900',letterSpacing:1.05},title:{color:theme.colors.navy,fontSize:28,lineHeight:34,fontWeight:'900'},subtitle:{color:theme.colors.slate,fontSize:13,lineHeight:19},backButton:{alignSelf:'flex-start',minHeight:38,flexDirection:'row',alignItems:'center',gap:5},backText:{color:theme.colors.greenDark,fontSize:12,fontWeight:'900'},flexCopy:{flex:1,minWidth:0},toolbarRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:9},sectionTitle:{color:theme.colors.navy,fontSize:15,fontWeight:'900'},newButton:{minHeight:40,borderRadius:11,backgroundColor:theme.colors.green,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:5},newButtonText:{color:theme.colors.white,fontSize:11,fontWeight:'900'},transferList:{gap:8},transferCard:{minHeight:72,borderRadius:theme.radius.md,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:11,flexDirection:'row',alignItems:'center',gap:8},transferReference:{color:theme.colors.navy,fontSize:13,fontWeight:'900'},statusPill:{borderRadius:theme.radius.pill,backgroundColor:theme.colors.mintSoft,paddingHorizontal:8,paddingVertical:5},statusText:{color:theme.colors.greenDark,fontSize:10,fontWeight:'900'},formCard:{borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:14,gap:9},formHead:{flexDirection:'row',alignItems:'flex-start',gap:9},formTitle:{color:theme.colors.navy,fontSize:15,fontWeight:'900'},iconButton:{width:36,height:36,borderRadius:11,backgroundColor:'#F2F4F7',alignItems:'center',justifyContent:'center'},label:{color:theme.colors.slate,fontSize:11.5,fontWeight:'900'},branchChoices:{flexDirection:'row',flexWrap:'wrap',gap:6},choiceButton:{minHeight:36,borderRadius:theme.radius.pill,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,paddingHorizontal:10,alignItems:'center',justifyContent:'center'},choiceButtonActive:{borderColor:theme.colors.green,backgroundColor:theme.colors.mintSoft},choiceText:{color:theme.colors.slate,fontSize:10.5,fontWeight:'800'},choiceTextActive:{color:theme.colors.greenDark},fieldHeadingRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},generateButton:{minHeight:30,paddingHorizontal:8,borderRadius:9,backgroundColor:theme.colors.mintSoft,flexDirection:'row',alignItems:'center',gap:4},generateText:{color:theme.colors.greenDark,fontSize:10.5,fontWeight:'900'},input:{minHeight:47,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,paddingHorizontal:12,color:theme.colors.navy,fontSize:13},multilineInput:{minHeight:78,textAlignVertical:'top',paddingTop:10},helper:{color:theme.colors.muted,fontSize:10.5,lineHeight:16},searchBox:{minHeight:46,borderWidth:1,borderColor:theme.colors.border,borderRadius:12,backgroundColor:theme.colors.white,paddingHorizontal:10,flexDirection:'row',alignItems:'center',gap:7},searchInput:{flex:1,color:theme.colors.navy,fontSize:13,paddingVertical:0},productMenu:{borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:5,gap:2},productOption:{minHeight:48,paddingHorizontal:9,flexDirection:'row',alignItems:'center',gap:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.colors.border},lineList:{gap:8},lineCard:{borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:'#F9FAFB',padding:10,gap:8},lineHead:{flexDirection:'row',alignItems:'center',gap:8},itemName:{color:theme.colors.navy,fontSize:12.5,fontWeight:'900'},removeButton:{width:36,height:36,borderRadius:10,backgroundColor:theme.colors.dangerSoft,alignItems:'center',justifyContent:'center'},uomRow:{flexDirection:'row',flexWrap:'wrap',gap:6},uomChip:{minHeight:33,borderRadius:theme.radius.pill,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,paddingHorizontal:9,alignItems:'center',justifyContent:'center'},uomChipActive:{borderColor:theme.colors.green,backgroundColor:theme.colors.mintSoft},uomText:{color:theme.colors.slate,fontSize:10.5,fontWeight:'800'},uomTextActive:{color:theme.colors.greenDark},primaryButton:{flex:1,minHeight:47,borderRadius:13,backgroundColor:theme.colors.green,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,paddingHorizontal:12},primaryText:{color:theme.colors.white,fontSize:12,fontWeight:'900'},secondaryButton:{flex:1,minHeight:47,borderRadius:13,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,alignItems:'center',justifyContent:'center',paddingHorizontal:12},secondaryText:{color:theme.colors.slate,fontSize:12,fontWeight:'900'},dangerButton:{flex:1,minHeight:47,borderRadius:13,backgroundColor:theme.colors.danger,alignItems:'center',justifyContent:'center'},dangerText:{color:theme.colors.white,fontSize:12,fontWeight:'900'},actionRow:{flexDirection:'row',gap:9},detailCard:{borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:14,gap:10},detailHead:{flexDirection:'row',alignItems:'center',gap:9},detailTitle:{color:theme.colors.navy,fontSize:16,fontWeight:'900'},ruleCard:{borderRadius:12,backgroundColor:'#EFF8FF',padding:11,flexDirection:'row',alignItems:'flex-start',gap:8},ruleText:{flex:1,color:theme.colors.slate,fontSize:11,lineHeight:17},reasonText:{color:theme.colors.slate,fontSize:11.5,lineHeight:17},detailLine:{borderRadius:11,borderWidth:1,borderColor:theme.colors.border,backgroundColor:'#F9FAFB',padding:10},confirmCard:{borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:'#F9FAFB',padding:11,gap:9},confirmText:{color:theme.colors.slate,fontSize:11.5,lineHeight:17},emptyCard:{minHeight:125,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:18,alignItems:'center',justifyContent:'center',gap:7},emptyTitle:{color:theme.colors.navy,fontSize:15,fontWeight:'900'},muted:{color:theme.colors.muted,fontSize:11,lineHeight:16},errorCard:{borderRadius:theme.radius.md,borderWidth:1,borderColor:'#FDA29B',backgroundColor:theme.colors.dangerSoft,padding:11,flexDirection:'row',gap:7,alignItems:'flex-start'},errorText:{flex:1,color:'#912018',fontSize:11.5,lineHeight:17},noticeCard:{borderRadius:theme.radius.md,borderWidth:1,borderColor:'#ABEFC6',backgroundColor:theme.colors.mintSoft,padding:11,flexDirection:'row',gap:7,alignItems:'flex-start'},noticeText:{flex:1,color:theme.colors.slate,fontSize:11.5,lineHeight:17},disabled:{opacity:0.42},pressed:{opacity:0.82},
});

const darkStyles=StyleSheet.create({titleText:{color:'#F8FAFC'},bodyText:{color:'#CBD5E1'},card:{backgroundColor:'#111827',borderColor:'#334155'},subtleCard:{backgroundColor:'#172033',borderColor:'#334155'},outlineButton:{backgroundColor:'#111827',borderColor:'#334155'},input:{backgroundColor:'#111827',borderColor:'#334155',color:'#F8FAFC'},inputText:{color:'#F8FAFC'},errorCard:{backgroundColor:'#3F1D1D',borderColor:'#7F1D1D'},noticeCard:{backgroundColor:'#102E24',borderColor:'#166534'}});
