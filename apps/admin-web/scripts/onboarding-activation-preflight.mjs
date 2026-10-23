import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const adminCommercial = readFileSync(resolve(root, '../../supabase/functions/platform-admin-commercial/index.ts'), 'utf8');
const commercialWorkspace = readFileSync(resolve(root, 'src/CommercialBillingAdministration.tsx'), 'utf8');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(
  adminCommercial.includes("identity.aal !== 'aal2'") &&
    adminCommercial.includes("action === 'onboarding_state'") &&
    adminCommercial.includes("rpc<JsonRecord>('get_sellertray_onboarding_state_admin'"),
  'Admin onboarding state must be read only through the AAL2-protected commercial service',
);
requireValue(
  commercialWorkspace.includes('Payment obligation, payment confirmation, agreement acceptance and entitlement remain separate authorities.') &&
    commercialWorkspace.includes('Branch setup readiness'),
  'Admin commercial workspace must preserve separate payment/agreement/setup/entitlement visibility while OA1 adds the unified read projection',
);
requireValue(
  !adminCommercial.includes("from('tenant_subscriptions')") &&
    !adminCommercial.includes("from('sellertray_commercial_orders')"),
  'Admin OA1 read path must not reconstruct onboarding truth from raw tables',
);

if (failures.length) {
  console.error('SellerTray Admin onboarding activation preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('SellerTray Admin onboarding activation preflight passed.');
