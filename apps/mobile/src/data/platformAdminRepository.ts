import { supabase } from '../lib/supabase';

export type PlatformAdminRole = 'admin' | 'support';
export type PlatformTenantAccessMode = 'full' | 'read_only';
export type PlatformSubscriptionStatus = 'trial' | 'active' | 'past_due' | 'grace' | 'suspended' | 'cancelled';
export type PlatformWhatsappStatus = 'not_connected' | 'pending' | 'connected' | 'error';

export type PlatformTenantSummary = {
  id: string;
  name: string;
  slug: string;
  businessEmail: string | null;
  businessPhone: string | null;
  onboardingStatus: string;
  whatsappStatus: PlatformWhatsappStatus;
  subscriptionStatus: PlatformSubscriptionStatus;
  planCode: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  accessMode: PlatformTenantAccessMode;
  orders30d: number;
  needsReview: number;
  lastOrderAt: string | null;
  lastInboundAt: string | null;
  notificationExceptions: number;
  teamMembers: number;
  usageUnitsPeriod: number;
  usageAmountPeriod: number;
  usageUnitPrice: number | null;
  currency: string;
  usageAuthorizationReady: boolean;
  usageOutstandingAmount: number;
  usageFailedSettlements: number;
  supportNote: string | null;
  supportNoteUpdatedAt: string | null;
};

export type PlatformAdminOverview = {
  actorRole: PlatformAdminRole;
  generatedAt: string;
  tenants: PlatformTenantSummary[];
};

export type PlatformAdminAuditEvent = {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
  actorEmail: string;
};

export type PlatformAdminMutationAction =
  | 'set_subscription_status'
  | 'extend_trial_days'
  | 'set_whatsapp_status'
  | 'set_support_note';

export async function loadPlatformAdminOverview(): Promise<PlatformAdminOverview | null> {
  const { data, error } = await supabase.functions.invoke('platform-admin', {
    body: { action: 'overview' },
  });

  if (error) {
    if (httpStatus(error) === 403) return null;
    throw new Error(functionError(error, 'Unable to load ProcessEdge admin console.'));
  }

  const raw = isRecord(data) && isRecord(data.overview) ? data.overview : null;
  return raw ? normalizeOverview(raw) : null;
}

export async function mutatePlatformTenant(
  tenantId: string,
  action: PlatformAdminMutationAction,
  value: string | number | null,
): Promise<PlatformAdminOverview> {
  const { data, error } = await supabase.functions.invoke('platform-admin', {
    body: { action, tenantId, value },
  });

  if (error) throw new Error(functionError(error, 'Unable to update this SellerTray business.'));
  const raw = isRecord(data) && isRecord(data.overview) ? data.overview : null;
  if (!raw) throw new Error('Platform admin update returned no refreshed overview.');
  return normalizeOverview(raw);
}

export async function loadPlatformAdminAudit(
  tenantId: string | null = null,
  limit = 30,
): Promise<PlatformAdminAuditEvent[]> {
  const { data, error } = await supabase.functions.invoke('platform-admin', {
    body: { action: 'audit', tenantId, limit },
  });

  if (error) throw new Error(functionError(error, 'Unable to load platform audit history.'));
  const audit = isRecord(data) && isRecord(data.audit) ? data.audit : null;
  const events = audit && Array.isArray(audit.events) ? audit.events : [];

  return events.filter(isRecord).map((event) => ({
    id: stringValue(event.id),
    tenantId: optionalString(event.tenantId),
    tenantName: optionalString(event.tenantName),
    action: stringValue(event.action),
    detail: isRecord(event.detail) ? event.detail : {},
    createdAt: stringValue(event.createdAt),
    actorEmail: stringValue(event.actorEmail),
  }));
}

function normalizeOverview(raw: Record<string, unknown>): PlatformAdminOverview {
  const role = raw.actorRole === 'support' ? 'support' : 'admin';
  const tenants = Array.isArray(raw.tenants) ? raw.tenants.filter(isRecord).map(normalizeTenant) : [];
  return {
    actorRole: role,
    generatedAt: stringValue(raw.generatedAt),
    tenants,
  };
}

function normalizeTenant(value: Record<string, unknown>): PlatformTenantSummary {
  const subscriptionStatus = supportedSubscriptionStatus(value.subscriptionStatus);
  const whatsappStatus = supportedWhatsappStatus(value.whatsappStatus);
  return {
    id: stringValue(value.id),
    name: stringValue(value.name),
    slug: stringValue(value.slug),
    businessEmail: optionalString(value.businessEmail),
    businessPhone: optionalString(value.businessPhone),
    onboardingStatus: stringValue(value.onboardingStatus),
    whatsappStatus,
    subscriptionStatus,
    planCode: optionalString(value.planCode),
    trialEndsAt: optionalString(value.trialEndsAt),
    currentPeriodEnd: optionalString(value.currentPeriodEnd),
    graceEndsAt: optionalString(value.graceEndsAt),
    accessMode: value.accessMode === 'read_only' ? 'read_only' : 'full',
    orders30d: numberValue(value.orders30d),
    needsReview: numberValue(value.needsReview),
    lastOrderAt: optionalString(value.lastOrderAt),
    lastInboundAt: optionalString(value.lastInboundAt),
    notificationExceptions: numberValue(value.notificationExceptions),
    teamMembers: numberValue(value.teamMembers),
    usageUnitsPeriod: numberValue(value.usageUnitsPeriod),
    usageAmountPeriod: numberValue(value.usageAmountPeriod),
    usageUnitPrice: optionalNumber(value.usageUnitPrice),
    currency: stringValue(value.currency) || 'NGN',
    supportNote: optionalString(value.supportNote),
    supportNoteUpdatedAt: optionalString(value.supportNoteUpdatedAt),
  };
}

function supportedSubscriptionStatus(value: unknown): PlatformSubscriptionStatus {
  const supported: PlatformSubscriptionStatus[] = ['trial', 'active', 'past_due', 'grace', 'suspended', 'cancelled'];
  return supported.includes(value as PlatformSubscriptionStatus)
    ? value as PlatformSubscriptionStatus
    : 'trial';
}

function supportedWhatsappStatus(value: unknown): PlatformWhatsappStatus {
  const supported: PlatformWhatsappStatus[] = ['not_connected', 'pending', 'connected', 'error'];
  return supported.includes(value as PlatformWhatsappStatus)
    ? value as PlatformWhatsappStatus
    : 'not_connected';
}

function functionError(error: unknown, fallback: string): string {
  if (isRecord(error) && typeof error.message === 'string' && error.message) return error.message;
  return fallback;
}

function httpStatus(error: unknown): number | null {
  if (!isRecord(error) || !isRecord(error.context)) return null;
  return typeof error.context.status === 'number' ? error.context.status : null;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
