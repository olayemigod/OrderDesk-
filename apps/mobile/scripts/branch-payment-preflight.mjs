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
const authorityMigration = read(join(repoRoot, 'supabase/migrations/20261014190000_payment_operation_branch_authority.sql'));
const actionAuthorityReader = read(join(repoRoot, 'supabase/migrations/20261014190500_payment_action_authority_reader.sql'));
const finalAuthorityMigration = read(join(repoRoot, 'supabase/migrations/20261014191000_pos_checkout_payment_authority_compatibility.sql'));
const paymentMethodsRepository = read(join(mobileRoot, 'src/data/paymentMethodsRepository.ts'));
const orderPaymentsRepository = read(join(mobileRoot, 'src/data/orderPaymentsRepository.ts'));
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
  authorityMigration.includes('sellertray_user_can_manage_order_payment') &&
    authorityMigration.includes("public.confirm_sellertray_offline_payment") &&
    authorityMigration.includes('public.sellertray_user_can_manage_order_payment(') &&
    authorityMigration.includes('public.finalize_sellertray_pos_confirmed_payment('),
  'Manual confirmation must reuse the shared payment authority boundary without losing POS transfer settlement',
);
requireValue(
  finalAuthorityMigration.includes('sellertray_user_can_manage_order_payment') &&
    finalAuthorityMigration.includes('sellertray_user_can_operate_branch') &&
    finalAuthorityMigration.includes("o.source='pos'") &&
    finalAuthorityMigration.includes("'can_manage_payments'") &&
    finalAuthorityMigration.includes('sellertray_user_has_capability'),
  'Final payment authority must preserve POS Branch-operator settlement while requiring payment capability for non-POS payment management',
);
requireValue(
  finalAuthorityMigration.indexOf('sellertray_user_can_operate_branch') < finalAuthorityMigration.indexOf("o.source='pos'") &&
    finalAuthorityMigration.indexOf("o.source='pos'") < finalAuthorityMigration.indexOf("'can_manage_payments'"),
  'Final payment authority must always enforce Branch operation before the POS-or-payment-capability split',
);
requireValue(
  actionAuthorityReader.includes('get_sellertray_order_payment_authority') &&
    actionAuthorityReader.includes('auth.uid()') &&
    actionAuthorityReader.includes('sellertray_user_can_manage_order_payment') &&
    actionAuthorityReader.includes('to authenticated,service_role'),
  'Mobile action authority reader must bind the decision to the signed-in user without exposing the internal predicate',
);
requireValue(
  paymentMethodsRepository.includes("supabase.rpc('get_sellertray_branch_customer_payment_methods'") &&
    paymentMethodsRepository.includes('p_branch_id: branchId'),
  'Mobile payment repository must load customer payment methods through the guarded Branch RPC',
);
requireValue(
  orderPaymentsRepository.includes("supabase.rpc('get_sellertray_order_payment_authority'") &&
    orderPaymentsRepository.includes('p_tenant_id: tenantId') &&
    orderPaymentsRepository.includes('p_order_id: orderId'),
  'Mobile payment actions must query current-user payment authority through the authenticated reader',
);
requireValue(
  orderPaymentPanel.includes('loadBranchCustomerPaymentMethods(tenantId, order.branchId)') &&
    !orderPaymentPanel.includes('loadPaymentMethods(tenantId)'),
  'Order payment panel must use the order Branch instead of tenant-wide payment methods',
);
requireValue(
  orderPaymentPanel.includes('allowed = await canManageOrderPayment(tenantId, order.id)') &&
    orderPaymentPanel.includes("if (allowed && order.source !== 'pos')") &&
    orderPaymentPanel.includes("displayedPaymentStatus !== 'paid' && canManagePaymentActions") &&
    orderPaymentPanel.includes('const confirmable = canManagePaymentActions && offline') &&
    orderPaymentPanel.includes('const verifiable = canManagePaymentActions && gateway'),
  'Order payment panel must preserve read-only history while hiding payment mutations when authority is unavailable',
);
requireValue(
  merchantPaymentOperations.includes("rpc<Array<{ method_type: string; display_name: string }>>('sellertray_branch_customer_payment_methods'") &&
    merchantPaymentOperations.includes('p_branch_id: order.branch_id') &&
    !merchantPaymentOperations.includes('/rest/v1/merchant_payment_methods?select=method_type,display_name'),
  'Merchant-triggered WhatsApp payment options must be Branch-scoped',
);
requireValue(
  merchantPaymentOperations.includes("rpc<boolean>('sellertray_user_can_manage_order_payment'") &&
    merchantPaymentOperations.includes('p_order_id: orderId') &&
    merchantPaymentOperations.split('await assertHumanPaymentAuthority(tenantId, userId, order)').length >= 5 &&
    merchantPaymentOperations.includes('select=id,tenant_id,branch_id,source,payment_status'),
  'Merchant payment mutations must use the shared order payment authority boundary',
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
requireValue(
  !whatsappPayment.includes('sellertray_user_can_manage_order_payment'),
  'Customer WhatsApp payment self-service must not inherit human merchant payment authority checks',
);

if (failures.length > 0) {
  console.error('SellerTray Branch payment preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Branch payment preflight passed.');
