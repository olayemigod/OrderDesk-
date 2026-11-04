/** SellerTray legal views use Nigerian civil dates (dd/mm/yyyy).
 * UTC evidence is never modified; conversion is display-only.
 */
const timeZone = 'Africa/Lagos';

export function formatLegalDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone,
    }).format(date)
    : '—';
}

export function formatLegalDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).format(date);
  return `${formatLegalDate(value)} ${time} WAT`;
}
