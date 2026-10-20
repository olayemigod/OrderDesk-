import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const appRoot = process.cwd();
const supabaseClient = readFileSync(resolve(appRoot, 'src/supabase.ts'), 'utf8');
const main = readFileSync(resolve(appRoot, 'src/main.tsx'), 'utf8');
const workspace = readFileSync(resolve(appRoot, 'src/AdminWorkspace.tsx'), 'utf8');
const legacyApp = readFileSync(resolve(appRoot, 'src/App.tsx'), 'utf8');
const legacySubscriptionAccess = readFileSync(resolve(appRoot, 'src/SubscriptionAccess.tsx'), 'utf8');
const vercel = readFileSync(resolve(appRoot, 'vercel.json'), 'utf8');
const edgeFunction = readFileSync(resolve(root, 'supabase/functions/platform-merchant-message/index.ts'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/migrations/20260917103526_platform_merchant_message_idempotency.sql'), 'utf8');
const platformAdminFunction = readFileSync(resolve(root, 'supabase/functions/platform-admin/index.ts'), 'utf8');
const platformAdminMigration = readFileSync(resolve(root, 'supabase/migrations/20260910120256_platform_admin_operations_foundation.sql'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  !supabaseClient.includes('SERVICE_ROLE') &&
    !workspace.includes('SERVICE_ROLE') &&
    !main.includes('SERVICE_ROLE') &&
    !legacyApp.includes('SERVICE_ROLE') &&
    !legacySubscriptionAccess.includes('SERVICE_ROLE') &&
    !supabaseClient.includes('SUPABASE_SECRET') &&
    !workspace.includes('SUPABASE_SECRET') &&
    !main.includes('SUPABASE_SECRET'),
  'Admin browser bundle must never reference a Supabase service-role or secret key.',
);

requireValue(
  supabaseClient.includes('detectSessionInUrl: false') &&
    workspace.includes('getAuthenticatorAssuranceLevel') &&
    workspace.includes('challengeAndVerify') &&
    workspace.includes("factorType: 'totp'"),
  'Active Admin authentication must remain password-session based with TOTP/AAL2 enforcement.',
);

requireValue(
  main.includes("import AdminWorkspace from './AdminWorkspace'") &&
    !main.includes('SubscriptionAccess') &&
    !workspace.includes("action: 'extend_trial_days'") &&
    !workspace.includes('Extend trial'),
  'The active Admin Web must not expose the legacy free-trial extension workflow.',
);

requireValue(
  workspace.includes("'Overview'") &&
    workspace.includes("'Merchants'") &&
    workspace.includes("'Billing & Commercial'") &&
    workspace.includes("'Communications'") &&
    workspace.includes("'Platform Operations'") &&
    workspace.includes("'Audit'"),
  'Admin Web must retain the approved professional platform-operations navigation.',
);

requireValue(
  vercel.includes('Content-Security-Policy') &&
    vercel.includes("frame-ancestors 'none'") &&
    vercel.includes('Permissions-Policy') &&
    vercel.includes('X-Frame-Options'),
  'Admin deployment must retain anti-framing, CSP and browser-permission restrictions.',
);

requireValue(
  supabaseClient.includes("functionName === 'platform-merchant-message'") &&
    supabaseClient.includes('sessionStorage.setItem') &&
    supabaseClient.includes("crypto.subtle.digest('SHA-256'") &&
    workspace.includes("'platform-merchant-message'") &&
    edgeFunction.includes('p_request_id: requestId') &&
    migration.includes('platform_merchant_campaigns_actor_request_uidx') &&
    migration.includes("'idempotentReplay',true"),
  'Platform merchant broadcasts must retain end-to-end retry idempotency.',
);

requireValue(
  edgeFunction.includes("identity.aal !== 'aal2'") &&
    migration.includes("v_admin_role <> 'admin'") &&
    migration.includes('to service_role'),
  'Publishing must remain server-authorized by AAL2 plus ProcessEdge Platform Admin role.',
);

requireValue(
  platformAdminFunction.includes("identity.aal !== 'aal2'") &&
    platformAdminFunction.includes("action === 'extend_trial_days'") &&
    platformAdminMigration.includes("p_action = 'extend_trial_days'") &&
    platformAdminMigration.includes("v_role <> 'admin'") &&
    platformAdminMigration.includes('insert into public.platform_admin_audit') &&
    platformAdminMigration.includes('to service_role'),
  'Legacy trial compatibility must remain AAL2-gated, Platform Admin-only and audited until C2 removes it.',
);

requireValue(
  platformAdminFunction.includes('days < 1 || days > 90') &&
    platformAdminMigration.includes('v_days < 1 or v_days > 90'),
  'Legacy trial compatibility must retain bounded server validation until migration/removal.',
);

requireValue(
  supabaseClient.includes('optionalAuditRequest') &&
    supabaseClient.includes('emptyAuditResponse') &&
    workspace.includes("event.action === 'merchant_message_published'"),
  'Audit refresh must remain supplementary and must not turn a committed broadcast into an apparent publish failure.',
);

requireValue(
  workspace.includes("action: 'ai_parser_readiness'") &&
    workspace.includes("action: 'ai_parser_probe'") &&
    platformAdminFunction.includes("overview.actorRole !== 'admin'") &&
    platformAdminFunction.includes('ProcessEdge platform Admin role required for AI smoke test'),
  'Platform Operations AI diagnostics must remain governed and Admin-only for active probes.',
);

if (failures.length) {
  console.error('SellerTray Admin security preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Admin security preflight passed.');
