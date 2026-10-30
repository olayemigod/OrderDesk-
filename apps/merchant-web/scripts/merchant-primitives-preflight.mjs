import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const primitives = read('src/MerchantPagePrimitives.tsx');
const billing = read('src/SellerTrayBillingManagement.tsx');
const agreements = read('src/CommercialAgreementsManagement.tsx');
const agreementPackage = read('src/CommercialAgreementPackageManagement.tsx');
const merchantApp = read('src/MerchantApp.tsx');
const failures = [];

for (const name of ['MerchantPageHeader', 'MerchantLoadingState', 'MerchantShellState', 'MerchantEmptyState', 'MerchantNotice', 'MerchantStatusBadge', 'MerchantFactGrid', 'MerchantFact']) {
  if (!primitives.includes(`export function ${name}`)) failures.push(`shared primitive ${name} is missing`);
}

for (const [file, source] of [['SellerTrayBillingManagement.tsx', billing], ['CommercialAgreementsManagement.tsx', agreements], ['CommercialAgreementPackageManagement.tsx', agreementPackage]]) {
  if (!source.includes("from './MerchantPagePrimitives'")) failures.push(`${file} must consume shared Merchant Page primitives`);
  if (source.includes('function Fact(')) failures.push(`${file} must not reintroduce a local Fact component`);
  if (source.includes('<div className="section-heading">')) failures.push(`${file} must not reintroduce a one-off page heading`);
}

if (!billing.includes('<MerchantPageHeader') || !billing.includes('<MerchantLoadingState')) failures.push('Billing must use shared page and loading states');
if (!agreements.includes('<MerchantPageHeader') || !agreements.includes('<MerchantLoadingState')) failures.push('Agreements must use shared page and loading states');
if (!agreementPackage.includes('<MerchantPageHeader') || !agreementPackage.includes('<MerchantLoadingState') || !agreementPackage.includes('<MerchantFactGrid') || !agreementPackage.includes('<MerchantStatusBadge')) failures.push('Agreement Package must use shared page, loading, fact and status primitives');
if (!merchantApp.includes("from './MerchantPagePrimitives'") || !merchantApp.includes('<MerchantShellState') || !merchantApp.includes('<MerchantEmptyState') || !merchantApp.includes('<MerchantNotice')) failures.push('Merchant shell must use shared shell, empty and notice primitives');
for (const local of ['function Status(', 'function Empty(', 'function PageTable(', 'function Heading(']) { if (merchantApp.includes(local)) failures.push(`Merchant shell must not reintroduce local presentation primitive ${local}`); }

if (failures.length) {
  console.error('SellerTray Merchant Web primitives preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray Merchant Web primitives preflight passed.');
