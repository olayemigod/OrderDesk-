import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => readFileSync(join(root, path), 'utf8');
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

const provisionedApp = read('src/ProvisionedApp.tsx');
const repository = read('src/data/onboardingRepository.ts');
const view = read('src/components/OnboardingActivationView.tsx');

requireValue(
  provisionedApp.includes("useSellerTrayOnboarding(activeBusiness?.id ?? null)") &&
    provisionedApp.includes("if (!onboarding.state || !onboarding.state.operationsAllowed)") &&
    provisionedApp.indexOf('if (!onboarding.state || !onboarding.state.operationsAllowed)') < provisionedApp.indexOf('return <RedesignWorkspace />'),
  'Mobile must fail closed into setup/activation before entering the live workspace',
);
requireValue(
  repository.includes("supabase.rpc('get_sellertray_onboarding_state'") &&
    repository.includes("supabase.functions.invoke('onboarding-handoff'"),
  'Mobile onboarding must consume shared state and the governed web handoff',
);
requireValue(
  view.includes('Continue setup securely') &&
    view.includes('Preparation mode') &&
    view.includes('live POS sales, purchasing, stock movements, cashier shifts'),
  'Mobile must explain the bounded preparation mode and secure web continuation',
);
requireValue(
  !/fontSize:\s*(?:[0-9]|1[0-3](?:\.\d+)?)(?:\s*[,}])/.test(view),
  'OA1 Mobile onboarding text must not introduce font sizes below 14',
);

if (failures.length) {
  console.error('SellerTray onboarding activation preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('SellerTray onboarding activation preflight passed.');
