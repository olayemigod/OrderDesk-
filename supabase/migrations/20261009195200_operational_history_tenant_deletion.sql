begin;

-- Operational history remains immutable while its business exists. When the
-- governing Tenant itself is deleted through SellerTray's account lifecycle,
-- dependent operational history must be able to follow that parent deletion.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_branch_same_tenant,
  add constraint inventory_movements_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  drop constraint if exists inventory_movements_location_same_branch,
  add constraint inventory_movements_location_same_branch
    foreign key (tenant_id,branch_id,stock_location_id)
    references public.stock_locations(tenant_id,branch_id,id)
    on delete cascade,
  drop constraint if exists inventory_movements_item_same_tenant,
  add constraint inventory_movements_item_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete cascade,
  drop constraint if exists inventory_movements_reversal_same_tenant,
  add constraint inventory_movements_reversal_same_tenant
    foreign key (tenant_id,reversal_of_movement_id)
    references public.inventory_movements(tenant_id,id)
    on delete cascade;

create or replace function public.prevent_sellertray_inventory_movement_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE'
     and not exists(
       select 1 from public.tenants t where t.id=old.tenant_id
     ) then
    return old;
  end if;

  raise exception 'Inventory movements are immutable; post a correcting movement instead'
    using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_inventory_movement_mutation()
  from public,anon,authenticated;

alter table public.sale_returns
  drop constraint if exists sale_returns_order_same_tenant,
  add constraint sale_returns_order_same_tenant
    foreign key (tenant_id,order_id)
    references public.orders(tenant_id,id)
    on delete cascade,
  drop constraint if exists sale_returns_branch_same_tenant,
  add constraint sale_returns_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete cascade,
  drop constraint if exists sale_returns_payment_same_tenant,
  add constraint sale_returns_payment_same_tenant
    foreign key (tenant_id,original_payment_id)
    references public.order_payments(tenant_id,id)
    on delete cascade;

alter table public.sale_return_items
  drop constraint if exists sale_return_items_return_same_tenant,
  add constraint sale_return_items_return_same_tenant
    foreign key (tenant_id,sale_return_id)
    references public.sale_returns(tenant_id,id)
    on delete cascade,
  drop constraint if exists sale_return_items_order_item_same_tenant,
  add constraint sale_return_items_order_item_same_tenant
    foreign key (tenant_id,order_item_id)
    references public.order_items(tenant_id,id)
    on delete cascade,
  drop constraint if exists sale_return_items_catalog_same_tenant,
  add constraint sale_return_items_catalog_same_tenant
    foreign key (tenant_id,catalog_item_id)
    references public.catalog_items(tenant_id,id)
    on delete cascade;

alter table public.payment_refunds
  drop constraint if exists payment_refunds_order_same_tenant,
  add constraint payment_refunds_order_same_tenant
    foreign key (tenant_id,order_id)
    references public.orders(tenant_id,id)
    on delete cascade,
  drop constraint if exists payment_refunds_original_same_tenant,
  add constraint payment_refunds_original_same_tenant
    foreign key (tenant_id,original_payment_id)
    references public.order_payments(tenant_id,id)
    on delete cascade,
  drop constraint if exists payment_refunds_return_same_tenant,
  add constraint payment_refunds_return_same_tenant
    foreign key (tenant_id,sale_return_id)
    references public.sale_returns(tenant_id,id)
    on delete cascade;

create or replace function public.prevent_sellertray_return_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE'
     and not exists(
       select 1 from public.tenants t where t.id=old.tenant_id
     ) then
    return old;
  end if;

  raise exception 'SellerTray return and refund records are immutable'
    using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_return_mutation()
  from public,anon,authenticated;

create or replace function public.prevent_sellertray_capability_event_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE'
     and not exists(
       select 1 from public.tenants t where t.id=old.tenant_id
     ) then
    return old;
  end if;

  raise exception 'SellerTray permission history is immutable'
    using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_capability_event_mutation()
  from public,anon,authenticated;

commit;