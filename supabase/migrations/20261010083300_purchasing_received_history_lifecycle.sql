begin;

alter table public.purchase_order_items
  drop constraint purchase_order_items_product_same_tenant;
alter table public.purchase_order_items
  add constraint purchase_order_items_product_same_tenant
  foreign key (tenant_id,catalog_item_id)
  references public.catalog_items(tenant_id,id)
  on delete cascade;

alter table public.purchase_receipt_items
  drop constraint purchase_receipt_items_order_item_same_tenant;
alter table public.purchase_receipt_items
  add constraint purchase_receipt_items_order_item_same_tenant
  foreign key (tenant_id,purchase_order_item_id)
  references public.purchase_order_items(tenant_id,id)
  on delete cascade;

alter table public.purchase_receipt_items
  drop constraint purchase_receipt_items_product_same_tenant;
alter table public.purchase_receipt_items
  add constraint purchase_receipt_items_product_same_tenant
  foreign key (tenant_id,catalog_item_id)
  references public.catalog_items(tenant_id,id)
  on delete cascade;

alter table public.purchase_receipt_items
  drop constraint purchase_receipt_items_movement_same_tenant;
alter table public.purchase_receipt_items
  add constraint purchase_receipt_items_movement_same_tenant
  foreign key (tenant_id,inventory_movement_id)
  references public.inventory_movements(tenant_id,id)
  on delete cascade;

commit;