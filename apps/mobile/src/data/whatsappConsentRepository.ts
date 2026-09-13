import { supabase } from '../lib/supabase';

export type WhatsAppPolicy = {
  policy_key: string;
  version: string;
  effective_at: string;
  summary: string;
};

export type WhatsAppConsentStatus = {
  role: string;
  policies: WhatsAppPolicy[];
  termsPrivacyAccepted: boolean;
  consentActive: boolean;
  consent: {
    id: string;
    policy_version: string;
    scopes: string[];
    accepted_at: string;
    accepted_via: string;
  } | null;
};

export async function loadWhatsAppConsent(tenantId: string): Promise<WhatsAppConsentStatus> {
  return invokeConsent({ action: 'status', tenantId });
}

export async function acceptWhatsAppConsent(tenantId: string): Promise<WhatsAppConsentStatus> {
  await invokeConsent({ action: 'accept', tenantId, acceptedVia: 'sellertray_mobile' });
  return loadWhatsAppConsent(tenantId);
}

export async function revokeWhatsAppConsent(
  tenantId: string,
  reason = 'owner_revoked_in_app',
): Promise<WhatsAppConsentStatus> {
  await invokeConsent({ action: 'revoke', tenantId, reason });
  return loadWhatsAppConsent(tenantId);
}

async function invokeConsent(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('channel-consent', { body });
  if (!error) return data;

  let message = error.message || 'SellerTray WhatsApp consent request failed.';
  if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
    try {
      const payload = await (error.context as Response).clone().json() as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // Keep the SDK message.
    }
  }
  throw new Error(message);
}
