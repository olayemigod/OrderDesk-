import { supabase } from '../lib/supabase';

export type SellerTrayTaxContext = {
  configurationId: string | null;
  revision: number;
  taxApplied: boolean;
  ratePercent: number;
  displayTaxBreakdown: boolean;
};

export type SellerTrayTaxQuote = SellerTrayTaxContext & {
  subtotal: number;
  taxAmount: number;
  grossAmount: number;
};

export async function loadSellerTrayTaxQuote(tenantId: string, subtotal: number): Promise<SellerTrayTaxQuote> {
  if (!tenantId) throw new Error('Business is required.');
  if (!Number.isFinite(subtotal) || subtotal < 0) throw new Error('Sale subtotal is invalid.');

  const { data, error } = await supabase.rpc('quote_sellertray_tax', {
    p_tenant_id: tenantId,
    p_subtotal: roundMoney(subtotal),
  });
  if (error) throw error;
  const row = object(data);
  const revision = number(row.revision);
  const ratePercent = number(row.ratePercent);
  const quotedSubtotal = number(row.subtotal);
  const taxAmount = number(row.taxAmount);
  const grossAmount = number(row.grossAmount);
  if (
    revision === null || revision < 0
    || ratePercent === null || ratePercent < 0
    || quotedSubtotal === null || taxAmount === null || grossAmount === null
  ) {
    throw new Error('SellerTray returned an invalid tax quote.');
  }
  return {
    configurationId: typeof row.configurationId === 'string' && row.configurationId ? row.configurationId : null,
    revision,
    taxApplied: row.taxApplied === true,
    ratePercent,
    displayTaxBreakdown: row.displayTaxBreakdown === true,
    subtotal: quotedSubtotal,
    taxAmount,
    grossAmount,
  };
}

export function taxContextFromQuote(quote: SellerTrayTaxQuote): SellerTrayTaxContext {
  return {
    configurationId: quote.configurationId,
    revision: quote.revision,
    taxApplied: quote.taxApplied,
    ratePercent: quote.ratePercent,
    displayTaxBreakdown: quote.displayTaxBreakdown,
  };
}

/**
 * Offline presentation only. The server revalidates the immutable configuration
 * identity before posting and remains the commercial tax authority.
 */
export function previewTaxFromContext(subtotal: number, context: SellerTrayTaxContext): SellerTrayTaxQuote {
  const safeSubtotal = roundMoney(subtotal);
  const taxAmount = context.taxApplied
    ? roundMoney(safeSubtotal * context.ratePercent / 100)
    : 0;
  return {
    ...context,
    subtotal: safeSubtotal,
    taxAmount,
    grossAmount: roundMoney(safeSubtotal + taxAmount),
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
