import { supabase } from '../lib/supabase';

export type SellerTrayOnboardingStage =
  | 'business_setup'
  | 'commercial_purchase'
  | 'commercial_review'
  | 'agreement'
  | 'payment'
  | 'setup'
  | 'activation'
  | 'active';

export type SellerTrayOnboardingState = {
  tenantId: string;
  governanceMode: 'legacy_compatibility' | 'governed';
  activationRequired: boolean;
  stage: SellerTrayOnboardingStage;
  merchantMessage: string;
  nextAction: string;
  nextActionLabel: string;
  operationalAccessAllowed: boolean;
  activationComplete: boolean;
  activeBranchCount: number;
  commercialOrderId: string | null;
  installmentObligationId: string | null;
  agreementAccepted: boolean | null;
  firstPaymentConfirmed: boolean | null;
  setupRequiredCount: number;
  setupReadyCount: number;
  setupReady: boolean | null;
  entitlementState: string | null;
  activationAt: string | null;
  blockers: string[];
  generatedAt: string;
};

export async function loadSellerTrayOnboardingState(tenantId: string): Promise<SellerTrayOnboardingState> {
  const { data, error } = await supabase.rpc('get_sellertray_onboarding_state', {
    p_tenant_id: tenantId,
  });

  if (error) throw error;
  return parseOnboardingState(data, tenantId);
}

function parseOnboardingState(value: unknown, tenantId: string): SellerTrayOnboardingState {
  const row = record(value);
  const stage = onboardingStage(row.stage);
  const governanceMode = row.governanceMode === 'legacy_compatibility'
    ? 'legacy_compatibility'
    : 'governed';

  return {
    tenantId: stringValue(row.tenantId, tenantId),
    governanceMode,
    activationRequired: row.activationRequired === true,
    stage,
    merchantMessage: stringValue(row.merchantMessage, 'SellerTray setup status is available.'),
    nextAction: stringValue(row.nextAction),
    nextActionLabel: stringValue(row.nextActionLabel, 'Continue'),
    operationalAccessAllowed: row.operationalAccessAllowed === true,
    activationComplete: row.activationComplete === true,
    activeBranchCount: nonNegativeInteger(row.activeBranchCount),
    commercialOrderId: optionalString(row.commercialOrderId),
    installmentObligationId: optionalString(row.installmentObligationId),
    agreementAccepted: optionalBoolean(row.agreementAccepted),
    firstPaymentConfirmed: optionalBoolean(row.firstPaymentConfirmed),
    setupRequiredCount: nonNegativeInteger(row.setupRequiredCount),
    setupReadyCount: nonNegativeInteger(row.setupReadyCount),
    setupReady: optionalBoolean(row.setupReady),
    entitlementState: optionalString(row.entitlementState),
    activationAt: optionalString(row.activationAt),
    blockers: Array.isArray(row.blockers)
      ? row.blockers.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [],
    generatedAt: stringValue(row.generatedAt),
  };
}

function onboardingStage(value: unknown): SellerTrayOnboardingStage {
  const supported: SellerTrayOnboardingStage[] = [
    'business_setup',
    'commercial_purchase',
    'commercial_review',
    'agreement',
    'payment',
    'setup',
    'activation',
    'active',
  ];
  return supported.includes(value as SellerTrayOnboardingStage)
    ? value as SellerTrayOnboardingStage
    : 'commercial_review';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value ? value : fallback;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}
