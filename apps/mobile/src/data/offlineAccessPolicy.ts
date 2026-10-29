export type CachedOperationalAccess = { canWrite: boolean; validUntil: string | null };

export function isCachedOperationalAccessAllowed(value: CachedOperationalAccess | null, now = Date.now()): boolean {
  if (value?.canWrite !== true) return false;
  return value.validUntil === null || (Number.isFinite(Date.parse(value.validUntil)) && Date.parse(value.validUntil) > now);
}
