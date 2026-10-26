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
    && navigation.includes("label: 'SellerTray Billing'")
    && navigation.includes("id: 'agreements'")
    && navigation.includes("label: 'Agreements'")
    && navigation.includes("id: 'payments'")
    && navigation.includes("label: 'Payments & Receivables'"),
  'Merchant navigation must keep SellerTray Billing, Agreements, and customer Payments & Receivables as separate surfaces.',
);

requireValue(
  merchantApp.includes("page === 'sellertray_billing'")
    && merchantApp.includes('<SellerTrayBillingManagement tenantId={business.id} />')
    && merchantApp.includes("page === 'agreements'")
    && merchantApp.includes('<CommercialAgreementsManagement tenantId={business.id} />'),
  'Merchant App must route SellerTray Billing and Agreements to their dedicated surfaces.',
);

requireValue(
  !management.includes('CommercialAgreementsManagement'),
  'Merchant Settings must remain settings-only and must not embed legal agreement authority.',
);

requireValue(
  agreements.includes("functions.invoke('master-agreements'")
    && agreements.includes("action: 'merchant_get'")
    && agreements.includes("action: 'merchant_accept'"),
  'Agreements must use the governed master-agreements runtime for reads and acceptance.',
);

requireValue(
  agreements.includes('authorityConfirmed: true')
    && agreements.includes('I confirm I am authorised to act for this Business and accept this SellerTray Master Agreement version.'),
  'Master Agreement acceptance must carry the explicit merchant authority confirmation shown in the UI.',
);

requireValue(
  agreements.includes('acceptanceCommandIds.current.get(versionId)')
    && agreements.includes('acceptanceCommandIds.current.set(versionId, commandId)')
    && agreements.includes('acceptanceCommandIds.current.delete(versionId)'),
  'Master Agreement acceptance must preserve one command identity per current version across failed retries and clear it only after success.',
);

requireValue(
  agreements.includes('new orders do not require the same agreement again')
    && agreements.includes('Commercial orders and payments remain separate')
    && agreements.includes('independent of your commercial orders, plans, Branches and payment schedule'),
  'Merchant Agreement UI must keep universal legal acceptance independent of orders and payment.',
);

requireValue(
  excludes(agreements, [
    "functions.invoke('commercial-agreements'",
    "functions.invoke('billing-checkout'",
    "from('sellertray_commercial_agreements')",
    "from('sellertray_commercial_agreement_acceptances')",
    "from('sellertray_commercial_agreement_template_versions')",
    'commercialOrderId',
    'installmentObligationId',
    'SERVICE_ROLE',
    'SUPABASE_SECRET',
  ]),
  'Master Agreement surface must remain universal/legal-only and must not revive order-bound agreement or payment authority.',
);

requireValue(
  billing.includes("functions.invoke('commercial-billing'")
    && billing.includes("functions.invoke('billing-checkout'")
    && billing.includes('nextInstallmentScheduleId')
    && billing.includes('nextPayableAmount')
    && billing.includes("response.status === 'retry_required'")
    && billing.includes('response.needsNewCommand === true'),
  'SellerTray Billing must read server-owned settlement state and preserve governed checkout retry semantics.',
);

requireValue(
  excludes(billing, ['SERVICE_ROLE', 'SUPABASE_SECRET', "from('sellertray_commercial_payment_confirmations')"]),
  'SellerTray Billing must not bypass the governed commercial billing and checkout authorities.',
);

if (failures.length) {
  console.error('SellerTray Master Agreement and billing preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Master Agreement and billing preflight passed.');
