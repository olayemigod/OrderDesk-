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
  const baseCents = scaledDecimal(base, 2);
  const conversionMicros = scaledDecimal(conversion, 6);
  if (baseCents === null || conversionMicros === null) return null;
  const resultCents = (baseCents * conversionMicros + 500_000n) / 1_000_000n;
  return resultCents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(resultCents) / 100 : null;
}

/**
 * Catalog prices have 2 decimal places and Product UOM conversions have 6.
 * Convert their decimal digits directly to integers so half-cent boundaries
 * round exactly like PostgreSQL numeric, not binary floating point.
 */
export function scaledDecimal(value: number, places: number): bigint | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const match = /^(\\d+)(?:\\.(\\d+))?$/.exec(String(value));
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > places && /[1-9]/.test(fraction.slice(places))) return null;
  const scaled = `${match[1]}${fraction.padEnd(places, '0').slice(0, places)}`;
  return BigInt(scaled);
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
