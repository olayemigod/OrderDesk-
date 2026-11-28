import { parseAdjustmentUnitCost, parseAdjustmentEvidenceText } from './adjustment-cost.ts';

function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

Deno.test('explicit numeric zero is valid; omitted and coercible non-numbers are not verified cost', () => {
  equal(parseAdjustmentUnitCost(0), 0);
  equal(parseAdjustmentUnitCost('0.00'), 0);
  for (const invalid of [undefined, null, '', '  ', false, true, [], [0], {}, -1, '-1', Infinity, NaN, 'Infinity', '0x10', 1000000000000000]) {
    equal(parseAdjustmentUnitCost(invalid), null);
  }
});

Deno.test('documented decimal costs and the database upper limit remain supported', () => {
  equal(parseAdjustmentUnitCost(49000), 49000);
  equal(parseAdjustmentUnitCost(' 12.34567890 '), 12.3456789);
  equal(parseAdjustmentUnitCost('.5'), 0.5);
  equal(parseAdjustmentUnitCost(999999999999999), 999999999999999);
});

Deno.test('evidence is normalized but never silently truncated', () => {
  equal(parseAdjustmentEvidenceText('  Invoice  42  ', 160), 'Invoice 42');
  equal(parseAdjustmentEvidenceText('a'.repeat(160), 160), 'a'.repeat(160));
  equal(parseAdjustmentEvidenceText('a'.repeat(161), 160), null);
  equal(parseAdjustmentEvidenceText('a'.repeat(501), 500), null);
  equal(parseAdjustmentEvidenceText('  ', 500), null);
  equal(parseAdjustmentEvidenceText(42, 500), null);
});
