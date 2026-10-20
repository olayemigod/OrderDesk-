import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const appRoot = process.cwd();
const supabaseClient = readFileSync(resolve(appRoot, 'src/supabase.ts'), 'utf8');
const app = readFileSync(resolve(appRoot, 'src/App.tsx'), 'utf8');
const subscriptionAccess = readFileSync(resolve(appRoot, 'src/SubscriptionAccess.tsx'), 'utf8');
const vercel = readFileSync(resolve(appRoot, 'vercel.json'), 'utf8');
const edgeFunction = readFileSync(resolve(root, 'supabase/functions/platform-merchant-message/index.ts'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/migrations/20260917121500_platform_merchant_message_idempotency.sql'), 'utf8');
const platformAdminFunction = readFileSync(resolve(root, 'supabase/functions/platform-admin/index.ts'), 'utf8');
const platformAdminMigration = readFileSync(resolve(root, 'supabase/migrations/20260910120256_platform_admin_operations_foundation.sql'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

requireValue(
  !supabaseClient.includes('SERVICE_ROLE') &&
    !app.includes('SERVICE_ROLE') &&
    !subscriptionAccess.includes('SERVICE_ROLE') &&
    !supabaseClient.includes('SUPABASE_SECRET') &&
    !app.includes('SUPABASE_SECRET') &&
    !subscriptionAccess.includes('SUPABASE_SECRET'),
  'Admin browser bundle must never reference a Supabase service-role or secret key.',
);

requireValue(
  supabaseClient.includes('detectSessionInUrl: false') &&
    app.includes('getAuthenticatorAssuranceLevel') &&
    app.includes('challengeAndVerify') &&
    app.includes("factorType: 'totp'"),
  'Admin authentication must remain password-session based with TOTP/AAL2 enforcement.',
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
  subscriptionAccess.includes("action: 'extend_trial_days'") &&
    subscriptionAccess.includes("'platform-admin'") &&
    platformAdminFunction.includes("identity.aal !== 'aal2'") &&
    platformAdminFunction.includes("action === 'extend_trial_days'") &&
    platformAdminMigration.includes("p_action = 'extend_trial_days'") &&
    platformAdminMigration.includes("v_role <> 'admin'") &&
    platformAdminMigration.includes('insert into public.platform_admin_audit') &&
    platformAdminMigration.includes('to service_role'),
  'Subscription trial extensions must remain AAL2-gated, Platform Admin-only and audit-recorded server actions.',
);

requireValue(
  subscriptionAccess.includes("value: days") &&
    subscriptionAccess.includes('days < 1 || days > 90') &&
    platformAdminFunction.includes('days < 1 || days > 90') &&
    platformAdminMigration.includes('v_days < 1 or v_days > 90'),
  'Trial extension bounds must remain 1 to 90 days in both admin UI and governed server boundary.',
);

requireValue(
  supabaseClient.includes('optionalAuditRequest') &&
    supabaseClient.includes('emptyAuditResponse') &&
    app.includes("event.action === 'merchant_message_published'"),
  'Audit refresh must remain supplementary and must not turn a committed broadcast into an apparent publish failure.',
);

if (failures.length) {
  console.error('SellerTray Admin security preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Admin security preflight passed.');
