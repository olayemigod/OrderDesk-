import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.resolve(root, relative), 'utf8');
const notifications = read('src/data/merchantNotificationsRepository.ts');
const app = read('src/SaasApp.tsx');
const packageJson = read('package.json');

const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(
  notifications.includes("'master_agreement_required'")
    && notifications.includes("'master_agreement_accepted'"),
  'Mobile must continue consuming the governed Master Agreement lifecycle notification vocabulary.',
);
requireValue(
  app.includes('useMerchantNotifications')
    && app.includes("setView('notifications')"),
  'Mobile must keep agreement lifecycle awareness inside the governed notification shell.',
);
requireValue(
  !app.includes("functions.invoke('master-agreements'")
    && !app.includes('merchant_confirm_package')
    && !app.includes('Accept & Sign')
    && !app.includes('Confirm & Sign'),
  'Mobile must not become a second Master Agreement signing authority; authenticated signing remains Merchant Web owned.',
);
requireValue(
  !packageJson.includes('pdf-lib')
    && !packageJson.includes('unpdf')
    && !packageJson.includes('jspdf'),
  'Mobile must not generate canonical Agreement Package PDF evidence locally.',
);

if (failures.length) {
  console.error('Mobile agreement boundary preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Mobile agreement notification/handoff boundary preflight passed.');
