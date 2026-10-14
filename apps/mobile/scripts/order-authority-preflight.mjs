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

const authorityMigration = read(join(repoRoot, 'supabase/migrations/20261014192000_order_operation_authority_convergence.sql'));
const paidCancellationGuard = read(join(repoRoot, 'supabase/migrations/20260914095500_restore_paid_order_cancellation_guard.sql'));
const posDraftMigration = read(join(repoRoot, 'supabase/migrations/20261014091000_pos_draft_item_editing.sql'));
const ordersRepository = read(join(mobileRoot, 'src/data/ordersRepository.ts'));
const useOrders = read(join(mobileRoot, 'src/hooks/useOrders.ts'));
const fulfillmentEdge = read(join(repoRoot, 'supabase/functions/order-fulfillment/index.ts'));

requireValue(
  authorityMigration.includes('sellertray_user_can_manage_order_operation') &&
    authorityMigration.includes("'can_manage_orders'") &&
    authorityMigration.includes('sellertray_user_can_operate_branch'),
  'Order mutations must share can_manage_orders plus active Branch authority',
);
requireValue(
  authorityMigration.includes('get_sellertray_order_action_authority') &&
    authorityMigration.includes('auth.uid()') &&
    authorityMigration.includes('orderdesk_subscription_can_write'),
  'Order action visibility must have a signed-in, writable-subscription authority reader',
);
requireValue(
  authorityMigration.includes('transition_sellertray_order') &&
    authorityMigration.includes("v_order.source='pos'") &&
    authorityMigration.includes('sellertray.audit_actor_user_id'),
  'Generic workflow transitions must be governed, audited and kept separate from POS sale commands',
);
requireValue(
  authorityMigration.includes('mutate_sellertray_order_item') &&
    authorityMigration.includes("v_order.source='pos'") &&
    authorityMigration.includes("'manual',null"),
  'Customer-order line corrections must be governed and preserve explicit manual provenance',
);
requireValue(
  authorityMigration.includes('apply_sellertray_order_fulfillment') &&
    authorityMigration.includes("sellertray_payment_gate_decision(p_order_id,'dispatch')") &&
    authorityMigration.includes("sellertray_payment_gate_decision(p_order_id,'complete')") &&
    authorityMigration.includes('commercial_action_ledger'),
  'Fulfillment must enforce payment gates and commercial audit inside the database command',
);
requireValue(
  authorityMigration.includes('revoke insert,update,delete on table public.orders from authenticated') &&
    authorityMigration.includes('revoke update(status,status_reason,updated_at) on table public.orders from authenticated') &&
    authorityMigration.includes('revoke insert,update,delete on table public.order_items from authenticated'),
  'Authenticated clients must not retain raw order or order-line mutation privileges',
);
requireValue(
  paidCancellationGuard.includes("old.payment_status in ('paid','verification_required','payment_issue')") &&
    paidCancellationGuard.includes("sellertray_payment_gate_decision(new.id,'processing')") &&
    paidCancellationGuard.includes("sellertray_payment_gate_decision(new.id,'ready')") &&
    paidCancellationGuard.includes("sellertray_payment_gate_decision(new.id,'complete')"),
  'Existing state, payment-gate and paid-cancellation trigger protections must remain authoritative',
);
requireValue(
  ordersRepository.includes("supabase.rpc('transition_sellertray_order'") &&
    ordersRepository.includes("supabase.rpc('mutate_sellertray_order_item'") &&
    ordersRepository.includes("supabase.rpc('get_sellertray_order_action_authority'") &&
    !ordersRepository.includes(".from('orders')\n    .update(") &&
    !ordersRepository.includes(".from('order_items').insert(") &&
    !ordersRepository.includes(".from('order_items').delete("),
  'Mobile order repository must use governed commands instead of raw table mutations',
);
requireValue(
  useOrders.includes('updateOrderStatus(tenantId, orderId, status, normalizedReason)') &&
    useOrders.includes('addOrderItem(tenantId, orderId, item)') &&
    useOrders.includes('updateOrderItem(tenantId, parentOrder.id, itemId, item)') &&
    useOrders.includes('deleteOrderItem(tenantId, parentOrder.id, itemId)'),
  'Mobile order commands must bind mutations to the active business and parent order',
);
requireValue(
  fulfillmentEdge.includes("admin.rpc('apply_sellertray_order_fulfillment'") &&
    fulfillmentEdge.includes('p_actor_user_id: userId') &&
    !fulfillmentEdge.includes(".from('orders')\n      .update("),
  'Fulfillment edge service must delegate business mutation to the governed database command',
);
requireValue(
  posDraftMigration.includes('sellertray_user_can_operate_branch') &&
    posDraftMigration.includes("'can_manage_orders'") &&
    posDraftMigration.includes('update_sellertray_pos_draft_items'),
  'Dedicated POS draft editing must retain its existing Branch and order authority checks',
);

if (failures.length > 0) {
  console.error('SellerTray order authority preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray order authority preflight passed.');
