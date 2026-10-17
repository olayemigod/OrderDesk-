-- Preserve tenant isolation when return lines reference historical order items.
-- order_items predates the newer same-tenant composite-key convention, so add
-- the missing key before the sale-return foreign key is introduced.

alter table public.order_items
  add constraint order_items_tenant_id_id_unique
  unique (tenant_id, id);