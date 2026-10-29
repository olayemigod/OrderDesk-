import { AVAILABLE_MERCHANT_PORTAL_PAGE_IDS, type MerchantPortalPage } from './portalNavigation';

const PAGE_QUERY_KEY = 'page';
const LAST_PAGE_STORAGE_PREFIX = 'sellertray.merchant.lastPage.';
const AVAILABLE_PAGE_IDS = new Set<string>(AVAILABLE_MERCHANT_PORTAL_PAGE_IDS);

export function isAvailableMerchantPage(value: string | null | undefined): value is MerchantPortalPage {
  return Boolean(value && AVAILABLE_PAGE_IDS.has(value));
}

export function readMerchantPageFromLocation(): MerchantPortalPage | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get(PAGE_QUERY_KEY);
  return isAvailableMerchantPage(value) ? value : null;
}

export function resolveMerchantPage(tenantId: string): MerchantPortalPage {
  return readMerchantPageFromLocation() ?? readMerchantLastPage(tenantId) ?? 'overview';
}

export function rememberMerchantPage(tenantId: string, page: MerchantPortalPage): void {
  if (typeof window === 'undefined' || !tenantId || !isAvailableMerchantPage(page)) return;
  window.localStorage.setItem(merchantPageStorageKey(tenantId), page);
}

export function syncMerchantPageUrl(tenantId: string, page: MerchantPortalPage, mode: 'push' | 'replace' = 'push'): void {
  if (typeof window === 'undefined' || !isAvailableMerchantPage(page)) return;
  rememberMerchantPage(tenantId, page);
  const url = new URL(window.location.href);
  url.searchParams.set(PAGE_QUERY_KEY, page);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (mode === 'push' && next === current) return;
  if (mode === 'replace') window.history.replaceState({}, '', next);
  else window.history.pushState({}, '', next);
}

export function merchantPageStorageKey(tenantId: string): string {
  return `${LAST_PAGE_STORAGE_PREFIX}${tenantId}`;
}

function readMerchantLastPage(tenantId: string): MerchantPortalPage | null {
  if (typeof window === 'undefined' || !tenantId) return null;
  const value = window.localStorage.getItem(merchantPageStorageKey(tenantId));
  return isAvailableMerchantPage(value) ? value : null;
}
