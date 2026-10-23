import { errorMessage, supabase } from './supabase';

export type MerchantOnboardingStage =
  | 'business_setup'
  | 'commercial_purchase'
  | 'commercial_review'
  | 'agreement'
  | 'payment'
  | 'setup'
  | 'activation'
  | 'active';

export type MerchantOnboardingState = {
  stage: MerchantOnboardingStage;
  merchantMessage: string;
  nextActionLabel: string;
  operationalAccessAllowed: boolean;
  activationComplete: boolean;
  activeBranchCount: number;
  commercialOrderId: string | null;
  agreementAccepted: boolean | null;
  firstPaymentConfirmed: boolean | null;
  setupRequiredCount: number;
  setupReadyCount: number;
  setupReady: boolean | null;
  activationAt: string | null;
  blockers: string[];
};

export async function loadMerchantOnboardingState(tenantId: string): Promise<MerchantOnboardingState> {
  const { data, error } = await supabase.rpc('get_sellertray_onboarding_state', { p_tenant_id: tenantId });
  if (error) throw new Error(errorMessage(error, 'Unable to load SellerTray setup status.'));
  return parseMerchantOnboardingState(data);
}

function parseMerchantOnboardingState(value: unknown): MerchantOnboardingState {
  const row = record(value);
  return {
    stage: stageValue(row.stage),
    merchantMessage: stringValue(row.merchantMessage, 'SellerTray setup status is available.'),
    nextActionLabel: stringValue(row.nextActionLabel, 'Continue'),
    operationalAccessAllowed: row.operationalAccessAllowed === true,
    activationComplete: row.activationComplete === true,
    activeBranchCount: integerValue(row.activeBranchCount),
    commercialOrderId: optionalString(row.commercialOrderId),
    agreementAccepted: optionalBoolean(row.agreementAccepted),
    firstPaymentConfirmed: optionalBoolean(row.firstPaymentConfirmed),
    setupRequiredCount: integerValue(row.setupRequiredCount),
    setupReadyCount: integerValue(row.setupReadyCount),
    setupReady: optionalBoolean(row.setupReady),
    activationAt: optionalString(row.activationAt),
    blockers: Array.isArray(row.blockers) ? row.blockers.filter((item): item is string => typeof item === 'string') : [],
  };
}

function stageValue(value: unknown): MerchantOnboardingStage {
  const supported: MerchantOnboardingStage[] = ['business_setup','commercial_purchase','commercial_review','agreement','payment','setup','activation','active'];
  return supported.includes(value as MerchantOnboardingStage) ? value as MerchantOnboardingStage : 'commercial_review';
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown, fallback=''): string { return typeof value === 'string' && value ? value : fallback; }
function optionalString(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function optionalBoolean(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function integerValue(value: unknown): number { const result=typeof value==='number'?value:Number(value??0); return Number.isFinite(result)?Math.max(0,Math.trunc(result)):0; }
