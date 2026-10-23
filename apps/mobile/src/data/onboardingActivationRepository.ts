import { supabase } from '../lib/supabase';

export type SellerTrayOnboardingStage =
  | 'business_setup'
  | 'commercial_order'
  | 'agreement'
  | 'payment'
  | 'setup'
  | 'activation'
  | 'active';

export type SellerTrayOnboardingNextAction = {
  code: string;
  label: string;
  surface: 'merchant_web' | 'mobile' | 'automatic' | 'processedge_setup' | string;
};

export type SellerTrayOnboardingState = {
  tenantId: string;
  stage: SellerTrayOnboardingStage;
  onboardingComplete: boolean;
  operationalAccess: boolean;
  legacyRuntimeAccess: boolean;
  blockerCodes: string[];
  nextAction: SellerTrayOnboardingNextAction;
  activeBranchCount: number;
  commercialOrderId: string | null;
  commercialOrderReference: string | null;
  commercialOrderCreatedAt: string | null;
  installmentObligationId: string | null;
  agreementRequired: boolean;
  agreementAccepted: boolean;
  paidInstallmentCount: number;
  installmentCount: number;
  setupRequiredCount: number;
  setupReadyCount: number;
  setupReady: boolean;
  activationAt: string | null;
  entitlementState: 'pending' | 'provisional' | 'full' | 'legacy' | string;
  runtimeCompatibilityStatus: string | null;
  currentPeriodEnd: string | null;
  actorKind: 'merchant' | 'platform_admin';
  actorRole: string;
};

export async function loadSellerTrayOnboardingState(tenantId: string): Promise<SellerTrayOnboardingState> {
  const { data, error } = await supabase.functions.invoke('onboarding-state', { body: { tenantId } });

  if (error) {
    let message = error.message || 'Unable to load SellerTray setup status.';
    if (error.context && typeof error.context === 'object' && 'clone' in error.context) {
      try {
        const payload = await (error.context as Response).clone().json() as { error?: string };
        if (payload?.error) message = payload.error;
      } catch {
        // Keep the SDK message when the response body cannot be parsed.
      }
    }
    throw new Error(message);
  }

  const root = record(data);
  return parseState(record(root.state));
}

function parseState(value: Record<string, unknown>): SellerTrayOnboardingState {
  const tenantId = stringValue(value.tenantId);
  if (!tenantId) throw new Error('SellerTray setup status is unavailable for this Business.');
  const next = record(value.nextAction);
  return {
    tenantId,
    stage: onboardingStage(value.stage),
    onboardingComplete: value.onboardingComplete === true,
    operationalAccess: value.operationalAccess === true,
    legacyRuntimeAccess: value.legacyRuntimeAccess === true,
    blockerCodes: array(value.blockerCodes).map((item) => stringValue(item)).filter(Boolean),
    nextAction: {
      code: stringValue(next.code, 'review_setup'),
      label: stringValue(next.label, 'Review SellerTray setup'),
      surface: stringValue(next.surface, 'merchant_web'),
    },
    activeBranchCount: nonNegativeInteger(value.activeBranchCount),
    commercialOrderId: optionalString(value.commercialOrderId),
    commercialOrderReference: optionalString(value.commercialOrderReference),
    commercialOrderCreatedAt: optionalString(value.commercialOrderCreatedAt),
    installmentObligationId: optionalString(value.installmentObligationId),
    agreementRequired: value.agreementRequired === true,
    agreementAccepted: value.agreementAccepted === true,
    paidInstallmentCount: nonNegativeInteger(value.paidInstallmentCount),
    installmentCount: nonNegativeInteger(value.installmentCount),
    setupRequiredCount: nonNegativeInteger(value.setupRequiredCount),
    setupReadyCount: nonNegativeInteger(value.setupReadyCount),
    setupReady: value.setupReady === true,
    activationAt: optionalString(value.activationAt),
    entitlementState: stringValue(value.entitlementState, 'pending'),
    runtimeCompatibilityStatus: optionalString(value.runtimeCompatibilityStatus),
    currentPeriodEnd: optionalString(value.currentPeriodEnd),
    actorKind: value.actorKind === 'platform_admin' ? 'platform_admin' : 'merchant',
    actorRole: stringValue(value.actorRole),
  };
}

function onboardingStage(value: unknown): SellerTrayOnboardingStage {
  const supported: SellerTrayOnboardingStage[] = ['business_setup','commercial_order','agreement','payment','setup','activation','active'];
  return supported.includes(value as SellerTrayOnboardingStage) ? value as SellerTrayOnboardingStage : 'commercial_order';
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown,fallback=''): string { return typeof value === 'string' && value ? value : fallback; }
function optionalString(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function nonNegativeInteger(value: unknown): number { const parsed=typeof value==='number'?value:Number(value??0); return Number.isFinite(parsed)?Math.max(0,Math.trunc(parsed)):0; }
