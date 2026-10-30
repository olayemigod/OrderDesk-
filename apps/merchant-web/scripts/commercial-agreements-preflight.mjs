import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const management = read('src/ManagementPage.tsx');
const merchantApp = read('src/MerchantApp.tsx');
const navigation = read('src/portalNavigation.ts');
const agreements = read('src/CommercialAgreementsManagement.tsx');
const agreementStyles = read('src/agreement-documents.css');
const agreementPdf = read('src/agreementPdf.ts');
const pdfPreview = read('src/VerifiedPdfPreview.tsx');
const packageAgreements = read('src/CommercialAgreementPackageManagement.tsx');
const billing = read('src/SellerTrayBillingManagement.tsx');
const initialPurchase = read('src/SellerTrayInitialPurchase.tsx');
const setup = read('src/SetupSchedulingManagement.tsx');
const prepurchaseAuthority = read('../../supabase/functions/master-agreement-prepurchase/index.ts');
const commercialBilling = read('../../supabase/functions/commercial-billing/index.ts');
const separationMigration = read('../../supabase/migrations/20261030173500_separate_master_agreement_order_form_confirmation.sql');
const checkoutGate = read('../../supabase/migrations/20261030210000_order_form_checkout_confirmation_gate.sql');
const legacyAgreementApi = read('../../supabase/functions/commercial-agreements/index.ts');
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };
const excludes = (source, values) => values.every((value) => !source.includes(value));

requireValue(
  navigation.includes("id: 'sellertray_billing'") && navigation.includes("label: 'Billing'") && navigation.includes("section: 'Business'")
    && navigation.includes("id: 'agreements'") && navigation.includes("label: 'Agreements'")
    && navigation.includes("id: 'setup'") && navigation.includes("label: 'Setup & Activation'")
    && navigation.indexOf("id: 'agreements'") < navigation.indexOf("id: 'sellertray_billing'")
    && navigation.indexOf("id: 'sellertray_billing'") < navigation.indexOf("id: 'setup'")
    && navigation.includes("id: 'payments'") && navigation.includes("label: 'Payments & Receivables'"),
  'Merchant navigation must preserve Agreements -> Billing -> Setup & Activation while keeping customer receivables separate.',
);
requireValue(excludes(navigation, ["label: 'SellerTray Billing'", "label: 'Master Agreement'", "label: 'Setup appointments'"]), 'Merchant navigation must use approved production labels.');

requireValue(
  merchantApp.includes("page === 'sellertray_billing'")
    && merchantApp.includes("onReviewOrderForm={() => navigate('agreements')}")
    && merchantApp.includes("onContinueToBilling={() => navigate('sellertray_billing')}")
    && billing.includes('onReviewOrderForm: () => void')
    && initialPurchase.includes('onContinueToOrderForm: () => void'),
  'Commercial onboarding transitions must use the existing MerchantApp navigation authority in both directions.',
);
requireValue(!management.includes('CommercialAgreementsManagement'), 'Merchant Settings must remain settings-only and must not embed legal agreement authority.');

requireValue(
  agreements.includes("functions.invoke('master-agreements'") && agreements.includes("action: 'merchant_get'")
    && agreements.includes("functions.invoke('master-agreement-prepurchase'") && agreements.includes("action: 'merchant_get_document'") && agreements.includes("action: 'merchant_accept'"),
  'Master Agreement review and acceptance must use governed server boundaries.',
);
requireValue(
  prepurchaseAuthority.includes("rpc<string>('accept_sellertray_master_agreement'")
    && prepurchaseAuthority.includes('reviewed_pdf_sha256') && prepurchaseAuthority.includes('reviewed_content_sha256')
    && prepurchaseAuthority.includes("if (action === 'merchant_get_document')")
    && prepurchaseAuthority.includes("if (center.masterAcceptanceRequired !== true)")
    && prepurchaseAuthority.includes('readStoredPdf(storagePath)')
    && prepurchaseAuthority.includes('doc.setCreationDate(documentDate)')
    && prepurchaseAuthority.includes('doc.setModificationDate(documentDate)'),
  'Master PDF authority must support post-accept viewing, immutable acceptance evidence and deterministic/reused fallback PDFs.',
);
requireValue(
  agreements.includes('View Master Agreement') && agreements.includes('Review Master Agreement')
    && agreements.includes('reviewedPdfSha256') && agreements.includes('reviewDocument.pdfSha256')
    && agreements.includes('reviewDocument.contentSha256')
    && agreements.includes("disabled={busy || !confirmed || !legalName.trim() || !reviewReady}"),
  'Accepted agreements must remain viewable while new acceptance stays locked to the exact reviewed PDF.',
);
requireValue(
  packageJson.dependencies?.['pdfjs-dist'] === '6.4.299'
    && pdfPreview.includes("from 'pdfjs-dist'")
    && pdfPreview.includes("pdf.worker.min.mjs?url")
    && pdfPreview.includes('<canvas')
    && pdfPreview.includes('await renderTask.promise')
    && pdfPreview.includes('renderedCallbackRef.current?.()')
    && agreementPdf.includes("crypto.subtle.digest('SHA-256'")
    && agreementPdf.includes("String.fromCharCode(...new Uint8Array(bytes, 0, 5)) === '%PDF-'"),
  'Agreement review must use the pinned in-app PDF.js renderer after byte-size, PDF signature and SHA-256 verification.',
);
requireValue(
  agreements.includes('role="dialog"') && agreements.includes('aria-modal="true"')
    && agreements.includes('<VerifiedPdfPreview') && agreements.includes('fetchVerifiedPdf(document)')
    && agreements.includes('onFirstPageRendered={markPreviewRendered}')
    && agreementStyles.includes('.verified-pdf-viewer') && agreementStyles.includes('.verified-pdf-canvas') && agreementStyles.includes('height: 100dvh'),
  'Master Agreement review must remain a responsive verified in-page PDF preview whose actual render unlocks acceptance.',
);
requireValue(excludes(agreements, ['<iframe', 'onLoad={markPreviewLoaded}', 'src={previewObjectUrl}', "window.open(", "target=\"_blank\""]), 'Master Agreement review must not depend on a browser PDF iframe, popup or frame-load event.');
requireValue(excludes(agreements, ['<pre', '{master.contentBody}', 'Read Master Agreement text']), 'Master Agreement acceptance must remain PDF-first.');
requireValue(agreements.includes('This accepts only the current Master Agreement. It does not confirm any purchase, plan or Order Form.'), 'Master acceptance copy must remain separate from purchase confirmation.');
requireValue(
  agreements.includes('currentOrderFormConfirmed')
    && agreements.includes("agreementsComplete && (!hasOrderForms || currentOrderFormConfirmed)")
    && agreements.includes('Purchase confirmed. Continue to Billing to complete the amount due.')
    && agreements.includes('onClick={onContinueToBilling}')
    && agreements.includes('<CommercialAgreementPackageManagement tenantId={tenantId} onChanged={load} />')
    && packageAgreements.includes('onChanged?: () => void | Promise<void>')
    && packageAgreements.includes('await onChanged?.()'),
  'Order Form confirmation must refresh the workflow immediately and expose Billing without a page reload.',
);

requireValue(
  packageAgreements.includes("action: 'merchant_confirm_package'") && packageAgreements.includes("action: 'merchant_get_document'")
    && packageAgreements.includes('expectedPackageFingerprint') && packageAgreements.includes('orderFormId')
    && packageAgreements.includes("'Confirm Purchase'")
    && packageAgreements.includes('This confirms only this Order Form and purchase. It does not create or replace Master Agreement acceptance.'),
  'Order Form confirmation must remain exact-PDF/fingerprint-bound and separate from Master acceptance.',
);
requireValue(
  packageAgreements.includes('<VerifiedPdfPreview')
    && packageAgreements.includes('fetchVerifiedPdf(document)')
    && packageAgreements.includes('onFirstPageRendered={markDocumentRendered}')
    && packageAgreements.includes('setReviewedFingerprint(reviewDocument.packageFingerprint)')
    && excludes(packageAgreements, ["window.open(", "target=\"_blank\"", 'popup.location.href', '<iframe']),
  'Order Form review must require the same verified in-app PDF render instead of popup creation or native-browser frame behavior.',
);
requireValue(excludes(packageAgreements, ['masterAcceptanceCreated', "'Accept & Continue'", 'I accept the Master Agreement, confirm this purchase']), 'Order Form confirmation must never double as Master acceptance.');
requireValue(
  separationMigration.includes('Accept the current SellerTray Master Agreement separately before confirming this Order Form')
    && separationMigration.includes("'masterAcceptanceCreated',false") && !separationMigration.includes('perform public.accept_sellertray_master_agreement'),
  'Database Order Form confirmation must require an existing Master acceptance and never manufacture one.',
);

requireValue(
  initialPurchase.includes('Choose your SellerTray plan') && initialPurchase.includes('Continue to Order Form')
    && initialPurchase.includes('Prepare your Order Form') && !initialPurchase.includes("'Confirm Purchase'")
    && !initialPurchase.includes('Choose your governed plan'),
  'Initial purchase must prepare the Order Form; Confirm Purchase is reserved for the Order Form itself.',
);
requireValue(commercialBilling.includes('orderFormState,'), 'Commercial Billing must expose server-resolved Order Form readiness.');
requireValue(
  billing.includes("order.orderFormState === 'ready_for_review'") && billing.includes('Review Order Form')
    && billing.includes("order.orderFormState === 'preparing'")
    && billing.includes("order.orderFormState === 'confirmed' || order.orderFormState === 'legacy'")
    && billing.includes("functions.invoke('billing-checkout'") && billing.includes("response.status === 'retry_required'"),
  'Billing must block new payment UX until governed Order Form confirmation while preserving legacy/retry handling.',
);
const checkoutReplayIndex = checkoutGate.indexOf("where s.tenant_id=p_tenant_id and s.checkout_kind='installment' and s.command_id=p_command_id");
const activeCheckoutIndex = checkoutGate.indexOf("s.status in ('preparing','initialized','paid')");
const orderFormGateIndex = checkoutGate.indexOf('select f.id into v_order_form_id');
requireValue(
  checkoutGate.includes('Review and confirm this SellerTray Order Form before payment')
    && checkoutGate.includes('sellertray_order_form_confirmations')
    && checkoutGate.includes("to_regclass('public.sellertray_agreement_package_processing')")
    && checkoutGate.includes('execute $sql$')
    && checkoutReplayIndex >= 0 && activeCheckoutIndex >= 0 && orderFormGateIndex >= 0
    && checkoutReplayIndex < orderFormGateIndex && activeCheckoutIndex < orderFormGateIndex,
  'Checkout authority must preserve committed checkout facts and optional pre-C2 schemas before enforcing confirmation on a new governed checkout.',
);
requireValue(excludes(billing, ['SERVICE_ROLE', 'SUPABASE_SECRET', "from('sellertray_commercial_payment_confirmations')"]), 'Billing must not bypass governed commercial authorities.');

requireValue(billing.includes('<h2>Billing</h2>') && setup.includes('<h2>Setup & Activation</h2>') && agreements.includes('<h2>Agreements</h2>'), 'Commercial onboarding headings must match approved labels.');

const retiredGuardIndex = legacyAgreementApi.indexOf('if (RETIRED_AGREEMENT_MUTATIONS.has(action))');
const legacyAcceptIndex = legacyAgreementApi.indexOf("if (action === 'merchant_accept')");
requireValue(legacyAgreementApi.includes("'merchant_accept'") && retiredGuardIndex >= 0 && legacyAcceptIndex > retiredGuardIndex && legacyAgreementApi.includes('This legacy agreement mutation is retired. Use the SellerTray Master Agreement authority.'), 'Legacy order-bound agreement mutations must remain retired.');

if (failures.length) {
  console.error('SellerTray Master Agreement and billing preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('SellerTray separated Master Agreement, Order Form, rendered PDF review and payment preflight passed.');
