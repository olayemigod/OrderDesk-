import type { MerchantPortalPage } from './portalNavigation';
import { errorMessage, supabase } from './supabase';

export type MerchantHandoffTarget = {
  businessId: string;
  page: MerchantPortalPage;
};

type BackendTargetPage = 'agreements' | 'sellertray_billing' | 'setup';

const HANDOFF_PAGE_MAP: Record<BackendTargetPage, MerchantPortalPage> = {
  agreements: 'agreements',
  sellertray_billing: 'sellertray_billing',
  setup: 'setup_activation',
};

export async function consumeMerchantWebHandoff(): Promise<MerchantHandoffTarget | null> {
  const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const handoffToken = parameters.get('st_handoff')?.trim() ?? '';
  if (!handoffToken) return null;

  // Remove the one-time bearer before any application rendering, navigation or
  // referrer use. The browser never persists the raw handoff secret.
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

  if (!/^[A-Za-z0-9_-]{40,128}$/.test(handoffToken)) {
    throw new Error('This SellerTray continuation link is invalid. Return to the mobile app and try again.');
  }

  const { data, error } = await supabase.functions.invoke('merchant-web-handoff', {
    body: { action: 'consume', handoffToken },
  });
  if (error) throw new Error(errorMessage(error, 'SellerTray could not continue securely to Merchant Web.'));

  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const tokenHash = typeof payload.tokenHash === 'string' ? payload.tokenHash : '';
  const businessId = typeof payload.tenantId === 'string' ? payload.tenantId : '';
  const backendPage = backendTargetPage(payload.targetPage);
  const page = backendPage ? HANDOFF_PAGE_MAP[backendPage] : null;

  if (!tokenHash || !isUuid(businessId) || !page) {
    throw new Error('SellerTray could not verify this Merchant Web continuation. Return to the mobile app and try again.');
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  });
  if (verifyError) {
    throw new Error('SellerTray could not establish your Merchant Web session. Return to the mobile app and try again.');
  }

  return { businessId, page };
}

function backendTargetPage(value: unknown): BackendTargetPage | null {
  return value === 'agreements' || value === 'sellertray_billing' || value === 'setup' ? value : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
