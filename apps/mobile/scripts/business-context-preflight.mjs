import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobileRoot = process.cwd();
const failures = [];
const read = (path) => readFileSync(join(mobileRoot, path), 'utf8');
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

const provisioning = read('src/ProvisionedApp.tsx');
const businesses = read('src/hooks/useBusinesses.ts');
const shell = read('src/redesign/MobileShell.tsx');
const selector = read('src/redesign/BusinessContextSelection.tsx');

requireValue(
  provisioning.includes('BusinessContextSelectionProvider')
    && provisioning.includes('businesses={businesses}')
    && provisioning.includes('activeBusinessId={activeBusiness.id}')
    && provisioning.includes('onSelectBusiness={selectBusiness}')
    && provisioning.includes('<RedesignWorkspace key={activeBusiness.id} />'),
  'Provisioned Mobile workspace must mount the Business selector above tenant-bound redesign state and remount on Business change.',
);

const persistIndex = businesses.indexOf('await AsyncStorage.setItem(ACTIVE_BUSINESS_KEY, businessId);');
const stateIndex = businesses.indexOf('setActiveBusinessId(businessId);');
requireValue(
  persistIndex >= 0 && stateIndex > persistIndex
    && businesses.includes("throw new Error('This Business is no longer available to your account. Refresh SellerTray and try again.')"),
  'Business switching must validate membership and persist the next Business before exposing the new tenant context to mounted workspaces.',
);

requireValue(
  shell.includes('useBusinessContextSelection()')
    && shell.includes('businessContext.canSwitchBusiness')
    && shell.includes('businessContext.openBusinessSwitcher')
    && shell.includes('accessibilityLabel={`Switch Business. Current Business ${businessName}`}')
    && shell.includes('accessibilityLabel="Switch Branch"')
    && shell.includes('>Branch</Text>'),
  'Redesigned Mobile shell must provide distinct, accessible Business and Branch context controls.',
);

requireValue(
  selector.includes('useWindowDimensions()')
    && selector.includes('width >= 600')
    && selector.includes('<Modal')
    && selector.includes("businesses.length > 1")
    && selector.includes('minHeight: 68')
    && selector.includes('Current Business')
    && selector.includes('Branch selection remains separate inside that Business.'),
  'Business selector must use an adaptive sheet/dialog with large touch rows, explicit current state, and separate Branch semantics.',
);

requireValue(
  selector.includes('await onSelectBusiness(businessId);')
    && selector.includes('disabled={Boolean(switchingId)}')
    && selector.includes('accessibilityState={{ selected: active, busy: switching }}'),
  'Business selection must serialize switches and expose selected/busy state instead of permitting overlapping context changes.',
);

if (failures.length > 0) {
  console.error('SellerTray Business-context preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray Business-context preflight passed.');
