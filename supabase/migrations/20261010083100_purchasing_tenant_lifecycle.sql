begin;

alter table public.purchase_orders
  add constraint purchase_orders_tenant_fk
  foreign key (tenant_id) references public.tenants(id) on delete cascade;

alter table public.purchase_orders
  drop constraint purchase_orders_branch_same_tenant;
alter table public.purchase_orders
  add constraint purchase_orders_branch_same_tenant
  foreign key (tenant_id,branch_id)
  references public.branches(tenant_id,id)
  on delete cascade;

alter table public.purchase_orders
  drop constraint purchase_orders_supplier_same_tenant;
alter table public.purchase_orders
  add constraint purchase_orders_supplier_same_tenant
  foreign key (tenant_id,supplier_id)
  references public.suppliers(tenant_id,id)
  on delete cascade;

alter table public.purchase_receipts
  drop constraint purchase_receipts_order_same_tenant;
alter table public.purchase_receipts
  add constraint purchase_receipts_order_same_tenant
  foreign key (tenant_id,purchase_order_id)
  references public.purchase_orders(tenant_id,id)
  on delete cascade;

alter table public.purchase_receipts
  drop constraint purchase_receipts_branch_same_tenant;
alter table public.purchase_receipts
  add constraint purchase_receipts_branch_same_tenant
  foreign key (tenant_id,branch_id)
  references public.branches(tenant_id,id)
  on delete cascade;

alter table public.purchase_receipts
  drop constraint purchase_receipts_supplier_same_tenant;
alter table public.purchase_receipts
  add constraint purchase_receipts_supplier_same_tenant
  foreign key (tenant_id,supplier_id)
  references public.suppliers(tenant_id,id)
  on delete cascade;

create or replace function public.prevent_supplier_history_delete()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Suppliers are archived instead of deleted' using errcode='55000';
end;
$$;

revoke all on function public.prevent_supplier_history_delete() from public,anon,authenticated;

drop trigger if exists prevent_supplier_delete on public.suppliers;
create trigger prevent_supplier_delete
before delete on public.suppliers
for each row execute function public.prevent_supplier_history_delete();

create or replace function public.prevent_purchase_order_history_delete()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if not exists(select 1 from public.tenants t where t.id=old.tenant_id) then
    return old;
  end if;
  raise exception 'Purchase Orders are cancelled instead of deleted' using errcode='55000';
end;
$$;

revoke all on function public.prevent_purchase_order_history_delete() from public,anon,authenticated;

drop trigger if exists prevent_purchase_order_delete on public.purchase_orders;
create trigger prevent_purchase_order_delete
before delete on public.purchase_orders
for each row execute function public.prevent_purchase_order_history_delete();

commit;