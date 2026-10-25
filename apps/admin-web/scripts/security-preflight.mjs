import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const appRoot = process.cwd();
const supabaseClient = readFileSync(resolve(appRoot, 'src/supabase.ts'), 'utf8');
const main = readFileSync(resolve(appRoot, 'src/main.tsx'), 'utf8');
const activeWorkspace = readFileSync(resolve(appRoot, 'src/AdminWorkspace.tsx'), 'utf8');
const communications = readFileSync(resolve(appRoot, 'src/AdminCommunicationsWorkspaces.tsx'), 'utf8');
const operations = readFileSync(resolve(appRoot, 'src/AdminOperationsWorkspaces.tsx'), 'utf8');
const revenue = readFileSync(resolve(appRoot, 'src/RevenueDashboard.tsx'), 'utf8');
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
    !activeWorkspace.includes('SERVICE_ROLE') &&
    !communications.includes('SERVICE_ROLE') &&
    !operations.includes('SERVICE_ROLE') &&
    !revenue.includes('SERVICE_ROLE') &&
    !main.includes('SERVICE_ROLE') &&
    !legacyApp.includes('SERVICE_ROLE') &&
    !legacySubscriptionAccess.includes('SERVICE_ROLE') &&
    !supabaseClient.includes('SUPABASE_SECRET') &&
    !activeWorkspace.includes('SUPABASE_SECRET') &&
    !communications.includes('SUPABASE_SECRET') &&
    !operations.includes('SUPABASE_SECRET') &&
    !revenue.includes('SUPABASE_SECRET') &&
    !main.includes('SUPABASE_SECRET'),
  'Admin browser bundle must never reference a Supabase service-role or secret key.',
);

requireValue(
  supabaseClient.includes('detectSessionInUrl: false') &&
    activeWorkspace.includes('getAuthenticatorAssuranceLevel') &&
    activeWorkspace.includes('challengeAndVerify') &&
    activeWorkspace.includes("factorType: 'totp'"),
  'Active Admin authentication must remain password-session based with TOTP/AAL2 enforcement.',
);

requireValue(
  main.includes("import AdminWorkspace from './AdminWorkspace'") &&
    !main.includes('AdminWorkspaceV3') &&
    !main.includes('SubscriptionAccess') &&
    !activeWorkspace.includes("action: 'extend_trial_days'") &&
    !activeWorkspace.includes('Extend trial'),
  'The active Admin Web must not expose the legacy free-trial extension workflow.',
);

requireValue(
  activeWorkspace.includes("label: 'Overview'") &&
    activeWorkspace.includes("label: 'Merchants'") &&
    activeWorkspace.includes("label: 'Commercial'") &&
    activeWorkspace.includes("label: 'Onboarding & Setup'") &&
    activeWorkspace.includes("label: 'Communications'") &&
    activeWorkspace.includes("label: 'Platform Operations'") &&
    activeWorkspace.includes("label: 'Insights & Reports'") &&
    activeWorkspace.includes("label: 'Governance'") &&
    activeWorkspace.includes("label: 'Commercial Orders'") &&
    activeWorkspace.includes("label: 'Plans & Pricing'") &&
    activeWorkspace.includes("label: 'Setup Resources'") &&
    activeWorkspace.includes("label: 'Compose Message'") &&
    activeWorkspace.includes("label: 'Campaign History'") &&
    activeWorkspace.includes("label: 'WhatsApp Operations'") &&
    activeWorkspace.includes("label: 'AI Operations'") &&
    activeWorkspace.includes("label: 'Revenue Dashboard'") &&
    activeWorkspace.includes('admin-nav-group-button') &&
    activeWorkspace.includes('admin-nav-submenu-link'),
  'Admin Web must retain the approved grouped professional platform-operations navigation.',
);

requireValue(
  revenue.includes("action: 'business_dashboard'") &&
    revenue.includes('recognised revenue is not calculated or displayed here') &&
    revenue.includes('Amounts are never combined across currencies') &&
    platformAdminFunction.includes("action === 'business_dashboard'") &&
    platformAdminFunction.includes('platform_admin_business_summary'),
  'Revenue Dashboard must reuse governed platform reporting authority and preserve the accounting boundary.',
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
    communications.includes("'platform-merchant-message'") &&
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
    communications.includes("event.action === 'merchant_message_published'"),
  'Audit refresh must remain supplementary and must not turn a committed broadcast into an apparent publish failure.',
);

requireValue(
  operations.includes("action: 'operations_summary'") &&
    operations.includes("action: 'ai_parser_probe'") &&
    platformAdminFunction.includes("bootstrap.actorRole !== 'admin'") &&
    platformAdminFunction.includes('platform_admin_operations_summary') &&
    platformAdminFunction.includes('ProcessEdge platform Admin role required for AI smoke test'),
  'Platform Operations AI diagnostics must remain governed and Admin-only for active probes.',
);

if (failures.length) {
  console.error('SellerTray Admin security preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Admin security preflight passed.');
