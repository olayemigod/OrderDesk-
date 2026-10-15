import type { CommerceProduct, CommerceUom } from '../data/commerceRepository';
import type { MerchantOrder } from '../domain/order';

export type ResumedPosDraftLine = {
  key: string;
  orderItemId: string;
  product: CommerceProduct;
  uom: CommerceUom;
  quantity: number;
};

export type ResumedPosDraft = {
  orderId: string;
  branchId: string;
  customer: { id: string; name: string; phone: string } | null;
  lines: ResumedPosDraftLine[];
};

export function buildResumedPosDraft(order: MerchantOrder, products: CommerceProduct[]): ResumedPosDraft {
  if (order.source !== 'pos' || order.status !== 'draft' || order.paymentStatus !== 'unpaid' || order.amountPaid !== 0) {
    throw new Error('Only an unpaid saved POS sale can be resumed.');
  }
  if (!order.branchId) throw new Error('This saved sale has no Branch and cannot be resumed.');
  if (!order.items.length) throw new Error('This saved sale has no products to resume.');

  const productsById = new Map(products.map((product) => [product.id, product]));
  const usedKeys = new Set<string>();
  const lines = order.items.map((item) => {
    if (!item.catalogItemId) {
      throw new Error(`${item.name} is not linked to a Product and cannot be resumed in Sell.`);
    }
    const product = productsById.get(item.catalogItemId);
    if (!product || !product.isActive) {
      throw new Error(`${item.name} is no longer available for sale.`);
    }

    const uomName = item.selectedUom.trim().toLowerCase();
    const matches = product.uoms.filter((candidate) => candidate.name.trim().toLowerCase() === uomName);
    const uom = matches[0];
    if (matches.length !== 1 || !uom || uom.sellingPrice === null) {
      throw new Error(`The selling unit for ${item.name} is no longer available.`);
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error(`${item.name} has an invalid quantity.`);
    }
    if (!uom.allowFractional && item.quantity !== Math.trunc(item.quantity)) {
      throw new Error(`${uom.name} does not allow fractional quantity.`);
    }

    const key = `${product.id}:${uom.id}`;
    if (usedKeys.has(key)) {
      throw new Error(`${product.name} has duplicate ${uom.name} lines. Edit this draft from Orders before resuming it.`);
    }
    usedKeys.add(key);
    return { key, orderItemId: item.id, product, uom, quantity: item.quantity };
  });

  return {
    orderId: order.id,
    branchId: order.branchId,
    customer: order.customerId
      ? { id: order.customerId, name: order.customerName, phone: order.customerPhone }
      : null,
    lines,
  };
}

export function buildResumedPosDraftEdits(
  order: MerchantOrder,
  lines: ResumedPosDraftLine[],
): Array<{ orderItemId: string; quantity: number }> {
  const quantityByItemId = new Map(lines.map((line) => [line.orderItemId, line.quantity]));
  if (lines.some((line) => !order.items.some((item) => item.id === line.orderItemId))) {
    throw new Error('This saved sale contains a product that is not part of the original draft.');
  }
  const edits = order.items.map((item) => ({
    orderItemId: item.id,
    quantity: quantityByItemId.get(item.id) ?? 0,
  }));
  if (!edits.some((item) => item.quantity > 0)) {
    throw new Error('Keep at least one product in the saved sale.');
  }
  return edits;
}
