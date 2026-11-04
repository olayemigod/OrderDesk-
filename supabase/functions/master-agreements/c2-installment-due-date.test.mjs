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

test('missing or invalid due-date evidence must still be rejected', () => {
  for (const value of [undefined, '', 'not-a-date', {}, 0, '2026-11-04']) {
    assert.throws(() => formatOrderFormInstallmentDueDate(value, display), /invalid installment due date/);
  }
  assert.throws(
    () => formatOrderFormInstallmentDueDate('2026-12-31T09:00:00Z', () => '—'),
    /could not format/,
  );
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
