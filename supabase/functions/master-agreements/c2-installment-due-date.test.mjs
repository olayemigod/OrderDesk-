import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOrderFormInstallmentDueDate } from './installment-due-date.mjs';

const display = (dueAt) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
}).format(new Date(dueAt));

test('governed 70/30 and 60/20/20 alternatives render without invented deadlines', () => {
  const examples = [
    { structure: '70/30', amounts: [70, 30], dueDates: [null, null] },
    { structure: '60/20/20', amounts: [60, 20, 20], dueDates: [null, null, null] },
  ];
  for (const example of examples) {
    const labels = example.dueDates.map((dueAt) => formatOrderFormInstallmentDueDate(dueAt, display));
    assert.equal(labels.length, example.amounts.length, example.structure);
    for (const label of labels) {
      assert.equal(label, 'Not specified in the selected installment structure');
      assert.equal(formatOrderFormInstallmentDueDate(null, () => { throw new Error('must not invent date'); }), label);
    }
  }
});

test('review/executed artifact can display a dated installment as frozen', () => {
  const dueAt = '2026-12-31T09:00:00+00:00';
  assert.equal(formatOrderFormInstallmentDueDate(dueAt, display), display(dueAt));
});

test('missing, impossible, or invalid due-date evidence must fail closed', () => {
  const impossible = [
    undefined, '', 'not-a-date', {}, 0, '2026-11-04',
    '2026-02-30T09:00:00Z',  // Previously normalised to March 2.
    '2026-04-31T09:00:00Z',  // Previously normalised to May 1.
    '2026-02-29T09:00:00Z',  // 2026 is not a leap year.
    '2100-02-29T09:00:00Z',  // Divisible by 100, but not 400.
    '2026-00-01T09:00:00Z',
    '2026-13-01T09:00:00Z',
    '2026-12-00T09:00:00Z',
    '2026-12-32T09:00:00Z',
    '2026-12-31T24:00:00Z', // Javascript accepts a midnight day rollover.
    '2026-12-31T23:60:00Z',
    '2026-12-31T23:59:60Z',
    '2026-12-31T23:59:59+25:00',
    '2026-12-31T23:59:59+01:60',
    '2026-12-31T23:59:59', // Missing governed timezone evidence.
    '2026-12-31T23:59:59Z trailing',
  ];
  for (const value of impossible) {
    assert.throws(
      () => formatOrderFormInstallmentDueDate(value, display),
      /invalid installment due date/,
      `Invalid supplied installment evidence must not be silently normalised: ${String(value)}`,
    );
  }
  assert.throws(
    () => formatOrderFormInstallmentDueDate('2026-12-31T09:00:00Z', () => '—'),
    /could not format/,
  );
});

test('real calendar and timezone dates survive strict validation unchanged', () => {
  const valid = [
    '2028-02-29T09:00:00Z', // Leap day.
    '2000-02-29T09:00:00Z', // Century leap year.
    '2026-02-28T23:59:59Z',
    '2026-04-30T09:00:00+01:00',
    '2026-12-31T09:00:00+05:30',
    '2026-12-31T09:00:00.123456+00:00', // PostgreSQL timestamptz precision.
    '2026-12-31 09:00:00.123+00:00', // Valid historical timestamptz format.
  ];
  for (const dueAt of valid) {
    assert.equal(
      formatOrderFormInstallmentDueDate(dueAt, display),
      display(dueAt),
      `Valid frozen installment evidence must retain its specified calendar date: ${dueAt}`,
    );
  }
});

test('explicit null due date remains readable on historic issued forms', () => {
  const frozenHistorical = {
    schemaVersion: 2,
    orderKind: 'branch_commercial_v2',
    branch_commitments: [{
      installment_template_code: 'two_installment_70_30',
      installment_template_version: 1,
      settlement: {
        schedule: [
          { sequenceNo: 1, percentage: 70, amountDue: 700, dueAt: null },
          { sequenceNo: 2, percentage: 30, amountDue: 300, dueAt: null },
        ],
      },
    }],
  };
  assert.deepEqual(
    frozenHistorical.branch_commitments[0].settlement.schedule.map(
      (row) => formatOrderFormInstallmentDueDate(row.dueAt, display),
    ),
    ['Not specified in the selected installment structure', 'Not specified in the selected installment structure'],
  );
});
