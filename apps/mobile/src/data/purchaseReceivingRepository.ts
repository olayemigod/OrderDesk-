import { supabase } from '../lib/supabase';

export type PurchaseReceivingListRow = {
  id: string;
  reference: string;
  status: 'ordered' | 'partially_received';
  branchId: string;
  branchName: string;
  supplierName: string;
  itemCount: number;
  expectedDate: string | null;
  createdAt: string;
};

export type PurchaseReceivingItem = {
  itemId: string;
  productName: string;
  selectedUom: string;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
};

export type PurchaseReceivingDetail = {
  purchaseOrderId: string;
  reference: string;
  status: string;
  branchId: string;
  branchName: string;
  supplierName: string;
  expectedDate: string | null;
  notes: string | null;
  items: PurchaseReceivingItem[];
  receipts: Array<{ receiptId: string; reference: string; receivedAt: string; itemCount: number }>;
};

export type PurchaseReceiptResult = {
  receiptId: string;
  purchaseOrderId: string;
  reference: string;
  status: string;
  itemCount: number;
  idempotentReplay: boolean;
};

export async function loadReceivablePurchaseOrders(tenantId: string, branchId: string): Promise<PurchaseReceivingListRow[]> {
  if (!tenantId || !branchId) return [];
  const { data, error } = await supabase.rpc('get_sellertray_purchase_orders', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_limit: 100,
  });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id ?? row.purchase_order_id ?? ''),
      reference: String(row.reference ?? 'Purchase Order'),
      status: String(row.status ?? '') as PurchaseReceivingListRow['status'],
      branchId: String(row.branch_id ?? ''),
      branchName: String(row.branch_name ?? 'Branch'),
      supplierName: String(row.supplier_name ?? 'Supplier'),
      itemCount: numberValue(row.item_count),
      expectedDate: typeof row.expected_date === 'string' ? row.expected_date : null,
      createdAt: String(row.created_at ?? ''),
    }))
    .filter((row) => row.id && row.branchId === branchId && (row.status === 'ordered' || row.status === 'partially_received'));
}

export async function loadPurchaseReceivingDetail(tenantId: string, purchaseOrderId: string): Promise<PurchaseReceivingDetail> {
  const { data, error } = await supabase.rpc('get_sellertray_purchase_order_detail', {
    p_tenant_id: tenantId,
    p_purchase_order_id: purchaseOrderId,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Purchase Order is unavailable.');
  const row = data as Record<string, unknown>;
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const rawReceipts = Array.isArray(row.receipts) ? row.receipts : [];
  return {
    purchaseOrderId: String(row.purchaseOrderId ?? row.purchase_order_id ?? purchaseOrderId),
    reference: String(row.reference ?? 'Purchase Order'),
    status: String(row.status ?? ''),
    branchId: String(row.branchId ?? row.branch_id ?? ''),
    branchName: String(row.branchName ?? row.branch_name ?? 'Branch'),
    supplierName: String(row.supplierName ?? row.supplier_name ?? 'Supplier'),
    expectedDate: stringOrNull(row.expectedDate ?? row.expected_date),
    notes: stringOrNull(row.notes),
    items: rawItems.map((value) => {
      const item = value as Record<string, unknown>;
      return {
        itemId: String(item.itemId ?? item.item_id ?? ''),
        productName: String(item.productName ?? item.product_name ?? 'Product'),
        selectedUom: String(item.selectedUom ?? item.selected_uom ?? 'unit'),
        orderedQuantity: numberValue(item.orderedQuantity ?? item.ordered_quantity),
        receivedQuantity: numberValue(item.receivedQuantity ?? item.received_quantity),
        remainingQuantity: numberValue(item.remainingQuantity ?? item.remaining_quantity),
      };
    }).filter((item) => item.itemId),
    receipts: rawReceipts.map((value) => {
      const receipt = value as Record<string, unknown>;
      return {
        receiptId: String(receipt.receiptId ?? receipt.receipt_id ?? ''),
        reference: String(receipt.reference ?? 'Receipt'),
        receivedAt: String(receipt.receivedAt ?? receipt.received_at ?? ''),
        itemCount: numberValue(receipt.itemCount ?? receipt.item_count),
      };
    }).filter((receipt) => receipt.receiptId),
  };
}

export async function receivePurchaseOrder(input: {
  tenantId: string;
  purchaseOrderId: string;
  reference: string;
  notes?: string | null;
  items: Array<{ purchaseOrderItemId: string; quantity: number }>;
}): Promise<PurchaseReceiptResult> {
  if (!input.reference.trim()) throw new Error('Receipt reference is required.');
  if (!input.items.length || input.items.some((item) => !item.purchaseOrderItemId || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
    throw new Error('Enter at least one physically received quantity.');
  }
  const { data, error } = await supabase.rpc('receive_sellertray_purchase_order', {
    p_tenant_id: input.tenantId,
    p_purchase_order_id: input.purchaseOrderId,
    p_reference: input.reference.trim(),
    p_notes: input.notes?.trim() || null,
    p_items: input.items,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('SellerTray could not confirm this purchase receipt.');
  const row = data as Record<string, unknown>;
  return {
    receiptId: String(row.receiptId ?? ''),
    purchaseOrderId: String(row.purchaseOrderId ?? input.purchaseOrderId),
    reference: String(row.reference ?? input.reference),
    status: String(row.status ?? ''),
    itemCount: numberValue(row.itemCount),
    idempotentReplay: row.idempotentReplay === true,
  };
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
