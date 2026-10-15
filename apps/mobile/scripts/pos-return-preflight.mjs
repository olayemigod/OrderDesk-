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

const domain = read(join(mobileRoot, 'src/domain/order.ts'));
const ordersRepository = read(join(mobileRoot, 'src/data/ordersRepository.ts'));
const ordersWorkspace = read(join(mobileRoot, 'src/redesign/OrdersWorkspace.tsx'));
const redesignWorkspace = read(join(mobileRoot, 'src/redesign/RedesignWorkspace.tsx'));
const posReturnEdge = read(join(repoRoot, 'supabase/functions/pos-return/index.ts'));
const returnMigration = read(join(repoRoot, 'supabase/migrations/20261009194500_pos_void_and_cash_return.sql'));
const refundAuthorityMigration = read(join(repoRoot, 'supabase/migrations/20261014203000_pos_refund_authority_convergence.sql'));
const shiftReconciliationMigration = read(join(repoRoot, 'supabase/migrations/20261014202000_pos_cash_shift_reconciliation.sql'));
const teamManagementWeb = read(join(repoRoot, 'apps/merchant-web/src/TeamBranchesManagement.tsx'));

requireValue(
  domain.includes('cashReturnSupported?: boolean;'),
  'Order read model must expose whether the current full POS cash return is supported',
);
requireValue(
  ordersRepository.includes(".from('order_payments')")
    && ordersRepository.includes(".select('order_id,method_type,provider,status,amount,currency')")
    && ordersRepository.includes("payment.status === 'confirmed'")
    && ordersRepository.includes("confirmedPayment.method_type === 'cash'")
    && ordersRepository.includes("confirmedPayment.provider === 'pos_cash'")
    && ordersRepository.includes('confirmedPayments.length === 1'),
  'Order loading must derive cash-return support from one confirmed POS cash payment rather than payment_status alone',
);
requireValue(
  ordersRepository.includes("table: 'order_payments'") && ordersRepository.includes('cashReturnSupported,'),
  'Order return eligibility must refresh when payment evidence changes',
);
requireValue(
  ordersWorkspace.includes('order.cashReturnSupported === true')
    && ordersWorkspace.includes('order.cashReturnSupported !== true')
    && ordersWorkspace.includes('This sale was paid outside the cash drawer. Review the payment before processing a refund.'),
  'Orders UI must show the cash-return action only for supported cash sales and explain non-cash refund review',
);
requireValue(
  redesignWorkspace.includes("get_sellertray_pos_return_authority")
    && redesignWorkspace.includes('canReturnCompletedSale={canRefundSale && Boolean(activeCashShift)}'),
  'Mobile return visibility must use governed refund capability plus the active cashier shift',
);
requireValue(
  !posReturnEdge.includes("membership.role !== 'owner'")
    && !posReturnEdge.includes("membership.role !== 'manager'")
    && posReturnEdge.includes('return_sellertray_pos_cash_sale'),
  'POS return edge adapter must delegate refund authority to the governed domain command instead of hard-coding roles',
);
requireValue(
  refundAuthorityMigration.includes("'can_refund_sale'")
    && refundAuthorityMigration.includes('sellertray_user_can_operate_branch')
    && refundAuthorityMigration.includes('create or replace function public.get_sellertray_pos_return_authority')
    && refundAuthorityMigration.includes('create or replace function public.apply_sellertray_pos_cash_return_internal')
    && refundAuthorityMigration.includes('create or replace function public.return_sellertray_pos_cash_sale'),
  'Refund authority migration must enforce capability and Branch authority in both the reader and return command',
);
requireValue(
  teamManagementWeb.includes("'can_refund_sale'")
    && teamManagementWeb.includes('Refund completed sales'),
  'Merchant Web permission management must expose refund authority with merchant-facing wording',
);
requireValue(
  posReturnEdge.includes('return_sellertray_pos_cash_sale')
    && returnMigration.includes("p.method_type='cash' and p.provider='pos_cash' and p.status='confirmed'")
    && returnMigration.includes("'sale_return',v_line.stock_quantity,v_line.selected_uom,v_line.quantity")
    && returnMigration.includes('v_line.conversion_factor'),
  'The current return command must remain cash-only and restore stock from the historical sale UOM snapshot',
);
requireValue(
  returnMigration.includes('unique (tenant_id,order_id)')
    && returnMigration.includes('unique (tenant_id,sale_return_id)')
    && returnMigration.includes("'pos-cash-return:'||p_order_id::text"),
  'POS cash return and refund effects must remain duplicate-safe',
);
requireValue(
  shiftReconciliationMigration.includes('create or replace function public.capture_sellertray_shift_cash_sale()')
    && shiftReconciliationMigration.includes('Open a cashier shift in this Branch before taking counter cash payments')
    && shiftReconciliationMigration.includes('sellertray_user_can_operate_branch'),
  'Confirmed POS cash sales must fail closed unless the responsible operator has an open same-Branch shift',
);
requireValue(
  shiftReconciliationMigration.includes('create or replace function public.capture_sellertray_shift_cash_refund()')
    && shiftReconciliationMigration.includes('Open a cashier shift in this Branch before paying a cash refund')
    && shiftReconciliationMigration.includes('sellertray_cash_shift_totals')
    && shiftReconciliationMigration.includes('Cash refund cannot take expected drawer cash below zero'),
  'Confirmed cash refunds must be attributed to an open same-Branch drawer with sufficient expected cash',
);

if (failures.length > 0) {
  console.error('SellerTray POS return preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray POS return preflight passed.');
