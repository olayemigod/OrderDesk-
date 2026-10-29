begin;

create or replace function public.sync_sellertray_stock_uom_row()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_existing_id uuid;
begin
  new.stock_uom := nullif(btrim(coalesce(new.stock_uom,'')),'');
  if new.stock_uom is null then
    raise exception 'Stock UOM is required' using errcode='23514';
  end if;

  if tg_op='UPDATE'
     and lower(btrim(new.stock_uom))<>lower(btrim(old.stock_uom))
     and exists (
       select 1
       from public.order_items oi
       where oi.tenant_id=new.tenant_id
         and oi.catalog_item_id=new.id
     ) then
    raise exception 'Stock unit cannot be changed after transactions exist' using errcode='23514';
  end if;

  select u.id into v_existing_id
  from public.catalog_item_uoms u
  where u.tenant_id=new.tenant_id
    and u.catalog_item_id=new.id
    and lower(btrim(u.uom_name))=lower(new.stock_uom)
  limit 1;

  if v_existing_id is null then
    if not exists (
      select 1
      from public.catalog_item_uoms u
      where u.tenant_id=new.tenant_id
        and u.catalog_item_id=new.id
        and u.is_default_selling=true
    ) then
      insert into public.catalog_item_uoms(
        tenant_id,catalog_item_id,uom_name,conversion_factor,
        selling_price,allow_fractional,is_default_selling,is_default_purchase
      ) values (
        new.tenant_id,new.id,new.stock_uom,1,
        new.price_ngn,new.allow_fractional_stock,true,true
      );
    else
      insert into public.catalog_item_uoms(
        tenant_id,catalog_item_id,uom_name,conversion_factor,
        selling_price,allow_fractional,is_default_selling,is_default_purchase
      ) values (
        new.tenant_id,new.id,new.stock_uom,1,
        new.price_ngn,new.allow_fractional_stock,false,false
      );
    end if;
  else
    update public.catalog_item_uoms u
    set conversion_factor=1,
        selling_price=new.price_ngn,
        allow_fractional=new.allow_fractional_stock,
        updated_at=now()
    where u.id=v_existing_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_sellertray_stock_uom_row() from public,anon,authenticated;

commit;
