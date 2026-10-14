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
const paymentReconciliationPanel = read(join(mobileRoot, 'src/components/PaymentReconciliationPanel.tsx'));
const settlementMigration = read(join(repoRoot, 'supabase/migrations/20261014181500_pos_bank_transfer_settlement_convergence.sql'));
const checkoutFunction = read(join(repoRoot, 'supabase/functions/pos-checkout/index.ts'));

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

if (failures.length > 0) {
  console.error('SellerTray POS settlement preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray POS settlement preflight passed.');
