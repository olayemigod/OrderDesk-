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

const allocationMigration = read(join(repoRoot, 'supabase/migrations/20261016082241_pos_payment_allocation_runtime_convergence.sql'));
const compatibilityMigration = read(join(repoRoot, 'supabase/migrations/20261016083023_pos_payment_allocation_compatibility_fix.sql'));
const checkoutFunction = read(join(repoRoot, 'supabase/functions/pos-checkout/index.ts'));

requireValue(
  allocationMigration.includes('pos_payment_terms') &&
    allocationMigration.includes('pos_checkout_command_id') &&
    allocationMigration.includes('pos_checkout_request_hash') &&
    allocationMigration.includes('checkout_sellertray_pos_sale') &&
    allocationMigration.includes('sellertray_record_pos_payment_allocation') &&
    allocationMigration.includes('sellertray_finalize_pos_order_if_allowed'),
  'POS allocation migration must preserve payment terms, command identity, governed allocation recording and finalisation',
);
requireValue(
  allocationMigration.includes("grant execute on function public.checkout_sellertray_pos_sale") &&
    allocationMigration.includes('to service_role') &&
    allocationMigration.includes('from public,anon,authenticated'),
  'POS allocation checkout must stay behind the service-role boundary',
);
requireValue(
  compatibilityMigration.includes("v_is_allocation boolean:=coalesce(new.idempotency_key,'') like 'pos-allocation:%'") &&
    compatibilityMigration.includes("p.idempotency_key like 'pos-allocation:%'") &&
    compatibilityMigration.includes('sellertray_finalize_pos_order_if_allowed'),
  'POS allocation compatibility guard must aggregate only allocation commands while preserving legacy settlement finalisation',
);
requireValue(
  checkoutFunction.includes('const allocationMode=') &&
    checkoutFunction.includes("admin.rpc('checkout_sellertray_pos_sale'") &&
    checkoutFunction.includes('isAllocationCheckoutResult(data)') &&
    checkoutFunction.includes("row.paymentTerms!=='immediate'") &&
    checkoutFunction.includes('Array.isArray(row.payments)'),
  'pos-checkout must route allocation payloads to the governed allocation RPC and validate the allocation response contract',
);
requireValue(
  checkoutFunction.includes("const rpcName=methodType==='bank_transfer'") &&
    checkoutFunction.includes("'complete_sellertray_pos_sale'"),
  'pos-checkout must retain the governed legacy checkout path for mixed-version compatibility',
);

if (failures.length > 0) {
  console.error('SellerTray POS allocation preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray POS allocation preflight passed.');
