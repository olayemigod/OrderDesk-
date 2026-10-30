import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const navigationPath = path.join(root, 'src/portalNavigation.ts');
const source = fs.readFileSync(navigationPath, 'utf8');
const failures = [];

for (const page of ['sales', 'orders', 'returns']) {
  const branchRule = new RegExp(`\\{\\s*id:\\s*['\"]${page}['\"][^}]*requiresBranch:\\s*true[^}]*\\}`);
  if (!branchRule.test(source)) failures.push(`${page}: Branch-dependent navigation must remain hidden until an accessible Branch exists`);
}

if (!source.includes('merchantPortalNavigationForContext')) failures.push('context-aware Merchant Web navigation resolver is missing');
if (!source.includes("label: 'Subscription & Billing'")) failures.push('merchant-facing Subscription & Billing label is missing');
if (!source.includes("id: 'agreements', label: 'Agreements'")) failures.push('merchant-facing Agreements label is missing');

for (const planName of ['Starter', 'Growth', 'Scale']) {
  const conditional = new RegExp(`(?:===|!==|==|!=)\\s*['\"]${planName}['\"]|['\"]${planName}['\"]\\s*(?:===|!==|==|!=)`);
  if (conditional.test(source)) failures.push(`portal navigation must not hard-code ${planName} plan entitlement logic`);
}

if (failures.length) {
  console.error('SellerTray portal-navigation preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray portal-navigation preflight passed.');
