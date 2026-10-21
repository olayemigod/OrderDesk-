import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

const required = [
  "reconcileTenantInstallmentsBestEffort(tenantId, 'agreement acceptance')",
  "reconcileTenantInstallmentsBestEffort(tenantId, 'setup readiness')",
  "reconcileTenantInstallmentsBestEffort(tenantId, 'merchant agreement center')",
  "reconcileTenantInstallmentsBestEffort(tenantId, 'admin commercial overview')",
  'authorizeMerchantAgreementRead',
  'authorizeAdminAgreementRead',
  "results.filter((row) => row?.ok !== true)",
  'installmentObligationId',
  'errorCode',
  "'admin_onboarding'",
  "'admin_publish_subscription_price'",
  "'admin_publish_setup_price'",
  "'admin_create_initial_purchase'",
  "'get_sellertray_commercial_onboarding_admin'",
  "'publish_sellertray_subscription_price_pair_admin'",
  "'publish_sellertray_branch_setup_price_admin'",
  "'create_sellertray_initial_installment_purchase_admin'",
  "'publish_sellertray_commercial_agreement_template_admin'",
  "'issue_sellertray_commercial_agreement_admin'",
  'p_reason: reason',
];
for (const value of required) {
  if (!source.includes(value)) {
    throw new Error(`commercial-agreements C1B contract is missing: ${value}`);
  }
}

const merchantAction = source.indexOf("if (action === 'merchant_list')");
const merchantAuthorize = source.indexOf('await authorizeMerchantAgreementRead(tenantId, userId);', merchantAction);
const merchantReconcile = source.indexOf("reconcileTenantInstallmentsBestEffort(tenantId, 'merchant agreement center')", merchantAction);
const merchantFullLoad = source.indexOf('await loadMerchantCenter(tenantId, userId)', merchantReconcile);
if (
  merchantAction < 0
  || merchantAuthorize < merchantAction
  || merchantReconcile <= merchantAuthorize
  || merchantFullLoad <= merchantReconcile
) {
  throw new Error('Merchant C1B recovery must authorize narrowly before reconciliation and load the full state only afterward');
}

const adminAction = source.indexOf("if (action === 'admin_overview')");
const adminAuthorize = source.indexOf('await authorizeAdminAgreementRead(tenantId, userId);', adminAction);
const adminReconcile = source.indexOf("reconcileTenantInstallmentsBestEffort(tenantId, 'admin commercial overview')", adminAction);
const adminFullLoad = source.indexOf('await loadAdminOverview(tenantId, userId)', adminReconcile);
if (
  adminAction < 0
  || adminAuthorize < adminAction
  || adminReconcile <= adminAuthorize
  || adminFullLoad <= adminReconcile
) {
  throw new Error('Admin C1B recovery must authorize narrowly before reconciliation and load the full state only afterward');
}

const merchantAuthHelper = source.indexOf('async function authorizeMerchantAgreementRead');
const merchantAuthRpc = source.indexOf("'get_sellertray_commercial_agreement_center'", merchantAuthHelper);
if (merchantAuthHelper < 0 || merchantAuthRpc <= merchantAuthHelper) {
  throw new Error('Merchant C1B recovery authorization must use the governed C1A Merchant read authority');
}

const adminAuthHelper = source.indexOf('async function authorizeAdminAgreementRead');
const adminAuthRpc = source.indexOf("'get_sellertray_commercial_agreement_admin'", adminAuthHelper);
if (adminAuthHelper < 0 || adminAuthRpc <= adminAuthHelper) {
  throw new Error('Admin C1B recovery authorization must use the governed C1A Admin/Support read authority');
}

const initialPurchaseAction = source.indexOf("if (action === 'admin_create_initial_purchase')");
const initialPurchaseRpc = source.indexOf("'create_sellertray_initial_installment_purchase_admin'", initialPurchaseAction);
if (initialPurchaseAction < 0 || initialPurchaseRpc <= initialPurchaseAction) {
  throw new Error('First-merchant purchase must use the governed service-authoritative initial-purchase command');
}

const templateAction = source.indexOf("if (action === 'admin_publish_template')");
const auditedTemplateRpc = source.indexOf("'publish_sellertray_commercial_agreement_template_admin'", templateAction);
if (templateAction < 0 || auditedTemplateRpc <= templateAction) {
  throw new Error('Admin agreement template publication must use the audited Platform Admin wrapper');
}

const auditedIssueRpc = source.indexOf("'issue_sellertray_commercial_agreement_admin'", auditedTemplateRpc);
if (auditedIssueRpc <= auditedTemplateRpc) {
  throw new Error('Admin agreement issuance must use the audited Platform Admin wrapper');
}

console.log('commercial-agreements C1B reconciliation and first-merchant acceptance contract passed');
