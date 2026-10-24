import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

const required = [
  'providerPaidAt(data)',
  'Verified provider payment time is required for installment confirmation',
  "p_provider_event_fingerprint: fingerprint",
  "await rpc<JsonRecord>('reconcile_sellertray_installment_entitlement'",
  "return new Response('Webhook processing failed', { status: 500 })",
  'function providerPaidAt(data: JsonRecord): string | null',
];

for (const value of required) {
  if (!source.includes(value)) {
    throw new Error(`paystack-webhook C1B contract is missing: ${value}`);
  }
}

const forbidden = [
  'const paidAt = asString(data.paid_at) ?? new Date().toISOString();',
  'Reconciliation is deliberately best-effort',
  "console.error('SellerTray installment entitlement reconciliation requires review'",
];

for (const value of forbidden) {
  if (source.includes(value)) {
    throw new Error(`paystack-webhook C1B contract forbids: ${value}`);
  }
}

const providerTimeStart = source.indexOf('function providerPaidAt(data: JsonRecord): string | null');
const providerTimeEnd = source.indexOf('\nfunction toNumber', providerTimeStart);
const providerTimeSource = source.slice(providerTimeStart, providerTimeEnd);
if (providerTimeStart < 0 || providerTimeEnd <= providerTimeStart || providerTimeSource.includes('data.created_at')) {
  throw new Error('paystack-webhook installment payment time must not fall back to transaction creation time');
}

const confirmationIndex = source.indexOf("confirm_sellertray_installment_payment_from_checkout");
const reconciliationIndex = source.indexOf("reconcile_sellertray_installment_entitlement", confirmationIndex);
if (confirmationIndex < 0 || reconciliationIndex <= confirmationIndex) {
  throw new Error('paystack-webhook must confirm the immutable installment payment before reconciliation');
}

console.log('paystack-webhook C1B installment retry/time contract passed');
