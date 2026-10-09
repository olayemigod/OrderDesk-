begin;

create or replace function public.switch_sellertray_default_purchase_uom()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.is_default_purchase is true then
    update public.catalog_item_uoms u
    set is_default_purchase=false,
        updated_at=now()
    where u.tenant_id=new.tenant_id
      and u.catalog_item_id=new.catalog_item_id
      and u.id is distinct from new.id
      and u.is_default_purchase=true;
  end if;

  return new;
end;
$$;

revoke all on function public.switch_sellertray_default_purchase_uom()
  from public,anon,authenticated;

drop trigger if exists switch_sellertray_default_purchase_uom
  on public.catalog_item_uoms;
create trigger switch_sellertray_default_purchase_uom
before insert or update of is_default_purchase
on public.catalog_item_uoms
for each row execute function public.switch_sellertray_default_purchase_uom();

commit;