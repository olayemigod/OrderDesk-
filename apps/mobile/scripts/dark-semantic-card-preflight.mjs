import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const theme = read('src/theme/sellerTrayTheme.ts');
const inventory = read('src/redesign/InventoryTabWorkspace.tsx');
const stockCount = read('src/redesign/StockCountWorkspace.tsx');

for (const token of ['dangerSurface', 'dangerBorder', 'dangerText']) {
  requireValue(theme.includes(`${token}:`), `Dark theme must define ${token} for semantic danger surfaces`);
}

requireValue(
  inventory.includes('alertDark&&darkStyles.alert'),
  'Inventory dark-mode alert cards must override the light danger surface after the light alert style',
);
requireValue(
  inventory.includes('alertDark&&darkStyles.alertIcon'),
  'Inventory dark-mode alert cards must use a dark semantic icon surface',
);
requireValue(
  inventory.includes('theme.dark.dangerText'),
  'Inventory dark-mode alert icon and affordance must use the shared dark danger text token',
);
requireValue(
  inventory.includes('backgroundColor:theme.dark.dangerSurface'),
  'Inventory dark-mode alert card must use the shared dark danger surface token',
);
requireValue(
  stockCount.includes('style={[styles.metric, dark && darkStyles.metric]}'),
  'Stock Count Counted, Variances and +/- metric cards must apply an explicit dark surface',
);
requireValue(
  stockCount.includes("metric: { backgroundColor: '#172033', borderColor: '#334155' }"),
  'Stock Count dark metric cards must use a readable dark surface and border',
);

if (failures.length) {
  console.error('SellerTray dark semantic card preflight failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('SellerTray dark semantic card preflight passed.');
