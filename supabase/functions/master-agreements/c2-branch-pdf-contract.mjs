import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./agreement-pdf.ts', import.meta.url), 'utf8');
const rendererStart = source.indexOf('function drawOrderForm(');
const rendererEnd = source.indexOf('function drawIntegrityPage(', rendererStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'Order Form PDF renderer exists');
const renderer = source.slice(rendererStart, rendererEnd);
const packageBuilder = source.slice(source.indexOf('export async function buildAgreementPackagePdf'), rendererStart);
assert.match(packageBuilder, /drawOrderForm\(doc, regular, bold, input\)/, 'Both review and executed PDFs use the same Form renderer');
assert.match(renderer, /snapshot\.orderKind\) === 'branch_commercial_v2'/, 'C2 Branch rendering is specifically gated');
assert.ok(renderer.indexOf('drawBranchCommitmentSchedules(') < renderer.indexOf('ORDER FORM LEGAL WORDING'), 'Frozen Branch payments appear before legal confirmation wording');

for (const property of [
  'snapshot.branch_commitments', 'branch.branch_name', 'branch.branch_id',
  'settlement.schedule', 'settlement.netAmountDue', 'branch.setup_required',
  'branch.billing_cycle', 'branch.installment_template_code',
  'installment.sequenceNo', 'installment.percentage', 'installment.amountDue',
  'installment.dueAt', 'formatDate(dueAt)', 'money(',
  'The Branch Order Form is missing a Branch identity or its frozen payment schedule',
]) {
  assert.ok(renderer.includes(property), `Branch PDF must use immutable field or fail-closed: ${property}`);
}
assert.match(source, /currency\.toUpperCase\(\)/, 'WinAnsi-friendly amounts use explicit ISO currency code');
console.log('SellerTray C2 reviewed Branch installment PDF source contract passed');
