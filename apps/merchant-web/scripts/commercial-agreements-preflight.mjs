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
  agreements.includes("functions.invoke('commercial-agreements'")
    && agreements.includes("action: 'merchant_list'")
    && agreements.includes("action: 'merchant_accept'"),
  'Billing & agreements must use the governed commercial-agreements runtime for reads and acceptance.',
);

requireValue(
  agreements.includes('authorityConfirmed: true')
    && agreements.includes('I confirm I am authorised to act for this business and accept this agreement.'),
  'Commercial agreement acceptance must carry the explicit merchant authority confirmation shown in the UI.',
);

requireValue(
  agreements.includes('acceptanceCommandIds.current.get(selected.id)')
    && agreements.includes('acceptanceCommandIds.current.set(selected.id, commandId)')
    && agreements.includes('acceptanceCommandIds.current.delete(selected.id)'),
  'Commercial agreement acceptance must preserve one command identity across failed retries and clear it only after success.',
);

requireValue(
  excludes(agreements, [
    "from('sellertray_commercial_agreements')",
    "from('sellertray_commercial_agreement_acceptances')",
    "from('sellertray_commercial_agreement_template_versions')",
    'SERVICE_ROLE',
    'SUPABASE_SECRET',
  ]),
  'Merchant Web must not bypass C1A commercial agreement authority with raw table access or service credentials.',
);

if (failures.length) {
  console.error('SellerTray commercial agreement preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray commercial agreement preflight passed.');
