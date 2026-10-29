import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [main, mobile, mobileFeatures] = await Promise.all([
  readFile(`${root}src/main.tsx`, 'utf8'),
  readFile(`${root}src/mobile.css`, 'utf8'),
  readFile(`${root}src/mobile-features.css`, 'utf8'),
]);

const requiredImports = [
  "import './purchasing.css';",
  "import './mobile.css';",
  "import './mobile-features.css';",
];

const requiredResponsiveContracts = [
  '.sellertray-input',
  '.sellertray-select',
  '.sellertray-textarea',
  '.report-center-tabs',
  '.check-row',
  '.product-workspace',
  '.table-wrap',
  '@media (max-width: 760px)',
  'font-size: 16px',
  'overflow-x: hidden',
  'overflow-x: auto',
];

const requiredFeatureContracts = [
  '.branch-row small',
  '.device-row small',
  '.dashboard-heading-copy',
  '.product-tabs button',
  '.purchasing-tabs button',
  '@media (max-width: 520px)',
];

const failures = [];
for (const value of requiredImports) {
  if (!main.includes(value)) failures.push(`Merchant entrypoint is missing ${value}`);
}
for (const value of requiredResponsiveContracts) {
  if (!mobile.includes(value)) failures.push(`Responsive foundation is missing ${value}`);
}
for (const value of requiredFeatureContracts) {
  if (!mobileFeatures.includes(value)) failures.push(`Feature mobile contract is missing ${value}`);
}

if (failures.length) {
  console.error('SellerTray Merchant Web responsive foundation check failed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray Merchant Web responsive foundation check passed.');
