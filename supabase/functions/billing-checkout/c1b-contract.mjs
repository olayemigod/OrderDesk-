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
  "begin_sellertray_installment_checkout_initialization",
  "initialization.status === 'failed'",
  '!initialization.started',
  "status: 'preparing'",
  "fail_sellertray_installment_checkout_initialization",
  'Retry with the same checkout command.',
];
for (const value of checkoutRequired) {
  if (!checkoutSource.includes(value)) {
    throw new Error(`billing-checkout C1B retry contract is missing: ${value}`);
  }
}

const installmentStartIndex = checkoutSource.indexOf('async function startInstallmentCheckout');
const failedIndex = checkoutSource.indexOf("reservation.status === 'failed'", installmentStartIndex);
const beginIndex = checkoutSource.indexOf("begin_sellertray_installment_checkout_initialization", installmentStartIndex);
const initializeIndex = checkoutSource.indexOf("https://api.paystack.co/transaction/initialize", installmentStartIndex);
const failIndex = checkoutSource.indexOf("fail_sellertray_installment_checkout_initialization", installmentStartIndex);
if (
  installmentStartIndex < 0
  || failedIndex <= installmentStartIndex
  || beginIndex <= failedIndex
  || initializeIndex <= beginIndex
  || failIndex <= initializeIndex
) {
  throw new Error('billing-checkout must lease provider initialization before Paystack and retire only an explicit provider failure afterwards');
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

console.log('billing-checkout C1B failed/ambiguous-attempt retry contract passed');
