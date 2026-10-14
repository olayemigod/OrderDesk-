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
const whatsappWebhook = readFileSync(resolve(appRoot, '../../supabase/functions/whatsapp-webhook/index.ts'), 'utf8');
const idempotency = readFileSync(resolve(appRoot, '../../supabase/migrations/20261010101500_pos_draft_client_idempotency.sql'), 'utf8');
const replay = readFileSync(resolve(appRoot, '../../supabase/migrations/20261010101600_offline_pos_replay_validation.sql'), 'utf8');
const customerIdentity = readFileSync(resolve(appRoot, '../../supabase/migrations/20261014130000_pos_customer_identity_selection.sql'), 'utf8');
const customerConvergence = readFileSync(resolve(appRoot, '../../supabase/migrations/20261014133000_customer_phone_identity_convergence.sql'), 'utf8');
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
  sell.includes('PosCustomerSelector') &&
    sell.includes('customerId: customer?.id ?? null') &&
    sell.includes('customerName: customer?.name ?? null') &&
    sell.includes('customerPhone: customer?.phone ?? null') &&
    commerce.includes('customerId?: string | null') &&
    commerce.includes('customerId: cleanOptional(input.customerId)'),
  'POS must carry the selected shared customer identity into the governed server draft.',
);

const preparePaymentIndex = sell.indexOf('async function continueToPayment()');
const completePaymentIndex = sell.indexOf('async function completeSelectedSale()');
requireValue(
  preparePaymentIndex >= 0 &&
    completePaymentIndex > preparePaymentIndex &&
    sell.includes('const orderId = await createPosDraft(currentDraftInput(clientReference));') &&
    sell.includes('if (!draftOrderId || completing || !selectedPayment) return;') &&
    sell.includes('await completePosSale(tenantId, orderId, selectedPayment.paymentMethodId);'),
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
  offline.includes('schemaVersion: 2') &&
    offline.includes('customerId: candidate.customerId') &&
    offline.includes('customerName: candidate.customerName') &&
    offline.includes('customerPhone: candidate.customerPhone') &&
    offline.includes("(row.schemaVersion !== 1 && row.schemaVersion !== 2)") &&
    offline.includes("row.schemaVersion === 2 ? nullableString(row.customerId) : null"),
  'Held-sale sync must preserve new customer identity while remaining backward compatible with schema-v1 held sales.',
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
  edge.includes('customerId') &&
    edge.includes('p_customer_id: customerId') &&
    edge.includes('create_sellertray_pos_order_idempotent') &&
    edge.includes('Offline-ready sale lines require the displayed price and unit conversion') &&
    edge.includes('create_sellertray_pos_order_atomic'),
  'merchant-order must route selected customer identity and modern POS references through the governed server commands.',
);

requireValue(
  customerIdentity.includes('resolve_sellertray_pos_customer') &&
    customerIdentity.includes('Multiple customer records use this phone. Select the customer from search.') &&
    customerIdentity.includes("'customerId',p_customer_id") &&
    customerIdentity.includes('Queued sale needs review because Branch stock is no longer sufficient'),
  'Customer-aware POS commands must reuse one shared customer and retain strong offline replay validation.',
);

requireValue(
  customerConvergence.includes('resolve_sellertray_whatsapp_customer') &&
    customerConvergence.includes("regexp_replace(v_customer_phone,'[^0-9]','','g')") &&
    customerConvergence.includes("c.wa_id like 'manual:%'") &&
    customerConvergence.includes('grant execute on function public.resolve_sellertray_whatsapp_customer(uuid,text,text)') &&
    whatsappWebhook.includes('/rest/v1/rpc/resolve_sellertray_whatsapp_customer') &&
    whatsappWebhook.includes('p_wa_id: event.waId') &&
    !whatsappWebhook.includes('const customerPayload: JsonRecord = {'),
  'POS and WhatsApp must resolve one shared customer identity instead of creating channel-specific customer records.',
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
