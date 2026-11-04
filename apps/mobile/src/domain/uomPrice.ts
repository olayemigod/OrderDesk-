/**
 * Read-only price preview for the POS catalogue and offline product snapshot.
 * The server's sellertray_effective_uom_selling_price is authoritative.
 * A configured selling price, including zero, always supersedes conversion.
 */
export function resolveSellerTrayUnitPrice(
  explicitPrice: number | string | null,
  stockUnitPrice: number | string | null,
  conversionFactor: number | string,
): number | null {
  const configured = numberOrNull(explicitPrice);
  if (configured !== null) return configured;
  const base = numberOrNull(stockUnitPrice);
  const conversion = numberOrNull(conversionFactor);
  if (base === null || conversion === null || conversion <= 0 || base < 0) return null;
  const cents = Math.round(Math.round(base * 100) * conversion + Number.EPSILON);
  return Number.isFinite(cents) ? cents / 100 : null;
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
