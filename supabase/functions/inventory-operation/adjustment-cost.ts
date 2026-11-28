// Verified adjustment cost is evidence, not a default. In particular, JSON
// booleans, whitespace and arrays must never become a documented zero cost.
export function parseAdjustmentUnitCost(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 999999999999999
    ? parsed : null;
}

export function parseAdjustmentEvidenceText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  // Match the database's evidence length limit instead of silently truncating
  // facts that are part of the immutable command/retry identity.
  return clean && Array.from(clean).length <= max ? clean : null;
}
