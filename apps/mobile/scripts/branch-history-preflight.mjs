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

const migration = read(join(repoRoot, 'supabase/migrations/20261021133000_order_branch_name_snapshot.sql'));
const ordersRepository = read(join(mobileRoot, 'src/data/ordersRepository.ts'));

requireValue(
  migration.includes('branch_name_snapshot') &&
    migration.includes('snapshot_sellertray_order_branch_name') &&
    migration.includes('orders_snapshot_branch_name'),
  'Orders must persist an authoritative immutable Branch-name snapshot',
);
requireValue(
  migration.includes('snapshot_sellertray_receipt_branch_name') &&
    migration.includes("jsonb_build_object('branchName', v_branch_name)"),
  'Receipt and reprint jobs must consume the order-time Branch snapshot',
);
requireValue(
  ordersRepository.includes('branch_name_snapshot') &&
    ordersRepository.includes('branchName: row.branch_name_snapshot'),
  'Mobile Orders must display the order-time Branch snapshot',
);
requireValue(
  !ordersRepository.includes(".from('branches')") &&
    !ordersRepository.includes('const branchNames = new Map'),
  'Mobile Orders must not resolve historical Branch names from the current Branch master',
);

if (failures.length > 0) {
  console.error('SellerTray Branch history preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Branch history preflight passed.');
