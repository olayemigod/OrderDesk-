import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const billing = await readFile(path.join(root, 'src/SellerTrayBillingManagement.tsx'), 'utf8');
const initialPurchase = await readFile(path.join(root, 'src/SellerTrayInitialPurchase.tsx'), 'utf8');

const failures = [];
function expect(condition, message) {
  if (!condition) failures.push(message);
}

expect(
  billing.includes("setLoadError('SellerTray billing details could not be loaded. Refresh and try again.')"),
  'billing read failures must use bounded merchant-facing wording',
);
expect(
  billing.includes('loadError ? <div className="error-banner">') && billing.includes('onClick={() => void load()}>Retry</button>'),
  'billing read failures must offer an explicit retry',
);
expect(
  billing.includes('center && centerPayload !== null && center.orders.length === 0 ? <SellerTrayInitialPurchase'),
  'first-purchase controls must render only after a successful zero-order billing read',
);
expect(
  billing.includes('center && center.orders.length === 0 ? <article className="panel empty-state"><strong>No SellerTray purchase yet</strong>'),
  'the no-purchase state must require a successfully loaded billing center',
);
expect(
  !billing.includes('!center?.orders.length ? <article className="panel empty-state">'),
  'a failed billing read must never be interpreted as an empty purchase history',
);
expect(
  !initialPurchase.includes("body: { action: 'center', tenantId }"),
  'initial purchase must not issue a second billing-center request',
);
expect(
  initialPurchase.includes('centerData: unknown') && initialPurchase.includes('parseCenter(centerData)'),
  'initial purchase must reuse the parent billing-center payload',
);
expect(
  initialPurchase.includes("action: 'create_initial_purchase'"),
  'initial purchase must retain the governed create command',
);

if (failures.length) {
  console.error('SellerTray billing runtime preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray billing runtime preflight passed.');
