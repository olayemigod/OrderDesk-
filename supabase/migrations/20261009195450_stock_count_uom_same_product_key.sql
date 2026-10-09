begin;

alter table public.catalog_item_uoms
  add constraint catalog_item_uoms_tenant_item_id_key
  unique (tenant_id,catalog_item_id,id);

commit;