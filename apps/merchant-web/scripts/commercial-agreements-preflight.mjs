import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const management = read('src/ManagementPage.tsx');
const merchantApp = read('src/MerchantApp.tsx');
const navigation = read('src/portalNavigation.ts');
const agreements = read('src/CommercialAgreementsManagement.tsx');
const agreementStyles = read('src/agreement-documents.css');
const packageAgreements = read('src/CommercialAgreementPackageManagement.tsx');
const billing = read('src/SellerTrayBillingManagement.tsx');
const setup = read('src/SetupSchedulingManagement.tsx');
const prepurchaseAuthority = read('../../supabase/functions/master-agreement-prepurchase/index.ts');
const separationMigration = read('../../supabase/migrations/20261030173500_separate_master_agreement_order_form_confirmation.sql');
const legacyAgreementApi = read('../../supabase/functions/commercial-agreements/index.ts');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };
const excludes = (source, values) => values.every((value) => !source.includes(value));

requireValue(
  navigation.includes("id: 'sellertray_billing'")
    && navigation.includes("label: 'Billing'")
    && navigation.includes("section: 'Business'")
    && navigation.includes("id: 'agreements'")
    && navigation.includes("label: 'Agreements'")
    && navigation.includes("id: 'setup'")
    && navigation.includes("label: 'Setup & Activation'")
    && navigation.indexOf("id: 'agreements'") < navigation.indexOf("id: 'sellertray_billing'")
    && navigation.indexOf("id: 'sellertray_billing'") < navigation.indexOf("id: 'setup'")
    && navigation.includes("id: 'payments'")
    && navigation.includes("label: 'Payments & Receivables'"),
  'Merchant navigation must preserve the approved Agreements -> Billing -> Setup & Activation Business workflow while keeping customer Payments & Receivables separate.',
);

requireValue(
  excludes(navigation, ["label: 'SellerTray Billing'", "label: 'Master Agreement'", "label: 'Setup appointments'"]),
  'Merchant navigation must not regress approved merchant-facing labels back to internal commercial/legal names.',
);

requireValue(
  merchantApp.includes("page === 'sellertray_billing'")
    && merchantApp.includes('<SellerTrayBillingManagement tenantId={business.id} />')
    && merchantApp.includes("page === 'agreements'")
    && merchantApp.includes('<CommercialAgreementsManagement tenantId={business.id} />'),
  'Merchant App must route Billing and Agreements to their dedicated surfaces.',
);

requireValue(!management.includes('CommercialAgreementsManagement'), 'Merchant Settings must remain settings-only and must not embed legal agreement authority.');

requireValue(
  agreements.includes("functions.invoke('master-agreements'")
    && agreements.includes("action: 'merchant_get'")
    && agreements.includes("functions.invoke('master-agreement-prepurchase'")
    && agreements.includes("action: 'merchant_get_document'")
    && agreements.includes("action: 'merchant_accept'"),
  'Master Agreement review and acceptance must use governed read plus dedicated PDF-review/acceptance authority.',
);

requireValue(
  prepurchaseAuthority.includes("rpc<string>('accept_sellertray_master_agreement'")
    && prepurchaseAuthority.includes("'prepurchase_master_pdf_acceptance'")
    && prepurchaseAuthority.includes("'master_version_pdf_acceptance'")
    && prepurchaseAuthority.includes('reviewed_pdf_sha256')
    && prepurchaseAuthority.includes('reviewed_content_sha256')
    && prepurchaseAuthority.includes("documentKind: 'master_agreement_pdf'"),
  'Master acceptance must bind immutable Business/version authority to the exact reviewed Master PDF and content integrity for both first-purchase and later-version acceptance.',
);

requireValue(
  agreements.includes('Review Master Agreement')
    && agreements.includes('reviewedPdfSha256')
    && agreements.includes('reviewDocument.pdfSha256')
    && agreements.includes('reviewDocument.contentSha256')
    && agreements.includes("disabled={busy || !confirmed || !legalName.trim() || !reviewReady}"),
  'Master acceptance UI must require the exact governed PDF to be reviewed before Accept & Continue is enabled.',
);

requireValue(
  agreements.includes('role="dialog"')
    && agreements.includes('aria-modal="true"')
    && agreements.includes('className="agreement-preview-frame"')
    && agreements.includes('src={reviewDocument.signedUrl}')
    && agreements.includes('onLoad={markPreviewLoaded}')
    && agreements.includes('Close preview & continue')
    && agreementStyles.includes('.agreement-preview-modal')
    && agreementStyles.includes('height: 100dvh'),
  'Master Agreement review must use a responsive in-page PDF preview modal and mark review only after the governed PDF frame loads.',
);

requireValue(
  excludes(agreements, ["window.open(", "target=\"_blank\"", "popup.location.href"]),
  'Master Agreement review must not depend on a blank/new browser tab or popup window.',
);

requireValue(
  excludes(agreements, ['<pre', '{master.contentBody}', 'Read Master Agreement text']),
  'Master Agreement acceptance must be PDF-first and must not present the long inline legal text as the primary review surface.',
);

requireValue(
  agreements.includes('This accepts only the current Master Agreement. It does not confirm any purchase, plan or Order Form.')
    && agreements.includes('Each initial purchase, plan change or other governed commercial commitment uses its own Order Form'),
  'Merchant Master Agreement copy must clearly separate legal acceptance from purchase-specific Order Form confirmation.',
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
  packageAgreements.includes("action: 'merchant_confirm_package'")
    && packageAgreements.includes("action: 'merchant_get_document'")
    && packageAgreements.includes('expectedPackageFingerprint')
    && packageAgreements.includes('orderFormId')
    && packageAgreements.includes("'Confirm Purchase'")
    && packageAgreements.includes('center.masterAcceptanceRequired || !actionRequired')
    && packageAgreements.includes('This confirms only this Order Form and purchase. It does not create or replace Master Agreement acceptance.'),
  'Purchase-specific Order Form must retain exact PDF/fingerprint-bound confirmation and require prior Master acceptance.',
);

requireValue(
  excludes(packageAgreements, ['masterAcceptanceCreated', "'Accept & Continue'", 'I accept the Master Agreement, confirm this purchase']),
  'Order Form confirmation UI must never double as Master Agreement acceptance.',
);

requireValue(
  separationMigration.includes('Accept the current SellerTray Master Agreement separately before confirming this Order Form')
    && separationMigration.includes("'masterAcceptanceCreated',false")
    && separationMigration.includes("'master_acceptance_id',v_master_acceptance.id")
    && !separationMigration.includes('perform public.accept_sellertray_master_agreement'),
  'Database Order Form confirmation must require an existing Master acceptance and must never manufacture one.',
);

requireValue(
  billing.includes('<h2>Billing</h2>')
    && setup.includes('<h2>Setup & Activation</h2>')
    && agreements.includes('<h2>Agreements</h2>'),
  'Commercial onboarding page headings must match the approved Agreements -> Billing -> Setup & Activation workflow labels.',
);

const retiredGuardIndex = legacyAgreementApi.indexOf('if (RETIRED_AGREEMENT_MUTATIONS.has(action))');
const legacyAcceptIndex = legacyAgreementApi.indexOf("if (action === 'merchant_accept')");
const legacyPublishIndex = legacyAgreementApi.indexOf("if (action === 'admin_publish_template')");
const legacyIssueIndex = legacyAgreementApi.indexOf("const agreementId = await rpc<string>('issue_sellertray_commercial_agreement_admin'");
requireValue(
  legacyAgreementApi.includes("'merchant_accept'")
    && legacyAgreementApi.includes("'admin_publish_template'")
    && legacyAgreementApi.includes("'admin_issue'")
    && retiredGuardIndex >= 0
    && legacyAcceptIndex > retiredGuardIndex
    && legacyPublishIndex > retiredGuardIndex
    && legacyIssueIndex > retiredGuardIndex
    && legacyAgreementApi.includes('This legacy agreement mutation is retired. Use the SellerTray Master Agreement authority.'),
  'Legacy order-bound agreement mutations must fail closed before any old acceptance, template-publication, or issuance branch can execute.',
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

requireValue(excludes(billing, ['SERVICE_ROLE', 'SUPABASE_SECRET', "from('sellertray_commercial_payment_confirmations')"]), 'Billing must not bypass governed commercial billing and checkout authorities.');

if (failures.length) {
  console.error('SellerTray Master Agreement and billing preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray separated Master Agreement and Order Form preflight passed.');
