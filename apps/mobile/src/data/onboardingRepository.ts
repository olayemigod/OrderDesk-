import { supabase } from '../lib/supabase';

export type OnboardingStage =
  | 'business_setup'
  | 'commercial_purchase'
  | 'agreement'
  | 'payment'
  | 'setup'
  | 'activating'
  | 'active';

export type OnboardingAction = {
  code: string;
  label: string;
  surface: 'mobile' | 'merchant_web' | 'admin_web' | string;
};

export type OnboardingBlocker = {
  code: string;
  message: string;
  requiredCount: number | null;
  readyCount: number | null;
};

export type SellerTrayOnboardingState = {
  tenantId: string;
  enrolled: boolean;
  compatibilityMode: boolean;
  stage: OnboardingStage;
  operationsAllowed: boolean;
  actorRole: 'owner' | 'manager' | 'staff';
  canManageCommercial: boolean;
  progress: { current: number; total: number };
  nextAction: OnboardingAction;
  blockers: OnboardingBlocker[];
  activeBranchCount: number;
  agreementAccepted: boolean;
  firstPaymentConfirmed: boolean;
  setupRequiredCount: number;
  setupReadyCount: number;
  setupComplete: boolean;
  entitlementState: string | null;
  activationAt: string | null;
  provisionalUntil: string | null;
  fullTermUntil: string | null;
};

type HandoffResponse = { url?: unknown };

export async function loadSellerTrayOnboardingState(tenantId: string): Promise<SellerTrayOnboardingState> {
  const { data, error } = await supabase.rpc('get_sellertray_onboarding_state', {
    p_tenant_id: tenantId,
  });
  if (error) throw error;
  return parseOnboardingState(data, tenantId);
}

export async function createSellerTrayOnboardingHandoff(tenantId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('onboarding-handoff', {
    body: { tenantId },
  });
  if (error) throw error;
  const payload = (data ?? {}) as HandoffResponse;
  if (typeof payload.url !== 'string' || !/^https:\/\//i.test(payload.url)) {
    throw new Error('SellerTray could not open the secure Merchant Web setup page.');
  }
  return payload.url;
}

function parseOnboardingState(value: unknown, tenantId: string): SellerTrayOnboardingState {
  const root = record(value);
  const progress = record(root.progress);
  const nextAction = record(root.nextAction);
  const branch = record(root.branch);
  const commercial = record(root.commercial);
  const stage = stageValue(root.stage);
  const actorRole = roleValue(root.actorRole);

  return {
    tenantId: stringValue(root.tenantId, tenantId),
    enrolled: root.enrolled === true,
    compatibilityMode: root.compatibilityMode === true,
    stage,
    operationsAllowed: root.operationsAllowed === true,
    actorRole,
    canManageCommercial: root.canManageCommercial === true,
    progress: {
      current: boundedInteger(progress.current, 1, 6, stage === 'active' ? 6 : 1),
      total: boundedInteger(progress.total, 1, 20, 6),
    },
    nextAction: {
      code: stringValue(nextAction.code, 'refresh_activation'),
      label: stringValue(nextAction.label, 'Check setup status'),
      surface: stringValue(nextAction.surface, 'mobile'),
    },
    blockers: array(root.blockers).map((item) => {
      const blocker = record(item);
      return {
        code: stringValue(blocker.code, 'setup_pending'),
        message: stringValue(blocker.message, 'SellerTray setup is not complete yet.'),
        requiredCount: nullableInteger(blocker.requiredCount),
        readyCount: nullableInteger(blocker.readyCount),
      };
    }),
    activeBranchCount: nonNegativeInteger(branch.activeCount),
    agreementAccepted: commercial.agreementAccepted === true,
    firstPaymentConfirmed: commercial.firstPaymentConfirmed === true,
    setupRequiredCount: nonNegativeInteger(commercial.setupRequiredCount),
    setupReadyCount: nonNegativeInteger(commercial.setupReadyCount),
    setupComplete: commercial.setupComplete === true,
    entitlementState: nullableString(commercial.entitlementState),
    activationAt: nullableString(commercial.activationAt),
    provisionalUntil: nullableString(commercial.provisionalUntil),
    fullTermUntil: nullableString(commercial.fullTermUntil),
  };
}

function stageValue(value: unknown): OnboardingStage {
  const supported: OnboardingStage[] = [
    'business_setup',
    'commercial_purchase',
    'agreement',
    'payment',
    'setup',
    'activating',
    'active',
  ];
  return supported.includes(value as OnboardingStage) ? value as OnboardingStage : 'commercial_purchase';
}

function roleValue(value: unknown): 'owner' | 'manager' | 'staff' {
  return value === 'owner' || value === 'manager' || value === 'staff' ? value : 'staff';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = numberValue(value);
  return parsed === null ? 0 : Math.max(0, Math.trunc(parsed));
}

function nullableInteger(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.max(0, Math.trunc(parsed));
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = numberValue(value);
  if (parsed === null) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
