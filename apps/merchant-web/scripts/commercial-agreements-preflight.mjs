import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const management = read('src/ManagementPage.tsx');
const setup = read('src/SetupSchedulingManagement.tsx');
const merchantApp = read('src/MerchantApp.tsx');
const navigation = read('src/portalNavigation.ts');
const agreements = read('src/CommercialAgreementsManagement.tsx');
const documentRequestGateSource = read('src/agreement-document-request.ts');
const billing = read('src/SellerTrayBillingManagement.tsx');
const main = read('src/main.tsx');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };
const excludes = (source, values) => values.every((value) => !source.includes(value));

requireValue(
  navigation.includes("id: 'sellertray_billing'")
    && navigation.includes("label: 'Billing'")
    && navigation.includes("section: 'Business'")
    && navigation.includes("id: 'agreements'")
    && navigation.includes("label: 'Agreements'")
    && navigation.includes("id: 'setup_activation'")
    && navigation.includes("label: 'Setup & Activation'")
    && navigation.includes("id: 'payments'")
    && navigation.includes("label: 'Payments & Receivables'"),
  'Merchant navigation must keep Agreements, Billing, Setup & Activation, and customer Payments & Receivables as distinct governed surfaces.',
);

requireValue(
  merchantApp.includes("COMMERCIAL_JOURNEY_PAGES: Page[] = ['agreements', 'sellertray_billing', 'setup_activation']")
    && merchantApp.includes('<CommercialJourneyNavigation activePage={page} onNavigate={navigate} />')
    && merchantApp.includes('Agreement acceptance, payment and Branch setup remain separate governed steps.'),
  'Merchant Web must present Agreements, Billing, and Setup & Activation as one coherent activation journey without conflating their authority.',
);

requireValue(
  merchantApp.includes("page === 'sellertray_billing'")
    && merchantApp.includes('<SellerTrayBillingManagement tenantId={business.id} />')
    && merchantApp.includes("page === 'agreements'")
    && merchantApp.includes('<CommercialAgreementsManagement tenantId={business.id} />')
    && merchantApp.includes('onNavigate={navigate}'),
  'Merchant App must route Billing, Agreements, and governed Setup next actions through the shared management shell.',
);

requireValue(
  !management.includes('CommercialAgreementsManagement')
    && management.includes('<SetupSchedulingManagement tenantId={tenantId} onNavigate={onNavigate} />'),
  'Merchant Settings must remain settings-only while Setup & Activation receives only navigation support, not duplicated commercial authority.',
);

requireValue(
  agreements.includes("functions.invoke('master-agreements'")
    && agreements.includes("action: 'merchant_get'")
    && agreements.includes("action: 'merchant_get_document'")
    && agreements.includes("action: 'merchant_confirm_package'")
    && !agreements.includes("action: 'merchant_accept'"),
  'Agreements must use the governed Master Agreement + exact Order Form package authority and must not use direct Master-only or legacy agreement acceptance.',
);

const documentRequestGateModule = await import(pathToFileURL(resolve(root, 'src/agreement-document-request.ts')).href);
const documentRequestGate = new documentRequestGateModule.AgreementDocumentRequestGate();
const documentRaceState = { document: null, error: null, reviewReady: false, busy: null };
const settleDocumentRequest = (request, result) => {
  if (!documentRequestGate.isCurrent(request)) return;
  documentRaceState.document = result.document;
  documentRaceState.error = result.error;
  documentRaceState.reviewReady = result.reviewReady;
  documentRaceState.busy = null;
};
const orderFormARequest = documentRequestGate.begin('merchant-1', 'order-form-a');
documentRaceState.busy = 'review_pdf';
documentRequestGate.invalidate('merchant-1', 'order-form-b');
documentRaceState.document = null;
documentRaceState.error = null;
documentRaceState.reviewReady = false;
const orderFormBRequest = documentRequestGate.begin('merchant-1', 'order-form-b');
documentRaceState.busy = 'review_pdf';
settleDocumentRequest(orderFormARequest, { document: 'A', error: 'stale A error', reviewReady: true });
requireValue(
  documentRaceState.busy === 'review_pdf' && documentRaceState.document === null && documentRaceState.error === null && documentRaceState.reviewReady === false,
  'A stale Order Form A response must not close Order Form B loading or mutate B document/error/review state.',
);
settleDocumentRequest(orderFormBRequest, { document: 'B', error: null, reviewReady: true });
settleDocumentRequest(orderFormARequest, { document: 'A', error: 'late A error', reviewReady: false });
requireValue(
  documentRaceState.busy === null && documentRaceState.document === 'B' && documentRaceState.error === null && documentRaceState.reviewReady === true,
  'After B completes, a late A response must not overwrite B or change B readiness/error/loading state.',
);
const oldTenantRequest = documentRequestGate.begin('merchant-1', 'order-form-b');
documentRequestGate.invalidate('merchant-2', 'order-form-b');
requireValue(
  !documentRequestGate.isCurrent(oldTenantRequest),
  'Changing tenant with the same Order Form identity must invalidate the old tenant document request.',
);
requireValue(
  agreements.includes("import { AgreementDocumentRequestGate } from './agreement-document-request';")
    && agreements.includes('documentRequestGate.current.invalidate(tenantId, orderFormId)')
    && (agreements.match(/documentRequestGate\.current\.isCurrent\(request\)/g)?.length ?? 0) >= 3
    && agreements.includes('reviewDocumentState.request.tenantId === tenantId')
    && agreements.includes('reviewDocumentState.request.orderFormId === selected.id'),
  'Merchant Agreements must guard success, error, and finally state with both request generation and tenant/Order Form context.',
);

requireValue(
  agreements.includes("center.masterAcceptanceRequired ? 'Accept & Continue' : 'Confirm Purchase'")
    && agreements.includes("'I accept the Master Agreement, confirm this purchase and confirm my authority to continue.'")
    && agreements.includes("'I confirm this purchase under the accepted Master Agreement and confirm my authority to continue.'"),
  'Merchant CTA must distinguish first Master acceptance from later purchase confirmation under an unchanged Master.',
);

requireValue(
  agreements.includes('`${selected.id}:${center.masterAgreement.id}:${reviewDocument.packageFingerprint}`')
    && agreements.includes('confirmationCommandIds.current.set(commandKey, commandId)')
    && agreements.includes('confirmationCommandIds.current.delete(commandKey)')
    && agreements.includes('expectedPackageId: reviewDocument.packageId')
    && agreements.includes('expectedPackageFingerprint: reviewDocument.packageFingerprint'),
  'Agreement Package confirmation must preserve command idempotency and exact reviewed-package binding.',
);

requireValue(
  agreements.includes('Review agreement')
    && agreements.includes('Agreement opened for review. You can continue below when ready.')
    && agreements.includes('Open signed copy')
    && agreements.includes('Agreement is being prepared automatically')
    && excludes(agreements, ['No commercial agreements issued', 'Prepare Agreement PDF', 'Package fingerprint', 'PDF SHA-256', 'deterministic package fingerprint']),
  'Merchant Agreements must expose the current package lifecycle and must not regress to the retired no-commercial-agreement experience or internal integrity vocabulary.',
);

requireValue(
  setup.includes("nextActionCode === 'review_master_agreement'")
    && setup.includes("onNavigate('agreements')")
    && setup.includes("nextActionCode === 'pay_outstanding'")
    && setup.includes("onNavigate('sellertray_billing')"),
  'Setup & Activation must turn governed onboarding nextAction codes into direct merchant actions for Agreements and Billing.',
);

requireValue(
  main.includes("import './agreement-documents.css';"),
  'Merchant Web must load the responsive Agreement Package and activation-journey styles.',
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
  'Agreement Package UI must remain server-governed and separate from payment and canonical PDF authority.',
);

requireValue(
  billing.includes("functions.invoke('commercial-billing'")
    && billing.includes("functions.invoke('billing-checkout'")
    && billing.includes('nextInstallmentScheduleId')
    && billing.includes('nextPayableAmount')
    && billing.includes("response.status === 'retry_required'")
    && billing.includes('response.needsNewCommand === true'),
  'Billing must continue using server-owned settlement state and governed checkout retry semantics; agreement acceptance must not be fabricated as a payment gate.',
);

requireValue(
  excludes(billing, [
    'SERVICE_ROLE',
    'SUPABASE_SECRET',
    "from('sellertray_commercial_payment_confirmations')",
    'This value is resolved by the server after all approved adjustments and confirmed payments.',
    'Discounts, direct ProcessEdge payments and provider payments are separate immutable settlement facts.',
  ]),
  'Billing must preserve authority separation and the approved merchant-facing copy removals.',
);

if (failures.length) {
  console.error('SellerTray Agreement Package, Billing and activation-journey preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray Agreement Package, Billing and activation-journey preflight passed.');
