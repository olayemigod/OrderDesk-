import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

const required = [
  'subtotal_amount',
  'tax_applied',
  'tax_rate_percent',
  'tax_amount',
  'tax_display_breakdown',
  'gross_amount',
  'tax_posted_at',
  'tax_basis_amount',
  'gross_line_total',
  "'SUBTOTAL'",
  "'SALE TOTAL'",
  "'PAYMENT RECEIVED'",
  'Posted sale tax snapshot is inconsistent',
];

for (const value of required) {
  if (!source.includes(value)) {
    throw new Error(`financial-document tax contract is missing: ${value}`);
  }
}

const forbidden = [
  'sellertray_tax_configurations',
  'get_sellertray_tax_settings',
  'save_sellertray_tax_settings',
  'quote_sellertray_tax',
];

for (const value of forbidden) {
  if (source.includes(value)) {
    throw new Error(`financial-document must render posted snapshots, not current tax authority: ${value}`);
  }
}

console.log('financial-document posted-tax rendering contract passed');
