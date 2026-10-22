import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const sell = readFileSync(resolve(root, 'src/redesign/SellWorkspace.tsx'), 'utf8');
const offlineAllocator = readFileSync(resolve(root, 'src/redesign/OfflinePosPaymentAllocator.tsx'), 'utf8');
const hook = readFileSync(resolve(root, 'src/hooks/useOfflineSalesSync.ts'), 'utf8');
const offline = readFileSync(resolve(root, 'src/data/offlineSalesRepository.ts'), 'utf8');
const prepare = readFileSync(resolve(root, 'src/data/posDraftPreparationRepository.ts'), 'utf8');
const inventory = readFileSync(resolve(root, 'src/redesign/InventoryWorkspace.tsx'), 'utf8');
const customer = readFileSync(resolve(root, 'src/redesign/PosCustomerSelector.tsx'), 'utf8');
const safeError = readFileSync(resolve(root, 'src/data/userFacingError.ts'), 'utf8');
const policy = readFileSync(resolve(root, 'src/data/posPaymentRepository.ts'), 'utf8');
const skill = readFileSync(resolve(root, '../../.agents/skills/sellertray-project-implementation/SKILL.md'), 'utf8');
const offlineGovernance = readFileSync(resolve(root, '../../.agents/skills/sellertray-project-implementation/OFFLINE.md'), 'utf8');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(sell.includes('sellingPrice: number') && sell.includes('configured') && sell.includes('canOverridePrice') && sell.includes('Unit price') && sell.includes('prepareGovernedPosDraft'), 'Sell must separate configured price from the governed effective selling price and expose an authorised unit-price edit.');
requireValue(policy.includes('allowPriceOverride') && policy.includes('canOverridePrice'), 'POS price changes must remain controlled by merchant policy and operator capability.');
requireValue(policy.includes('allowSplitPayments') && policy.includes('allowPartialPayments') && policy.includes('allowPayLater'), 'POS Split payment, Partial payment and Pay later must remain independent governed policy switches.');
requireValue(prepare.includes('createPosDraft') && prepare.includes('updatePosDraftItems') && prepare.includes('expectedSellingPrice') && prepare.includes('sellingPrice'), 'Price overrides must use the governed draft command after configured-price validation, never direct order-item writes.');
requireValue(offline.includes("OfflineCompletionIntent = 'draft' | 'cash' | 'bank' | 'payment'") && offline.includes('OfflinePaymentPlan') && offline.includes('paymentPlan') && offline.includes('schemaVersion: 6') && offline.includes('allocations: OfflinePaymentAllocation[]'), 'Offline outbox must preserve legacy Draft/Cash/Bank records while adding the governed multi-allocation payment plan schema.');
requireValue(offline.includes('checkoutCommandId') && offline.includes('confirmNow') && offline.includes('providerReference') && offline.includes('capturedAt') && offline.includes('methodSnapshot'), 'Offline payment plans must retain deterministic command identity, confirmation intent and non-cash evidence snapshots.');
requireValue(offline.includes('MAX_OPEN_INTENTS = 50') && offline.includes('sellingPrice') && offline.includes('reserveCachedStock'), 'Offline outbox must preserve effective price, bounded storage and controlled cached-stock reservation.');
requireValue(sell.includes('OfflinePosPaymentAllocator') && sell.includes('queueOfflinePaymentSale') && sell.includes("completionIntent: 'payment'") && sell.includes('loadPosPaymentMethodsCache') && sell.includes('loadPosPolicyCache'), 'Sell must use cached governed payment methods/policy and a generic offline payment allocator rather than a Cash/Bank-only fallback.');
requireValue(offlineAllocator.includes('policy.allowSplitPayments') && offlineAllocator.includes('policy.allowPartialPayments') && offlineAllocator.includes('policy.allowPayLater'), 'Offline checkout must expose Split, Partial and Pay later only through the same cached merchant policy used online.');
requireValue(offlineAllocator.includes("method.methodType === 'cash'") && offlineAllocator.includes("method.methodType === 'bank_transfer'") && offlineAllocator.includes('card_terminal'), 'Offline checkout must support governed Cash, Bank and Card/terminal methods.');
requireValue(hook.includes('probeReachability') && hook.includes('backendReachable === false') && hook.includes("sale.completionIntent === 'payment'") && hook.includes('checkoutPosPaymentAllocations') && hook.includes('prepareGovernedPosDraft'), 'Offline status must reflect backend reachability and replay payment plans through the shared governed draft and allocation checkout commands.');
requireValue(hook.includes('inventoryMovementCount !== 0') && hook.includes('pending_verification'), 'Offline replay must keep stock unchanged while non-cash verification or an outstanding balance prevents finalization.');
requireValue(offline.includes('unknownhost') && offline.includes('unable to resolve host'), 'DNS/backend reachability failures must be classified as offline conditions.');
requireValue(sell.includes('catalogueView') && sell.includes("'grid'") && sell.includes('grid-outline') && sell.includes('list-outline'), 'POS catalogue must default to governed tile view and retain an explicit compact list toggle.');
requireValue(inventory.includes('loadBranchStockCache') && inventory.includes('saveBranchStockCache') && inventory.includes('last saved stock'), 'Inventory must consume the same governed branch-stock cache as POS when offline.');
requireValue(customer.includes('loadCustomerCache') && customer.includes('saveCustomerCache'), 'POS customer selection must use the governed offline customer cache.');
requireValue(safeError.includes('supabase\\.co') && safeError.includes('Connect to continue.') && safeError.includes('sellerTrayBackgroundError') && safeError.includes('isLikelyConnectivityError'), 'Merchant-facing error translation must suppress infrastructure details, treat background connectivity loss as global state, and reserve Connect to continue for user-triggered online-only actions.');
requireValue(offline.includes("throw new Error('An offline sale with payment intent cannot be discarded") && hook.includes('syncOfflinePosSales'), 'Offline sales carrying payment intent must not be destructively discarded and must reconcile through the sync queue.');
const governed = skill.toLowerCase();
requireValue(governed.includes('offline-capable selling') && governed.includes('controlled discounts/price overrides') && governed.includes('sale reduces stock exactly once'), 'Implementation must remain aligned with SellerTray offline selling, price-control and exactly-once stock rules.');
const governedOffline = offlineGovernance.toLowerCase();
requireValue(governedOffline.includes('offline pos payment parity rule') && governedOffline.includes('partial payment') && governedOffline.includes('pay later') && governedOffline.includes('same merchant pos policy used online'), 'Offline implementation must remain aligned with the governing online/offline payment-parity policy.');

if (failures.length) { console.error('SellerTray offline reliability preflight failed:'); for (const failure of failures) console.error('- ' + failure); process.exit(1); }
console.log('SellerTray offline reliability preflight passed.');
