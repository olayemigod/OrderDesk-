import type { MerchantBusiness } from '../data/businessRepository';
import type { OrderFinancialDocument, OrderPaymentAttempt } from '../data/orderPaymentsRepository';
import type { PrinterReceiptSettings, SellerTrayPrinter } from '../data/printerRepository';
import type { MerchantOrder } from '../domain/order';
import { orderPaymentLabel, orderTotal } from '../domain/order';
import { sendBluetoothPrintBytes } from './bluetoothPrinter';
import {
  buildEscPosPrintBytes,
  type PaymentReceiptPrintSnapshot,
  type SalesInvoicePrintSnapshot,
} from './escPosReceipt';

const MONEY_EPSILON = 0.005;

export function buildSalesInvoiceSnapshot(input: {
  business: MerchantBusiness;
  order: MerchantOrder;
  invoice: OrderFinancialDocument;
}): SalesInvoicePrintSnapshot {
  const { business, order, invoice } = input;
  if (invoice.documentType !== 'invoice' || invoice.status !== 'issued') {
    throw new Error('This sale does not have an issued Sales Invoice.');
  }
  const orderGrandTotal = orderTotal(order);
  if (orderGrandTotal === null) throw new Error('This Sales Invoice cannot print until pricing is complete.');
  const items = order.items.map((item) => {
    if (item.unitPrice === null) throw new Error('This Sales Invoice cannot print until pricing is complete.');
    return {
      name: item.name,
      quantity: item.quantity,
      uom: item.selectedUom,
      unitPrice: item.unitPrice,
      lineTotal: roundMoney(item.quantity * item.unitPrice),
    };
  });
  const itemSubtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const subtotal = validMoney(order.subtotalAmount) ? order.subtotalAmount! : itemSubtotal;
  const gross = invoice.amount;
  const taxAmount = validMoney(order.taxAmount) ? order.taxAmount! : roundMoney(Math.max(gross - subtotal, 0));
  if (Math.abs(orderGrandTotal - gross) > 0.01) {
    throw new Error('The Sales Invoice total does not match the governed sale total. Refresh this sale before printing.');
  }

  return {
    formatVersion: 1,
    documentType: 'sales_invoice',
    businessName: business.name,
    businessEmail: business.businessEmail,
    businessPhone: business.businessPhone,
    branchName: order.branchName,
    cashierName: order.posOperatorName,
    orderReference: order.publicOrderId,
    invoiceReference: invoice.documentReference,
    issuedAt: invoice.issuedAt,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    currency: invoice.currency,
    subtotalAmount: subtotal,
    taxApplied: order.taxApplied === true || taxAmount > MONEY_EPSILON,
    taxRatePercent: validMoney(order.taxRatePercent) ? order.taxRatePercent! : 0,
    taxAmount,
    taxDisplayBreakdown: order.taxDisplayBreakdown !== false,
    grossAmount: gross,
    paymentLabel: originalInvoicePaymentLabel(order),
    fulfillmentLabel: titleCase(order.fulfillmentStatus),
    items,
    platformAttribution: 'Powered by SellerTray',
  };
}

export function buildPaymentReceiptSnapshot(input: {
  business: MerchantBusiness;
  order: MerchantOrder;
  payment: OrderPaymentAttempt;
  copyLabel?: string;
  merchantFooter?: string | null;
}): PaymentReceiptPrintSnapshot {
  const { business, order, payment } = input;
  if (payment.status !== 'confirmed' || payment.exceptionState !== 'none') {
    throw new Error('Only a confirmed payment can be printed as a Payment Receipt.');
  }

  return {
    formatVersion: 1,
    documentType: 'payment_receipt',
    businessName: business.name,
    businessEmail: business.businessEmail,
    businessPhone: business.businessPhone,
    branchName: order.branchName,
    cashierName: order.posOperatorName,
    orderReference: order.publicOrderId,
    paymentId: payment.id,
    paymentReference: payment.providerReference ?? payment.providerTransactionId,
    issuedAt: payment.confirmedAt ?? payment.createdAt,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    currency: payment.currency,
    amountReceived: payment.amount,
    paymentMethod: payment.methodType,
    paymentProvider: payment.provider,
    paymentLabel: orderPaymentLabel(order),
    fulfillmentLabel: titleCase(order.fulfillmentStatus),
    copyLabel: input.copyLabel,
    merchantFooter: input.merchantFooter ?? null,
    platformAttribution: 'Powered by SellerTray',
  };
}

export async function printSalesInvoiceDocument(
  printer: SellerTrayPrinter,
  snapshot: SalesInvoicePrintSnapshot,
): Promise<void> {
  const bytes = buildEscPosPrintBytes(snapshot, printer.paperWidthMm);
  await sendBluetoothPrintBytes(printer.hardwareIdentifier, bytes);
}

export async function printPaymentReceiptDocument(
  printer: SellerTrayPrinter,
  settings: PrinterReceiptSettings,
  input: Omit<Parameters<typeof buildPaymentReceiptSnapshot>[0], 'copyLabel' | 'merchantFooter'>,
): Promise<void> {
  const copies = settings.copyDefinitions.length > 0
    ? [...settings.copyDefinitions].sort((a, b) => a.sortOrder - b.sortOrder)
    : [{ type: 'customer' as const, label: 'Customer Copy', sortOrder: 1 }];
  for (const copy of copies) {
    const snapshot = buildPaymentReceiptSnapshot({
      ...input,
      copyLabel: copy.label,
      merchantFooter: settings.merchantFooter,
    });
    const bytes = buildEscPosPrintBytes(snapshot, printer.paperWidthMm);
    await sendBluetoothPrintBytes(printer.hardwareIdentifier, bytes);
  }
}

function originalInvoicePaymentLabel(order: MerchantOrder): string {
  if (order.paymentTerms === 'partial') return 'Partial';
  if (order.paymentTerms === 'pay_later') return 'Pay later';
  return orderPaymentLabel(order);
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').split(' ').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function validMoney(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
