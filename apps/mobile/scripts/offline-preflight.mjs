import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const sell = readFileSync(resolve(root, 'src/redesign/SellWorkspace.tsx'), 'utf8');
const hook = readFileSync(resolve(root, 'src/hooks/useOfflineSalesSync.ts'), 'utf8');
const offline = readFileSync(resolve(root, 'src/data/offlineSalesRepository.ts'), 'utf8');
const prepare = readFileSync(resolve(root, 'src/data/posDraftPreparationRepository.ts'), 'utf8');
const inventory = readFileSync(resolve(root, 'src/redesign/InventoryWorkspace.tsx'), 'utf8');
const customer = readFileSync(resolve(root, 'src/redesign/PosCustomerSelector.tsx'), 'utf8');
const safeError = readFileSync(resolve(root, 'src/data/userFacingError.ts'), 'utf8');
const policy = readFileSync(resolve(root, 'src/data/posPaymentRepository.ts'), 'utf8');
const skill = readFileSync(resolve(root, '../../.agents/skills/sellertray-project-implementation/SKILL.md'), 'utf8');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(sell.includes('sellingPrice: number') && sell.includes('configured') && sell.includes('canOverridePrice') && sell.includes('Unit price') && sell.includes('prepareGovernedPosDraft'), 'Sell must separate configured price from the governed effective selling price and expose an authorised unit-price edit.');
requireValue(policy.includes('allowPriceOverride') && policy.includes('canOverridePrice'), 'POS price changes must remain controlled by merchant policy and operator capability.');
requireValue(prepare.includes('createPosDraft') && prepare.includes('updatePosDraftItems') && prepare.includes('expectedSellingPrice') && prepare.includes('sellingPrice'), 'Price overrides must use the governed draft command after configured-price validation, never direct order-item writes.');
requireValue(offline.includes("OfflineCompletionIntent = 'draft' | 'cash' | 'bank'") && offline.includes('OfflineBankPaymentEvidence') && offline.includes('bankPayment') && offline.includes('sellingPrice') && offline.includes('reserveCachedStock') && offline.includes('MAX_OPEN_INTENTS = 50'), 'Offline outbox must preserve effective price, support Draft/Cash/Bank completion intents, retain governed Bank evidence, reserve cached Cash stock and stay bounded.');
requireValue(sell.includes("completionIntent: 'cash'") && sell.includes('Cash sale recorded offline') && sell.includes('loadPosPaymentMethodsCache') && sell.includes('loadPosPolicyCache'), 'Sell must cache governed payment/policy context and record eligible offline cash sales rather than only holding drafts.');
requireValue(hook.includes('probeReachability') && hook.includes('backendReachable === false') && hook.includes("sale.completionIntent === 'cash'") && hook.includes('completePosSale') && hook.includes('prepareGovernedPosDraft'), 'Offline status must reflect backend reachability and replay cash sales through governed draft and checkout commands.');
requireValue(offline.includes('unknownhost') && offline.includes('unable to resolve host'), 'DNS/backend reachability failures must be classified as offline conditions.');
requireValue(sell.includes("catalogueView") && sell.includes("'grid'") && sell.includes('grid-outline') && sell.includes('list-outline'), 'POS catalogue must default to governed tile view and retain an explicit compact list toggle.');
requireValue(inventory.includes('loadBranchStockCache') && inventory.includes('saveBranchStockCache') && inventory.includes('last saved stock'), 'Inventory must consume the same governed branch-stock cache as POS when offline.');
requireValue(customer.includes('loadCustomerCache') && customer.includes('saveCustomerCache'), 'POS customer selection must use the governed offline customer cache.');
requireValue(safeError.includes('supabase\\.co') && safeError.includes('Connect to continue.') && safeError.includes('sellerTrayBackgroundError') && safeError.includes('isLikelyConnectivityError'), 'Merchant-facing error translation must suppress infrastructure details, treat background connectivity loss as global state, and reserve Connect to continue for user-triggered online-only actions.');
requireValue(offline.includes("throw new Error('A completed offline cash sale cannot be discarded") && offline.includes("throw new Error('An offline Bank transfer sale cannot be discarded") && hook.includes('syncOfflinePosSales'), 'Locally completed Cash/Bank offline sales must not be destructively discarded and must reconcile through the sync queue.');
const governed = skill.toLowerCase();
requireValue(governed.includes('offline-capable selling') && governed.includes('controlled discounts/price overrides') && governed.includes('sale reduces stock exactly once'), 'Implementation must remain aligned with SellerTray offline selling, price-control and exactly-once stock rules.');

if (failures.length) { console.error('SellerTray offline reliability preflight failed:'); for (const failure of failures) console.error('- ' + failure); process.exit(1); }
console.log('SellerTray offline reliability preflight passed.');
