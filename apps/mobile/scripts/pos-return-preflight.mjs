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
const posReturnEdge = read(join(repoRoot, 'supabase/functions/pos-return/index.ts'));
const returnMigration = read(join(repoRoot, 'supabase/migrations/20261009194500_pos_void_and_cash_return.sql'));

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
  posReturnEdge.includes("return_sellertray_pos_cash_sale")
    && returnMigration.includes("p.method_type='cash' and p.provider='pos_cash' and p.status='confirmed'")
    && returnMigration.includes("'sale_return',v_line.stock_quantity,v_line.selected_uom,v_line.quantity")
    && returnMigration.includes('v_line.conversion_factor'),
  'The current return command must remain cash-only and restore stock from the historical sale UOM snapshot',
);
requireValue(
  returnMigration.includes("unique (tenant_id,order_id)")
    && returnMigration.includes("unique (tenant_id,sale_return_id)")
    && returnMigration.includes("'pos-cash-return:'||p_order_id::text"),
  'POS cash return and refund effects must remain duplicate-safe',
);

if (failures.length > 0) {
  console.error('SellerTray POS return preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray POS return preflight passed.');
