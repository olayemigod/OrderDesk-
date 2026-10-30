import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'src/SellerTrayBillingManagement.tsx',
  'src/SellerTrayInitialPurchase.tsx',
  'src/CommercialAgreementsManagement.tsx',
];

const forbiddenMerchantPhrases = [
  'governed plan',
  'governed purchase',
  'governed commercial order',
  'server authority',
  'immutable settlement facts',
  'commercial balance',
  'runtime authority',
  'legacy runtime',
  'OA5',
  'C2',
];

const failures = [];
for (const relative of targets) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, 'utf8');
  for (const phrase of forbiddenMerchantPhrases) {
    if (source.toLowerCase().includes(phrase.toLowerCase())) failures.push(`${relative}: merchant-facing implementation phrase \"${phrase}\" must not be reintroduced`);
  }
}

if (failures.length) {
  console.error('SellerTray production-language preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`SellerTray production-language preflight passed for ${targets.length} merchant-facing commercial surfaces.`);
