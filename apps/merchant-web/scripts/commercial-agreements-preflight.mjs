import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const management = read('src/ManagementPage.tsx');
const merchantApp = read('src/MerchantApp.tsx');
const navigation = read('src/portalNavigation.ts');
const agreements = read('src/CommercialAgreementsManagement.tsx');
const billing = read('src/SellerTrayBillingManagement.tsx');
const quarantineAuthority = read('../../supabase/migrations/20261027123000_master_agreement_publication_quarantine.sql');
const zeroTouchAuthority = read('../../supabase/migrations/20261027173000_agreement_package_zero_touch_orchestration.sql');
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
    && agreements.includes("action: 'merchant_get_document'")
    && agreements.includes("action: 'merchant_confirm_package'")
    && !agreements.includes("action: 'merchant_accept'"),
  'Agreements must use the governed Master Agreement + exact Order Form package authority and must not use direct Master-only acceptance.',
);

requireValue(
  agreements.includes("center.masterAcceptanceRequired ? 'Accept & Continue' : 'Confirm Purchase'")
    && agreements.includes("'I accept the Master Agreement, confirm this purchase and confirm my authority to continue.'")
    && agreements.includes("'I confirm this purchase under the accepted Master Agreement and confirm my authority to continue.'"),
  'Merchant CTA must distinguish required Master acceptance from later purchase confirmation with simple merchant-facing language.',
);

requireValue(
  agreements.includes('`${selected.id}:${center.masterAgreement.id}:${reviewDocument.packageFingerprint}`')
    && agreements.includes('confirmationCommandIds.current.set(commandKey, commandId)')
    && agreements.includes('confirmationCommandIds.current.delete(commandKey)')
    && agreements.includes('expectedPackageId: reviewDocument.packageId')
    && agreements.includes('expectedPackageFingerprint: reviewDocument.packageFingerprint'),
  'Package confirmation must preserve one command identity and exact reviewed-package binding behind the merchant UI.',
);

requireValue(
  agreements.includes('Review agreement')
    && agreements.includes('Agreement opened for review. You can continue below when ready.')
    && agreements.includes('Open signed copy')
    && agreements.includes('Agreement is being prepared automatically')
    && excludes(agreements, ['Prepare Agreement PDF', 'Package fingerprint', 'PDF SHA-256', 'Order Form integrity', 'Commercial snapshot integrity', 'deterministic package fingerprint']),
  'Merchant review must hide technical integrity mechanics while preserving one simple review/confirm experience.',
);

requireValue(
  zeroTouchAuthority.includes('ensure_sellertray_agreement_package_for_commercial_order')
    && zeroTouchAuthority.includes('orchestrate_sellertray_agreement_package_after_installment_schedule')
    && zeroTouchAuthority.includes("'order_form_template_missing'")
    && zeroTouchAuthority.includes("'master_agreement_missing'"),
  'Shared authority must automatically instantiate/reconcile the exact Order Form and Agreement Package without per-merchant Admin issuance.',
);

requireValue(
  quarantineAuthority.includes('sellertray_master_agreement_version_quarantines')
    && quarantineAuthority.includes('quarantine_sellertray_master_agreement_version_admin')
    && quarantineAuthority.includes('where not exists (')
    && quarantineAuthority.includes('get_sellertray_master_agreement_center'),
  'Merchant agreement reads must exclude quarantined invalid/non-production Master publications from current and historical customer-facing authority.',
);

requireValue(
  excludes(agreements, [
    "functions.invoke('commercial-agreements'",
    "functions.invoke('billing-checkout'",
    "from('sellertray_commercial_agreements')",
    "from('sellertray_commercial_agreement_acceptances')",
    "from('sellertray_commercial_agreement_template_versions')",
    'SERVICE_ROLE',
    'SUPABASE_SECRET',
    'pdf-lib',
    'jsPDF',
  ]),
  'Agreement Package UI must use server-governed package reads/documents/commands and remain separate from payment and canonical PDF authority.',
);

requireValue(
  billing.includes("functions.invoke('commercial-billing'")
    && billing.includes("functions.invoke('billing-checkout'")
    && billing.includes('nextInstallmentScheduleId')
    && billing.includes('nextPayableAmount')
    && billing.includes("response.status === 'retry_required'")
    && billing.includes('response.needsNewCommand === true'),
  'SellerTray Billing must continue using server-owned settlement state and governed checkout retry semantics.',
);

requireValue(
  excludes(billing, ['SERVICE_ROLE', 'SUPABASE_SECRET', "from('sellertray_commercial_payment_confirmations')"]),
  'SellerTray Billing must not bypass governed commercial billing and checkout authorities.',
);

if (failures.length) {
  console.error('SellerTray Agreement Package and billing preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Agreement Package and billing preflight passed.');
