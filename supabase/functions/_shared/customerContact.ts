/**
 * Customer identifiers are not contact numbers.
 *
 * A manual/phone-less customer owns a reserved wa_id solely to satisfy the
 * legacy unique identity column. Never surface that internal key in invoices,
 * receipts, print snapshots or outward-facing customer details.
 *
 * Retain real numeric WhatsApp identities for legacy customers without a
 * separately populated phone field. Do not manufacture a phone or change
 * matching/transaction authority here: this module is presentation-only.
 */
function displayablePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const canonical = trimmed.replace(/[\s()-]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(canonical)) return null;
  return trimmed;
}

export function customerContactPhone(phone: unknown, whatsappId: unknown): string | null {
  return displayablePhone(phone) ?? displayablePhone(whatsappId);
}

export function customerPublicName(
  displayName: unknown,
  phone: unknown,
  whatsappId: unknown,
  fallback = 'Customer',
): string {
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  if (name && !/^(manual:|pos:)/i.test(name)) return name;
  return customerContactPhone(phone, whatsappId) ?? fallback;
}
