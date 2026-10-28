import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const navigation = await readFile(new URL('../src/portalNavigation.ts', import.meta.url), 'utf8');
const merchantApp = await readFile(new URL('../src/MerchantApp.tsx', import.meta.url), 'utf8');
const managementPage = await readFile(new URL('../src/ManagementPage.tsx', import.meta.url), 'utf8');
const shell = await readFile(new URL('../src/merchantShell.tsx', import.meta.url), 'utf8');
const billing = await readFile(new URL('../src/SellerTrayBillingManagement.tsx', import.meta.url), 'utf8');

const requiredNavigation = [
  "{ id: 'sellertray_billing', label: 'Billing', section: 'Business', available: true }",
  "{ id: 'setup_activation', label: 'Setup & Activation', section: 'Business', available: true }",
  "{ id: 'settings', label: 'Settings', section: 'Business', available: true }",
];
for (const expected of requiredNavigation) {
  if (!navigation.includes(expected)) fail(`Missing Merchant Web navigation contract: ${expected}`);
}
if (navigation.includes("{ id: 'sellertray_billing', label: 'SellerTray Billing', section: 'Money'")) fail('SellerTray Billing must not remain under Money.');
if (!navigation.includes("{ id: 'payments', label: 'Payments & Receivables', section: 'Money', available: true }")) fail('Money must retain Payments & Receivables.');

const businessEntries = [...navigation.matchAll(/\{ id: '([^']+)', label: '([^']+)', section: 'Business', available: true \}/g)].map((match) => match[1]);
if (businessEntries.at(-1) !== 'settings') fail('Settings must remain the last Business navigation entry.');
if (!merchantApp.includes("page === 'setup_activation'")) fail('MerchantApp must route Setup & Activation through the management page boundary.');
if (!managementPage.includes("if (page === 'setup_activation') return <SetupSchedulingManagement tenantId={tenantId} />;")) fail('Setup & Activation must reuse the governed SetupSchedulingManagement flow.');
if (managementPage.indexOf("page === 'setup_activation'") > managementPage.indexOf("page === 'settings'")) fail('Setup & Activation must be a distinct route before Settings.');
if (!shell.includes("'setup_activation'")) fail('Setup & Activation requires a navigation icon contract.');

const forbiddenBillingCopy = [
  'This value is resolved by the server after all approved adjustments and confirmed payments.',
  'Discounts, direct ProcessEdge payments and provider payments are separate immutable settlement facts. The balance and next payable amount shown here come from SellerTray’s server authority.',
];
for (const phrase of forbiddenBillingCopy) {
  if (billing.includes(phrase)) fail(`Merchant-facing Billing still contains removed internal wording: ${phrase}`);
}
if (!billing.includes('<h2>Billing</h2>')) fail('Billing page must use the merchant-facing Billing label.');

console.log(`Merchant Web navigation and billing-copy guard passed for ${src}.`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
