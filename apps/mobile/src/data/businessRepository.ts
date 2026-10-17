import { supabase } from '../lib/supabase';

export type OnboardingStatus = 'profile' | 'catalogue' | 'whatsapp' | 'test_order' | 'ready';
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'grace' | 'suspended' | 'cancelled';
export type WhatsAppConnectionStatus = 'not_connected' | 'pending' | 'connected' | 'error';
export type MerchantRole = 'owner' | 'manager' | 'staff';

export type WhatsAppMessagingReadiness = {
  inboundReady: boolean;
  outboundReady: boolean;
  messagingReady: boolean;
  webhookReady: boolean;
  credentialReady: boolean;
  reason: string | null;
  checkedAt: string | null;
};

export type MerchantBusiness = {
  id: string;
  name: string;
  slug: string;
  merchantCode: string;
  role: MerchantRole;
  businessEmail: string | null;
  businessPhone: string | null;
  businessType: string | null;
  logoUrl: string | null;
  currency: string;
  timezone: string;
  onboardingStatus: OnboardingStatus;
  subscriptionStatus: SubscriptionStatus;
  whatsappConnectionStatus: WhatsAppConnectionStatus;
  whatsappReadiness: WhatsAppMessagingReadiness;
};

export type BusinessProfileInput = {
  name: string;
  businessEmail: string | null;
  businessPhone: string | null;
  businessType: string | null;
  logoUrl: string | null;
  currency: string;
  timezone: string;
};

export type InitialBusinessInput = {
  name: string;
  merchantCode: string;
  businessEmail: string | null;
  businessPhone: string | null;
  businessType: string | null;
};

type BusinessMembershipRow = {
  id: string;
  name: string;
  slug: string;
  merchant_code: string;
  role: MerchantRole;
  business_email: string | null;
  business_phone: string | null;
  business_type: string | null;
  logo_url: string | null;
  currency: string;
  timezone: string;
  onboarding_status: OnboardingStatus;
  subscription_status: SubscriptionStatus;
  whatsapp_connection_status: WhatsAppConnectionStatus;
  membership_created_at: string;
};

export async function loadBusinesses(): Promise<MerchantBusiness[]> {
  const { data, error } = await supabase.rpc('sellertray_list_businesses_for_current_user');
  if (error) throw error;

  const businesses = ((data ?? []) as unknown as BusinessMembershipRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    merchantCode: row.merchant_code,
    role: row.role,
    businessEmail: row.business_email,
    businessPhone: row.business_phone,
    businessType: row.business_type,
    logoUrl: row.logo_url,
    currency: row.currency,
    timezone: row.timezone,
    onboardingStatus: row.onboarding_status,
    subscriptionStatus: row.subscription_status,
    whatsappConnectionStatus: row.whatsapp_connection_status,
    whatsappReadiness: fallbackWhatsAppReadiness(row.whatsapp_connection_status),
  } satisfies MerchantBusiness));

  const readiness = await Promise.all(
    businesses.map(async (business) => {
      try {
        return await loadWhatsAppMessagingReadiness(business.id);
      } catch {
        return fallbackWhatsAppReadiness(business.whatsappConnectionStatus);
      }
    }),
  );

  return businesses.map((business, index) => ({
    ...business,
    whatsappReadiness: readiness[index] ?? fallbackWhatsAppReadiness(business.whatsappConnectionStatus),
  }));
}

export async function createInitialBusiness(input: InitialBusinessInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Business name is required.');
  const merchantCode = input.merchantCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(merchantCode)) {
    throw new Error('Merchant ID must be exactly 3 letters or numbers.');
  }

  const { data, error } = await supabase.functions.invoke('provision-business', {
    body: {
      name,
      merchantCode,
      businessEmail: cleanOptional(input.businessEmail),
      businessPhone: cleanOptional(input.businessPhone),
      businessType: cleanOptional(input.businessType),
    },
  });

  if (error) {
    let message = error.message || 'Unable to create your SellerTray workspace.';
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

  const tenantId =
    data && typeof data === 'object' && 'tenantId' in data && typeof data.tenantId === 'string'
      ? data.tenantId
      : null;

  if (!tenantId) throw new Error('SellerTray could not create the business workspace.');
  return tenantId;
}

export async function updateBusinessProfile(
  businessId: string,
  input: BusinessProfileInput,
): Promise<void> {
  const name = input.name.trim();
  const currency = input.currency.trim().toUpperCase();
  const timezone = input.timezone.trim();

  if (!name) throw new Error('Business name is required.');
  if (currency.length !== 3) throw new Error('Currency must be a 3-letter code.');
  if (!timezone) throw new Error('Timezone is required.');

  const { error } = await supabase
    .from('tenants')
    .update({
      name,
      business_email: cleanOptional(input.businessEmail),
      business_phone: cleanOptional(input.businessPhone),
      business_type: cleanOptional(input.businessType),
      logo_url: cleanOptional(input.logoUrl),
      currency,
      timezone,
    })
    .eq('id', businessId);

  if (error) throw error;
}

function cleanOptional(value: string | null): string | null {
  const clean = value?.trim() ?? '';
  return clean || null;
}

async function loadWhatsAppMessagingReadiness(
  tenantId: string,
): Promise<WhatsAppMessagingReadiness> {
  const { data, error } = await supabase.functions.invoke('whatsapp-connection', {
    body: { action: 'status', tenantId },
  });
  if (error) throw error;

  const readiness =
    data && typeof data === 'object' && 'readiness' in data
      ? (data as { readiness?: unknown }).readiness
      : null;

  if (!readiness || typeof readiness !== 'object') {
    throw new Error('WhatsApp messaging readiness was not returned.');
  }

  const value = readiness as Record<string, unknown>;
  return {
    inboundReady: value.inboundReady === true,
    outboundReady: value.outboundReady === true,
    messagingReady: value.messagingReady === true,
    webhookReady: value.webhookReady === true,
    credentialReady: value.credentialReady === true,
    reason: typeof value.reason === 'string' ? value.reason : null,
    checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : null,
  };
}

function fallbackWhatsAppReadiness(
  status: WhatsAppConnectionStatus,
): WhatsAppMessagingReadiness {
  const connected = status === 'connected';
  return {
    inboundReady: connected,
    outboundReady: false,
    messagingReady: false,
    webhookReady: connected,
    credentialReady: false,
    reason: connected
      ? 'Outbound WhatsApp messaging readiness has not been verified yet.'
      : 'WhatsApp connection is not active.',
    checkedAt: null,
  };
}
