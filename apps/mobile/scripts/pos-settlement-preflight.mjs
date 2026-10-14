import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mobileRoot = process.cwd();
const repoRoot = resolve(mobileRoot, '../..');
const failures = [];

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const commerceRepository = read(join(mobileRoot, 'src/data/commerceRepository.ts'));
const sellWorkspace = read(join(mobileRoot, 'src/redesign/SellWorkspace.tsx'));
const orderPaymentPanel = read(join(mobileRoot, 'src/components/OrderPaymentPanel.tsx'));
const paymentReconciliationPanel = read(join(mobileRoot, 'src/components/PaymentReconciliationPanel.tsx'));
const settlementMigration = read(join(repoRoot, 'supabase/migrations/20261014181500_pos_bank_transfer_settlement_convergence.sql'));
const checkoutFunction = read(join(repoRoot, 'supabase/functions/pos-checkout/index.ts'));
const merchantPaymentOperations = read(join(repoRoot, 'supabase/functions/merchant-payment-operations/index.ts'));

requireValue(
  settlementMigration.includes("'status','awaiting_payment_confirmation'") &&
    settlementMigration.includes("'paymentStatus','unpaid'") &&
    settlementMigration.includes("'inventoryMovementCount',0"),
  'POS bank-transfer initiation must remain unpaid and must not move stock',
);
requireValue(
  checkoutFunction.includes("row.status==='awaiting_payment_confirmation'") &&
    checkoutFunction.includes("row.paymentStatus==='unpaid'"),
  'pos-checkout must continue accepting the pending bank-transfer settlement result',
);
requireValue(
  commerceRepository.includes("status: 'awaiting_payment_confirmation'") &&
    commerceRepository.includes("paymentStatus: 'unpaid'") &&
    commerceRepository.includes("row.status === 'awaiting_payment_confirmation'") &&
    commerceRepository.includes("row.inventoryMovementCount === 0"),
  'Mobile commerce repository must model and validate the pending bank-transfer result',
);
requireValue(
  sellWorkspace.includes("checkout.status === 'awaiting_payment_confirmation'") &&
    sellWorkspace.includes('Record for verification') &&
    sellWorkspace.includes('stock has not been deducted') &&
    sellWorkspace.includes('Confirm the transfer in Payment inbox before handing over goods'),
  'Sell workspace must keep pending bank transfers visibly unpaid and unfulfilled',
);
requireValue(
  !sellWorkspace.includes('Confirm the transfer has reached this account') &&
    sellWorkspace.includes('Record transfer and verify received funds before fulfilment'),
  'Sell workspace bank-transfer copy must not imply that recording the claim confirms settlement',
);
requireValue(
  paymentReconciliationPanel.includes('POS bank-transfer sale awaiting settlement') &&
    paymentReconciliationPanel.includes('rechecks stock, completes collection and deducts stock') &&
    !paymentReconciliationPanel.includes('will not change order or fulfilment state'),
  'Payment inbox confirmation copy must match governed POS bank-transfer finalisation',
);

const posRecordGuard = merchantPaymentOperations.indexOf("if (order.source === 'pos')");
const createOfflinePayment = merchantPaymentOperations.indexOf("create_sellertray_order_payment_for_method");
const paymentCapabilityCheck = merchantPaymentOperations.indexOf("p_capability: 'can_manage_payments'");
requireValue(
  posRecordGuard >= 0 && createOfflinePayment >= 0 && posRecordGuard < createOfflinePayment,
  'Merchant payment operations must reject POS record_offline before a duplicate payment can be created',
);
requireValue(
  paymentCapabilityCheck >= 0 && createOfflinePayment >= 0 && paymentCapabilityCheck < createOfflinePayment,
  'Merchant payment operations must authorize payment recording before creating a payment attempt',
);
requireValue(
  orderPaymentPanel.includes("const canRecordNewOfflinePayment = order.source !== 'pos'") &&
    orderPaymentPanel.includes("if (order.source === 'pos') return;") &&
    orderPaymentPanel.includes('confirm the existing POS transfer attempt') === false &&
    orderPaymentPanel.includes('Confirm that existing transfer below') &&
    orderPaymentPanel.includes('recheck stock, mark the payment paid, complete collection, deduct stock'),
  'Order payment panel must confirm the existing POS payment instead of recording a second one',
);
requireValue(
  orderPaymentPanel.includes("const displayedPaymentStatus: MerchantOrder['paymentStatus'] = receipt ? 'paid' : order.paymentStatus") &&
    orderPaymentPanel.includes('const displayedAmountPaid = receipt?.amount ?? order.amountPaid'),
  'Order payment panel must reflect a newly issued receipt without waiting for a parent-order reload',
);

if (failures.length > 0) {
  console.error('SellerTray POS settlement preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray POS settlement preflight passed.');
