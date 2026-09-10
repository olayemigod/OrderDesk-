import { supabase } from '../lib/supabase';

export type SubscriptionBaseStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'grace'
  | 'suspended'
  | 'cancelled';

export type SubscriptionEffectiveStatus = SubscriptionBaseStatus | 'trial_expired' | 'grace_expired';
export type SubscriptionAccessMode = 'full' | 'read_only';

export type SubscriptionAccess = {
  planCode: string;
  planName: string;
  baseStatus: SubscriptionBaseStatus;
  effectiveStatus: SubscriptionEffectiveStatus;
  accessMode: SubscriptionAccessMode;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  currency: string;
  priceAmount: number | null;
  billingInterval: 'month';
  checkoutReady: boolean;
};

export type BillingCheckout = {
  authorizationUrl: string;
  reference: string;
};

export async function loadSubscriptionAccess(tenantId: string): Promise<SubscriptionAccess> {
  const { data, error } = await supabase.rpc('get_orderdesk_subscription_access', {
    p_tenant_id: tenantId,
  });

  if (error) throw error;
  if (!data || typeof data !== 'object') {
    throw new Error('OrderDesk subscription state is unavailable.');
  }

  const value = data as Record<string, unknown>;
  return {
    planCode: stringValue(value.planCode, 'business'),
    planName: stringValue(value.planName, 'SellerTray Business'),
    baseStatus: baseStatus(value.baseStatus),
    effectiveStatus: effectiveStatus(value.effectiveStatus),
    accessMode: value.accessMode === 'read_only' ? 'read_only' : 'full',
    trialStartedAt: optionalString(value.trialStartedAt),
    trialEndsAt: optionalString(value.trialEndsAt),
    currentPeriodStart: optionalString(value.currentPeriodStart),
    currentPeriodEnd: optionalString(value.currentPeriodEnd),
    graceEndsAt: optionalString(value.graceEndsAt),
    cancelAtPeriodEnd: value.cancelAtPeriodEnd === true,
    currency: stringValue(value.currency, 'NGN'),
    priceAmount: numberValue(value.priceAmount),
    billingInterval: 'month',
    checkoutReady: value.checkoutReady === true,
  };
}

export async function startBillingCheckout(tenantId: string): Promise<BillingCheckout> {
  const { data, error } = await supabase.functions.invoke('billing-checkout', {
    body: { tenantId },
  });

  if (error) throw error;
  if (!data || typeof data !== 'object') {
    throw new Error('OrderDesk could not start billing checkout.');
  }

  const value = data as Record<string, unknown>;
  const authorizationUrl = optionalString(value.authorizationUrl);
  const reference = optionalString(value.reference);
  if (!authorizationUrl || !reference) {
    throw new Error('Billing provider returned an incomplete checkout session.');
  }

  return { authorizationUrl, reference };
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function baseStatus(value: unknown): SubscriptionBaseStatus {
  const supported: SubscriptionBaseStatus[] = ['trial', 'active', 'past_due', 'grace', 'suspended', 'cancelled'];
  return supported.includes(value as SubscriptionBaseStatus) ? value as SubscriptionBaseStatus : 'trial';
}

function effectiveStatus(value: unknown): SubscriptionEffectiveStatus {
  const supported: SubscriptionEffectiveStatus[] = [
    'trial',
    'active',
    'past_due',
    'grace',
    'suspended',
    'cancelled',
    'trial_expired',
    'grace_expired',
  ];
  return supported.includes(value as SubscriptionEffectiveStatus)
    ? value as SubscriptionEffectiveStatus
    : 'trial';
}
