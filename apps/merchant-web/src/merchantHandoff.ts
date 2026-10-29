import type { MerchantPortalPage } from './portalNavigation';
import { errorMessage, supabase } from './supabase';

export type MerchantHandoffTarget = {
  businessId: string;
  page: MerchantPortalPage;
};

const HANDOFF_PAGES = new Set<MerchantPortalPage>(['agreements', 'sellertray_billing', 'setup']);

export async function consumeMerchantWebHandoff(): Promise<MerchantHandoffTarget | null> {
  const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const handoffToken = parameters.get('st_handoff')?.trim() ?? '';
  if (!handoffToken) return null;

  // Remove the one-time bearer from the address bar before making any request,
  // rendering application UI, or allowing subsequent navigation/referrer use.
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
  const page = typeof payload.targetPage === 'string' ? payload.targetPage as MerchantPortalPage : 'overview';

  if (!tokenHash || !isUuid(businessId) || !HANDOFF_PAGES.has(page)) {
    throw new Error('SellerTray could not verify this Merchant Web continuation. Return to the mobile app and try again.');
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  });
  if (verifyError) throw new Error('SellerTray could not establish your Merchant Web session. Return to the mobile app and try again.');

  return { businessId, page };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
