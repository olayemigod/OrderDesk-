import type { Session } from '@supabase/supabase-js';
import { invokeJson } from './supabase';

export type AdminRole = 'admin' | 'support';

export type BranchSetupState = {
  commercialOrderId: string;
  installmentObligationId: string | null;
  lineNo: number;
  branchId: string;
  branchCode: string;
  branchName: string;
  description: string;
  currency: string;
  grossAmount: number;
  ready: boolean;
  readinessId: string | null;
  readyAt: string | null;
};

export type InstallmentLine = {
  id: string;
  sequenceNo: number;
  percentage: number;
  amountDue: number;
  dueAt: string | null;
  paymentStatus: 'settled' | 'partial' | 'unpaid';
  paidAt: string | null;
};

export type InstallmentState = {
  commercialOrderId: string;
  installmentObligationId: string;
  structureCode: string;
  currency: string;
  obligatedAmount: number;
  agreementAccepted: boolean;
  setupRequiredCount: number;
  setupReadyCount: number;
  setupReady: boolean;
  paidInstallmentCount: number;
  installmentCount: number;
  entitlementState: string;
  activationAt: string | null;
  provisionalUntil: string | null;
  fullTermUntil: string | null;
  schedule: InstallmentLine[];
};

export type CommercialOverview = {
  canManage: boolean;
  installmentBilling: InstallmentState[];
  branchSetup: BranchSetupState[];
};

export type OnboardingPlan = { code: string; name: string; currency: string; active: boolean };
export type OnboardingBranch = { id: string; code: string; name: string; active: boolean; isDefault: boolean };
export type OnboardingPrice = {
  id: string;
  priceKind: 'subscription' | 'branch_setup';
  planCode: string | null;
  billingCycle: 'monthly' | 'yearly' | null;
  currency: string;
  grossAmount: number;
  taxRatePercent: number | null;
  effectiveFrom: string;
};
export type OnboardingOrder = {
  id: string;
  reference: string;
  currency: string;
  totalGrossAmount: number;
  orderedAt: string;
  installmentObligationId: string | null;
  structureCode: string | null;
};
export type OnboardingTemplate = { id: string; family: string; versionCode: string; title: string; effectiveFrom: string; publishedAt: string };
export type OnboardingAgreement = { id: string; commercialOrderId: string; reference: string; accepted: boolean };
export type CommercialOnboarding = {
  canManage: boolean;
  eligibleForInitialInstallment: boolean;
  planCode: string | null;
  plans: OnboardingPlan[];
  branches: OnboardingBranch[];
  prices: OnboardingPrice[];
  orders: OnboardingOrder[];
  templates: OnboardingTemplate[];
  agreements: OnboardingAgreement[];
};

type AdminResponse = { ok?: boolean; overview?: unknown; onboarding?: unknown };

export async function loadCommercialOverview(session: Session, tenantId: string): Promise<CommercialOverview> {
  const response = await invokeCommercialAdmin(session, { action: 'admin_overview', tenantId });
  return parseOverview(response.overview);
}

export async function loadCommercialOnboarding(session: Session, tenantId: string): Promise<CommercialOnboarding> {
  const response = await invokeCommercialAdmin(session, { action: 'admin_onboarding', tenantId });
  return parseOnboarding(response.onboarding);
}

export async function invokeCommercialAdmin(session: Session, payload: Record<string, unknown>): Promise<AdminResponse> {
  return await invokeJson<AdminResponse>('commercial-agreements', payload, session);
}

function parseOverview(value: unknown): CommercialOverview {
  const root = record(value);
  return {
    canManage: root.canManage === true,
    installmentBilling: array(root.installmentBilling).map((value) => {
      const row = record(value);
      return {
        commercialOrderId: stringValue(row.commercialOrderId),
        installmentObligationId: stringValue(row.installmentObligationId),
        structureCode: stringValue(row.structureCode),
        currency: stringValue(row.currency, 'NGN'),
        obligatedAmount: numberValue(row.obligatedAmount),
        agreementAccepted: row.agreementAccepted === true,
        setupRequiredCount: numberValue(row.setupRequiredCount),
        setupReadyCount: numberValue(row.setupReadyCount),
        setupReady: row.setupReady === true,
        paidInstallmentCount: numberValue(row.paidInstallmentCount),
        installmentCount: numberValue(row.installmentCount),
        entitlementState: stringValue(row.entitlementState, 'pending'),
        activationAt: nullableString(row.activationAt),
        provisionalUntil: nullableString(row.provisionalUntil),
        fullTermUntil: nullableString(row.fullTermUntil),
        schedule: array(row.schedule).map((item) => {
          const line = record(item);
          return {
            id: stringValue(line.id),
            sequenceNo: numberValue(line.sequenceNo),
            percentage: numberValue(line.percentage),
            amountDue: numberValue(line.amountDue),
            dueAt: nullableString(line.dueAt),
            paymentStatus: line.paymentStatus === 'settled' || line.paymentStatus === 'paid' ? 'settled' : line.paymentStatus === 'partial' ? 'partial' : 'unpaid',
            paidAt: nullableString(line.paidAt),
          } as InstallmentLine;
        }),
      } as InstallmentState;
    }).filter((row) => row.installmentObligationId),
    branchSetup: array(root.branchSetup).map((value) => {
      const row = record(value);
      return {
        commercialOrderId: stringValue(row.commercialOrderId),
        installmentObligationId: nullableString(row.installmentObligationId),
        lineNo: numberValue(row.lineNo),
        branchId: stringValue(row.branchId),
        branchCode: stringValue(row.branchCode),
        branchName: stringValue(row.branchName, 'Branch'),
        description: stringValue(row.description, 'Branch setup'),
        currency: stringValue(row.currency, 'NGN'),
        grossAmount: numberValue(row.grossAmount),
        ready: row.ready === true,
        readinessId: nullableString(row.readinessId),
        readyAt: nullableString(row.readyAt),
      } as BranchSetupState;
    }).filter((row) => row.commercialOrderId && row.branchId),
  };
}

function parseOnboarding(value: unknown): CommercialOnboarding {
  const root = record(value);
  const runtime = record(root.runtimeCompatibility);
  return {
    canManage: root.canManage === true,
    eligibleForInitialInstallment: runtime.eligibleForInitialInstallment === true,
    planCode: nullableString(runtime.planCode),
    plans: array(root.plans).map((value) => {
      const row = record(value);
      return { code: stringValue(row.code), name: stringValue(row.name), currency: stringValue(row.currency, 'NGN'), active: row.active === true };
    }).filter((row) => row.code),
    branches: array(root.branches).map((value) => {
      const row = record(value);
      return { id: stringValue(row.id), code: stringValue(row.code), name: stringValue(row.name, 'Branch'), active: row.active === true, isDefault: row.isDefault === true };
    }).filter((row) => row.id),
    prices: array(root.prices).map((value) => {
      const row = record(value);
      return {
        id: stringValue(row.id),
        priceKind: row.priceKind === 'branch_setup' ? 'branch_setup' : 'subscription',
        planCode: nullableString(row.planCode),
        billingCycle: row.billingCycle === 'monthly' || row.billingCycle === 'yearly' ? row.billingCycle : null,
        currency: stringValue(row.currency, 'NGN'),
        grossAmount: numberValue(row.grossAmount),
        taxRatePercent: nullableNumber(row.taxRatePercent),
        effectiveFrom: stringValue(row.effectiveFrom),
      } as OnboardingPrice;
    }).filter((row) => row.id),
    orders: array(root.orders).map((value) => {
      const row = record(value);
      return {
        id: stringValue(row.id),
        reference: stringValue(row.reference),
        currency: stringValue(row.currency, 'NGN'),
        totalGrossAmount: numberValue(row.totalGrossAmount),
        orderedAt: stringValue(row.orderedAt),
        installmentObligationId: nullableString(row.installmentObligationId),
        structureCode: nullableString(row.structureCode),
      };
    }).filter((row) => row.id),
    templates: array(root.templates).map((value) => {
      const row = record(value);
      return { id: stringValue(row.id), family: stringValue(row.family), versionCode: stringValue(row.versionCode), title: stringValue(row.title), effectiveFrom: stringValue(row.effectiveFrom), publishedAt: stringValue(row.publishedAt) };
    }).filter((row) => row.id),
    agreements: array(root.agreements).map((value) => {
      const row = record(value);
      return { id: stringValue(row.id), commercialOrderId: stringValue(row.commercialOrderId), reference: stringValue(row.reference), accepted: row.accepted === true };
    }).filter((row) => row.id),
  };
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function numberValue(value: unknown): number { const result = typeof value === 'number' ? value : Number(value); return Number.isFinite(result) ? result : 0; }
function nullableNumber(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const result = Number(value); return Number.isFinite(result) ? result : null; }
