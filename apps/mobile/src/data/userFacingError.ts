export function sellerTrayUserMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : String(error ?? '');
  if (!raw.trim()) return fallback;
  if (/unknownhost|unable to resolve host|network request failed|failed to fetch|fetch failed|networkerror|connection.*failed|failed to send a request to the edge function/i.test(raw)) return 'SellerTray is offline. Showing saved data where available.';
  if (/duplicate key value|unique constraint|violates .*constraint|postgres|sqlstate|supabase\.co|https?:\/\//i.test(raw)) return fallback;
  return raw.replace(/Error:\s*/gi, '').trim() || fallback;
}
