import { isLikelyConnectivityError } from './offlineSalesRepository';

export function sellerTrayUserMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (isLikelyConnectivityError(error)) return 'Connect to continue.';

  const raw = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '');
  if (!raw.trim()) return fallback;
  if (/duplicate key value|unique constraint|violates .*constraint|postgres|sqlstate|supabase\.co|https?:\/\//i.test(raw)) return fallback;
  return raw.replace(/Error:\s*/gi, '').trim() || fallback;
}

/**
 * Routine SellerTray reachability loss is global Online/Offline/Syncing state,
 * not a local page error. Background refresh/read callers should use this
 * helper and keep cached/local data visible when it returns null.
 */
export function sellerTrayBackgroundError(error: unknown, fallback: string): string | null {
  if (isLikelyConnectivityError(error)) return null;
  return sellerTrayUserMessage(error, fallback);
}
