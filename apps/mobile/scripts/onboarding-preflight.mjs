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

const migration = read(join(repoRoot, 'supabase/migrations/20261023124500_merchant_onboarding_read_model.sql'));
const repository = read(join(mobileRoot, 'src/data/onboardingRepository.ts'));
const businessesHook = read(join(mobileRoot, 'src/hooks/useBusinesses.ts'));
const hook = read(join(mobileRoot, 'src/hooks/useOnboardingState.ts'));
const card = read(join(mobileRoot, 'src/redesign/OnboardingPreparationCard.tsx'));
const home = read(join(mobileRoot, 'src/redesign/HomeDashboard.tsx'));

requireValue(
  migration.includes('get_sellertray_onboarding_state_core') &&
    migration.includes('get_sellertray_onboarding_state_admin') &&
    migration.includes("'informational_only_until_oa4'"),
  'OA1 must keep one shared server onboarding projection with merchant/Admin wrappers and an explicit non-blocking phase marker',
);
requireValue(
  migration.includes("grant execute on function public.get_sellertray_onboarding_state(uuid)\n  to authenticated") &&
    migration.includes('revoke all on function public.get_sellertray_onboarding_state_core(uuid)\n  from public,anon,authenticated') &&
    migration.includes("if v_role is null or v_role not in ('owner','manager')") &&
    migration.includes("if v_role is null or v_role not in ('admin','support')"),
  'Onboarding wrappers must reject missing identities explicitly and clients must not execute the internal core directly',
);
requireValue(
  migration.includes("'approvedAdjustmentAmount',v_approved_adjustment_amount") &&
    migration.includes("'directPaymentAmount',0") &&
    migration.includes("v_approved_adjustment_amount numeric(18,2) := 0"),
  'OA1 must not manufacture discount/direct-payment facts before OA2 authority is implemented',
);
requireValue(
  repository.includes("supabase.rpc('get_sellertray_onboarding_state'") &&
    !repository.includes('get_sellertray_onboarding_state_core') &&
    !repository.includes('get_sellertray_onboarding_state_admin'),
  'Mobile must consume only the merchant-facing onboarding read wrapper',
);
requireValue(
  businessesHook.includes('orderdesk.activeBusinessRoleHint') &&
    businessesHook.includes('nextActiveBusiness.role') &&
    hook.includes('orderdesk.activeBusinessRoleHint') &&
    hook.includes("role === 'owner' || role === 'manager'") &&
    hook.includes('isPermissionDenied'),
  'Mobile onboarding commercial detail must suppress staff reads locally while retaining the server Owner/Manager authority check',
);
requireValue(
  hook.includes("AppState.addEventListener('change'") &&
    hook.includes("nextState === 'active'") &&
    hook.includes('void refresh()'),
  'Mobile onboarding status must refresh when the app returns to the foreground so external Merchant Web progress is reflected',
);
requireValue(
  card.includes('Preparation') &&
    card.includes('Current selling access remains available') &&
    card.includes('Continue this step in Merchant Web'),
  'The Mobile onboarding surface must explain preparation mode, legacy compatibility and Merchant Web ownership of commercial steps',
);
requireValue(
  home.includes('<OnboardingPreparationCard') &&
    home.includes('onPress={onNewSale}') &&
    !home.includes('onboarding.state.activation.operationallyActive && onNewSale'),
  'OA1 Mobile must show onboarding preparation without turning onboarding into a Sell gate',
);

if (failures.length > 0) {
  console.error('SellerTray onboarding preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray onboarding preflight passed.');
