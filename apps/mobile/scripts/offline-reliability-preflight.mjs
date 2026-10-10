import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const cache = readFileSync(resolve(appRoot, 'src/data/offlineCommerceCache.ts'), 'utf8');
const commerce = readFileSync(resolve(appRoot, 'src/data/commerceRepository.ts'), 'utf8');
const queue = readFileSync(resolve(appRoot, 'src/data/offlinePosDraftQueue.ts'), 'utf8');
const sell = readFileSync(resolve(appRoot, 'src/redesign/SellWorkspace.tsx'), 'utf8');
const sync = readFileSync(resolve(appRoot, 'src/redesign/SyncStatusWorkspace.tsx'), 'utf8');
const more = readFileSync(resolve(appRoot, 'src/redesign/MoreWorkspace.tsx'), 'utf8');
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
  'Catalogue cache must never become inventory truth or a commercial/payment queue.',
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
  commerce.includes('body.customerName === null') &&
    commerce.includes('body.customerPhone === null') &&
    commerce.includes('body.note === null') &&
    commerce.includes('savePendingPosDraft') &&
    commerce.includes('markPendingPosDraftError') &&
    commerce.includes('removePendingPosDraft'),
  'Durable pending sync must be limited to walk-in drafts without local customer identity or notes.',
);

requireValue(
  queue.includes("const KEY_PREFIX = 'sellertray.sync.pos-draft.v1'") &&
    queue.includes('MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000') &&
    queue.includes('requestId: string') &&
    queue.includes('branchId: string') &&
    queue.includes('items: PosDraftLine[]') &&
    queue.includes('attemptCount: number') &&
    !queue.includes('customerName') &&
    !queue.includes('customerPhone') &&
    !queue.includes('sellingPrice') &&
    !queue.includes('quantityOnHand') &&
    !queue.includes('payment') &&
    !queue.includes('receipt'),
  'Pending sync envelopes must stay minimal: request/Branch/items only, with no PII, prices, stock, payment or receipt state.',
);

requireValue(
  sync.includes('Draft sync only') &&
    sync.includes('It never confirms cash, deducts stock, or issues a receipt.') &&
    sync.includes('Retry draft save') &&
    sync.includes('Discard local retry') &&
    sync.includes('createPosDraft') &&
    !sync.includes('completePosCashSale'),
  'Sync Status must keep retries explicit and draft-only.',
);

requireValue(
  more.includes('Sync Status') && more.includes('<SyncStatusWorkspace'),
  'Pending draft sync must be visible from the mobile More workspace.',
);

requireValue(
  merchantOrder.includes("create_sellertray_pos_order_idempotent") &&
    merchantOrder.includes('p_request_id: requestId') &&
    merchantOrder.includes('requestIdProvided && !requestId') &&
    merchantOrder.includes('idempotentReplay') &&
    merchantOrder.includes("/already used for different sale details/i.test(message) ? 409 : 400") &&
    merchantOrder.includes("create_sellertray_pos_order_atomic"),
  'Merchant POS boundary must fail closed on malformed request identity, use idempotent creation for keyed requests, and retain legacy caller compatibility only when the key is absent.',
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
  !queue.includes('setInterval') &&
    !queue.includes('Background') &&
    !sync.includes('useEffect(() => void retry') &&
    !commerce.includes('completePosCashSale(tenantId, orderId).catch'),
  'Pending drafts must not auto-sync or auto-complete payments/stock in the background.',
);

if (failures.length) {
  console.error('SellerTray offline reliability preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray offline reliability preflight passed.');
