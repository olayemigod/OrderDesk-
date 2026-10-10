import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const cache = readFileSync(resolve(appRoot, 'src/data/offlineCommerceCache.ts'), 'utf8');
const commerce = readFileSync(resolve(appRoot, 'src/data/commerceRepository.ts'), 'utf8');
const sell = readFileSync(resolve(appRoot, 'src/redesign/SellWorkspace.tsx'), 'utf8');
const merchantOrder = readFileSync(resolve(appRoot, '../../supabase/functions/merchant-order/index.ts'), 'utf8');
const idempotencyMigration = readFileSync(
  resolve(appRoot, '../../supabase/migrations/20261010213000_pos_draft_request_idempotency.sql'),
  'utf8',
);
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  cache.includes("const CACHE_PREFIX = 'sellertray.offline.products.v1'") &&
    cache.includes('MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000') &&
    cache.includes('tenantId') &&
    cache.includes('isCommerceProduct') &&
    cache.includes("source: 'live' | 'cache'"),
  'Offline catalogue cache must remain tenant-scoped, versioned, age-bounded and schema-validated.',
);

requireValue(
  sell.includes('loadCommerceProductsResilient') &&
    sell.includes("productSource === 'cache'") &&
    sell.includes('Cached catalogue') &&
    sell.includes('Live Branch stock is still required before selling.'),
  'Sell must visibly disclose cached catalogue use and preserve the live-stock requirement.',
);

requireValue(
  sell.includes('const stockReady = !stockLoading && !stockError') &&
    sell.includes('if (checkoutLocked || !stockReady) return;') &&
    sell.includes('if (saving || completing || checkoutLocked || cartLines.length === 0 || !stockReady) return;') &&
    sell.includes('const latestStock = await refreshBranchStock()') &&
    sell.includes('completePosCashSale(tenantId, orderId)'),
  'Cached catalogue must not bypass live stock checks or the governed online checkout command.',
);

requireValue(
  !cache.includes('inventory_movements') &&
    !cache.includes('quantityOnHand') &&
    !cache.includes('order_payments') &&
    !cache.includes('completePosCashSale') &&
    !cache.includes('createPosDraft'),
  'The first offline slice must not cache inventory truth or queue commercial/payment mutations.',
);

requireValue(
  commerce.includes('const pendingPosDraftRequestIds = new Map<string, string>()') &&
    commerce.includes('pendingPosDraftRequestIds.get(retryKey)') &&
    commerce.includes('pendingPosDraftRequestIds.set(retryKey, requestId)') &&
    commerce.includes('body: { ...body, requestId }') &&
    commerce.includes('pendingPosDraftRequestIds.delete(retryKey)'),
  'POS draft client retries must reuse one request identity after an ambiguous failure and clear it only after a confirmed response.',
);

requireValue(
  merchantOrder.includes("create_sellertray_pos_order_idempotent") &&
    merchantOrder.includes('p_request_id: requestId') &&
    merchantOrder.includes('idempotentReplay') &&
    merchantOrder.includes("/already used for different sale details/i.test(message) ? 409 : 400") &&
    merchantOrder.includes("create_sellertray_pos_order_atomic"),
  'Merchant POS boundary must use the idempotent command when a request key is supplied while retaining legacy caller compatibility.',
);

requireValue(
  idempotencyMigration.includes('sellertray_pos_draft_requests') &&
    idempotencyMigration.includes('pg_advisory_xact_lock') &&
    idempotencyMigration.includes('sha256') &&
    idempotencyMigration.includes('request_fingerprint') &&
    idempotencyMigration.includes('create_sellertray_pos_order_atomic') &&
    idempotencyMigration.includes('SellerTray POS request history is immutable') &&
    idempotencyMigration.includes('to service_role'),
  'POS draft request ledger must remain service-only, fingerprinted, serialized, immutable and backed by the shared POS creator.',
);

requireValue(
  !commerce.includes('AsyncStorage') &&
    !commerce.includes('completePosCashSale(tenantId, orderId).catch') &&
    !commerce.includes('offlineQueue'),
  'POS retry idempotency must not silently become a durable offline sale or payment queue.',
);

if (failures.length) {
  console.error('SellerTray offline reliability preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray offline reliability preflight passed.');
