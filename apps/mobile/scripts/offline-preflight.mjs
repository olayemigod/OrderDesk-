import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = process.cwd();
const sell = readFileSync(resolve(appRoot, 'src/redesign/SellWorkspace.tsx'), 'utf8');
const workspace = readFileSync(resolve(appRoot, 'src/redesign/RedesignWorkspace.tsx'), 'utf8');
const more = readFileSync(resolve(appRoot, 'src/redesign/MoreWorkspace.tsx'), 'utf8');
const sync = readFileSync(resolve(appRoot, 'src/redesign/SyncStatusWorkspace.tsx'), 'utf8');
const offline = readFileSync(resolve(appRoot, 'src/data/offlineSalesRepository.ts'), 'utf8');
const commerce = readFileSync(resolve(appRoot, 'src/data/commerceRepository.ts'), 'utf8');
const edge = readFileSync(resolve(appRoot, '../../supabase/functions/merchant-order/index.ts'), 'utf8');
const idempotency = readFileSync(resolve(appRoot, '../../supabase/migrations/20261010101500_pos_draft_client_idempotency.sql'), 'utf8');
const replay = readFileSync(resolve(appRoot, '../../supabase/migrations/20261010101600_offline_pos_replay_validation.sql'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  sell.includes('queueOfflinePosSale') &&
    sell.includes('Sale held on this device. It is not paid or completed.') &&
    sell.includes('expectedSellingPrice') &&
    sell.includes('expectedConversionFactor') &&
    sell.includes('clientReference'),
  'Sell must queue held sales with a stable client reference and displayed price/UOM snapshots without claiming payment.',
);

requireValue(
  sell.includes('completePosSale') &&
    sell.includes('if (!draftOrderId || completing || !selectedPayment) return;') &&
    sell.includes('await completePosSale(tenantId, orderId, selectedPayment.paymentMethodId)') &&
    sell.indexOf('createPosDraft') < sell.indexOf('completePosSale'),
  'Payment completion must remain gated by a server-created draft order and selected governed Branch payment method.',
);

requireValue(
  offline.includes("'pending' | 'syncing' | 'needs_review' | 'failed' | 'synced'") &&
    offline.includes('actorUserId') &&
    offline.includes('MAX_OPEN_INTENTS = 50') &&
    offline.includes("status: 'needs_review'") &&
    offline.includes("status: 'pending', message: 'Waiting for a connection.'"),
  'Offline outbox must be bounded, user-owned, and distinguish connectivity from business conflicts.',
);

requireValue(
  !offline.includes('completePosSale') &&
    !offline.includes('completePosCashSale') &&
    !offline.includes('complete_sellertray_pos') &&
    !offline.includes('record_sellertray_inventory_movement') &&
    !offline.includes('sellertray_supplier_payment') &&
    !offline.includes('set_sellertray_member_'),
  'Offline replay code must not finalize payments, mutate stock, suppliers, or permissions.',
);

requireValue(
  workspace.includes('useOfflineSalesSync') &&
    workspace.includes("offline.connectionState === 'offline'") &&
    !workspace.includes("workspaceError ? 'offline'"),
  'Mobile shell must derive Offline from held-sale connectivity state, not from generic refresh errors.',
);

requireValue(
  more.includes('Sync Status') &&
    sync.includes('A held sale is not paid or completed') &&
    sync.includes('Payment completion always stays online'),
  'More must expose an explicit Sync Status surface with the offline safety boundary.',
);

requireValue(
  commerce.includes('PosDraftRequestError') &&
    commerce.includes('createPosClientReference') &&
    commerce.includes('expectedSellingPrice') &&
    commerce.includes('expectedConversionFactor'),
  'POS repository must carry stable references and expected commercial snapshots to the server.',
);

requireValue(
  edge.includes("clientReference") &&
    edge.includes("create_sellertray_pos_order_idempotent") &&
    edge.includes("Offline-ready sale lines require the displayed price and unit conversion") &&
    edge.includes("create_sellertray_pos_order_atomic"),
  'merchant-order must route modern POS references through idempotent replay validation while preserving legacy callers.',
);

requireValue(
  idempotency.includes('pg_advisory_xact_lock') &&
    idempotency.includes('payload_fingerprint') &&
    idempotency.includes('Sale reference was reused with different details'),
  'Server idempotency must serialize retries and reject conflicting client-reference reuse.',
);

requireValue(
  replay.includes('expected_selling_price') &&
    replay.includes('expected_conversion_factor') &&
    replay.includes('Branch stock is no longer sufficient') &&
    replay.includes('Branch is no longer available') &&
    replay.includes('product price or unit changed'),
  'Offline replay must revalidate price, conversion, active Branch, and current stock before creating a draft.',
);

if (failures.length) {
  console.error('SellerTray offline reliability preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray offline reliability preflight passed.');