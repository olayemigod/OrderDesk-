begin;

alter table public.purchase_order_items
  drop constraint purchase_order_items_uom_same_tenant;

create or replace function public.validate_purchase_order_item_uom_reference()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if not exists(
    select 1
    from public.catalog_item_uoms u
    where u.tenant_id=new.tenant_id
      and u.id=new.uom_id
      and u.catalog_item_id=new.catalog_item_id
  ) then
    raise exception 'Purchase Order unit does not belong to this product and business'
      using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_purchase_order_item_uom_reference()
  from public,anon,authenticated;

drop trigger if exists validate_purchase_order_item_uom_reference on public.purchase_order_items;
create trigger validate_purchase_order_item_uom_reference
before insert or update of tenant_id,catalog_item_id,uom_id
on public.purchase_order_items
for each row execute function public.validate_purchase_order_item_uom_reference();

commit;