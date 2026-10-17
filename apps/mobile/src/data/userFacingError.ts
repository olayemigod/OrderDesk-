import { isLikelyConnectivityError } from './offlineSalesRepository';

/**
 * Connectivity is application state in SellerTray, not a generic user-facing error.
 * Callers that can continue with cached/local data should suppress connectivity failures
 * and let the global Online / Offline / Syncing status present reachability.
 */
export function sellerTrayUserMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
  options: { suppressConnectivity?: boolean } = {},
): string | null {
  if (isLikelyConnectivityError(error)) {
    return options.suppressConnectivity ? null : 'Connect to continue.';
  }

  const raw = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '');
  if (!raw.trim()) return fallback;
  if (/duplicate key value|unique constraint|violates .*constraint|postgres|sqlstate|supabase\.co|https?:\/\//i.test(raw)) return fallback;
  return raw.replace(/Error:\s*/gi, '').trim() || fallback;
}

export function sellerTrayBackgroundError(error: unknown, fallback: string): string | null {
  return sellerTrayUserMessage(error, fallback, { suppressConnectivity: true });
}
