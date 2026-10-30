import { supabase } from '../lib/supabase';

export type SellerTrayMerchantWebHandoff = {
  url: string;
  expiresAt: string;
  actionCode: string;
  actionLabel: string;
};

export class SellerTrayMerchantWebHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SellerTrayMerchantWebHandoffError';
  }
}

export async function createSellerTrayMerchantWebHandoff(
  tenantId: string,
): Promise<SellerTrayMerchantWebHandoff> {
  const { data, error } = await supabase.functions.invoke('merchant-web-handoff', {
    body: { action: 'create', tenantId },
  });

  if (error) {
    const safeMessage = await readSafeHandoffError(error);
    if (safeMessage) throw new SellerTrayMerchantWebHandoffError(safeMessage);
    throw error;
  }
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

async function readSafeHandoffError(error: unknown): Promise<string | null> {
  const context = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: unknown }).context
    : null;
  if (!(context instanceof Response)) return null;

  try {
    const payload = await context.clone().json() as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const message = (payload as Record<string, unknown>).error;
    return isSafeServerMessage(message) ? message.trim() : null;
  } catch {
    return null;
  }
}

function isSafeServerMessage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const message = value.trim();
  return message.length > 0 && message.length <= 180 && !/[\r\n]/.test(message);
}

function isSecureMerchantWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hash.startsWith('#st_handoff=');
  } catch {
    return false;
  }
}
