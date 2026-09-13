revoke update on table public.tenants from authenticated;

grant update (
  name,
  business_email,
  business_phone,
  business_type,
  logo_url,
  currency,
  timezone
) on table public.tenants to authenticated;

create policy tenants_update_owner_manager
on public.tenants
for update
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenants.id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
)
with check (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = tenants.id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create or replace function public.touch_tenant_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_tenant_updated_at on public.tenants;
create trigger touch_tenant_updated_at
before update on public.tenants
for each row
execute function public.touch_tenant_updated_at();
