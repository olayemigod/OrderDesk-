import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const management = read('src/ManagementPage.tsx');
const merchantApp = read('src/MerchantApp.tsx');
const navigation = read('src/portalNavigation.ts');
const agreements = read('src/CommercialAgreementsManagement.tsx');
const packageAgreements = read('src/CommercialAgreementPackageManagement.tsx');
const billing = read('src/SellerTrayBillingManagement.tsx');
const prepurchaseAuthority = read('../../supabase/functions/master-agreement-prepurchase/index.ts');
const legacyAgreementApi = read('../../supabase/functions/commercial-agreements/index.ts');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };
const excludes = (source, values) => values.every((value) => !source.includes(value));

requireValue(
  navigation.includes("id: 'sellertray_billing'")
    && navigation.includes("label: 'SellerTray Billing'")
    && navigation.includes("id: 'agreements'")
    && navigation.includes("label: 'Master Agreement'")
    && navigation.includes("id: 'payments'")
    && navigation.includes("label: 'Payments & Receivables'"),
  'Merchant navigation must keep SellerTray Billing, Master Agreement, and customer Payments & Receivables as separate surfaces.',
);

requireValue(
  merchantApp.includes("page === 'sellertray_billing'")
    && merchantApp.includes('<SellerTrayBillingManagement tenantId={business.id} />')
    && merchantApp.includes("page === 'agreements'")
    && merchantApp.includes('<CommercialAgreementsManagement tenantId={business.id} />'),
  'Merchant App must route SellerTray Billing and Master Agreement to their dedicated surfaces.',
);

requireValue(
  !management.includes('CommercialAgreementsManagement'),
  'Merchant Settings must remain settings-only and must not embed legal agreement authority.',
);

requireValue(
  agreements.includes("functions.invoke('master-agreements'")
    && agreements.includes("action: 'merchant_get'")
    && agreements.includes("functions.invoke('master-agreement-prepurchase'"),
  'Pre-purchase Master Agreement must use the governed agreement read runtime and the dedicated authenticated pre-purchase acceptance boundary.',
);

requireValue(
  prepurchaseAuthority.includes("rpc<string>('accept_sellertray_master_agreement'")
    && prepurchaseAuthority.includes("rpc<JsonRecord>('get_sellertray_onboarding_state_core'")
    && prepurchaseAuthority.includes("code !== 'review_master_agreement'")
    && prepurchaseAuthority.includes("code !== 'select_plan'")
    && prepurchaseAuthority.includes('orderForms.length !== 0')
    && prepurchaseAuthority.includes("flow: 'prepurchase_master_acceptance'")
    && prepurchaseAuthority.includes('authority_confirmed: true'),
  'Pre-purchase Master acceptance must remain bound to the universal acceptance RPC, no-Order-Form state, current onboarding action, and post-acceptance select_plan transition.',
);

requireValue(
  agreements.includes('authorityConfirmed: true')
    && agreements.includes('I confirm I am authorised to act for this Business and accept this current SellerTray Master Agreement.'),
  'Master Agreement acceptance must carry the explicit merchant authority confirmation shown in the UI.',
);

requireValue(
  agreements.includes('commandIds.current.get(master.id)')
    && agreements.includes('commandIds.current.set(master.id, commandId)')
    && agreements.includes('commandIds.current.delete(master.id)'),
  'Master Agreement acceptance must preserve one command identity per current version across failed retries and clear it only after success.',
);

requireValue(
  agreements.includes('This universal Master Agreement is accepted separately from your commercial purchase.')
    && agreements.includes('This does not confirm a purchase.')
    && agreements.includes('purchase-specific Order Form')
    && agreements.includes('CommercialAgreementPackageManagement'),
  'Merchant Master Agreement UI must keep universal legal acceptance independent of purchase/payment truth and hand off to the governed package after purchase.',
);

requireValue(
  agreements.includes('<pre')
    && agreements.includes('{master.contentBody}')
    && agreements.includes("open><summary>Read Master Agreement text"),
  'Pre-purchase Agreements must display the exact published Master Agreement text instead of an Order Form preparation placeholder.',
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
  'Pre-purchase Master Agreement surface must remain universal/legal-only and must not revive order-bound agreement or payment authority.',
);

requireValue(
  packageAgreements.includes("action: 'merchant_confirm_package'")
    && packageAgreements.includes("action: 'merchant_get_document'")
    && packageAgreements.includes('expectedPackageFingerprint')
    && packageAgreements.includes('orderFormId'),
  'Post-purchase Agreement Package must retain exact Order Form/document review and fingerprint-bound confirmation authority.',
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
