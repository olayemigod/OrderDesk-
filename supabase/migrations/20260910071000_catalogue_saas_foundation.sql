alter table public.catalog_items
  add column if not exists category text,
  add column if not exists image_url text;

create table public.catalog_item_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  catalog_item_id uuid not null,
  alias text not null check (nullif(btrim(alias), '') is not null),
  created_at timestamptz not null default now(),
  constraint catalog_item_aliases_item_same_tenant
    foreign key (tenant_id, catalog_item_id)
    references public.catalog_items(tenant_id, id)
    on delete cascade
);

create unique index catalog_item_aliases_tenant_alias_unique
  on public.catalog_item_aliases (tenant_id, lower(btrim(alias)));
create index catalog_item_aliases_tenant_item_idx
  on public.catalog_item_aliases (tenant_id, catalog_item_id);

alter table public.catalog_item_aliases enable row level security;
revoke all on table public.catalog_item_aliases from anon, authenticated;
grant select, insert, update, delete on table public.catalog_item_aliases to authenticated;

drop policy if exists catalog_items_insert_member on public.catalog_items;
drop policy if exists catalog_items_update_member on public.catalog_items;

create policy catalog_items_insert_owner_manager
on public.catalog_items
for insert
to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_items.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create policy catalog_items_update_owner_manager
on public.catalog_items
for update
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_items.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_items.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create policy catalog_item_aliases_select_member
on public.catalog_item_aliases
for select
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_item_aliases.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

create policy catalog_item_aliases_insert_owner_manager
on public.catalog_item_aliases
for insert
to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_item_aliases.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create policy catalog_item_aliases_update_owner_manager
on public.catalog_item_aliases
for update
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_item_aliases.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_item_aliases.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create policy catalog_item_aliases_delete_owner_manager
on public.catalog_item_aliases
for delete
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_item_aliases.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create or replace function public.advance_orderdesk_catalogue_onboarding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.catalog_items ci
    where ci.tenant_id = new.tenant_id
      and ci.is_active = true
      and ci.price_ngn is not null
  ) then
    update public.tenants
    set onboarding_status = 'whatsapp'
    where id = new.tenant_id
      and onboarding_status = 'catalogue';
  end if;
  return new;
end;
$$;

revoke all on function public.advance_orderdesk_catalogue_onboarding() from public;
revoke all on function public.advance_orderdesk_catalogue_onboarding() from anon;
revoke all on function public.advance_orderdesk_catalogue_onboarding() from authenticated;

drop trigger if exists advance_orderdesk_catalogue_onboarding on public.catalog_items;
create trigger advance_orderdesk_catalogue_onboarding
after insert or update of price_ngn, is_active on public.catalog_items
for each row
execute function public.advance_orderdesk_catalogue_onboarding();
