import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const management = read('src/ManagementPage.tsx');
const agreements = read('src/CommercialAgreementsManagement.tsx');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };
const excludes = (source, values) => values.every((value) => !source.includes(value));

requireValue(
  management.includes("import CommercialAgreementsManagement from './CommercialAgreementsManagement'")
    && management.includes('<CommercialAgreementsManagement tenantId={tenantId} />'),
  'Merchant Settings must expose the governed Billing & agreements surface.',
);

requireValue(
  agreements.includes("functions.invoke('master-agreements'")
    && agreements.includes("action: 'merchant_list'")
    && agreements.includes("action: 'merchant_confirm_package'")
    && agreements.includes('orderFormId: selected.id'),
  'Billing & agreements must use the governed master-agreements runtime for package confirmation.',
);

requireValue(
  agreements.includes('authorityConfirmed: true')
    && agreements.includes('I accept the Master Agreement and confirm this exact Order Form.')
    && agreements.includes('I confirm this exact Order Form under the accepted Master Agreement.'),
  'Package confirmation must explicitly distinguish Master acceptance from exact Order Form confirmation.',
);

requireValue(
  agreements.includes('confirmationCommandIds.current.get(selected.id)')
    && agreements.includes('confirmationCommandIds.current.set(selected.id, commandId)')
    && agreements.includes('confirmationCommandIds.current.delete(selected.id)'),
  'Package confirmation must preserve one command identity across failed retries and clear it only after success.',
);

requireValue(
  agreements.includes("'Accept & Continue'")
    && agreements.includes("'Confirm Purchase'")
    && agreements.includes('center.masterAcceptanceRequired'),
  'Merchant Web must present the approved action for the current Master acceptance state.',
);

requireValue(
  excludes(agreements, [
    "from('sellertray_commercial_agreements')",
    "from('sellertray_commercial_agreement_acceptances')",
    "from('sellertray_commercial_agreement_template_versions')",
    "from('sellertray_master_agreement_acceptances')",
    "from('sellertray_commercial_order_forms')",
    "from('sellertray_order_form_confirmations')",
    "from('sellertray_agreement_packages')",
    'SERVICE_ROLE',
    'SUPABASE_SECRET',
  ]),
  'Merchant Web must not bypass Master/Order Form/package authority with raw table access or service credentials.',
);

if (failures.length) {
  console.error('SellerTray commercial agreement preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray commercial agreement preflight passed.');
