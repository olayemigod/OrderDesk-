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

  // Frozen PostgreSQL timestamptz evidence is an offset-bearing ISO timestamp.
  // Date.parse() alone cannot validate it: JS normalises impossible days
  // (for example 2026-02-30 becomes March 2) and may accept 24:00 rollover.
  const match = typeof dueAt === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):?(\d{2}))$/.exec(dueAt)
    : null;
  if (!match) {
    throw new Error('The Branch Order Form contains an invalid installment due date');
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!daysInMonth || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59
    || !Number.isFinite(Date.parse(dueAt))) {
    throw new Error('The Branch Order Form contains an invalid installment due date');
  }

  const displayed = formatDate(dueAt);
  if (typeof displayed !== 'string' || !displayed.trim() || displayed === '—') {
    throw new Error('The Branch Order Form could not format its installment due date');
  }
  return displayed;
}
