import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const cache = readFileSync(resolve(appRoot, 'src/data/offlineCommerceCache.ts'), 'utf8');
const sell = readFileSync(resolve(appRoot, 'src/redesign/SellWorkspace.tsx'), 'utf8');
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

if (failures.length) {
  console.error('SellerTray offline reliability preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray offline reliability preflight passed.');
