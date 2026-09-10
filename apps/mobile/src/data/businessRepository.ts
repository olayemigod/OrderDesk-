import { supabase } from '../lib/supabase';

export type OnboardingStatus = 'profile' | 'catalogue' | 'whatsapp' | 'test_order' | 'ready';
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'grace' | 'suspended' | 'cancelled';
export type WhatsAppConnectionStatus = 'not_connected' | 'pending' | 'connected' | 'error';
export type MerchantRole = 'owner' | 'manager' | 'staff';

export type MerchantBusiness = {
  id: string;
  name: string;
  slug: string;
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
  businessEmail: string | null;
  businessPhone: string | null;
  businessType: string | null;
};

type MembershipRow = {
  role: MerchantRole;
  tenants:
    | {
        id: string;
        name: string;
        slug: string;
        business_email: string | null;
        business_phone: string | null;
        business_type: string | null;
        logo_url: string | null;
        currency: string;
        timezone: string;
        onboarding_status: OnboardingStatus;
        subscription_status: SubscriptionStatus;
        whatsapp_connection_status: WhatsAppConnectionStatus;
      }
    | Array<{
        id: string;
        name: string;
        slug: string;
        business_email: string | null;
        business_phone: string | null;
        business_type: string | null;
        logo_url: string | null;
        currency: string;
        timezone: string;
        onboarding_status: OnboardingStatus;
        subscription_status: SubscriptionStatus;
        whatsapp_connection_status: WhatsAppConnectionStatus;
      }>
    | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function loadBusinesses(): Promise<MerchantBusiness[]> {
  const { data, error } = await supabase
    .from('tenant_members')
    .select(`
      role,
      created_at,
      tenants(
        id,
        name,
        slug,
        business_email,
        business_phone,
        business_type,
        logo_url,
        currency,
        timezone,
        onboarding_status,
        subscription_status,
        whatsapp_connection_status
      )
    `)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return ((data ?? []) as unknown as MembershipRow[])
    .map((membership) => {
      const tenant = one(membership.tenants);
      if (!tenant) return null;

      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        role: membership.role,
        businessEmail: tenant.business_email,
        businessPhone: tenant.business_phone,
        businessType: tenant.business_type,
        logoUrl: tenant.logo_url,
        currency: tenant.currency,
        timezone: tenant.timezone,
        onboardingStatus: tenant.onboarding_status,
        subscriptionStatus: tenant.subscription_status,
        whatsappConnectionStatus: tenant.whatsapp_connection_status,
      } satisfies MerchantBusiness;
    })
    .filter((business): business is MerchantBusiness => business !== null);
}

export async function createInitialBusiness(input: InitialBusinessInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Business name is required.');

  const { data, error } = await supabase.rpc('create_my_business', {
    p_name: name,
    p_business_email: cleanOptional(input.businessEmail),
    p_business_phone: cleanOptional(input.businessPhone),
    p_business_type: cleanOptional(input.businessType),
  });

  if (error) throw error;
  if (typeof data !== 'string' || !data) throw new Error('OrderDesk could not create the business workspace.');
  return data;
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
