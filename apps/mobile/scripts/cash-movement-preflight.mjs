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

const migration = read(join(repoRoot, 'supabase/migrations/20261014200500_cash_movement_command_identity.sql'));
const edge = read(join(repoRoot, 'supabase/functions/cash-shift/index.ts'));
const repository = read(join(mobileRoot, 'src/data/cashShiftRepository.ts'));
const workspace = read(join(mobileRoot, 'src/redesign/CashShiftWorkspace.tsx'));
const references = read(join(mobileRoot, 'src/redesign/operationalReference.ts'));

requireValue(
  migration.includes('command_id_hash text') &&
    migration.includes("pg_catalog.md5(p_tenant_id::text||'|'||v_command_id)") &&
    migration.includes('Cash activity retry identity is already used for different facts'),
  'Cash movements must use a hidden tenant-scoped retry identity and reject changed replay facts',
);
requireValue(
  migration.includes('lower(btrim(m.reference))=lower(v_reference)') &&
    migration.includes('This cash reference is already used for different facts'),
  'Merchant-facing cash reference must remain a separate duplicate guard',
);
requireValue(
  migration.includes('sellertray_shift_cash_movements_command_unique') &&
    migration.includes('where command_id_hash is not null'),
  'Cash movement command identity must be uniquely enforced for the business',
);
requireValue(
  edge.includes('const commandId = cleanCommandId(body.commandId)') &&
    edge.includes('p_command_id: commandId'),
  'Cash Shift Edge Function must validate and forward the hidden movement command identity',
);
requireValue(
  repository.includes('commandId: string;') &&
    repository.includes('commandId: input.commandId.trim()'),
  'Mobile cash repository must require and send the hidden movement command identity',
);
requireValue(
  references.includes('createCashMovementCommandId') &&
    references.includes('cash:${kind}'),
  'Mobile must generate a non-user-facing cash movement command identity',
);
requireValue(
  workspace.includes('setMovementCommandId(createCashMovementCommandId(type))') &&
    workspace.includes('commandId: movementCommandId') &&
    workspace.includes("setMovementCommandId('')"),
  'Cash activity form must preserve one hidden command identity through retries and clear it when the form ends',
);
requireValue(
  workspace.includes('value={movementReference}') &&
    workspace.includes('onChangeText={setMovementReference}') &&
    !workspace.includes('command ID') &&
    !workspace.includes('idempotency'),
  'Cash reference stays merchant-editable without exposing internal retry terminology',
);

if (failures.length > 0) {
  console.error('SellerTray cash movement preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray cash movement preflight passed.');
