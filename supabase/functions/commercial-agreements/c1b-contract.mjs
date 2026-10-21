import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

const required = [
  "reconcileTenantInstallmentsBestEffort(tenantId, 'agreement acceptance')",
  "reconcileTenantInstallmentsBestEffort(tenantId, 'setup readiness')",
  "reconcileTenantInstallmentsBestEffort(tenantId, 'merchant agreement center')",
  "reconcileTenantInstallmentsBestEffort(tenantId, 'admin commercial overview')",
  "results.filter((row) => row?.ok !== true)",
  'installmentObligationId',
  'errorCode',
];
for (const value of required) {
  if (!source.includes(value)) {
    throw new Error(`commercial-agreements C1B recovery contract is missing: ${value}`);
  }
}

const merchantAction = source.indexOf("if (action === 'merchant_list')");
const merchantAuthorize = source.indexOf('await loadMerchantCenter(tenantId, userId);', merchantAction);
const merchantReconcile = source.indexOf("reconcileTenantInstallmentsBestEffort(tenantId, 'merchant agreement center')", merchantAction);
if (merchantAction < 0 || merchantAuthorize < merchantAction || merchantReconcile <= merchantAuthorize) {
  throw new Error('Merchant C1B self-heal must run only after Merchant read authorization succeeds');
}

const adminAction = source.indexOf("if (action === 'admin_overview')");
const adminAuthorize = source.indexOf('await loadAdminOverview(tenantId, userId);', adminAction);
const adminReconcile = source.indexOf("reconcileTenantInstallmentsBestEffort(tenantId, 'admin commercial overview')", adminAction);
if (adminAction < 0 || adminAuthorize < adminAction || adminReconcile <= adminAuthorize) {
  throw new Error('Admin C1B self-heal must run only after Admin/Support read authorization succeeds');
}

console.log('commercial-agreements C1B reconciliation self-heal contract passed');
