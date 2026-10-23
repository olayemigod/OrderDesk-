import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const merchantApp = readFileSync(resolve(root, 'src/MerchantApp.tsx'), 'utf8');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(
  merchantApp.includes("supabase.rpc('get_sellertray_onboarding_state'") &&
    merchantApp.includes('onboarding?.enrolled && !onboarding.operationsAllowed'),
  'Merchant Web must consume and expose the shared SellerTray onboarding projection',
);
requireValue(
  merchantApp.includes("params.get('business')") &&
    merchantApp.includes("params.get('onboarding') === '1'") &&
    merchantApp.includes("setPage('settings')"),
  'Secure onboarding handoff must resolve the intended Business and open the commercial Settings surface',
);
requireValue(
  merchantApp.includes("window.history.replaceState(null, '', window.location.pathname || '/')"),
  'Merchant Web must remove the one-time onboarding routing query after it is consumed',
);
requireValue(
  !merchantApp.includes("from('sellertray_commercial_orders')") &&
    !merchantApp.includes("from('tenant_subscriptions')"),
  'Merchant shell must not rebuild commercial or entitlement truth from raw tables',
);

if (failures.length) {
  console.error('SellerTray Merchant onboarding activation preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('SellerTray Merchant onboarding activation preflight passed.');
