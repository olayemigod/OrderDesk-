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

const migration = read(join(repoRoot, 'supabase/migrations/20261014184500_branch_customer_payment_convergence.sql'));
const paymentMethodsRepository = read(join(mobileRoot, 'src/data/paymentMethodsRepository.ts'));
const orderPaymentPanel = read(join(mobileRoot, 'src/components/OrderPaymentPanel.tsx'));
const merchantPaymentOperations = read(join(repoRoot, 'supabase/functions/merchant-payment-operations/index.ts'));
const whatsappPayment = read(join(repoRoot, 'supabase/functions/whatsapp-webhook/payment.ts'));

requireValue(
  migration.includes('sellertray_branch_customer_payment_methods') &&
    migration.includes('get_sellertray_branch_customer_payment_methods') &&
    migration.includes('sellertray_branch_payment_methods') &&
    migration.includes('SellerTray payment method is not available for this Branch'),
  'Database payment creation and discovery must enforce the order Branch assignment',
);
requireValue(
  migration.includes("m.method_type in (\n      'bank_transfer','paystack','flutterwave','cash_on_delivery','pay_on_pickup'\n    )") &&
    !migration.match(/sellertray_branch_customer_payment_methods[\s\S]*m\.method_type in \([^)]*card_terminal/),
  'Customer payment discovery must exclude in-person card terminals',
);
requireValue(
  paymentMethodsRepository.includes("supabase.rpc('get_sellertray_branch_customer_payment_methods'") &&
    paymentMethodsRepository.includes('p_branch_id: branchId'),
  'Mobile payment repository must load customer payment methods through the guarded Branch RPC',
);
requireValue(
  orderPaymentPanel.includes('loadBranchCustomerPaymentMethods(tenantId, order.branchId)') &&
    !orderPaymentPanel.includes('loadPaymentMethods(tenantId)'),
  'Order payment panel must use the order Branch instead of tenant-wide payment methods',
);
requireValue(
  merchantPaymentOperations.includes("rpc<Array<{ method_type: string; display_name: string }>>('sellertray_branch_customer_payment_methods'") &&
    merchantPaymentOperations.includes('p_branch_id: order.branch_id') &&
    !merchantPaymentOperations.includes('/rest/v1/merchant_payment_methods?select=method_type,display_name'),
  'Merchant-triggered WhatsApp payment options must be Branch-scoped',
);
requireValue(
  whatsappPayment.includes('branch_id: string;') &&
    whatsappPayment.includes('select=id,branch_id,customer_id,public_order_id,status,payment_status') &&
    whatsappPayment.split('loadMethods(input.tenantId, order.branch_id)').length >= 3,
  'WhatsApp customer payment listing and selection must use the order Branch',
);
requireValue(
  whatsappPayment.includes("rpc<PaymentMethod[]>('sellertray_branch_customer_payment_methods'") &&
    !whatsappPayment.includes('/rest/v1/merchant_payment_methods?select=id,method_type,display_name'),
  'WhatsApp customer payment discovery must use the shared service Branch reader',
);

if (failures.length > 0) {
  console.error('SellerTray Branch payment preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Branch payment preflight passed.');
