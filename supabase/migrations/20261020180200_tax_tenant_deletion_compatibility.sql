begin;

-- Tax configuration history is immutable while its Business exists, but it must
-- not make governed Business deletion impossible. Match SellerTray's existing
-- operational-history lifecycle: direct configuration deletion still fails;
-- cascading cleanup is permitted only after the governing Tenant is gone.

alter table public.sellertray_tax_configurations
  drop constraint if exists sellertray_tax_configurations_tenant_id_fkey,
  add constraint sellertray_tax_configurations_tenant_id_fkey
    foreign key (tenant_id)
    references public.tenants(id)
    on delete cascade;

alter table public.orders
  drop constraint if exists orders_tax_configuration_same_tenant,
  add constraint orders_tax_configuration_same_tenant
    foreign key (tenant_id,tax_configuration_id)
    references public.sellertray_tax_configurations(tenant_id,id)
    on delete cascade,
  drop constraint if exists orders_offline_tax_configuration_same_tenant,
  add constraint orders_offline_tax_configuration_same_tenant
    foreign key (tenant_id,offline_tax_configuration_id)
    references public.sellertray_tax_configurations(tenant_id,id)
    on delete cascade;

alter table public.sale_returns
  drop constraint if exists sale_returns_tax_configuration_same_tenant,
  add constraint sale_returns_tax_configuration_same_tenant
    foreign key (tenant_id,tax_configuration_id)
    references public.sellertray_tax_configurations(tenant_id,id)
    on delete cascade;

create or replace function public.prevent_sellertray_tax_configuration_mutation()
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

  raise exception 'SellerTray tax configuration history is immutable'
    using errcode='55000';
end;
$$;

revoke all on function public.prevent_sellertray_tax_configuration_mutation()
  from public,anon,authenticated;

commit;
