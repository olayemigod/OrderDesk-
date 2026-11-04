import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatAgreementDate, formatAgreementDateTime } from './agreement-date-display.mjs';

const file = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('every Agreement/Order Form display date uses dd/mm/yyyy in Lagos local time', () => {
  assert.equal(formatAgreementDate('2026-11-04T10:35:00Z'), '04/11/2026');
  assert.equal(formatAgreementDate('2026-02-28T23:45:00Z'), '01/03/2026');
  assert.equal(formatAgreementDate('2028-02-29T09:00:00Z'), '29/02/2028');
  assert.equal(formatAgreementDate('2026-12-31T00:00:00Z'), '31/12/2026');
  assert.equal(formatAgreementDate('invalid-date'), '—');
  assert.equal(formatAgreementDateTime('2026-11-04T10:35:00Z'), '04/11/2026 11:35 WAT');
  assert.equal(formatAgreementDateTime('2026-02-28T23:45:00Z'), '01/03/2026 00:45 WAT');
  assert.equal(formatAgreementDateTime('invalid-date'), '—');
});

test('reviewed and executed PDF use consistent display for due dates and legal event timestamps', () => {
  const pdf = file('./agreement-pdf.ts');
  assert.match(pdf, /formatOrderFormInstallmentDueDate\(installment\.dueAt, formatAgreementDate\)/);
  assert.match(pdf, /\['Order date', formatAgreementDate\(/);
  assert.match(pdf, /\['Prepared', formatAgreementDateTime\(/);
  assert.match(pdf, /\['Master Agreement accepted', formatAgreementDateTime\(/);
  assert.match(pdf, /\['Order Form confirmed', formatAgreementDateTime\(/);
  assert.match(pdf, /page\.drawText\(formatAgreementDateTime\(confirmation\.confirmedAt\)/);
});

test('Merchant Web agreement screens use the same date order and preserve accepted/confirmed times', () => {
  const dates = file('../../../apps/merchant-web/src/legalDate.ts');
  const packageScreen = file('../../../apps/merchant-web/src/CommercialAgreementPackageManagement.tsx');
  const masterScreen = file('../../../apps/merchant-web/src/CommercialAgreementsManagement.tsx');
  for (const part of ["'en-GB'", "day: '2-digit'", "month: '2-digit'", "year: 'numeric'", "'Africa/Lagos'"]) {
    assert.ok(dates.includes(part), `Merchant date formatting must use ${part}`);
  }
  for (const screen of [packageScreen, masterScreen]) {
    assert.match(screen, /formatLegalDate as formatDate, formatLegalDateTime as formatDateTime/);
    assert.doesNotMatch(screen, /dateStyle: 'medium'/);
  }
  assert.match(packageScreen, /formatDateTime\(selected\.confirmation\.confirmedAt\)/);
  assert.match(masterScreen, /formatDateTime\(master\.acceptance\.acceptedAt\)/);
});

test('Admin Agreement lifecycle follows dd/mm/yyyy while leaving datetime-local input untouched', () => {
  const admin = file('../../../apps/admin-web/src/AgreementLifecycleManagement.tsx');
  assert.match(admin, /Intl\.DateTimeFormat\('en-GB', \{ day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa\/Lagos' \}\)/);
  assert.match(admin, /formatDateTime\(tenantState\.acceptance\.acceptedAt\)/);
  assert.match(admin, /formatDateTime\(selected\.publishedAt\)/);
  assert.match(admin, /type="datetime-local"/);
});
