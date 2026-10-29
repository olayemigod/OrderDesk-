import { supabase } from '../lib/supabase';

export type SellerTrayOnboardingStage =
  | 'business_setup'
  | 'commercial_order'
  | 'agreement'
  | 'settlement'
  | 'setup'
  | 'activation'
  | 'active';

export type SellerTrayOnboardingSurface = 'mobile' | 'merchant_web' | 'admin_web' | 'shared_core';

export type SellerTrayOnboardingBlocker = {
  code: string;
  message: string;
  surface: SellerTrayOnboardingSurface;
};

export type SellerTrayOnboardingAction = {
  code: string;
  label: string;
  surface: SellerTrayOnboardingSurface;
};

export type SellerTrayOnboardingState = {
  readModelVersion: string;
  generatedAt: string | null;
  tenantId: string;
  currentStage: SellerTrayOnboardingStage;
  blockers: SellerTrayOnboardingBlocker[];
  nextAction: SellerTrayOnboardingAction;
  accessEnforcement: 'governed_runtime';
  branchPreparation: {
    activeBranchCount: number;
    readyForCommercialOrder: boolean;
  };
  commercialOrder: null | {
    id: string;
    reference: string;
    currency: string;
    grossAmount: number;
    orderedAt: string | null;
    planCode: string | null;
    billingCycle: string | null;
    installmentObligationId: string | null;
    installmentStructureCode: string | null;
  };
  agreement: {
    required: boolean;
    accepted: boolean;
    acceptedAt: string | null;
  };
  settlement: {
    currency: string;
    grossAmount: number;
    approvedAdjustmentAmount: number;
    gatewayPaymentAmount: number;
    directPaymentAmount: number;
    confirmedPaymentAmount: number;
    outstandingAmount: number;
    qualifyingSettlementSatisfied: boolean;
    fullySettled: boolean;
    installmentCount: number;
    paidInstallmentCount: number;
    firstInstallmentAmount: number | null;
    firstPaidAt: string | null;
  };
  branchSetup: {
    branches: { branchId: string; branchName: string; setupStatus: string; ready: boolean }[];
    requiredCount: number;
    readyCount: number;
    ready: boolean;
  };
  activation: {
    entitlementState: 'not_active' | 'provisional' | 'full';
    guaranteeStart: string | null;
    guaranteeEnd: string | null;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
    operationallyActive: boolean;
  };
  legacyRuntime: {
    status: string | null;
    canWrite: boolean;
    compatibilityAccess: boolean;
  };
};

export async function loadSellerTrayOnboardingState(
  tenantId: string,
): Promise<SellerTrayOnboardingState> {
  const { data, error } = await supabase.rpc('get_sellertray_onboarding_state', {
    p_tenant_id: tenantId,
  });

  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SellerTray onboarding status is unavailable.');
  }

  const value = data as Record<string, unknown>;
  const nextAction = objectValue(value.nextAction);
  const branchPreparation = objectValue(value.branchPreparation);
  const agreement = objectValue(value.agreement);
  const settlement = objectValue(value.settlement);
  const branchSetup = objectValue(value.branchSetup);
  const activation = objectValue(value.activation);
  const legacyRuntime = objectValue(value.legacyRuntime);
  const commercialOrderValue = value.commercialOrder === null
    ? null
    : objectValue(value.commercialOrder);

  return {
    readModelVersion: stringValue(value.readModelVersion, 'oa1-v1'),
    generatedAt: optionalString(value.generatedAt),
    tenantId: stringValue(value.tenantId, tenantId),
    currentStage: onboardingStage(value.currentStage),
    blockers: arrayValue(value.blockers).flatMap((entry) => {
      const blocker = objectValue(entry);
      const message = optionalString(blocker.message);
      if (!message) return [];
      return [{
        code: stringValue(blocker.code, 'onboarding_attention_required'),
        message,
        surface: onboardingSurface(blocker.surface),
      } satisfies SellerTrayOnboardingBlocker];
    }),
    nextAction: {
      code: stringValue(nextAction.code, 'review_onboarding'),
      label: stringValue(nextAction.label, 'Review onboarding'),
      surface: onboardingSurface(nextAction.surface),
    },
    accessEnforcement: 'governed_runtime',
    branchPreparation: {
      activeBranchCount: integerValue(branchPreparation.activeBranchCount),
      readyForCommercialOrder: branchPreparation.readyForCommercialOrder === true,
    },
    commercialOrder: commercialOrderValue ? {
      id: stringValue(commercialOrderValue.id, ''),
      reference: stringValue(commercialOrderValue.reference, ''),
      currency: stringValue(commercialOrderValue.currency, 'NGN'),
      grossAmount: numberValue(commercialOrderValue.grossAmount),
      orderedAt: optionalString(commercialOrderValue.orderedAt),
      planCode: optionalString(commercialOrderValue.planCode),
      billingCycle: optionalString(commercialOrderValue.billingCycle),
      installmentObligationId: optionalString(commercialOrderValue.installmentObligationId),
      installmentStructureCode: optionalString(commercialOrderValue.installmentStructureCode),
    } : null,
    agreement: {
      required: agreement.required === true,
      accepted: agreement.accepted === true,
      acceptedAt: optionalString(agreement.acceptedAt),
    },
    settlement: {
      currency: stringValue(settlement.currency, 'NGN'),
      grossAmount: numberValue(settlement.grossAmount),
      approvedAdjustmentAmount: numberValue(settlement.approvedAdjustmentAmount),
      gatewayPaymentAmount: numberValue(settlement.gatewayPaymentAmount),
      directPaymentAmount: numberValue(settlement.directPaymentAmount),
      confirmedPaymentAmount: numberValue(settlement.confirmedPaymentAmount),
      outstandingAmount: numberValue(settlement.outstandingAmount),
      qualifyingSettlementSatisfied: settlement.qualifyingSettlementSatisfied === true,
      fullySettled: settlement.fullySettled === true,
      installmentCount: integerValue(settlement.installmentCount),
      paidInstallmentCount: integerValue(settlement.paidInstallmentCount),
      firstInstallmentAmount: nullableNumberValue(settlement.firstInstallmentAmount),
      firstPaidAt: optionalString(settlement.firstPaidAt),
    },
    branchSetup: {
      branches: arrayValue(branchSetup.branches).map((entry) => { const b = objectValue(entry); return { branchId: stringValue(b.branchId, ''), branchName: stringValue(b.branchName, 'Branch'), setupStatus: stringValue(b.setupStatus, 'Setup pending'), ready: b.ready === true }; }),
      requiredCount: integerValue(branchSetup.requiredCount),
      readyCount: integerValue(branchSetup.readyCount),
      ready: branchSetup.ready === true,
    },
    activation: {
      entitlementState: entitlementState(activation.entitlementState),
      guaranteeStart: optionalString(activation.guaranteeStart),
      guaranteeEnd: optionalString(activation.guaranteeEnd),
      effectiveFrom: optionalString(activation.effectiveFrom),
      effectiveUntil: optionalString(activation.effectiveUntil),
      operationallyActive: activation.operationallyActive === true,
    },
    legacyRuntime: {
      status: optionalString(legacyRuntime.status),
      canWrite: legacyRuntime.canWrite === true,
      compatibilityAccess: legacyRuntime.compatibilityAccess === true,
    },
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function nullableNumberValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: unknown): number {
  return nullableNumberValue(value) ?? 0;
}

function integerValue(value: unknown): number {
  return Math.max(0, Math.trunc(numberValue(value)));
}

function onboardingStage(value: unknown): SellerTrayOnboardingStage {
  const supported: SellerTrayOnboardingStage[] = [
    'business_setup',
    'commercial_order',
    'agreement',
    'settlement',
    'setup',
    'activation',
    'active',
  ];
  return supported.includes(value as SellerTrayOnboardingStage)
    ? value as SellerTrayOnboardingStage
    : 'commercial_order';
}

function onboardingSurface(value: unknown): SellerTrayOnboardingSurface {
  const supported: SellerTrayOnboardingSurface[] = ['mobile', 'merchant_web', 'admin_web', 'shared_core'];
  return supported.includes(value as SellerTrayOnboardingSurface)
    ? value as SellerTrayOnboardingSurface
    : 'shared_core';
}

function entitlementState(value: unknown): SellerTrayOnboardingState['activation']['entitlementState'] {
  return value === 'provisional' || value === 'full' ? value : 'not_active';
}
