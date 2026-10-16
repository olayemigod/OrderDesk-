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
const posSaleRepository = read(join(mobileRoot, 'src/data/posSaleRepository.ts'));
const ordersWorkspace = read(join(mobileRoot, 'src/redesign/OrdersWorkspace.tsx'));
const redesignWorkspace = read(join(mobileRoot, 'src/redesign/RedesignWorkspace.tsx'));
const mobileShell = read(join(mobileRoot, 'src/redesign/MobileShell.tsx'));
const posReturnEdge = read(join(repoRoot, 'supabase/functions/pos-return/index.ts'));
const partialReturnMigration = read(join(repoRoot, 'supabase/migrations/20261016074945_pos_partial_return_governance.sql'));
const draftDeletionMigration = read(join(repoRoot, 'supabase/migrations/20261016044000_pos_draft_deletion.sql'));
const refundAuthorityMigration = read(join(repoRoot, 'supabase/migrations/20261014203000_pos_refund_authority_convergence.sql'));
const shiftReconciliationMigration = read(join(repoRoot, 'supabase/migrations/20261014202000_pos_cash_shift_reconciliation.sql'));
const teamManagementWeb = read(join(repoRoot, 'apps/merchant-web/src/TeamBranchesManagement.tsx'));

requireValue(
  domain.includes("export type ReturnStatus = 'none' | 'partial' | 'returned';")
    && domain.includes('cashReturnSupported?: boolean;'),
  'Order read model must distinguish partial and full returns while preserving cash refund eligibility evidence',
);
requireValue(
  ordersRepository.includes(".from('order_payments')")
    && ordersRepository.includes("payment.status === 'confirmed'")
    && ordersRepository.includes("confirmedPayment.method_type === 'cash'")
    && ordersRepository.includes("confirmedPayment.provider === 'pos_cash'")
    && ordersRepository.includes('confirmedPayments.length === 1')
    && ordersRepository.includes(".is('deleted_at', null)"),
  'Order loading must derive cash-return support from one confirmed POS cash payment and hide audit-deleted drafts',
);
requireValue(
  posSaleRepository.includes("rpc('get_sellertray_pos_returnable_items'")
    && posSaleRepository.includes('returnPosSaleItems')
    && posSaleRepository.includes('deletePosDraft')
    && posSaleRepository.includes("export function createPosCommandId(action: 'return' | 'delete_draft'")
    && ordersWorkspace.includes("createPosCommandId('return', order.id)")
    && ordersWorkspace.includes("createPosCommandId('delete_draft', order.id)")
    && ordersWorkspace.includes('commandId: pending.commandId'),
  'Mobile sale commands must load remaining line quantities and preserve retry identity for returns and draft deletion',
);
requireValue(
  ordersWorkspace.includes("order.returnStatus === 'partial'")
    && ordersWorkspace.includes('loadPosReturnableItems')
    && ordersWorkspace.includes('returnPosSaleItems')
    && ordersWorkspace.includes('remainingQuantity')
    && ordersWorkspace.includes('Delete draft')
    && ordersWorkspace.includes('deletePosDraft'),
  'Orders UI must support quantity-level partial returns and explicit deletion of unwanted unpaid drafts',
);
requireValue(
  redesignWorkspace.includes('get_sellertray_pos_return_authority')
    && redesignWorkspace.includes('canReturnCompletedSale={canRefundSale && Boolean(activeCashShift)}'),
  'Mobile return visibility must use governed refund capability plus the active cashier shift',
);
requireValue(
  mobileShell.includes('RefreshControl')
    && redesignWorkspace.includes('onRefresh={refreshWorkspace}')
    && redesignWorkspace.includes('notifications.refresh()')
    && redesignWorkspace.includes('loadStockTransfers(tenantId, branchId, 100)'),
  'Redesign pull-to-refresh must refresh live operational data rather than exposing a no-op gesture',
);
requireValue(
  !posReturnEdge.includes("membership.role !== 'owner'")
    && !posReturnEdge.includes("membership.role !== 'manager'")
    && posReturnEdge.includes("type PosAction = 'void' | 'return' | 'delete_draft'")
    && posReturnEdge.includes("rpc = 'return_sellertray_pos_cash_sale'")
    && posReturnEdge.includes('p_items: items')
    && posReturnEdge.includes('p_command_id: commandId')
    && posReturnEdge.includes("rpc = 'delete_sellertray_pos_draft'"),
  'POS action edge adapter must delegate partial return and draft deletion authority to governed domain commands',
);
requireValue(
  partialReturnMigration.includes("check (return_status in ('none','partial','returned'))")
    && partialReturnMigration.includes('create or replace function public.get_sellertray_pos_returnable_items')
    && partialReturnMigration.includes('create or replace function public.return_sellertray_pos_cash_sale')
    && partialReturnMigration.includes('p_items jsonb')
    && partialReturnMigration.includes('p_command_id text')
    && partialReturnMigration.includes("v_order.return_status not in ('none','partial')")
    && partialReturnMigration.includes('sale_returns_command_unique'),
  'Partial return domain must calculate remaining quantities and make each return command duplicate-safe',
);
requireValue(
  partialReturnMigration.includes("p.method_type='cash' and p.provider='pos_cash' and p.status='confirmed'")
    && partialReturnMigration.includes('v_remaining_qty')
    && partialReturnMigration.includes('sale_return_items')
    && partialReturnMigration.includes('conversion_factor'),
  'Partial returns must remain cash-only and restore stock from the historical sale UOM snapshot',
);
requireValue(
  draftDeletionMigration.includes('create or replace function public.delete_sellertray_pos_draft')
    && draftDeletionMigration.includes('deleted_at')
    && draftDeletionMigration.includes('deletion_reason')
    && draftDeletionMigration.includes('deletion_command_hash')
    && draftDeletionMigration.includes("v_order.payment_status<>'unpaid'")
    && draftDeletionMigration.includes('coalesce(v_order.amount_paid,0)<>0')
    && draftDeletionMigration.includes('A POS draft with payment activity cannot be deleted')
    && draftDeletionMigration.includes('A POS draft with stock activity cannot be deleted')
    && draftDeletionMigration.includes('A POS draft with financial documents cannot be deleted')
    && draftDeletionMigration.includes('prevent_sellertray_deleted_draft_mutation'),
  'Draft deletion must remain an audited soft deletion restricted to commercially untouched unpaid drafts',
);
requireValue(
  refundAuthorityMigration.includes("'can_refund_sale'")
    && refundAuthorityMigration.includes('sellertray_user_can_operate_branch')
    && refundAuthorityMigration.includes('create or replace function public.get_sellertray_pos_return_authority'),
  'Refund authority must remain capability- and Branch-governed',
);
requireValue(
  teamManagementWeb.includes("'can_refund_sale'")
    && teamManagementWeb.includes('Refund completed sales'),
  'Merchant Web permission management must expose refund authority with merchant-facing wording',
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
