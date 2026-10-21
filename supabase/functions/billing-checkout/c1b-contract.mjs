import { readFileSync } from 'node:fs';

const checkoutSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const merchantSource = readFileSync(
  new URL('../../../apps/merchant-web/src/CommercialAgreementsManagement.tsx', import.meta.url),
  'utf8',
);

const checkoutRequired = [
  "reservation.status === 'failed'",
  "status: 'retry_required'",
  'needsNewCommand: true',
  "fail_sellertray_installment_checkout_initialization",
  'Retry with the same checkout command.',
];
for (const value of checkoutRequired) {
  if (!checkoutSource.includes(value)) {
    throw new Error(`billing-checkout C1B retry contract is missing: ${value}`);
  }
}

const failedIndex = checkoutSource.indexOf("reservation.status === 'failed'");
const initializeIndex = checkoutSource.indexOf("https://api.paystack.co/transaction/initialize", failedIndex);
if (failedIndex < 0 || initializeIndex <= failedIndex) {
  throw new Error('billing-checkout must retire an explicitly failed attempt before any new Paystack initialization path');
}

const merchantRequired = [
  "response.status === 'retry_required'",
  'response.needsNewCommand === true',
  'safeSessionStorageRemove(storageKey);',
  'Select Pay installment again to create a new payment attempt.',
];
for (const value of merchantRequired) {
  if (!merchantSource.includes(value)) {
    throw new Error(`Merchant Web C1B retry contract is missing: ${value}`);
  }
}

console.log('billing-checkout C1B failed-attempt retry contract passed');
