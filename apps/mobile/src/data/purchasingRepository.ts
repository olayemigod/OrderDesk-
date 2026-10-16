import { supabase } from '../lib/supabase';

export type ReceivablePurchaseOrder = {
  id: string;
  reference: string;
  status: 'ordered' | 'partially_received';
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  totalAmount: number;
  itemCount: number;
  expectedDate: string | null;
  createdAt: string;
};

export type PurchaseReceivingItem = {
  itemId: string;
  catalogItemId: string;
  uomId: string;
  productName: string;
  sku: string | null;
  selectedUom: string;
  conversionFactor: number;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
};

export type PurchaseReceiptHistory = {
  receiptId: string;
  reference: string;
  receivedAt: string;
  notes: string | null;
  itemCount: number;
};

export type PurchaseReceivingDetail = {
  purchaseOrderId: string;
  reference: string;
  status: 'ordered' | 'partially_received' | 'received';
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  totalAmount: number;
  expectedDate: string | null;
  notes: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  items: PurchaseReceivingItem[];
  receipts: PurchaseReceiptHistory[];
};

export type PurchaseReceiptLineInput = {
  purchaseOrderItemId: string;
  quantity: number;
};

export type PurchaseReceiptResult = {
  receiptId: string;
  purchaseOrderId: string;
  reference: string;
  status: string;
  itemCount: number;
  idempotentReplay: boolean;
};

export async function loadPurchaseReceivingAuthority(
  tenantId: string,
  branchId: string,
): Promise<boolean> {
  if (!tenantId || !branchId) return false;
  const { data, error } = await supabase.rpc('get_sellertray_purchase_receiving_authority', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });
  if (error) throw error;
  return data === true;
}

export async function loadReceivablePurchases(
  tenantId: string,
  branchId: string,
): Promise<ReceivablePurchaseOrder[]> {
  if (!tenantId || !branchId) return [];
  const { data, error } = await supabase.rpc('get_sellertray_purchase_orders', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_limit: 100,
  });
  if (error) throw error;

  return rows(data)
    .map((row) => ({
      id: text(row.id),
      reference: text(row.reference) || 'Purchase Order',
      status: normalizeReceivableStatus(row.status),
      branchId: text(row.branch_id),
      branchName: text(row.branch_name) || 'Branch',
      supplierId: text(row.supplier_id),
      supplierName: text(row.supplier_name) || 'Supplier',
      currency: text(row.currency) || 'NGN',
      totalAmount: numberValue(row.total_amount),
      itemCount: numberValue(row.item_count),
      expectedDate: nullableText(row.expected_date),
      createdAt: text(row.created_at),
    }))
    .filter((row): row is ReceivablePurchaseOrder =>
      Boolean(row.id && row.branchId && row.supplierId && (row.status === 'ordered' || row.status === 'partially_received')),
    );
}

export async function loadPurchaseReceivingDetail(
  tenantId: string,
  purchaseOrderId: string,
): Promise<PurchaseReceivingDetail> {
  const { data, error } = await supabase.rpc('get_sellertray_purchase_order_detail', {
    p_tenant_id: tenantId,
    p_purchase_order_id: purchaseOrderId,
  });
  if (error) throw error;
  const row = object(data);

  const status = text(row.status);
  if (status !== 'ordered' && status !== 'partially_received' && status !== 'received') {
    throw new Error('This purchase is not available for stock receiving.');
  }

  return {
    purchaseOrderId: text(row.purchaseOrderId),
    reference: text(row.reference) || 'Purchase Order',
    status,
    branchId: text(row.branchId),
    branchName: text(row.branchName) || 'Branch',
    supplierId: text(row.supplierId),
    supplierName: text(row.supplierName) || 'Supplier',
    currency: text(row.currency) || 'NGN',
    totalAmount: numberValue(row.totalAmount),
    expectedDate: nullableText(row.expectedDate),
    notes: nullableText(row.notes),
    orderedAt: nullableText(row.orderedAt),
    receivedAt: nullableText(row.receivedAt),
    items: array(row.items)
      .map((item) => {
        const value = object(item);
        return {
          itemId: text(value.itemId),
          catalogItemId: text(value.catalogItemId),
          uomId: text(value.uomId),
          productName: text(value.productName) || 'Product',
          sku: nullableText(value.sku),
          selectedUom: text(value.selectedUom) || 'Unit',
          conversionFactor: numberValue(value.conversionFactor),
          orderedQuantity: numberValue(value.orderedQuantity),
          receivedQuantity: numberValue(value.receivedQuantity),
          remainingQuantity: numberValue(value.remainingQuantity),
        };
      })
      .filter((item) => item.itemId && item.remainingQuantity >= 0),
    receipts: array(row.receipts)
      .map((item) => {
        const value = object(item);
        return {
          receiptId: text(value.receiptId),
          reference: text(value.reference) || 'Receipt',
          receivedAt: text(value.receivedAt),
          notes: nullableText(value.notes),
          itemCount: numberValue(value.itemCount),
        };
      })
      .filter((item) => item.receiptId),
  };
}

export async function receivePurchaseOrder(input: {
  tenantId: string;
  purchaseOrderId: string;
  reference: string;
  notes?: string | null;
  items: PurchaseReceiptLineInput[];
}): Promise<PurchaseReceiptResult> {
  const reference = input.reference.trim();
  if (!reference) throw new Error('Receipt reference is required.');
  if (!input.items.length) throw new Error('Enter at least one received quantity.');

  const { data, error } = await supabase.rpc('receive_sellertray_purchase_order', {
    p_tenant_id: input.tenantId,
    p_purchase_order_id: input.purchaseOrderId,
    p_reference: reference,
    p_notes: input.notes?.trim() || null,
    p_items: input.items,
  });
  if (error) throw error;
  const row = object(data);

  return {
    receiptId: text(row.receiptId),
    purchaseOrderId: text(row.purchaseOrderId),
    reference: text(row.reference) || reference,
    status: text(row.status),
    itemCount: numberValue(row.itemCount),
    idempotentReplay: row.idempotentReplay === true,
  };
}

function normalizeReceivableStatus(value: unknown): 'ordered' | 'partially_received' | '' {
  return value === 'ordered' || value === 'partially_received' ? value : '';
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(object) : [];
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
