import fs from 'node:fs';

const handoff = fs.readFileSync(new URL('../src/merchantHandoff.ts', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/MerchantApp.tsx', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../src/portalNavigation.ts', import.meta.url), 'utf8');

const checks = [
  [handoff.includes("window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)"), 'raw one-time handoff token is removed before continuation processing'],
  [handoff.includes("supabase.functions.invoke('merchant-web-handoff'"), 'handoff is consumed through the governed server boundary'],
  [handoff.includes("supabase.auth.verifyOtp"), 'handoff establishes the merchant session through verified auth'],
  [handoff.includes("setup: 'setup_activation'"), 'server setup destination maps to the approved Setup & Activation page'],
  [main.includes('consumeMerchantWebHandoff') && main.includes('<MerchantApp handoffTarget={handoffTarget} />'), 'bootstrap passes the governed handoff target into Merchant Web'],
  [app.includes('handoffTarget?.businessId') && app.includes('handoffTarget?.page'), 'Merchant Web initializes from the Business-bound continuation target'],
  [app.includes('This SellerTray continuation is no longer authorised for the selected Business'), 'Merchant Web fails closed if target Business authority changes'],
  [navigation.includes("{ id: 'sellertray_billing', label: 'Billing', section: 'Business'"), 'Billing remains under Business with the approved merchant-facing label'],
  [navigation.includes("{ id: 'setup_activation', label: 'Setup & Activation', section: 'Business'"), 'Setup & Activation remains under Business'],
  [!navigation.includes("label: 'SellerTray Billing'"), 'retired SellerTray Billing navigation label is absent'],
];

for (const [ok, description] of checks) {
  if (!ok) throw new Error(`Merchant handoff preflight failed: ${description}`);
}

console.log(`Merchant handoff preflight passed (${checks.length} checks).`);
