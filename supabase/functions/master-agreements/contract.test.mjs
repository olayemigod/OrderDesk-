import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const legacyBoundary = readFileSync(new URL('../commercial-agreements/index.ts', import.meta.url), 'utf8');
const required = [
  "'merchant_list'",
  "'merchant_confirm_package'",
  "'admin_issue_order_form'",
  "rpc<JsonRecord>('confirm_sellertray_agreement_package'",
  "rpc<JsonRecord>('get_sellertray_master_agreement_center'",
  "rpc<string>('issue_sellertray_commercial_order_form_admin'",
  'authority_confirmed: true',
  'p_command_id: commandId',
  'reconcileTenantInstallmentsBestEffort',
];
const missing = required.filter((value) => !source.includes(value));
if (missing.length) {
  console.error('Master Agreement boundary contract failed:', missing);
  process.exit(1);
}
if (legacyBoundary.includes("| 'merchant_accept'") || legacyBoundary.includes("action === 'merchant_accept'")) {
  console.error('Legacy commercial-agreements boundary still exposes active merchant acceptance.');
  process.exit(1);
}
console.log('Master Agreement boundary contract passed.');
