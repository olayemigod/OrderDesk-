import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mobileRoot = process.cwd();
const repoRoot = resolve(mobileRoot, '../..');
const ui = readFileSync(join(mobileRoot, 'src/components/AccountDataControls.tsx'), 'utf8');
const repository = readFileSync(join(mobileRoot, 'src/data/accountLifecycleRepository.ts'), 'utf8');
const lifecycle = readFileSync(join(repoRoot, 'supabase/functions/account-lifecycle/index.ts'), 'utf8');
const teamMigration = readFileSync(join(repoRoot, 'supabase/migrations/20260910091000_team_membership_saas_foundation.sql'), 'utf8');
const billingMigration = readFileSync(join(repoRoot, 'supabase/migrations/20260910125000_paystack_billing_adapter_foundation.sql'), 'utf8');
const retentionMigration = readFileSync(join(repoRoot, 'supabase/migrations/20260912181000_financial_retention_and_storage_cleanup.sql'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  ui.includes("const DELETE_PHRASE = 'DELETE MY SELLERTRAY ACCOUNT'") &&
    ui.includes('Current password') &&
    ui.includes('Delete account permanently') &&
    ui.includes('deleteSellerTrayAccount(password)'),
  'Account deletion UI must retain password plus explicit permanent-action confirmation',
);

requireValue(
  repository.includes("action: 'delete_account'") &&
    repository.includes("confirmation: 'DELETE MY SELLERTRAY ACCOUNT'") &&
    repository.includes('data.deleted !== true'),
  'Mobile account deletion must remain behind the authenticated account-lifecycle server action',
);

requireValue(
  lifecycle.includes("passwordVerifier.auth.signInWithPassword") &&
    lifecycle.includes('Current password is incorrect') &&
    lifecycle.includes("orderdesk_has_unsettled_usage") &&
    lifecycle.includes('Cancel the active paid subscription before deleting this account'),
  'Account deletion must reauthenticate and retain usage/subscription financial gates',
);

requireValue(
  lifecycle.includes("archive_sellertray_financial_records") &&
    lifecycle.includes('loadTenantReceiptStoragePaths') &&
    lifecycle.includes('removeReceiptStorageObjects') &&
    lifecycle.includes('loadTenantMediaStorageObjects') &&
    lifecycle.includes('removeTenantMediaStorageObjects'),
  'Account deletion must retain financial evidence while deleting private merchant media and receipts',
);

requireValue(
  teamMigration.includes('invited_by_user_id uuid not null references auth.users(id) on delete restrict') &&
    lifecycle.includes("from('tenant_invitations').delete().eq('invited_by_user_id', userId)"),
  'Restrictive team-invitation user references must be cleaned before Auth deletion',
);

requireValue(
  billingMigration.includes('requested_by_user_id uuid not null references auth.users(id) on delete restrict') &&
    lifecycle.includes("from('billing_checkout_sessions').delete().eq('requested_by_user_id', userId)"),
  'Restrictive billing-checkout user references must be cleaned before Auth deletion',
);

requireValue(
  lifecycle.includes("from('tenant_members').delete().eq('user_id', userId)") &&
    lifecycle.includes('admin!.auth.admin.deleteUser(userId)') &&
    lifecycle.indexOf("from('tenant_members').delete().eq('user_id', userId)") < lifecycle.indexOf('admin!.auth.admin.deleteUser(userId)'),
  'Membership cleanup must precede permanent Auth-user deletion',
);

requireValue(
  lifecycle.includes('ProcessEdge administrator accounts cannot be deleted') &&
    lifecycle.includes('platform-administration audit history'),
  'Platform-administration identities and audit history must remain outside merchant self-service deletion',
);

requireValue(
  retentionMigration.includes("interval '6 years'") &&
    retentionMigration.includes('financial_retention_records') &&
    !retentionMigration.includes('customer_wa_id'),
  'Deletion must retain minimal financial evidence without copying customer WhatsApp identity',
);

if (failures.length) {
  console.error('SellerTray account-deletion preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray self-service account deletion preflight passed.');
