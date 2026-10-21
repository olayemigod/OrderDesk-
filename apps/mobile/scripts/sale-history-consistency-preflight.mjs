import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function requireText(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

const orderDomain = read('src/domain/order.ts');
const ordersWorkspace = read('src/redesign/OrdersWorkspace.tsx');
const printerRepository = read('src/data/printerRepository.ts');
const receipt = read('src/printing/escPosReceipt.ts');

requireText(
  orderDomain,
  /order\.status === 'completed'[\s\S]*order\.paymentStatus === 'paid'[\s\S]*return order\.amountPaid/,
  'Completed paid sale history must prefer the committed paid amount over line-only subtotal reconstruction.',
);
requireText(
  ordersWorkspace,
  /order\.branchName[\s\S]*Cashier: \$\{order\.posOperatorName\}/,
  'Order/invoice history rows must visibly retain Branch and immutable Cashier attribution.',
);
requireText(printerRepository, /subtotalAmount:[\s\S]*taxRatePercent:[\s\S]*taxAmount:[\s\S]*grossAmount:/,
  'Receipt parser must preserve committed financial snapshot fields.');
requireText(receipt, /'SUBTOTAL'/, 'Receipt must print an explicit subtotal.');
requireText(receipt, /taxLabel\(snapshot\.taxRatePercent\)/, 'Receipt must print the stored tax rate with the tax amount.');
requireText(receipt, /'TOTAL'/, 'Receipt must print the authoritative grand total.');
if (/sellertray_tax_configurations|loadSellerTrayTax|tax settings/i.test(receipt)) {
  throw new Error('Receipt rendering must not consult current tax settings.');
}

console.log('sale history consistency preflight passed');
