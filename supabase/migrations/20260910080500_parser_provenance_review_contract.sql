alter table public.orders
  add column if not exists parser_source text not null default 'legacy'
    check (parser_source in ('legacy', 'external', 'fallback', 'manual')),
  add column if not exists parser_version text,
  add column if not exists review_reasons text[] not null default '{}';

alter table public.order_items
  add column if not exists original_item_name text,
  add column if not exists match_source text not null default 'legacy'
    check (match_source in ('legacy', 'catalogue_name', 'catalogue_alias', 'normalized_name', 'normalized_alias', 'unmatched', 'manual')),
  add column if not exists match_confidence numeric(5,4)
    check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1));

update public.order_items
set original_item_name = item_name
where original_item_name is null;

-- Parser provenance and review diagnostics are server-owned. Merchants only
-- need to move an order through its workflow.
revoke update on table public.orders from authenticated;
grant update (status, updated_at) on table public.orders to authenticated;

-- Merchant correction remains available, but catalogue matching provenance is
-- written only by trusted server ingestion.
revoke insert, update on table public.order_items from authenticated;
grant insert (tenant_id, order_id, item_name, quantity, unit_price)
  on table public.order_items to authenticated;
grant update (item_name, quantity, unit_price)
  on table public.order_items to authenticated;
