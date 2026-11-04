/**
 * Order Forms reproduce the actual governed installment template, including
 * its absence of an approved calendar deadline. NULL is intentional for
 * certain published C2 structures; an absent/invalid field is not.
 *
 * @param {unknown} dueAt - Frozen dueAt from the commercial snapshot.
 * @param {(iso: string) => string} formatDate - PDF's date renderer.
 */
export function formatOrderFormInstallmentDueDate(dueAt, formatDate) {
  if (dueAt === null) return 'Not specified in the selected installment structure';
  if (typeof dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}[T\s]/.test(dueAt)
    || !Number.isFinite(Date.parse(dueAt))) {
    throw new Error('The Branch Order Form contains an invalid installment due date');
  }
  const displayed = formatDate(dueAt);
  if (typeof displayed !== 'string' || !displayed.trim() || displayed === '—') {
    throw new Error('The Branch Order Form could not format its installment due date');
  }
  return displayed;
}
