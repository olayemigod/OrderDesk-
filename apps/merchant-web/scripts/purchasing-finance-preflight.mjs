import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const management = readFileSync(resolve(root, 'src/ManagementPage.tsx'), 'utf8');
const finance = readFileSync(resolve(root, 'src/SupplierFinanceManagement.tsx'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  management.includes("import SupplierFinanceManagement from './SupplierFinanceManagement'") &&
    management.includes('Supplier Balances') &&
    management.includes('<SupplierFinanceManagement tenantId={tenantId} currency={currency} />'),
  'Supplier Balances must remain reachable from the governed Purchasing management area.',
);

requireValue(
  finance.includes("rpc('get_sellertray_supplier_balances'") &&
    finance.includes("rpc('get_sellertray_supplier_payment_summary'") &&
    finance.includes("rpc('record_sellertray_supplier_payment'") &&
    finance.includes("rpc('reverse_sellertray_supplier_payment'"),
  'Supplier finance must use the shared balance, payment-summary, payment-recording and reversal commands.',
);

requireValue(
  !finance.includes("from('supplier_payments').insert") &&
    !finance.includes("from('supplier_payments').update") &&
    !finance.includes("from('supplier_payments').delete") &&
    !finance.includes("from('supplier_payment_reversals').insert") &&
    !finance.includes("from('supplier_payment_reversals').update") &&
    !finance.includes("from('supplier_payment_reversals').delete") &&
    !finance.includes("from('purchase_receipt_items')") &&
    !finance.includes("from('inventory_movements')"),
  'Merchant Web must not bypass Supplier payment, reversal or received-value commands with raw browser writes.',
);

requireValue(
  finance.includes("'bank_transfer' | 'card' | 'other'") &&
    finance.includes('Cash paid from a register is not recorded here') &&
    !finance.includes('<option value="cash">'),
  'Supplier finance must keep cash-drawer mutation outside this payment evidence slice.',
);

requireValue(
  finance.includes('Outstanding is based on stock actually received') &&
    finance.includes('Record a payment only when the Supplier has actually been paid.'),
  'Supplier finance must explain received-value outstanding and evidence-based payment recording.',
);

requireValue(
  finance.includes('Reverse payment') &&
    finance.includes('Enter the reason for reversing this Supplier payment.') &&
    finance.includes('The original payment remains in history') &&
    finance.includes('Recorded Supplier payments are never edited or deleted.'),
  'Supplier finance must expose correction only through reasoned compensating reversal while retaining original evidence.',
);

requireValue(
  finance.includes('type="date" max={today()}') &&
    finance.includes("reversed: payment.reversed === true") &&
    finance.includes('reversalReason') &&
    finance.includes('reversedAt'),
  'Supplier finance must block future payment dates and display reversal state from the shared summary.',
);

if (failures.length) {
  console.error('SellerTray Purchasing finance preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Purchasing finance preflight passed.');
