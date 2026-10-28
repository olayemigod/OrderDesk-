import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const management = read('src/ManagementPage.tsx');
const merchantApp = read('src/MerchantApp.tsx');
const navigation = read('src/portalNavigation.ts');
const agreements = read('src/CommercialAgreementsManagement.tsx');
const billing = read('src/SellerTrayBillingManagement.tsx');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };
const excludes = (source, values) => values.every((value) => !source.includes(value));

requireValue(
  navigation.includes("id: 'sellertray_billing'")
    && navigation.includes("label: 'Billing'")
    && navigation.includes("section: 'Business'")
    && navigation.includes("id: 'agreements'")
    && navigation.includes("label: 'Agreements'")
    && navigation.includes("id: 'payments'")
    && navigation.includes("label: 'Payments & Receivables'"),
  'Merchant navigation must keep Billing, Agreements, and customer Payments & Receivables as separate governed surfaces.',
);

requireValue(
  merchantApp.includes("page === 'sellertray_billing'")
    && merchantApp.includes('<SellerTrayBillingManagement tenantId={business.id} />')
    && merchantApp.includes("page === 'agreements'")
    && merchantApp.includes('<CommercialAgreementsManagement tenantId={business.id} />'),
  'Merchant App must route Billing and Agreements to their dedicated surfaces.',
);

requireValue(
  !management.includes('CommercialAgreementsManagement'),
  'Merchant Settings must remain settings-only and must not embed commercial agreements.',
);

requireValue(
  agreements.includes("functions.invoke('commercial-agreements'")
    && agreements.includes("action: 'merchant_list'")
    && agreements.includes("action: 'merchant_accept'"),
  'Agreements must use the governed commercial-agreements runtime for reads and acceptance.',
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
    "functions.invoke('billing-checkout'",
    "from('sellertray_commercial_agreements')",
    "from('sellertray_commercial_agreement_acceptances')",
    "from('sellertray_commercial_agreement_template_versions')",
    'SERVICE_ROLE',
    'SUPABASE_SECRET',
  ]),
  'Agreements must remain legal-only and must not bypass authority or own SellerTray payment checkout.',
);

requireValue(
  billing.includes("functions.invoke('commercial-billing'")
    && billing.includes("functions.invoke('billing-checkout'")
    && billing.includes('nextInstallmentScheduleId')
    && billing.includes('nextPayableAmount')
    && billing.includes("response.status === 'retry_required'")
    && billing.includes('response.needsNewCommand === true'),
  'Billing must read server-owned settlement state and preserve governed checkout retry semantics.',
);

requireValue(
  excludes(billing, ['SERVICE_ROLE', 'SUPABASE_SECRET', "from('sellertray_commercial_payment_confirmations')"]),
  'Billing must not bypass the governed commercial billing and checkout authorities.',
);

if (failures.length) {
  console.error('SellerTray commercial agreement and billing preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray commercial agreement and billing preflight passed.');
