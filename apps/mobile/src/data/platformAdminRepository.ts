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
  aiParserAttemptsPeriod: number;
  aiParserSuccessesPeriod: number;
  aiParserNonSuccessPeriod: number;
  aiInputTokensPeriod: number;
  aiCachedInputTokensPeriod: number;
  aiOutputTokensPeriod: number;
  aiReasoningTokensPeriod: number;
  aiTotalTokensPeriod: number;
  aiCatalogueItemsTotalMax: number;
  aiCatalogueItemsSentAvg: number;
  aiCatalogueAliasesSentAvg: number;
  aiParserModel: string | null;
  supportNote: string | null;
  supportNoteUpdatedAt: string | null;
};

export type PlatformAdminOverview = {
  actorRole: PlatformAdminRole;
  generatedAt: string;
  tenants: PlatformTenantSummary[];
};

export type PlatformAiParserReadiness = {
  configured: boolean;
  configuration: {
    openaiApiKeyConfigured: boolean;
    parserTokenConfigured: boolean;
    configuredModel: string;
  };
  currentPeriod: {
    tenants: number;
    tenantsWithAttempts: number;
    attempts: number;
    successes: number;
    nonSuccess: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    meteredExternalOrderUnits: number;
    catalogueItemsTotalMax: number;
    catalogueItemsSentAvg: number;
    catalogueAliasesSentAvg: number;
    latestObservedModel: string | null;
  };
  acceptanceEvidence: {
    hasLiveAttempt: boolean;
    hasSuccessfulParse: boolean;
    hasMeteredExternalOrder: boolean;
    outcomesReconcile: boolean;
    meteredOrdersDoNotExceedSuccessfulParses: boolean;
    productionAcceptanceReady: boolean;
  };
  generatedAt: string;
};

export type PlatformAiParserProbe = {
  ok: boolean;
  status: 'passed' | 'not_configured' | 'parser_token_mismatch' | 'unexpected_output' | 'provider_error' | 'network_error';
  httpStatus: number | null;
  durationMs: number | null;
  configuredModel: string | null;
  structuredOutputValid: boolean;
  observed: {
    riceQuantity: number | null;
    milkQuantity: number | null;
    confidence: number | null;
  };
  telemetry: {
    outcome: string | null;
    model: string | null;
    providerStatus: number | null;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    totalTokens: number | null;
  };
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

export async function loadPlatformAiParserReadiness(): Promise<PlatformAiParserReadiness> {
  const { data, error } = await supabase.functions.invoke('platform-admin', {
    body: { action: 'ai_parser_readiness' },
  });

  if (error) throw new Error(functionError(error, 'Unable to load AI parser readiness.'));
  const raw = isRecord(data) && isRecord(data.readiness) ? data.readiness : null;
  if (!raw) throw new Error('AI parser readiness returned no status.');
  return normalizeAiParserReadiness(raw);
}

export async function runPlatformAiParserProbe(): Promise<PlatformAiParserProbe> {
  const { data, error } = await supabase.functions.invoke('platform-admin', {
    body: { action: 'ai_parser_probe' },
  });

  if (error) throw new Error(functionError(error, 'Unable to run AI parser smoke test.'));
  const raw = isRecord(data) && isRecord(data.probe) ? data.probe : null;
  if (!raw) throw new Error('AI parser smoke test returned no result.');
  return normalizeAiParserProbe(raw);
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

function normalizeAiParserProbe(raw: Record<string, unknown>): PlatformAiParserProbe {
  const observed = isRecord(raw.observed) ? raw.observed : {};
  const telemetry = isRecord(raw.telemetry) ? raw.telemetry : {};
  const supportedStatuses: PlatformAiParserProbe['status'][] = [
    'passed',
    'not_configured',
    'parser_token_mismatch',
    'unexpected_output',
    'provider_error',
    'network_error',
  ];
  const status = supportedStatuses.includes(raw.status as PlatformAiParserProbe['status'])
    ? raw.status as PlatformAiParserProbe['status']
    : 'provider_error';

  return {
    ok: raw.ok === true,
    status,
    httpStatus: optionalNumber(raw.httpStatus),
    durationMs: optionalNumber(raw.durationMs),
    configuredModel: optionalString(raw.configuredModel),
    structuredOutputValid: raw.structuredOutputValid === true,
    observed: {
      riceQuantity: optionalNumber(observed.riceQuantity),
      milkQuantity: optionalNumber(observed.milkQuantity),
      confidence: optionalNumber(observed.confidence),
    },
    telemetry: {
      outcome: optionalString(telemetry.outcome),
      model: optionalString(telemetry.model),
      providerStatus: optionalNumber(telemetry.providerStatus),
      inputTokens: optionalNumber(telemetry.inputTokens),
      cachedInputTokens: optionalNumber(telemetry.cachedInputTokens),
      outputTokens: optionalNumber(telemetry.outputTokens),
      reasoningTokens: optionalNumber(telemetry.reasoningTokens),
      totalTokens: optionalNumber(telemetry.totalTokens),
    },
  };
}

function normalizeAiParserReadiness(raw: Record<string, unknown>): PlatformAiParserReadiness {
  const configuration = isRecord(raw.configuration) ? raw.configuration : {};
  const currentPeriod = isRecord(raw.currentPeriod) ? raw.currentPeriod : {};
  const acceptanceEvidence = isRecord(raw.acceptanceEvidence) ? raw.acceptanceEvidence : {};

  return {
    configured: raw.configured === true,
    configuration: {
      openaiApiKeyConfigured: configuration.openaiApiKeyConfigured === true,
      parserTokenConfigured: configuration.parserTokenConfigured === true,
      configuredModel: stringValue(configuration.configuredModel) || 'gpt-5.6-luna',
    },
    currentPeriod: {
      tenants: numberValue(currentPeriod.tenants),
      tenantsWithAttempts: numberValue(currentPeriod.tenantsWithAttempts),
      attempts: numberValue(currentPeriod.attempts),
      successes: numberValue(currentPeriod.successes),
      nonSuccess: numberValue(currentPeriod.nonSuccess),
      inputTokens: numberValue(currentPeriod.inputTokens),
      cachedInputTokens: numberValue(currentPeriod.cachedInputTokens),
      outputTokens: numberValue(currentPeriod.outputTokens),
      reasoningTokens: numberValue(currentPeriod.reasoningTokens),
      totalTokens: numberValue(currentPeriod.totalTokens),
      meteredExternalOrderUnits: numberValue(currentPeriod.meteredExternalOrderUnits),
      catalogueItemsTotalMax: numberValue(currentPeriod.catalogueItemsTotalMax),
      catalogueItemsSentAvg: numberValue(currentPeriod.catalogueItemsSentAvg),
      catalogueAliasesSentAvg: numberValue(currentPeriod.catalogueAliasesSentAvg),
      latestObservedModel: optionalString(currentPeriod.latestObservedModel),
    },
    acceptanceEvidence: {
      hasLiveAttempt: acceptanceEvidence.hasLiveAttempt === true,
      hasSuccessfulParse: acceptanceEvidence.hasSuccessfulParse === true,
      hasMeteredExternalOrder: acceptanceEvidence.hasMeteredExternalOrder === true,
      outcomesReconcile: acceptanceEvidence.outcomesReconcile === true,
      meteredOrdersDoNotExceedSuccessfulParses:
        acceptanceEvidence.meteredOrdersDoNotExceedSuccessfulParses === true,
      productionAcceptanceReady: acceptanceEvidence.productionAcceptanceReady === true,
    },
    generatedAt: stringValue(raw.generatedAt),
  };
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
    usageAuthorizationReady: value.usageAuthorizationReady === true,
    usageOutstandingAmount: numberValue(value.usageOutstandingAmount),
    usageFailedSettlements: numberValue(value.usageFailedSettlements),
    aiParserAttemptsPeriod: numberValue(value.aiParserAttemptsPeriod),
    aiParserSuccessesPeriod: numberValue(value.aiParserSuccessesPeriod),
    aiParserNonSuccessPeriod: numberValue(value.aiParserNonSuccessPeriod),
    aiInputTokensPeriod: numberValue(value.aiInputTokensPeriod),
    aiCachedInputTokensPeriod: numberValue(value.aiCachedInputTokensPeriod),
    aiOutputTokensPeriod: numberValue(value.aiOutputTokensPeriod),
    aiReasoningTokensPeriod: numberValue(value.aiReasoningTokensPeriod),
    aiTotalTokensPeriod: numberValue(value.aiTotalTokensPeriod),
    aiCatalogueItemsTotalMax: numberValue(value.aiCatalogueItemsTotalMax),
    aiCatalogueItemsSentAvg: numberValue(value.aiCatalogueItemsSentAvg),
    aiCatalogueAliasesSentAvg: numberValue(value.aiCatalogueAliasesSentAvg),
    aiParserModel: optionalString(value.aiParserModel),
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
