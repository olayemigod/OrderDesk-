import { supabase } from '../lib/supabase';

export type SellerTrayMerchantWebHandoff = {
  url: string;
  expiresAt: string;
  actionCode: string;
  actionLabel: string;
};

export async function createSellerTrayMerchantWebHandoff(
  tenantId: string,
): Promise<SellerTrayMerchantWebHandoff> {
  const { data, error } = await supabase.functions.invoke('merchant-web-handoff', {
    body: { action: 'create', tenantId },
  });

  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SellerTray could not prepare Merchant Web continuation.');
  }

  const payload = data as Record<string, unknown>;
  const url = typeof payload.url === 'string' ? payload.url : '';
  const expiresAt = typeof payload.expiresAt === 'string' ? payload.expiresAt : '';
  const actionCode = typeof payload.actionCode === 'string' ? payload.actionCode : '';
  const actionLabel = typeof payload.actionLabel === 'string' ? payload.actionLabel : 'Continue onboarding';

  if (!isSecureMerchantWebUrl(url) || !expiresAt || !actionCode) {
    throw new Error('SellerTray returned an invalid Merchant Web continuation.');
  }

  return { url, expiresAt, actionCode, actionLabel };
}

function isSecureMerchantWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hash.startsWith('#st_handoff=');
  } catch {
    return false;
  }
}
