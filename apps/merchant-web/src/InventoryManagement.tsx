import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, numberValue, supabase } from './supabase';

type Branch = { id: string; name: string };
type ValuationStatus = 'empty' | 'valued' | 'partial' | 'unvalued';
type StockRow = {
  catalogItemId: string;
  itemName: string;
  sku: string | null;
  category: string | null;
  stockUom: string;
  currency: string;
  quantityOnHand: number | string;
  valuedQuantityOnHand: number | string;
  unvaluedQuantityOnHand: number | string;
  knownInventoryValue: number | string;
  averageUnitCost: number | string | null;
  valuationStatus: ValuationStatus;
  lowStockThreshold: number | string;
  reorderTarget: number | string | null;
  suggestedReorderQuantity: number | string | null;
  isLowStock: boolean;
  isOutOfStock: boolean;
  lastMovementAt: string | null;
};
type StockManagementResponse = {
  items: StockRow[];
  totalCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  valuedCount: number;
  partialValuationCount: number;
  unvaluedCount: number;
  emptyCount: number;
  knownInventoryValue: number | string;
  currency: string;
  asOf: string;
  limit: number;
  offset: number;
};
type Movement = {
  id: string;
  catalogItemId: string;
  itemName: string;
  sku: string | null;
  category: string | null;
  movementType: string;
  quantityDelta: number | string;
  stockUom: string;
  sourceUom: string;
  sourceQuantity: number | string;
  conversionFactor: number | string;
  referenceType: string;
  referenceId: string;
  businessAt: string;
  reason: string | null;
  createdAt: string;
  currency: string;
  knownUnitCost: number | string | null;
  valueDelta: number | string | null;
  cogsAmount: number | string | null;
  cogsComplete: boolean | null;
  valuationStatus: Exclude<ValuationStatus, 'empty'>;
  valuationSource: string;
};
type MovementManagementResponse = {
  items: Movement[];
  totalCount: number;
  inflowCount: number;
  outflowCount: number;
  valuedCount: number;
  partialValuationCount: number;
  unvaluedCount: number;
  knownValueDelta: number | string;
  currency: string;
  limit: number;
  offset: number;
};
type Transfer = {
  id: string;
  reference: string;
  reason: string | null;
  status: string;
  sourceBranchId: string;
  sourceBranchName: string;
  destinationBranchId: string;
  destinationBranchName: string;
  itemCount: number;
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};
type TransferManagementResponse = {
  items: Transfer[];
  totalCount: number;
  openCount: number;
  draftCount: number;
  dispatchedCount: number;
  limit: number;
  offset: number;
};
type ProductUom = { id: string; uom_name: string; conversion_factor: number | string; allow_fractional: boolean };
type Product = { id: string; name: string; stock_uom: string; catalog_item_uoms: ProductUom[] | null };
type CountItem = { productId: string; productName: string; stockUom: string; captured: boolean; selectedUom: string | null; countedQuantity: number | null; expectedStockQuantity: number | null; varianceQuantity: number | null };
type StockCount = { countId: string; reference: string; reason: string; status: 'counting' | 'review' | 'applied' | 'cancelled'; totalItems: number; capturedItems: number; items: CountItem[] };
type Capabilities = { can_receive_stock?: boolean; can_adjust_stock?: boolean; can_count_stock?: boolean; can_apply_stock_count?: boolean };
type Tab = 'stock' | 'movements' | 'counts' | 'transfers';
type TransferLine = { productId: string; uomId: string; quantity: string };

const PAGE_SIZE = 25;
const ADJUST_REASONS = ['Data correction', 'Damage', 'Expiry', 'Missing / shrinkage', 'Inventory recovery', 'Other approved adjustment'];
const EMPTY_STOCK: StockManagementResponse = { items: [], totalCount: 0, lowStockCount: 0, outOfStockCount: 0, valuedCount: 0, partialValuationCount: 0, unvaluedCount: 0, emptyCount: 0, knownInventoryValue: 0, currency: 'NGN', asOf: '', limit: PAGE_SIZE, offset: 0 };
const EMPTY_MOVEMENTS: MovementManagementResponse = { items: [], totalCount: 0, inflowCount: 0, outflowCount: 0, valuedCount: 0, partialValuationCount: 0, unvaluedCount: 0, knownValueDelta: 0, currency: 'NGN', limit: PAGE_SIZE, offset: 0 };
const EMPTY_TRANSFERS: TransferManagementResponse = { items: [], totalCount: 0, openCount: 0, draftCount: 0, dispatchedCount: 0, limit: PAGE_SIZE, offset: 0 };

export default function InventoryManagement({ tenantId, branch, branches }: { tenantId: string; branch: Branch | null; branches: Branch[] }) {
  const [tab, setTab] = useState<Tab>('stock');
  const [stock, setStock] = useState<StockManagementResponse>(EMPTY_STOCK);
  const [movements, setMovements] = useState<MovementManagementResponse>(EMPTY_MOVEMENTS);
  const [transfers, setTransfers] = useState<TransferManagementResponse>(EMPTY_TRANSFERS);
  const [products, setProducts] = useState<Product[]>([]);
  const [count, setCount] = useState<StockCount | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [stockSearch, setStockSearch] = useState('');
  const [stockState, setStockState] = useState('all');
  const [valuationState, setValuationState] = useState('all');
  const [stockOffset, setStockOffset] = useState(0);
  const [movementSearch, setMovementSearch] = useState('');
  const [movementType, setMovementType] = useState('all');
  const [movementDateFrom, setMovementDateFrom] = useState('');
  const [movementDateTo, setMovementDateTo] = useState('');
  const [movementOffset, setMovementOffset] = useState(0);
  const [transferSearch, setTransferSearch] = useState('');
  const [transferStatus, setTransferStatus] = useState('all');
  const [transferDateFrom, setTransferDateFrom] = useState('');
  const [transferDateTo, setTransferDateTo] = useState('');
  const [transferOffset, setTransferOffset] = useState(0);

  const [policyProductId, setPolicyProductId] = useState<string | null>(null);
  const [policyThreshold, setPolicyThreshold] = useState('');
  const [policyTarget, setPolicyTarget] = useState('');
  const [adjustProductId, setAdjustProductId] = useState('');
  const [adjustUomId, setAdjustUomId] = useState('');
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustDirection, setAdjustDirection] = useState<'increase' | 'decrease'>('decrease');
  const [adjustReason, setAdjustReason] = useState(ADJUST_REASONS[0]);
  const [adjustReference, setAdjustReference] = useState(() => reference('ADJ'));
  const [countReference, setCountReference] = useState(() => reference('COUNT'));
  const [countReason, setCountReason] = useState('Routine stock count');
  const [countEntryProductId, setCountEntryProductId] = useState<string | null>(null);
  const [countEntryUomId, setCountEntryUomId] = useState('');
  const [countEntryQty, setCountEntryQty] = useState('');
  const [countCancelOpen, setCountCancelOpen] = useState(false);
  const [countCancelReason, setCountCancelReason] = useState('');
  const [transferDestination, setTransferDestination] = useState('');
  const [transferReference, setTransferReference] = useState(() => reference('TRF'));
  const [transferReason, setTransferReason] = useState('Branch replenishment');
  const [transferLines, setTransferLines] = useState<TransferLine[]>([]);
  const [lineProductId, setLineProductId] = useState('');
  const [lineUomId, setLineUomId] = useState('');
  const [lineQty, setLineQty] = useState('');
  const [transferCancelId, setTransferCancelId] = useState<string | null>(null);
  const [transferCancelReason, setTransferCancelReason] = useState('');

  const selectedProduct = products.find((row) => row.id === adjustProductId) ?? null;
  const lineProduct = products.find((row) => row.id === lineProductId) ?? null;
  const policyProduct = policyProductId ? stock.items.find((row) => row.catalogItemId === policyProductId) ?? null : null;
  const countEntryItem = count?.items.find((item) => item.productId === countEntryProductId) ?? null;
  const countEntryProduct = countEntryProductId ? products.find((row) => row.id === countEntryProductId) ?? null : null;
  const transferToCancel = transferCancelId ? transfers.items.find((row) => row.id === transferCancelId) ?? null : null;

  useEffect(() => {
    setMessage(null); setError(null); setCount(null); setStock(EMPTY_STOCK); setMovements(EMPTY_MOVEMENTS); setTransfers(EMPTY_TRANSFERS); setProducts([]); setPolicyProductId(null);
    setCountEntryProductId(null); setCountEntryUomId(''); setCountEntryQty(''); setCountCancelOpen(false); setCountCancelReason('');
    setTransferCancelId(null); setTransferCancelReason(''); setStockOffset(0); setMovementOffset(0); setTransferOffset(0);
    if (branch) void loadBranchInventory(0, 0, 0);
  }, [tenantId, branch?.id]);
  useEffect(() => {
    const uom = selectedProduct?.catalog_item_uoms?.find((row) => row.uom_name.toLowerCase() === selectedProduct.stock_uom.toLowerCase()) ?? selectedProduct?.catalog_item_uoms?.[0];
    setAdjustUomId(uom?.id ?? '');
  }, [adjustProductId, products]);
  useEffect(() => {
    const uom = lineProduct?.catalog_item_uoms?.find((row) => row.uom_name.toLowerCase() === lineProduct.stock_uom.toLowerCase()) ?? lineProduct?.catalog_item_uoms?.[0];
    setLineUomId(uom?.id ?? '');
  }, [lineProductId, products]);

  async function loadStock(nextOffset = stockOffset) {
    if (!branch) return;
    setLoading(true); setError(null);
    try {
      const result = await supabase.rpc('get_sellertray_inventory_management_stock', {
        p_tenant_id: tenantId,
        p_branch_id: branch.id,
        p_search: stockSearch.trim() || null,
        p_stock_state: stockState,
        p_valuation_state: valuationState,
        p_as_of: new Date().toISOString(),
        p_limit: PAGE_SIZE,
        p_offset: nextOffset,
      });
      if (result.error) throw result.error;
      setStock((result.data ?? EMPTY_STOCK) as StockManagementResponse);
      setStockOffset(nextOffset);
    } catch (cause) { setError(errorMessage(cause, 'Unable to load Branch stock.')); }
    finally { setLoading(false); }
  }

  async function loadMovements(nextOffset = movementOffset) {
    if (!branch) return;
    setLoading(true); setError(null);
    try {
      const result = await supabase.rpc('get_sellertray_inventory_management_movements', {
        p_tenant_id: tenantId,
        p_branch_id: branch.id,
        p_search: movementSearch.trim() || null,
        p_movement_type: movementType === 'all' ? null : movementType,
        p_date_from: movementDateFrom || null,
        p_date_to: movementDateTo || null,
        p_limit: PAGE_SIZE,
        p_offset: nextOffset,
      });
      if (result.error) throw result.error;
      setMovements((result.data ?? EMPTY_MOVEMENTS) as MovementManagementResponse);
      setMovementOffset(nextOffset);
    } catch (cause) { setError(errorMessage(cause, 'Unable to load stock movement history.')); }
    finally { setLoading(false); }
  }

  async function loadTransfers(nextOffset = transferOffset) {
    if (!branch) return;
    setLoading(true); setError(null);
    try {
      const result = await supabase.rpc('get_sellertray_inventory_management_transfers', {
        p_tenant_id: tenantId,
        p_branch_id: branch.id,
        p_search: transferSearch.trim() || null,
        p_status: transferStatus,
        p_date_from: transferDateFrom || null,
        p_date_to: transferDateTo || null,
        p_limit: PAGE_SIZE,
        p_offset: nextOffset,
      });
      if (result.error) throw result.error;
      setTransfers((result.data ?? EMPTY_TRANSFERS) as TransferManagementResponse);
      setTransferOffset(nextOffset);
    } catch (cause) { setError(errorMessage(cause, 'Unable to load stock transfer history.')); }
    finally { setLoading(false); }
  }

  async function loadBranchInventory(nextStockOffset = stockOffset, nextMovementOffset = movementOffset, nextTransferOffset = transferOffset) {
    if (!branch) return;
    setLoading(true); setError(null);
    try {
      const asOf = new Date().toISOString();
      const [stockResult, movementResult, transferResult, countResult, capabilityResult, productResult] = await Promise.all([
        supabase.rpc('get_sellertray_inventory_management_stock', { p_tenant_id: tenantId, p_branch_id: branch.id, p_search: stockSearch.trim() || null, p_stock_state: stockState, p_valuation_state: valuationState, p_as_of: asOf, p_limit: PAGE_SIZE, p_offset: nextStockOffset }),
        supabase.rpc('get_sellertray_inventory_management_movements', { p_tenant_id: tenantId, p_branch_id: branch.id, p_search: movementSearch.trim() || null, p_movement_type: movementType === 'all' ? null : movementType, p_date_from: movementDateFrom || null, p_date_to: movementDateTo || null, p_limit: PAGE_SIZE, p_offset: nextMovementOffset }),
        supabase.rpc('get_sellertray_inventory_management_transfers', { p_tenant_id: tenantId, p_branch_id: branch.id, p_search: transferSearch.trim() || null, p_status: transferStatus, p_date_from: transferDateFrom || null, p_date_to: transferDateTo || null, p_limit: PAGE_SIZE, p_offset: nextTransferOffset }),
        supabase.rpc('get_sellertray_active_stock_count', { p_tenant_id: tenantId, p_branch_id: branch.id }),
        supabase.rpc('get_sellertray_inventory_capabilities', { p_tenant_id: tenantId, p_branch_id: branch.id }),
        supabase.rpc('get_sellertray_inventory_product_options', { p_tenant_id: tenantId, p_branch_id: branch.id }),
      ]);
      for (const result of [stockResult, movementResult, transferResult, countResult, capabilityResult, productResult]) if (result.error) throw result.error;
      setStock((stockResult.data ?? EMPTY_STOCK) as StockManagementResponse);
      setMovements((movementResult.data ?? EMPTY_MOVEMENTS) as MovementManagementResponse);
      setTransfers((transferResult.data ?? EMPTY_TRANSFERS) as TransferManagementResponse);
      setStockOffset(nextStockOffset); setMovementOffset(nextMovementOffset); setTransferOffset(nextTransferOffset);
      setCount((countResult.data ?? null) as StockCount | null);
      const cap = Array.isArray(capabilityResult.data) ? capabilityResult.data[0] : capabilityResult.data;
      setCapabilities((cap ?? {}) as Capabilities);
      const nextProducts = (productResult.data ?? []) as Product[];
      setProducts(nextProducts);
      setAdjustProductId((current) => nextProducts.some((row) => row.id === current) ? current : nextProducts[0]?.id ?? '');
      setLineProductId((current) => nextProducts.some((row) => row.id === current) ? current : nextProducts[0]?.id ?? '');
      setTransferDestination((current) => branches.some((row) => row.id === current && row.id !== branch.id) ? current : branches.find((row) => row.id !== branch.id)?.id ?? '');
    } catch (cause) { setError(errorMessage(cause, 'Unable to load inventory management data.')); }
    finally { setLoading(false); }
  }

  async function applyStockFilters(event: FormEvent) { event.preventDefault(); await loadStock(0); }
  async function applyMovementFilters(event: FormEvent) { event.preventDefault(); await loadMovements(0); }
  async function applyTransferFilters(event: FormEvent) { event.preventDefault(); await loadTransfers(0); }

  async function invoke(name: string, body: Record<string, unknown>) {
    const { data, error: invokeError } = await supabase.functions.invoke(name, { body });
    if (invokeError) throw invokeError;
    if (data?.error) throw new Error(String(data.error));
    return data;
  }

  async function submitAdjustment(event: FormEvent) {
    event.preventDefault(); if (!branch) return;
    const quantity = Number(adjustQty);
    if (!adjustProductId || !adjustUomId || !Number.isFinite(quantity) || quantity <= 0 || !adjustReference.trim()) { setError('Choose a product and enter a valid quantity and reference.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await invoke('inventory-operation', { tenantId, branchId: branch.id, productId: adjustProductId, uomId: adjustUomId, operation: 'adjust', quantity, adjustmentDirection: adjustDirection, reference: adjustReference, reason: adjustReason, commandId: commandId('adjust') });
      setMessage('Stock adjustment posted.'); setAdjustQty(''); setAdjustReference(reference('ADJ')); await loadBranchInventory();
    } catch (cause) { setError(errorMessage(cause, 'Unable to post this stock adjustment.')); } finally { setBusy(false); }
  }

  function editPolicy(row: StockRow) {
    setPolicyProductId(row.catalogItemId);
    setPolicyThreshold(String(numberValue(row.lowStockThreshold)));
    setPolicyTarget(row.reorderTarget == null ? '' : String(numberValue(row.reorderTarget)));
    setError(null); setMessage(null);
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    if (!branch || !policyProduct) return;
    const threshold = Number(policyThreshold);
    const target = policyTarget.trim() ? Number(policyTarget) : null;
    if (!Number.isFinite(threshold) || threshold < 0 || (target != null && (!Number.isFinite(target) || target < threshold))) { setError('Enter a valid threshold and a reorder target that is not below it.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await invoke('inventory-operation', { tenantId, branchId: branch.id, productId: policyProduct.catalogItemId, operation: 'policy', lowStockThreshold: threshold, reorderTarget: target });
      setPolicyProductId(null); setPolicyThreshold(''); setPolicyTarget('');
      setMessage('Low-stock policy updated.'); await loadBranchInventory();
    }
    catch (cause) { setError(errorMessage(cause, 'Unable to update this low-stock policy.')); } finally { setBusy(false); }
  }

  async function startCount(event: FormEvent) {
    event.preventDefault(); if (!branch) return;
    setBusy(true); setError(null);
    try {
      await invoke('stock-count', { action: 'start', tenantId, branchId: branch.id, reference: countReference, reason: countReason });
      setMessage('Stock count started.'); setCountReference(reference('COUNT')); setCountEntryProductId(null); setCountCancelOpen(false); await loadBranchInventory();
    }
    catch (cause) { setError(errorMessage(cause, 'Unable to start stock count.')); } finally { setBusy(false); }
  }

  function openCountEntry(item: CountItem) {
    const product = products.find((row) => row.id === item.productId);
    const selectedName = item.selectedUom?.trim().toLowerCase();
    const uom = product?.catalog_item_uoms?.find((row) => selectedName && row.uom_name.toLowerCase() === selectedName)
      ?? product?.catalog_item_uoms?.find((row) => row.uom_name.toLowerCase() === item.stockUom.toLowerCase())
      ?? product?.catalog_item_uoms?.[0];
    if (!product || !uom) { setError(`No usable unit is configured for ${item.productName}.`); return; }
    setCountEntryProductId(item.productId);
    setCountEntryUomId(uom.id);
    setCountEntryQty(item.countedQuantity == null ? '' : String(item.countedQuantity));
    setCountCancelOpen(false);
    setError(null); setMessage(null);
  }

  async function saveCountEntry(event: FormEvent) {
    event.preventDefault();
    if (!count || !countEntryItem || !countEntryProduct) return;
    const uom = countEntryProduct.catalog_item_uoms?.find((row) => row.id === countEntryUomId);
    const quantity = Number(countEntryQty);
    if (!uom || countEntryQty.trim() === '' || !Number.isFinite(quantity) || quantity < 0) { setError('Choose a unit and enter a counted quantity of zero or greater.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await invoke('stock-count', { action: 'capture', tenantId, countId: count.countId, productId: countEntryItem.productId, uomId: uom.id, quantity });
      setMessage(`Count saved for ${countEntryItem.productName}.`);
      setCountEntryProductId(null); setCountEntryUomId(''); setCountEntryQty('');
      await loadBranchInventory();
    } catch (cause) { setError(errorMessage(cause, 'Unable to save this counted quantity.')); } finally { setBusy(false); }
  }

  async function countAction(action: 'submit' | 'apply') {
    if (!count) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await invoke('stock-count', { action, tenantId, countId: count.countId });
      setCountEntryProductId(null); setCountCancelOpen(false); setCountCancelReason('');
      setMessage(action === 'apply' ? 'Stock count applied.' : 'Stock count ready for review.');
      await loadBranchInventory();
    }
    catch (cause) { setError(errorMessage(cause, 'Unable to complete this stock count action.')); } finally { setBusy(false); }
  }

  function openCountCancel() {
    setCountCancelOpen(true); setCountCancelReason(''); setCountEntryProductId(null); setError(null); setMessage(null);
  }

  async function cancelCount(event: FormEvent) {
    event.preventDefault();
    if (!count) return;
    const reason = countCancelReason.trim();
    if (!reason) { setError('Enter the reason for cancelling this stock count.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await invoke('stock-count', { action: 'cancel', tenantId, countId: count.countId, reason });
      setCountCancelOpen(false); setCountCancelReason(''); setCountEntryProductId(null);
      setMessage('Stock count cancelled.'); await loadBranchInventory();
    }
    catch (cause) { setError(errorMessage(cause, 'Unable to cancel this stock count.')); } finally { setBusy(false); }
  }

  function addTransferLine() {
    const quantity = Number(lineQty); if (!lineProductId || !lineUomId || !Number.isFinite(quantity) || quantity <= 0) { setError('Choose a product, unit and valid transfer quantity.'); return; }
    setTransferLines((rows) => [...rows, { productId: lineProductId, uomId: lineUomId, quantity: String(quantity) }]); setLineQty(''); setError(null);
  }

  async function createTransfer(event: FormEvent) {
    event.preventDefault(); if (!branch) return;
    if (!transferDestination || !transferLines.length || !transferReference.trim() || !transferReason.trim()) { setError('Choose a destination and add at least one product.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await invoke('stock-transfer', { action: 'create', tenantId, sourceBranchId: branch.id, destinationBranchId: transferDestination, reference: transferReference, reason: transferReason, items: transferLines.map((row) => ({ catalogItemId: row.productId, uomId: row.uomId, quantity: Number(row.quantity) })) });
      setMessage('Stock transfer saved as draft.'); setTransferLines([]); setTransferReference(reference('TRF')); await loadBranchInventory();
    } catch (cause) { setError(errorMessage(cause, 'Unable to create this stock transfer.')); } finally { setBusy(false); }
  }

  async function transferAction(transfer: Transfer, action: 'dispatch' | 'receive') {
    setBusy(true); setError(null); setMessage(null);
    try {
      await invoke('stock-transfer', { action, tenantId, transferId: transfer.id });
      setMessage(action === 'dispatch' ? 'Transfer dispatched.' : 'Transfer received into the destination Branch.');
      if (transferCancelId === transfer.id) { setTransferCancelId(null); setTransferCancelReason(''); }
      await loadBranchInventory();
    }
    catch (cause) { setError(errorMessage(cause, 'Unable to complete this transfer action.')); } finally { setBusy(false); }
  }

  function openTransferCancel(transfer: Transfer) {
    setTransferCancelId(transfer.id); setTransferCancelReason(''); setError(null); setMessage(null);
  }

  async function cancelTransfer(event: FormEvent) {
    event.preventDefault();
    if (!transferToCancel) return;
    const reason = transferCancelReason.trim();
    if (!reason) { setError('Enter the reason for cancelling this transfer.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await invoke('stock-transfer', { action: 'cancel', tenantId, transferId: transferToCancel.id, reason });
      setTransferCancelId(null); setTransferCancelReason('');
      setMessage('Stock transfer cancelled.'); await loadBranchInventory();
    }
    catch (cause) { setError(errorMessage(cause, 'Unable to cancel this transfer.')); } finally { setBusy(false); }
  }

  if (!branch) return <div className="page-stack"><Heading title="Inventory" note="Choose a Branch to manage stock." /><Empty title="No active Branch" body="Inventory actions require an explicit Branch context." /></div>;

  return <div className="page-stack">
    <Heading title="Inventory" note={`Manage ${branch.name} stock from the shared ledger, governed valuation and Branch controls.`} />
    {error ? <div className="error-banner">{error}<button onClick={() => setError(null)}>Dismiss</button></div> : null}
    {message ? <div className="success-banner">{message}<button onClick={() => setMessage(null)}>Dismiss</button></div> : null}
    <div className="metric-grid">
      <Metric label="Products" value={stock.totalCount} />
      <Metric label="Low stock" value={stock.lowStockCount} />
      <Metric label="Out of stock" value={stock.outOfStockCount} />
      <Metric label="Known stock value" value={formatMoney(numberValue(stock.knownInventoryValue), stock.currency)} detail={stock.partialValuationCount || stock.unvaluedCount ? 'Known-cost portion only' : 'Fully governed cost'} />
      <Metric label="Open transfers" value={transfers.openCount} />
    </div>
    {stock.partialValuationCount || stock.unvaluedCount ? <p className="muted">Some stock has partial or unavailable governed cost evidence. SellerTray shows known value separately and never treats unknown cost as zero.</p> : null}
    <div className="tab-row">{(['stock','movements','counts','transfers'] as Tab[]).map((value) => <button key={value} className={tab === value ? 'tab active' : 'tab'} onClick={() => setTab(value)}>{value === 'stock' ? 'Stock' : value === 'movements' ? 'Movement history' : value === 'counts' ? 'Stock count' : 'Transfers'}</button>)}</div>

    {tab === 'stock' ? <>
      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Branch stock</p><h3>On-hand quantities and valuation</h3><p className="muted">{stock.asOf ? `As of ${dateTime(stock.asOf)}.` : ''} Average unit cost is shown only when the on-hand quantity is fully valued.</p></div><button className="secondary-button" disabled={loading} onClick={() => void loadStock()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        <form className="form-grid" onSubmit={applyStockFilters}>
          <label className="field">Search<input placeholder="Product, SKU, category or unit" value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} /></label>
          <label className="field">Stock status<select value={stockState} onChange={(event) => setStockState(event.target.value)}><option value="all">All stock</option><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="out_of_stock">Out of stock</option></select></label>
          <label className="field">Valuation<select value={valuationState} onChange={(event) => setValuationState(event.target.value)}><option value="all">All valuation states</option><option value="valued">Valued</option><option value="partial">Partially valued</option><option value="unvalued">Unvalued</option><option value="empty">No stock</option></select></label>
          <div className="field"><span>Filters</span><button className="secondary-button" disabled={loading}>Apply filters</button></div>
        </form>
        <Table headers={['Product','SKU','Category','On hand','Stock unit','Valuation','Known value','Average unit cost','Last movement','Low-stock policy']}>{stock.items.map((row) => <tr key={row.catalogItemId}><td><strong>{row.itemName}</strong></td><td>{row.sku || '—'}</td><td>{row.category || '—'}</td><td className={numberValue(row.quantityOnHand) <= 0 ? 'danger-text' : ''}>{formatNumber(numberValue(row.quantityOnHand))}</td><td>{row.stockUom}</td><td>{valuationLabel(row.valuationStatus)}</td><td>{stockValue(row)}</td><td>{row.averageUnitCost == null ? '—' : `${formatMoney(numberValue(row.averageUnitCost), row.currency)} / ${row.stockUom}`}</td><td>{row.lastMovementAt ? dateTime(row.lastMovementAt) : 'No movement'}</td><td><button className="text-button" disabled={busy} onClick={() => editPolicy(row)}>Edit policy</button></td></tr>)}</Table>
        {!stock.items.length ? <Empty title="No stock rows" body="No products match the current Branch inventory filters." /> : null}
        <Pagination offset={stockOffset} total={stock.totalCount} pageSize={PAGE_SIZE} loading={loading} onChange={(next) => void loadStock(next)} />
      </article>
      {policyProduct ? <form className="panel product-editor-stack" onSubmit={savePolicy}><div className="panel-head"><div><p className="eyebrow">Replenishment policy</p><h3>{policyProduct.itemName}</h3><p className="muted">Set thresholds in {policyProduct.stockUom} for {branch.name}. This does not move or invent stock.</p></div><button type="button" className="text-button" disabled={busy} onClick={() => setPolicyProductId(null)}>Close</button></div><div className="form-grid">
        <label className="field">Low-stock threshold<input type="number" min="0" step="any" value={policyThreshold} onChange={(event) => setPolicyThreshold(event.target.value)} /></label>
        <label className="field">Reorder target<input type="number" min="0" step="any" value={policyTarget} onChange={(event) => setPolicyTarget(event.target.value)} placeholder="Optional" /></label>
      </div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save policy'}</button></div></form> : null}
      {capabilities.can_adjust_stock ? <form className="panel product-editor-stack" onSubmit={submitAdjustment}><div className="panel-head"><div><p className="eyebrow">Controlled correction</p><h3>Adjust stock</h3></div></div><p className="muted">Use this only for corrections, damage, expiry, shrinkage or recovery. Supplier receipts belong in Purchasing and Branch receipts belong in Transfers.</p><div className="form-grid">
        <label className="field">Product<select value={adjustProductId} onChange={(event) => setAdjustProductId(event.target.value)}>{products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="field">Unit<select value={adjustUomId} onChange={(event) => setAdjustUomId(event.target.value)}>{selectedProduct?.catalog_item_uoms?.map((row) => <option key={row.id} value={row.id}>{row.uom_name}</option>)}</select></label>
        <label className="field">Quantity<input type="number" min="0" step="any" value={adjustQty} onChange={(event) => setAdjustQty(event.target.value)} /></label>
        <label className="field">Direction<select value={adjustDirection} onChange={(event) => setAdjustDirection(event.target.value as 'increase' | 'decrease')}><option value="decrease">Reduce stock</option><option value="increase">Increase stock</option></select></label>
        <label className="field">Reason<select value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)}>{ADJUST_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
        <label className="field">Reference<input value={adjustReference} onChange={(event) => setAdjustReference(event.target.value)} /></label>
      </div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Posting…' : 'Post adjustment'}</button></div></form> : null}
    </> : null}

    {tab === 'movements' ? <article className="panel">
      <div className="panel-head"><div><p className="eyebrow">Audit trail</p><h3>Stock movement history</h3><p className="muted">History follows business time, including delayed offline posting.</p></div><button className="secondary-button" disabled={loading} onClick={() => void loadMovements()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
      <form className="form-grid" onSubmit={applyMovementFilters}>
        <label className="field">Search<input placeholder="Product, reference, movement or reason" value={movementSearch} onChange={(event) => setMovementSearch(event.target.value)} /></label>
        <label className="field">Movement<select value={movementType} onChange={(event) => setMovementType(event.target.value)}><option value="all">All movements</option><option value="opening">Opening</option><option value="sale">Sale</option><option value="sale_return">Sale return</option><option value="purchase_receipt">Purchase receipt</option><option value="adjustment">Adjustment</option><option value="count_reconciliation">Count reconciliation</option><option value="transfer_out">Transfer out</option><option value="transfer_in">Transfer in</option><option value="damaged">Damaged</option><option value="expired">Expired</option><option value="reversal">Reversal</option></select></label>
        <label className="field">From<input type="date" value={movementDateFrom} onChange={(event) => setMovementDateFrom(event.target.value)} /></label>
        <label className="field">To<input type="date" value={movementDateTo} onChange={(event) => setMovementDateTo(event.target.value)} /></label>
        <div className="field"><span>Filters</span><button className="secondary-button" disabled={loading}>Apply filters</button></div>
      </form>
      <Table headers={['When','Product','Movement','Quantity','Source','Reference','Valuation','Reason']}>{movements.items.map((row) => <tr key={row.id}><td>{dateTime(row.businessAt)}</td><td><strong>{row.itemName}</strong></td><td>{label(row.movementType)}</td><td className={numberValue(row.quantityDelta) < 0 ? 'danger-text' : ''}>{signed(numberValue(row.quantityDelta))} {row.stockUom}</td><td>{formatNumber(numberValue(row.sourceQuantity))} {row.sourceUom}</td><td>{row.referenceId || '—'}</td><td>{movementValuation(row)}</td><td>{row.reason || '—'}</td></tr>)}</Table>
      {!movements.items.length ? <Empty title="No movements" body="No stock movements match the current filters." /> : null}
      <Pagination offset={movementOffset} total={movements.totalCount} pageSize={PAGE_SIZE} loading={loading} onChange={(next) => void loadMovements(next)} />
    </article> : null}

    {tab === 'counts' ? <>
      {count ? <article className="panel"><div className="panel-head"><div><p className="eyebrow">{label(count.status)}</p><h3>{count.reference}</h3><p className="muted">{count.capturedItems} of {count.totalItems} products captured</p></div><div className="form-actions">{count.status === 'counting' ? <button className="primary-button" disabled={busy || count.capturedItems !== count.totalItems} onClick={() => void countAction('submit')}>Review variance</button> : null}{count.status === 'review' && capabilities.can_apply_stock_count ? <button className="primary-button" disabled={busy} onClick={() => void countAction('apply')}>Apply count</button> : null}{count.status !== 'applied' && count.status !== 'cancelled' ? <button className="secondary-button" disabled={busy} onClick={openCountCancel}>Cancel</button> : null}</div></div><Table headers={['Product','Counted','Expected','Variance','Action']}>{count.items.map((item) => <tr key={item.productId}><td><strong>{item.productName}</strong></td><td>{item.captured ? `${formatNumber(item.countedQuantity ?? 0)} ${item.selectedUom ?? item.stockUom}` : 'Not counted'}</td><td>{item.expectedStockQuantity == null ? 'Hidden until review' : `${formatNumber(item.expectedStockQuantity)} ${item.stockUom}`}</td><td className={item.varianceQuantity != null && item.varianceQuantity !== 0 ? 'danger-text' : ''}>{item.varianceQuantity == null ? '—' : `${signed(item.varianceQuantity)} ${item.stockUom}`}</td><td>{count.status === 'counting' ? <button className="text-button" disabled={busy} onClick={() => openCountEntry(item)}>{item.captured ? 'Update count' : 'Enter count'}</button> : '—'}</td></tr>)}</Table></article> : capabilities.can_count_stock ? <form className="panel product-editor-stack" onSubmit={startCount}><div className="panel-head"><div><p className="eyebrow">Physical verification</p><h3>Start stock count</h3></div></div><div className="form-grid"><label className="field">Reference<input value={countReference} onChange={(event) => setCountReference(event.target.value)} /></label><label className="field">Reason<input value={countReason} onChange={(event) => setCountReason(event.target.value)} /></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>Start count</button></div></form> : <Empty title="Stock count unavailable" body="Your SellerTray permissions do not allow starting a stock count for this Branch." />}
      {count?.status === 'counting' && countEntryItem && countEntryProduct ? <form className="panel product-editor-stack" onSubmit={saveCountEntry}><div className="panel-head"><div><p className="eyebrow">Count entry</p><h3>{countEntryItem.productName}</h3><p className="muted">Record what was physically counted. Expected stock stays hidden until review.</p></div><button type="button" className="text-button" disabled={busy} onClick={() => setCountEntryProductId(null)}>Close</button></div><div className="form-grid"><label className="field">Unit<select value={countEntryUomId} onChange={(event) => setCountEntryUomId(event.target.value)}>{countEntryProduct.catalog_item_uoms?.map((row) => <option key={row.id} value={row.id}>{row.uom_name}</option>)}</select></label><label className="field">Counted quantity<input required type="number" min="0" step="any" value={countEntryQty} onChange={(event) => setCountEntryQty(event.target.value)} /></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save count'}</button></div></form> : null}
      {count && countCancelOpen && count.status !== 'applied' && count.status !== 'cancelled' ? <form className="panel product-editor-stack" onSubmit={cancelCount}><div className="panel-head"><div><p className="eyebrow">Cancel stock count</p><h3>{count.reference}</h3><p className="muted">Cancellation keeps the count history but prevents it from being applied.</p></div><button type="button" className="text-button" disabled={busy} onClick={() => setCountCancelOpen(false)}>Close</button></div><div className="form-grid"><label className="field">Reason<input required value={countCancelReason} onChange={(event) => setCountCancelReason(event.target.value)} placeholder="Why is this count being cancelled?" /></label></div><div className="form-actions"><button className="danger-button" disabled={busy}>{busy ? 'Cancelling…' : 'Cancel stock count'}</button></div></form> : null}
    </> : null}

    {tab === 'transfers' ? <>
      <article className="panel">
        <div className="panel-head"><div><p className="eyebrow">Branch movement</p><h3>Stock transfers</h3></div><button className="secondary-button" disabled={loading} onClick={() => void loadTransfers()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        <form className="form-grid" onSubmit={applyTransferFilters}>
          <label className="field">Search<input placeholder="Reference, Branch, product or reason" value={transferSearch} onChange={(event) => setTransferSearch(event.target.value)} /></label>
          <label className="field">Status<select value={transferStatus} onChange={(event) => setTransferStatus(event.target.value)}><option value="all">All transfers</option><option value="draft">Draft</option><option value="dispatched">Dispatched</option><option value="received">Received</option><option value="cancelled">Cancelled</option></select></label>
          <label className="field">From<input type="date" value={transferDateFrom} onChange={(event) => setTransferDateFrom(event.target.value)} /></label>
          <label className="field">To<input type="date" value={transferDateTo} onChange={(event) => setTransferDateTo(event.target.value)} /></label>
          <div className="field"><span>Filters</span><button className="secondary-button" disabled={loading}>Apply filters</button></div>
        </form>
        <Table headers={['Reference','From','To','Products','Status','Created','Action']}>{transfers.items.map((row) => <tr key={row.id}><td><strong>{row.reference}</strong></td><td>{row.sourceBranchName}</td><td>{row.destinationBranchName}</td><td>{row.itemCount}</td><td>{label(row.status)}</td><td>{dateTime(row.createdAt)}</td><td><div className="form-actions">{row.status === 'draft' && row.sourceBranchId === branch.id ? <button className="text-button" disabled={busy} onClick={() => void transferAction(row,'dispatch')}>Dispatch</button> : null}{row.status === 'dispatched' && row.destinationBranchId === branch.id ? <button className="text-button" disabled={busy} onClick={() => void transferAction(row,'receive')}>Receive</button> : null}{row.status === 'draft' ? <button className="text-button" disabled={busy} onClick={() => openTransferCancel(row)}>Cancel</button> : null}</div></td></tr>)}</Table>
        {!transfers.items.length ? <Empty title="No transfers" body="No stock transfers match the current filters." /> : null}
        <Pagination offset={transferOffset} total={transfers.totalCount} pageSize={PAGE_SIZE} loading={loading} onChange={(next) => void loadTransfers(next)} />
      </article>
      {transferToCancel ? <form className="panel product-editor-stack" onSubmit={cancelTransfer}><div className="panel-head"><div><p className="eyebrow">Cancel transfer</p><h3>{transferToCancel.reference}</h3><p className="muted">{transferToCancel.sourceBranchName} → {transferToCancel.destinationBranchName}. The reason is retained with the governed transfer history.</p></div><button type="button" className="text-button" disabled={busy} onClick={() => setTransferCancelId(null)}>Close</button></div><div className="form-grid"><label className="field">Reason<input required value={transferCancelReason} onChange={(event) => setTransferCancelReason(event.target.value)} placeholder="Why is this transfer being cancelled?" /></label></div><div className="form-actions"><button className="danger-button" disabled={busy}>{busy ? 'Cancelling…' : 'Cancel transfer'}</button></div></form> : null}
      {branches.some((row) => row.id !== branch.id) ? <form className="panel product-editor-stack" onSubmit={createTransfer}><div className="panel-head"><div><p className="eyebrow">Move between Branches</p><h3>New stock transfer</h3></div></div><div className="form-grid"><label className="field">Destination<select value={transferDestination} onChange={(event) => setTransferDestination(event.target.value)}>{branches.filter((row) => row.id !== branch.id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="field">Reference<input value={transferReference} onChange={(event) => setTransferReference(event.target.value)} /></label><label className="field">Reason<input value={transferReason} onChange={(event) => setTransferReason(event.target.value)} /></label></div><div className="form-grid"><label className="field">Product<select value={lineProductId} onChange={(event) => setLineProductId(event.target.value)}>{products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="field">Unit<select value={lineUomId} onChange={(event) => setLineUomId(event.target.value)}>{lineProduct?.catalog_item_uoms?.map((row) => <option key={row.id} value={row.id}>{row.uom_name}</option>)}</select></label><label className="field">Quantity<input type="number" min="0" step="any" value={lineQty} onChange={(event) => setLineQty(event.target.value)} /></label><div className="field"><span>Transfer line</span><button type="button" className="secondary-button" onClick={addTransferLine}>Add product</button></div></div>{transferLines.length ? <Table headers={['Product','Unit','Quantity','']}>{transferLines.map((line,index) => { const product = products.find((row) => row.id === line.productId); const uom = product?.catalog_item_uoms?.find((row) => row.id === line.uomId); return <tr key={`${line.productId}-${index}`}><td>{product?.name ?? 'Product'}</td><td>{uom?.uom_name ?? 'Unit'}</td><td>{line.quantity}</td><td><button type="button" className="text-button" onClick={() => setTransferLines((rows) => rows.filter((_,i) => i !== index))}>Remove</button></td></tr>; })}</Table> : null}<div className="form-actions"><button className="primary-button" disabled={busy || !transferLines.length}>Save transfer</button></div></form> : <Empty title="One Branch only" body="Add another Branch before creating stock transfers." />}
    </> : null}
  </div>;
}

function Heading({ title, note }: { title: string; note: string }) { return <div className="section-heading"><div><p className="eyebrow">Stock</p><h2>{title}</h2></div><p className="muted">{note}</p></div>; }
function Metric({ label: text, value, detail = 'Selected Branch' }: { label: string; value: string | number; detail?: string }) { return <article className="metric-card"><span>{text}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) { return <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>; }
function Pagination({ offset, total, pageSize, loading, onChange }: { offset: number; total: number; pageSize: number; loading: boolean; onChange: (offset: number) => void }) {
  if (total <= pageSize && offset === 0) return null;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(total, offset + pageSize);
  return <div className="form-actions"><span className="muted">{start}–{end} of {total}</span><button type="button" className="secondary-button" disabled={loading || offset === 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>Previous</button><button type="button" className="secondary-button" disabled={loading || offset + pageSize >= total} onClick={() => onChange(offset + pageSize)}>Next</button></div>;
}
function valuationLabel(value: ValuationStatus) { return value === 'partial' ? 'Partially valued' : value === 'unvalued' ? 'Unvalued' : value === 'empty' ? 'No stock' : 'Valued'; }
function stockValue(row: StockRow) { if (row.valuationStatus === 'unvalued') return 'Unknown'; const known = formatMoney(numberValue(row.knownInventoryValue), row.currency); return row.valuationStatus === 'partial' ? `${known} known` : known; }
function movementValuation(row: Movement) { if (row.valuationStatus === 'unvalued') return 'Unvalued'; if (row.valuationStatus === 'partial') return 'Partially valued'; return row.knownUnitCost == null ? 'Valued' : `${formatMoney(numberValue(row.knownUnitCost), row.currency)} / ${row.stockUom}`; }
function label(value: string) { return value.replaceAll('_',' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatNumber(value: number) { return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 3 }).format(value); }
function formatMoney(value: number, currency: string) { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(value); }
function signed(value: number) { return `${value > 0 ? '+' : ''}${formatNumber(value)}`; }
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
function reference(prefix: string) { const now = new Date(); const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`; return `${prefix}-${stamp}`; }
function commandId(prefix: string) { return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2,10)}`; }
