begin;

-- Keep the long-standing `Each` default available for Businesses created after
-- the catalogue-master foundation migration. This remains master data only; it
-- does not create a product UOM conversion, price or stock balance.
create or replace function public.seed_sellertray_default_uom_for_tenant()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.sellertray_uoms (tenant_id, name)
  values (new.id, 'Each')
  on conflict (tenant_id, normalized_name) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_sellertray_default_uom_for_tenant() from public, anon, authenticated;

drop trigger if exists seed_sellertray_default_uom_for_tenant on public.tenants;
create trigger seed_sellertray_default_uom_for_tenant
after insert on public.tenants
for each row
execute function public.seed_sellertray_default_uom_for_tenant();

commit;
