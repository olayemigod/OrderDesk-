import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mobileRoot = process.cwd();
const repoRoot = resolve(mobileRoot, '../..');
const failures = [];

function read(path) { return readFileSync(path, 'utf8'); }
function requireValue(condition, message) { if (!condition) failures.push(message); }

const migration = read(join(repoRoot, 'supabase/migrations/20261014195000_inventory_operation_command_identity_classification.sql'));
const authorityMigration = read(join(repoRoot, 'supabase/migrations/20261016222000_inventory_adjustment_authority_convergence.sql'));
const edge = read(join(repoRoot, 'supabase/functions/inventory-operation/index.ts'));
const repository = read(join(mobileRoot, 'src/data/inventoryRepository.ts'));
const workspace = read(join(mobileRoot, 'src/redesign/InventoryWorkspace.tsx'));
const references = read(join(mobileRoot, 'src/redesign/operationalReference.ts'));

requireValue(
  migration.includes('p_command_id text') && migration.includes("p_tenant_id::text || '|' || v_command_id") && migration.includes('Stock action retry identity is already used for different stock facts'),
  'Inventory retries must use a hidden tenant-scoped command identity and reject changed replay facts',
);
requireValue(
  migration.includes('lower(btrim(im.reference_id))=lower(v_reference)') && migration.includes('Reference is already used for a different stock movement'),
  'Merchant-facing inventory references must remain an independent duplicate guard',
);
requireValue(
  migration.includes("v_movement_type := 'opening'") && migration.includes("when v_reason_key='damage' then 'damaged'") && migration.includes("when v_reason_key='expiry' then 'expired'"),
  'Opening, damage and expiry must use canonical stock movement classifications',
);
requireValue(
  migration.includes('Use Stock Transfer to move stock from another branch') && migration.includes('Use Stock Count to reconcile counted stock') && migration.includes('Opening stock can only be posted before other stock movements for this product'),
  'Direct stock actions must not bypass Stock Transfer, Stock Count or opening-stock history rules',
);
requireValue(
  edge.includes('const commandId = cleanCommandId(body.commandId)') && edge.includes('p_command_id: commandId') && edge.includes("['inventory recovery', 'Inventory recovery']") && !edge.includes("['supplier delivery', 'Supplier delivery']") && edge.includes("admin.rpc('apply_sellertray_stock_adjustment'"),
  'Inventory Edge Function must expose governed adjustments without a generic supplier receipt path',
);
requireValue(
  authorityMigration.includes('apply_sellertray_stock_adjustment') && authorityMigration.includes('revoke execute on function public.apply_sellertray_inventory_operation') && authorityMigration.includes('from service_role'),
  'Generic inventory receipt authority must be retired from the service runtime',
);
requireValue(
  repository.includes('commandId: string;') && repository.includes('commandId: input.commandId.trim()'),
  'Mobile inventory repository must require and send the hidden command identity',
);
requireValue(
  references.includes('function createHiddenCommandId(prefix: string)') && references.includes('createInventoryOperationCommandId') && references.includes('return createHiddenCommandId(`invop:${kind}`)'),
  'Mobile must generate a non-user-facing inventory command identity',
);
requireValue(
  workspace.includes("setCommandId(createInventoryOperationCommandId('adjust'))") && workspace.includes('commandId,') && workspace.includes("onPress={() => setReference(createOperationalReference('adjust'))}"),
  'Inventory adjustment form must preserve its hidden command identity while allowing the visible reference to change',
);
requireValue(
  !workspace.includes("'Branch replenishment'") && !workspace.includes("'Stock count correction'") && workspace.includes("'Inventory recovery'") && workspace.includes('Supplier deliveries are received from Purchase Receiving') && workspace.includes('Stock sent from another branch is received through Stock Transfers'),
  'Mobile inventory must route supplier receipts and branch transfers to their governed workflows',
);
requireValue(
  workspace.includes("reason === 'Damage' || reason === 'Expiry' || reason === 'Missing / shrinkage'") && workspace.includes("reason === 'Inventory recovery'") && workspace.includes('disabled={forcedDirection !== null}'),
  'Inventory adjustments must enforce direction-safe reason semantics',
);

if (failures.length > 0) {
  console.error('SellerTray inventory operation preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('SellerTray inventory operation preflight passed.');
