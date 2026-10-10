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
    finance.includes("rpc('record_sellertray_supplier_payment'"),
  'Supplier finance must use the shared balance, payment-summary and payment-recording commands.',
);

requireValue(
  !finance.includes("from('supplier_payments').insert") &&
    !finance.includes("from('supplier_payments').update") &&
    !finance.includes("from('supplier_payments').delete") &&
    !finance.includes("from('purchase_receipt_items')") &&
    !finance.includes("from('inventory_movements')"),
  'Merchant Web must not bypass Supplier payment or received-value commands with raw browser writes.',
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

if (failures.length) {
  console.error('SellerTray Purchasing finance preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Purchasing finance preflight passed.');
