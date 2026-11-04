// SellerTray merchant-facing legal dates are Nigerian civil dates. The
// authoritative UTC/offset timestamp is retained unchanged in evidence;
// only rendered display is formatted here.
const TIME_ZONE = 'Africa/Lagos';

function parsedDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Use dd/mm/yyyy consistently on reviewed and executed legal documents. */
export function formatAgreementDate(value) {
  const date = parsedDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TIME_ZONE,
  }).format(date);
}

/** Keep the event time visible for signatures/acceptance without changing its evidence. */
export function formatAgreementDateTime(value) {
  const date = parsedDate(value);
  if (!date) return '—';
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE,
  }).format(date);
  return `${formatAgreementDate(value)} ${time} WAT`;
}
