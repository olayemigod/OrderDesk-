import { supabase } from '../lib/supabase';

export type PosSaleAction = 'void' | 'return';
export type PosReturnStatus = 'partial' | 'returned';
export type PosRefundSource = 'cash' | 'bank';

export type PosRefundBankAccount = {
  id: string;
  displayName: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
};

export type PosReturnableItem = {
  orderItemId: string;
  catalogItemId: string;
  name: string;
  selectedUom: string;
  soldQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  unitPrice: number;
  remainingValue: number;
};

export type PosReturnableSale = {
  orderId: string;
  publicOrderId: string;
  currency: string;
  returnStatus: 'none' | PosReturnStatus;
  returnedAmount: number;
  remainingAmount: number;
  confirmedPaymentAmount: number;
  priorRefundAmount: number;
  netMoneyRetained: number;
  outstandingAmount: number;
  canCompleteMonetaryRefund: boolean;
  cashRefundAvailableAmount: number;
  bankAccounts: PosRefundBankAccount[];
  items: PosReturnableItem[];
};

export type PosSaleActionResult = {
  action: PosSaleAction;
  orderId: string;
  idempotentReplay: boolean;
  status?: 'cancelled';
  returnId?: string;
  refundId?: string | null;
  returnStatus?: PosReturnStatus;
  returnSubtotal?: number;
  returnTax?: number;
  returnedValue?: number;
  receivableReductionAmount?: number;
  refundedAmount?: number;
  outstandingBefore?: number;
  outstandingAfter?: number;
  returnedAmount?: number;
  refundSource?: PosRefundSource | null;
  refundPaymentMethodId?: string | null;
  currency?: string;
};

export type PosDraftDeletionResult = {
  orderId: string;
  deleted: true;
  deletedAt: string;
  idempotentReplay: boolean;
};

export type PosDraftItemEditResult = {
  orderId: string;
  status: 'draft';
  itemCount: number;
  totalAmount: number;
};

export type PosDraftItemEdit = {
  orderItemId?: string;
  catalogItemId?: string;
  uomId?: string;
  quantity: number;
  unitPrice?: number;
};

export type PosReturnItemInput = {
  orderItemId: string;
  quantity: number;
};

export async function updatePosDraftItems(input: {
  tenantId: string;
  orderId: string;
  items: PosDraftItemEdit[];
}): Promise<PosDraftItemEditResult> {
  if (!input.tenantId || !input.orderId) throw new Error('Business and draft sale are required.');
  if (!input.items.length) throw new Error('A draft sale must contain at least one item.');
  if (input.items.some((item) => {
    const editsExisting = Boolean(item.orderItemId);
    const addsProduct = Boolean(item.catalogItemId && item.uomId);
    return editsExisting === addsProduct
      || !Number.isFinite(item.quantity)
      || item.quantity < 0
      || (!editsExisting && item.quantity <= 0)
      || (item.unitPrice !== undefined && (!Number.isFinite(item.unitPrice) || item.unitPrice < 0));
  })) {
    throw new Error('Every draft item needs a valid existing line or Product/Unit, quantity and price.');
  }

  const { data, error } = await supabase.rpc('update_sellertray_pos_draft_items', {
    p_tenant_id: input.tenantId,
    p_order_id: input.orderId,
    p_items: input.items.map((item) => ({
      ...(item.orderItemId ? { orderItemId: item.orderItemId } : {}),
      ...(item.catalogItemId ? { catalogItemId: item.catalogItemId } : {}),
      ...(item.uomId ? { uomId: item.uomId } : {}),
      quantity: item.quantity,
      ...(item.unitPrice === undefined ? {} : { unitPrice: item.unitPrice }),
    })),
  });

  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SellerTray returned an invalid draft edit result.');
  }
  const row = data as Record<string, unknown>;
  const itemCount = numberOrUndefined(row.itemCount);
  const totalAmount = numberOrUndefined(row.totalAmount);
  if (typeof row.orderId !== 'string' || row.status !== 'draft' || itemCount === undefined || totalAmount === undefined) {
    throw new Error('SellerTray returned an invalid draft edit result.');
  }
  return {
    orderId: row.orderId,
    status: 'draft',
    itemCount,
    totalAmount,
  };
}

export async function loadPosReturnableItems(
  tenantId: string,
  orderId: string,
): Promise<PosReturnableSale> {
  if (!tenantId || !orderId) throw new Error('Business and completed sale are required.');
  const { data, error } = await supabase.rpc('get_sellertray_pos_returnable_items', {
    p_tenant_id: tenantId,
    p_order_id: orderId,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SellerTray returned invalid returnable sale details.');
  }

  const row = data as Record<string, unknown>;
  const returnStatus = row.returnStatus;
  const returnedAmount = numberOrUndefined(row.returnedAmount);
  const remainingAmount = numberOrUndefined(row.remainingAmount);
  const confirmedPaymentAmount = numberOrUndefined(row.confirmedPaymentAmount);
  const priorRefundAmount = numberOrUndefined(row.priorRefundAmount);
  const netMoneyRetained = numberOrUndefined(row.netMoneyRetained);
  const outstandingAmount = numberOrUndefined(row.outstandingAmount);
  const cashRefundAvailableAmount = numberOrUndefined(row.cashRefundAvailableAmount);
  if (
    typeof row.orderId !== 'string'
    || typeof row.publicOrderId !== 'string'
    || typeof row.currency !== 'string'
    || (returnStatus !== 'none' && returnStatus !== 'partial' && returnStatus !== 'returned')
    || returnedAmount === undefined
    || remainingAmount === undefined
    || confirmedPaymentAmount === undefined
    || priorRefundAmount === undefined
    || netMoneyRetained === undefined
    || outstandingAmount === undefined
    || cashRefundAvailableAmount === undefined
    || !Array.isArray(row.bankAccounts)
    || !Array.isArray(row.items)
  ) {
    throw new Error('SellerTray returned invalid returnable sale details.');
  }

  const items = row.items.map((value) => mapReturnableItem(value));
  return {
    orderId: row.orderId,
    publicOrderId: row.publicOrderId,
    currency: row.currency,
    returnStatus,
    returnedAmount,
    remainingAmount,
    confirmedPaymentAmount,
    priorRefundAmount,
    netMoneyRetained,
    outstandingAmount,
    canCompleteMonetaryRefund: row.canCompleteMonetaryRefund === true,
    cashRefundAvailableAmount,
    bankAccounts: row.bankAccounts.map(mapRefundBankAccount),
    items,
  };
}

export async function returnPosSaleItems(input: {
  tenantId: string;
  orderId: string;
  reason: string;
  items: PosReturnItemInput[];
  commandId: string;
  refundSource?: PosRefundSource | null;
  refundPaymentMethodId?: string | null;
}): Promise<PosSaleActionResult> {
  const reason = input.reason.trim();
  if (!reason) throw new Error('Enter a reason before continuing.');
  if (!input.commandId.trim()) throw new Error('Restart this return and try again.');
  if (!input.items.length || input.items.some((item) => !item.orderItemId || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
    throw new Error('Choose at least one item quantity to return.');
  }
  if (input.refundSource === 'bank' && !input.refundPaymentMethodId) {
    throw new Error('Choose the Business bank account for this refund.');
  }

  return invokeSaleAction({
    tenantId: input.tenantId,
    orderId: input.orderId,
    action: 'return',
    reason,
    items: input.items,
    commandId: input.commandId,
    refundSource: input.refundSource ?? null,
    refundPaymentMethodId: input.refundSource === 'bank' ? input.refundPaymentMethodId ?? null : null,
  });
}

export async function deletePosDraft(input: {
  tenantId: string;
  orderId: string;
  reason: string;
  commandId: string;
}): Promise<PosDraftDeletionResult> {
  const reason = input.reason.trim();
  if (!reason) throw new Error('Enter a reason before deleting this draft.');
  if (!input.commandId.trim()) throw new Error('Restart this deletion and try again.');

  const data = await invokeRawAction({
    tenantId: input.tenantId,
    orderId: input.orderId,
    action: 'delete_draft',
    reason,
    commandId: input.commandId,
  });
  if (data.deleted !== true || typeof data.deletedAt !== 'string') {
    throw new Error('SellerTray did not confirm the draft was deleted.');
  }
  return {
    orderId: data.orderId as string,
    deleted: true,
    deletedAt: data.deletedAt,
    idempotentReplay: data.idempotentReplay as boolean,
  };
}

export function createPosCommandId(action: 'return' | 'delete_draft', orderId: string): string {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `pos-${action}:${orderId}:${suffix}`;
}

export async function applyPosSaleAction(input: {
  tenantId: string;
  orderId: string;
  action: PosSaleAction;
  reason: string;
}): Promise<PosSaleActionResult> {
  const reason = input.reason.trim();
  if (!reason) throw new Error('Enter a reason before continuing.');

  if (input.action === 'return') {
    const returnable = await loadPosReturnableItems(input.tenantId, input.orderId);
    return returnPosSaleItems({
      tenantId: input.tenantId,
      orderId: input.orderId,
      reason,
      commandId: createPosCommandId('return', input.orderId),
      refundSource: 'cash',
      items: returnable.items.map((item) => ({
        orderItemId: item.orderItemId,
        quantity: item.remainingQuantity,
      })),
    });
  }

  return invokeSaleAction({
    tenantId: input.tenantId,
    orderId: input.orderId,
    action: input.action,
    reason,
  });
}

async function invokeSaleAction(input: {
  tenantId: string;
  orderId: string;
  action: PosSaleAction;
  reason: string;
  items?: PosReturnItemInput[];
  commandId?: string;
  refundSource?: PosRefundSource | null;
  refundPaymentMethodId?: string | null;
}): Promise<PosSaleActionResult> {
  const row = await invokeRawAction(input);

  if (input.action === 'void' && row.status !== 'cancelled') {
    throw new Error('SellerTray did not confirm the sale was voided.');
  }
  if (
    input.action === 'return'
    && ((row.returnStatus !== 'partial' && row.returnStatus !== 'returned')
      || typeof row.returnId !== 'string'
      || (row.refundId !== null && row.refundId !== undefined && typeof row.refundId !== 'string')
      || numberOrUndefined(row.returnedValue) === undefined
      || numberOrUndefined(row.receivableReductionAmount) === undefined
      || numberOrUndefined(row.refundedAmount) === undefined
      || numberOrUndefined(row.outstandingAfter) === undefined)
  ) {
    throw new Error('SellerTray did not confirm the sale return.');
  }

  return {
    action: input.action,
    orderId: row.orderId as string,
    idempotentReplay: row.idempotentReplay as boolean,
    status: row.status === 'cancelled' ? 'cancelled' : undefined,
    returnId: typeof row.returnId === 'string' ? row.returnId : undefined,
    refundId: typeof row.refundId === 'string' ? row.refundId : row.refundId === null ? null : undefined,
    returnStatus: row.returnStatus === 'partial' || row.returnStatus === 'returned' ? row.returnStatus : undefined,
    returnSubtotal: numberOrUndefined(row.returnSubtotal),
    returnTax: numberOrUndefined(row.returnTax),
    returnedValue: numberOrUndefined(row.returnedValue),
    receivableReductionAmount: numberOrUndefined(row.receivableReductionAmount),
    refundedAmount: numberOrUndefined(row.refundedAmount),
    outstandingBefore: numberOrUndefined(row.outstandingBefore),
    outstandingAfter: numberOrUndefined(row.outstandingAfter),
    returnedAmount: numberOrUndefined(row.returnedAmount),
    refundSource: row.refundSource === 'cash' || row.refundSource === 'bank' ? row.refundSource : null,
    refundPaymentMethodId: typeof row.refundPaymentMethodId === 'string' ? row.refundPaymentMethodId : null,
    currency: typeof row.currency === 'string' ? row.currency : undefined,
  };
}

async function invokeRawAction(input: {
  tenantId: string;
  orderId: string;
  action: PosSaleAction | 'delete_draft';
  reason: string;
  items?: PosReturnItemInput[];
  commandId?: string;
  refundSource?: PosRefundSource | null;
  refundPaymentMethodId?: string | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('pos-return', {
    body: {
      tenantId: input.tenantId,
      orderId: input.orderId,
      action: input.action,
      reason: input.reason,
      ...(input.items ? { items: input.items } : {}),
      ...(input.commandId ? { commandId: input.commandId } : {}),
      ...(input.refundSource ? { refundSource: input.refundSource } : {}),
      ...(input.refundPaymentMethodId ? { refundPaymentMethodId: input.refundPaymentMethodId } : {}),
    },
  });

  if (error) {
    let message = error.message || `Unable to ${input.action} this sale.`;
    if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
      try {
        const payload = await (error.context as Response).clone().json() as { error?: string };
        if (payload?.error) message = payload.error;
      } catch {
        // Keep the SDK message.
      }
    }
    throw new Error(message);
  }

  if (!data || typeof data !== 'object' || data.ok !== true || data.action !== input.action) {
    throw new Error('SellerTray returned an invalid sale action result.');
  }

  const row = data as Record<string, unknown>;
  if (typeof row.orderId !== 'string' || typeof row.idempotentReplay !== 'boolean') {
    throw new Error('SellerTray returned an invalid sale action result.');
  }
  return row;
}

function mapRefundBankAccount(value: unknown): PosRefundBankAccount {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (typeof row.id !== 'string') throw new Error('SellerTray returned an invalid refund bank account.');
  return {
    id: row.id,
    displayName: String(row.displayName ?? 'Business bank'),
    bankName: String(row.bankName ?? ''),
    accountName: String(row.accountName ?? ''),
    accountNumber: String(row.accountNumber ?? ''),
  };
}

function mapReturnableItem(value: unknown): PosReturnableItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SellerTray returned an invalid returnable item.');
  }
  const row = value as Record<string, unknown>;
  const soldQuantity = numberOrUndefined(row.soldQuantity);
  const returnedQuantity = numberOrUndefined(row.returnedQuantity);
  const remainingQuantity = numberOrUndefined(row.remainingQuantity);
  const unitPrice = numberOrUndefined(row.unitPrice);
  const remainingValue = numberOrUndefined(row.remainingValue);
  if (
    typeof row.orderItemId !== 'string'
    || typeof row.catalogItemId !== 'string'
    || typeof row.name !== 'string'
    || typeof row.selectedUom !== 'string'
    || soldQuantity === undefined
    || returnedQuantity === undefined
    || remainingQuantity === undefined
    || unitPrice === undefined
    || remainingValue === undefined
  ) {
    throw new Error('SellerTray returned an invalid returnable item.');
  }
  return {
    orderItemId: row.orderItemId,
    catalogItemId: row.catalogItemId,
    name: row.name,
    selectedUom: row.selectedUom,
    soldQuantity,
    returnedQuantity,
    remainingQuantity,
    unitPrice,
    remainingValue,
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
