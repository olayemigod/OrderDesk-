import { createPosDraft, type CreatePosDraftInput } from './commerceRepository';
import { supabase } from '../lib/supabase';
import { updatePosDraftItems } from './posSaleRepository';

export type GovernedPosDraftLine = CreatePosDraftInput['items'][number] & {
  uomName: string;
  sellingPrice: number;
};

export type GovernedPosDraftInput = Omit<CreatePosDraftInput, 'items'> & {
  items: GovernedPosDraftLine[];
};

type DraftItemRow = {
  id: string;
  catalog_item_id: string | null;
  selected_uom: string;
};

/**
 * Creates the governed POS draft at the configured catalogue price, then applies
 * any authorised per-line selling-price overrides through the existing draft
 * edit command. This keeps price authority on the server and makes retries safe:
 * the stable client reference returns the same draft and the edit command can be
 * retried without creating a second sale.
 */
export async function prepareGovernedPosDraft(input: GovernedPosDraftInput): Promise<string> {
  const orderId = await createPosDraft({
    ...input,
    items: input.items.map((line) => ({
      catalogItemId: line.catalogItemId,
      uomId: line.uomId,
      quantity: line.quantity,
      expectedSellingPrice: line.expectedSellingPrice,
      expectedConversionFactor: line.expectedConversionFactor,
    })),
  });

  const overrides = input.items.filter(
    (line) => Math.abs(line.sellingPrice - line.expectedSellingPrice) > 0.005,
  );
  if (!overrides.length) return orderId;

  const { data, error } = await supabase
    .from('order_items')
    .select('id,catalog_item_id,selected_uom')
    .eq('tenant_id', input.tenantId)
    .eq('order_id', orderId);
  if (error) throw error;

  const rows = (data ?? []) as DraftItemRow[];
  const used = new Set<string>();
  const edits = input.items.map((line) => {
    const match = rows.find((row) =>
      !used.has(row.id)
      && row.catalog_item_id === line.catalogItemId
      && row.selected_uom.trim().toLowerCase() === line.uomName.trim().toLowerCase(),
    );
    if (!match) {
      throw new Error('SellerTray could not match a saved sale line while applying its selling price.');
    }
    used.add(match.id);
    return {
      orderItemId: match.id,
      quantity: line.quantity,
      ...(Math.abs(line.sellingPrice - line.expectedSellingPrice) > 0.005
        ? { unitPrice: line.sellingPrice }
        : {}),
    };
  });

  await updatePosDraftItems({ tenantId: input.tenantId, orderId, items: edits });
  return orderId;
}
