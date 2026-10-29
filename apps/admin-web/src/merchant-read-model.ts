import type { Session } from '@supabase/supabase-js';
import { invokeJson, isRecord } from './supabase';

export type MerchantFilter = 'all' | 'attention' | 'connected' | 'restricted';
export type MerchantCursor = { afterName: string; afterId: string };
export type MerchantRow = {
  id: string; name: string; slug: string; businessEmail: string | null; businessPhone: string | null;
  onboardingStatus: string; whatsappStatus: string; subscriptionStatus: string; accessMode: string;
  planCode: string | null; currentPeriodEnd: string | null; currency: string; createdAt: string | null;
  activatedAt: string | null; completedOrders30d: number; needsReview: number; totalBranches: number;
  activeBranches: number; teamCount: number; lastOrderAt: string | null; notificationExceptions: number;
  attentionReasons: string[];
};
export type MerchantPortfolioPage = { generatedAt: string; pageSize: number; items: MerchantRow[]; hasMore: boolean; nextCursor: MerchantCursor | null };
export type MerchantMoney = { currency: string; merchantGmv: number; recordedPaidValue: number; outstandingOrderValue: number };
export type MerchantBranch = { id: string; code: string; name: string; active: boolean; default: boolean };
export type MerchantActivity = { id: string; action: string; createdAt: string };
export type MerchantDetail = {
  merchant: MerchantRow & {
    businessType: string | null; timezone: string; updatedAt: string | null; planName: string | null;
    graceEndsAt: string | null; activeUntil: string | null; lastInboundAt: string | null;
    supportNote: string | null; supportNoteUpdatedAt: string | null;
  };
  branches: MerchantBranch[];
  team: { total: number; owners: number; managers: number; cashiers: number };
  performance: { periodDays: number; completedOrders: number; whatsappOrders: number; posOrders: number; manualOrders: number; lastOrderAt: string | null; lastCompletedAt: string | null; money: MerchantMoney[] };
  commercial: { commercialOrders: number; latestCommercialOrderAt: string | null; agreementsIssued: number; agreementsAccepted: number; setupRequired: number; setupReady: number };
  recentAdminActivity: MerchantActivity[];
};

export async function loadMerchantPortfolio(
  session: Session,
  options: { search?: string; filter?: MerchantFilter; cursor?: MerchantCursor | null; limit?: number } = {},
): Promise<MerchantPortfolioPage> {
  const response = await invokeJson<{ portfolio?: unknown }>('platform-admin', {
    action: 'merchant_portfolio',
    search: options.search ?? '',
    filter: options.filter ?? 'all',
    afterName: options.cursor?.afterName ?? null,
    afterId: options.cursor?.afterId ?? null,
    limit: options.limit ?? 25,
  }, session);
  return parsePortfolio(response.portfolio);
}

export async function loadMerchantDetail(session: Session, tenantId: string): Promise<MerchantDetail> {
  const response = await invokeJson<{ detail?: unknown }>('platform-admin', { action: 'merchant_detail', tenantId }, session);
  return parseDetail(response.detail);
}

function parsePortfolio(value: unknown): MerchantPortfolioPage {
  if (!isRecord(value)) throw new Error('Merchant portfolio returned an invalid response.');
  const items = Array.isArray(value.items) ? value.items.filter(isRecord).map(parseMerchant) : [];
  const cursor = isRecord(value.nextCursor) ? { afterName: stringValue(value.nextCursor.afterName), afterId: stringValue(value.nextCursor.afterId) } : null;
  return { generatedAt: stringValue(value.generatedAt), pageSize: numberValue(value.pageSize) || 25, items: items.filter((item) => item.id), hasMore: value.hasMore === true, nextCursor: cursor?.afterName && cursor.afterId ? cursor : null };
}

function parseMerchant(value: Record<string, unknown>): MerchantRow {
  return { id: stringValue(value.id), name: stringValue(value.name) || 'Unnamed business', slug: stringValue(value.slug), businessEmail: optionalString(value.businessEmail), businessPhone: optionalString(value.businessPhone), onboardingStatus: stringValue(value.onboardingStatus) || 'unknown', whatsappStatus: stringValue(value.whatsappStatus) || 'not_connected', subscriptionStatus: stringValue(value.subscriptionStatus) || 'unknown', accessMode: stringValue(value.accessMode) || 'unknown', planCode: optionalString(value.planCode), currentPeriodEnd: optionalString(value.currentPeriodEnd), currency: stringValue(value.currency) || 'NGN', createdAt: optionalString(value.createdAt), activatedAt: optionalString(value.activatedAt), completedOrders30d: numberValue(value.completedOrders30d), needsReview: numberValue(value.needsReview), totalBranches: numberValue(value.totalBranches), activeBranches: numberValue(value.activeBranches), teamCount: numberValue(value.teamCount), lastOrderAt: optionalString(value.lastOrderAt), notificationExceptions: numberValue(value.notificationExceptions), attentionReasons: strings(value.attentionReasons) };
}

function parseDetail(value: unknown): MerchantDetail {
  if (!isRecord(value) || !isRecord(value.merchant) || !isRecord(value.team) || !isRecord(value.performance) || !isRecord(value.commercial)) throw new Error('Merchant 360 returned an invalid response.');
  const merchantBase = parseMerchant(value.merchant);
  const performance = value.performance; const team = value.team; const commercial = value.commercial;
  return {
    merchant: { ...merchantBase, businessType: optionalString(value.merchant.businessType), timezone: stringValue(value.merchant.timezone), updatedAt: optionalString(value.merchant.updatedAt), planName: optionalString(value.merchant.planName), graceEndsAt: optionalString(value.merchant.graceEndsAt), activeUntil: optionalString(value.merchant.activeUntil), lastInboundAt: optionalString(value.merchant.lastInboundAt), supportNote: optionalString(value.merchant.supportNote), supportNoteUpdatedAt: optionalString(value.merchant.supportNoteUpdatedAt) },
    branches: Array.isArray(value.branches) ? value.branches.filter(isRecord).map((branch) => ({ id: stringValue(branch.id), code: stringValue(branch.code), name: stringValue(branch.name), active: branch.active === true, default: branch.default === true })) : [],
    team: { total: numberValue(team.total), owners: numberValue(team.owners), managers: numberValue(team.managers), cashiers: numberValue(team.cashiers) },
    performance: { periodDays: numberValue(performance.periodDays), completedOrders: numberValue(performance.completedOrders), whatsappOrders: numberValue(performance.whatsappOrders), posOrders: numberValue(performance.posOrders), manualOrders: numberValue(performance.manualOrders), lastOrderAt: optionalString(performance.lastOrderAt), lastCompletedAt: optionalString(performance.lastCompletedAt), money: Array.isArray(performance.money) ? performance.money.filter(isRecord).map((money) => ({ currency: stringValue(money.currency), merchantGmv: numberValue(money.merchantGmv), recordedPaidValue: numberValue(money.recordedPaidValue), outstandingOrderValue: numberValue(money.outstandingOrderValue) })) : [] },
    commercial: { commercialOrders: numberValue(commercial.commercialOrders), latestCommercialOrderAt: optionalString(commercial.latestCommercialOrderAt), agreementsIssued: numberValue(commercial.agreementsIssued), agreementsAccepted: numberValue(commercial.agreementsAccepted), setupRequired: numberValue(commercial.setupRequired), setupReady: numberValue(commercial.setupReady) },
    recentAdminActivity: Array.isArray(value.recentAdminActivity) ? value.recentAdminActivity.filter(isRecord).map((item) => ({ id: stringValue(item.id), action: stringValue(item.action), createdAt: stringValue(item.createdAt) })) : [],
  };
}

function numberValue(value: unknown) { const parsed = typeof value === 'number' ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function stringValue(value: unknown) { return typeof value === 'string' ? value : ''; }
function optionalString(value: unknown) { return typeof value === 'string' && value ? value : null; }
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
