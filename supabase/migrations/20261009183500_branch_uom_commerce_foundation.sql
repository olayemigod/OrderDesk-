-- SellerTray shared commerce foundation: Branch attribution and UOM snapshots.
-- This migration is deliberately backward compatible with the current
-- WhatsApp/manual order functions. Existing callers do not need to know about
-- Branch or UOM yet; database triggers attach safe defaults and preserve the
-- transaction snapshot for later inventory integration.

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null check (nullif(btrim(code), '') is not null),
  name text not null check (nullif(btrim(name), '') is not null),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create unique index branches_tenant_code_unique
  on public.branches (tenant_id, lower(btrim(code)));
create unique index branches_one_default_per_tenant
  on public.branches (tenant_id)
  where is_default;
create index branches_tenant_active_name_idx
  on public.branches (tenant_id, is_active, name);

insert into public.branches (tenant_id, code, name, is_default, is_active)
select t.id, 'MAIN', 'Main Branch', true, true
from public.tenants t
where not exists (
  select 1 from public.branches b where b.tenant_id = t.id
);

create or replace function public.ensure_sellertray_default_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.branches b where b.tenant_id = new.id
  ) then
    insert into public.branches (tenant_id, code, name, is_default, is_active)
    values (new.id, 'MAIN', 'Main Branch', true, true);
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_sellertray_default_branch() from public, anon, authenticated;

drop trigger if exists ensure_sellertray_default_branch on public.tenants;
create trigger ensure_sellertray_default_branch
after insert on public.tenants
for each row execute function public.ensure_sellertray_default_branch();

create table public.branch_user_access (
  tenant_id uuid not null,
  branch_id uuid not null,
  user_id uuid not null,
  can_operate boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, branch_id, user_id),
  constraint branch_user_access_branch_same_tenant
    foreign key (tenant_id, branch_id)
    references public.branches(tenant_id, id)
    on delete cascade,
  constraint branch_user_access_member_same_tenant
    foreign key (tenant_id, user_id)
    references public.tenant_members(tenant_id, user_id)
    on delete cascade
);

create index branch_user_access_user_idx
  on public.branch_user_access (user_id, tenant_id, can_operate);

alter table public.branches enable row level security;
alter table public.branch_user_access enable row level security;

revoke all on table public.branches from anon, authenticated;
revoke all on table public.branch_user_access from anon, authenticated;
grant select, insert, update on table public.branches to authenticated;
grant select, insert, update, delete on table public.branch_user_access to authenticated;
grant all on table public.branches to service_role;
grant all on table public.branch_user_access to service_role;

create policy branches_select_member
on public.branches
for select
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = branches.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

create policy branches_insert_management
on public.branches
for insert
to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = branches.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create policy branches_update_management
on public.branches
for update
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = branches.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = branches.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create policy branch_user_access_select_member
on public.branch_user_access
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = branch_user_access.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create policy branch_user_access_manage_management
on public.branch_user_access
for all
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = branch_user_access.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = branch_user_access.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create or replace function public.get_sellertray_accessible_branches(p_tenant_id uuid)
returns table (
  id uuid,
  code text,
  name text,
  is_default boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with membership as (
    select tm.role
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = (select auth.uid())
    limit 1
  )
  select b.id, b.code, b.name, b.is_default
  from public.branches b
  cross join membership m
  where b.tenant_id = p_tenant_id
    and b.is_active = true
    and (
      m.role in ('owner', 'manager')
      or exists (
        select 1
        from public.branch_user_access bua
        where bua.tenant_id = b.tenant_id
          and bua.branch_id = b.id
          and bua.user_id = (select auth.uid())
          and bua.can_operate = true
      )
      or (
        m.role = 'staff'
        and b.is_default = true
        and not exists (
          select 1
          from public.branch_user_access any_bua
          where any_bua.tenant_id = p_tenant_id
            and any_bua.user_id = (select auth.uid())
        )
      )
    )
  order by b.is_default desc, b.name asc;
$$;

revoke all on function public.get_sellertray_accessible_branches(uuid) from public, anon;
grant execute on function public.get_sellertray_accessible_branches(uuid) to authenticated, service_role;

alter table public.orders
  add column branch_id uuid;

update public.orders o
set branch_id = b.id
from public.branches b
where b.tenant_id = o.tenant_id
  and b.is_default = true
  and o.branch_id is null;

alter table public.orders
  add constraint orders_branch_same_tenant
  foreign key (tenant_id, branch_id)
  references public.branches(tenant_id, id)
  on delete restrict;

alter table public.orders
  alter column branch_id set not null;

create index orders_tenant_branch_created_idx
  on public.orders (tenant_id, branch_id, created_at desc);

create or replace function public.apply_sellertray_order_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null then
    select b.id into new.branch_id
    from public.branches b
    where b.tenant_id = new.tenant_id
      and b.is_default = true
      and b.is_active = true
    limit 1;
  end if;

  if new.branch_id is null then
    raise exception 'An active branch is required for this order' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.branches b
    where b.id = new.branch_id
      and b.tenant_id = new.tenant_id
      and b.is_active = true
  ) then
    raise exception 'Selected branch is unavailable for this business' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.apply_sellertray_order_branch() from public, anon, authenticated;

drop trigger if exists apply_sellertray_order_branch on public.orders;
create trigger apply_sellertray_order_branch
before insert or update of tenant_id, branch_id on public.orders
for each row execute function public.apply_sellertray_order_branch();

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders
  add constraint orders_source_check
  check (source in ('whatsapp', 'manual', 'pos'));

alter table public.catalog_items
  add column stock_uom text not null default 'Each'
    check (nullif(btrim(stock_uom), '') is not null),
  add column allow_fractional_stock boolean not null default true;

create table public.catalog_item_uoms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  catalog_item_id uuid not null,
  uom_name text not null check (nullif(btrim(uom_name), '') is not null),
  conversion_factor numeric(18,6) not null check (conversion_factor > 0),
  selling_price numeric(14,2) check (selling_price is null or selling_price >= 0),
  barcode text,
  allow_fractional boolean not null default true,
  is_default_selling boolean not null default false,
  is_default_purchase boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint catalog_item_uoms_item_same_tenant
    foreign key (tenant_id, catalog_item_id)
    references public.catalog_items(tenant_id, id)
    on delete cascade
);

create unique index catalog_item_uoms_item_name_unique
  on public.catalog_item_uoms (tenant_id, catalog_item_id, lower(btrim(uom_name)));
create unique index catalog_item_uoms_barcode_unique
  on public.catalog_item_uoms (tenant_id, btrim(barcode))
  where barcode is not null and btrim(barcode) <> '';
create unique index catalog_item_uoms_one_default_selling
  on public.catalog_item_uoms (tenant_id, catalog_item_id)
  where is_default_selling;
create unique index catalog_item_uoms_one_default_purchase
  on public.catalog_item_uoms (tenant_id, catalog_item_id)
  where is_default_purchase;
create index catalog_item_uoms_item_idx
  on public.catalog_item_uoms (tenant_id, catalog_item_id);

alter table public.catalog_item_uoms enable row level security;
revoke all on table public.catalog_item_uoms from anon, authenticated;
grant select, insert, update, delete on table public.catalog_item_uoms to authenticated;
grant all on table public.catalog_item_uoms to service_role;

create policy catalog_item_uoms_select_member
on public.catalog_item_uoms
for select
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_item_uoms.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

create policy catalog_item_uoms_manage_management
on public.catalog_item_uoms
for all
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_item_uoms.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = catalog_item_uoms.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create or replace function public.validate_sellertray_catalog_uom()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stock_uom text;
begin
  select ci.stock_uom into v_stock_uom
  from public.catalog_items ci
  where ci.tenant_id = new.tenant_id
    and ci.id = new.catalog_item_id;

  if v_stock_uom is null then
    raise exception 'Product does not belong to this business' using errcode = '23503';
  end if;

  new.uom_name := btrim(new.uom_name);
  new.barcode := nullif(btrim(coalesce(new.barcode, '')), '');

  if lower(new.uom_name) = lower(v_stock_uom)
     and new.conversion_factor <> 1 then
    raise exception 'Stock unit conversion factor must be 1' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validate_sellertray_catalog_uom() from public, anon, authenticated;

drop trigger if exists validate_sellertray_catalog_uom on public.catalog_item_uoms;
create trigger validate_sellertray_catalog_uom
before insert or update on public.catalog_item_uoms
for each row execute function public.validate_sellertray_catalog_uom();

insert into public.catalog_item_uoms (
  tenant_id,
  catalog_item_id,
  uom_name,
  conversion_factor,
  selling_price,
  allow_fractional,
  is_default_selling,
  is_default_purchase
)
select
  ci.tenant_id,
  ci.id,
  ci.stock_uom,
  1,
  ci.price_ngn,
  ci.allow_fractional_stock,
  true,
  true
from public.catalog_items ci
on conflict do nothing;

create or replace function public.sync_sellertray_stock_uom_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
begin
  if tg_op = 'UPDATE'
     and lower(btrim(new.stock_uom)) <> lower(btrim(old.stock_uom))
     and exists (
       select 1 from public.order_items oi
       where oi.tenant_id = new.tenant_id
         and oi.catalog_item_id = new.id
     ) then
    raise exception 'Stock unit cannot be changed after transactions exist' using errcode = '23514';
  end if;

  select u.id into v_existing_id
  from public.catalog_item_uoms u
  where u.tenant_id = new.tenant_id
    and u.catalog_item_id = new.id
    and lower(btrim(u.uom_name)) = lower(btrim(new.stock_uom))
  limit 1;

  if v_existing_id is null then
    if not exists (
      select 1 from public.catalog_item_uoms u
      where u.tenant_id = new.tenant_id
        and u.catalog_item_id = new.id
        and u.is_default_selling = true
    ) then
      insert into public.catalog_item_uoms (
        tenant_id, catalog_item_id, uom_name, conversion_factor,
        selling_price, allow_fractional, is_default_selling, is_default_purchase
      ) values (
        new.tenant_id, new.id, new.stock_uom, 1,
        new.price_ngn, new.allow_fractional_stock, true, true
      );
    else
      insert into public.catalog_item_uoms (
        tenant_id, catalog_item_id, uom_name, conversion_factor,
        selling_price, allow_fractional, is_default_selling, is_default_purchase
      ) values (
        new.tenant_id, new.id, new.stock_uom, 1,
        new.price_ngn, new.allow_fractional_stock, false, false
      );
    end if;
  else
    update public.catalog_item_uoms
    set conversion_factor = 1,
        selling_price = case
          when lower(btrim(stock.uom_name)) = lower(btrim(new.stock_uom))
            then new.price_ngn
          else stock.selling_price
        end,
        allow_fractional = new.allow_fractional_stock,
        updated_at = now()
    from public.catalog_item_uoms stock
    where public.catalog_item_uoms.id = v_existing_id
      and stock.id = v_existing_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_sellertray_stock_uom_row() from public, anon, authenticated;

drop trigger if exists sync_sellertray_stock_uom_row on public.catalog_items;
create trigger sync_sellertray_stock_uom_row
after insert or update of stock_uom, price_ngn, allow_fractional_stock on public.catalog_items
for each row execute function public.sync_sellertray_stock_uom_row();

alter table public.order_items
  add column selected_uom text,
  add column conversion_factor numeric(18,6),
  add column stock_quantity numeric(18,6);

update public.order_items oi
set selected_uom = ci.stock_uom,
    conversion_factor = 1,
    stock_quantity = oi.quantity
from public.catalog_items ci
where ci.tenant_id = oi.tenant_id
  and ci.id = oi.catalog_item_id
  and oi.selected_uom is null;

update public.order_items
set selected_uom = coalesce(selected_uom, 'Each'),
    conversion_factor = coalesce(conversion_factor, 1),
    stock_quantity = coalesce(stock_quantity, quantity)
where selected_uom is null
   or conversion_factor is null
   or stock_quantity is null;

alter table public.order_items
  alter column selected_uom set not null,
  alter column conversion_factor set not null,
  alter column stock_quantity set not null,
  add constraint order_items_selected_uom_nonempty
    check (nullif(btrim(selected_uom), '') is not null),
  add constraint order_items_conversion_factor_positive
    check (conversion_factor > 0),
  add constraint order_items_stock_quantity_positive
    check (stock_quantity > 0);

create or replace function public.snapshot_sellertray_order_item_uom()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stock_uom text;
  v_factor numeric(18,6);
  v_allow_fractional boolean;
  v_validate_config boolean;
begin
  if new.catalog_item_id is null then
    new.selected_uom := coalesce(nullif(btrim(new.selected_uom), ''), 'Each');
    new.conversion_factor := coalesce(new.conversion_factor, 1);
    new.stock_quantity := new.quantity * new.conversion_factor;
    return new;
  end if;

  select ci.stock_uom into v_stock_uom
  from public.catalog_items ci
  where ci.tenant_id = new.tenant_id
    and ci.id = new.catalog_item_id;

  if v_stock_uom is null then
    raise exception 'Product does not belong to this business' using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    v_validate_config := true;
  else
    v_validate_config :=
      new.catalog_item_id is distinct from old.catalog_item_id
      or new.selected_uom is distinct from old.selected_uom
      or new.conversion_factor is distinct from old.conversion_factor;

    if old.catalog_item_id is null
       and new.catalog_item_id is not null
       and new.selected_uom = old.selected_uom
       and new.conversion_factor = old.conversion_factor then
      new.selected_uom := v_stock_uom;
      new.conversion_factor := null;
      v_validate_config := true;
    end if;
  end if;

  if nullif(btrim(coalesce(new.selected_uom, '')), '') is null then
    new.selected_uom := v_stock_uom;
    v_validate_config := true;
  else
    new.selected_uom := btrim(new.selected_uom);
  end if;

  if v_validate_config then
    select u.conversion_factor, u.allow_fractional
    into v_factor, v_allow_fractional
    from public.catalog_item_uoms u
    where u.tenant_id = new.tenant_id
      and u.catalog_item_id = new.catalog_item_id
      and lower(btrim(u.uom_name)) = lower(btrim(new.selected_uom))
    limit 1;

    if v_factor is null then
      raise exception 'Selected unit is not configured for this product' using errcode = '23514';
    end if;

    if new.conversion_factor is not null
       and new.conversion_factor <> v_factor then
      raise exception 'Unit conversion does not match the configured product unit' using errcode = '23514';
    end if;

    new.conversion_factor := v_factor;

    if not v_allow_fractional and new.quantity <> trunc(new.quantity) then
      raise exception 'This product unit does not allow fractional quantity' using errcode = '23514';
    end if;
  end if;

  new.conversion_factor := coalesce(new.conversion_factor, 1);
  new.stock_quantity := new.quantity * new.conversion_factor;
  return new;
end;
$$;

revoke all on function public.snapshot_sellertray_order_item_uom() from public, anon, authenticated;

drop trigger if exists snapshot_sellertray_order_item_uom on public.order_items;
create trigger snapshot_sellertray_order_item_uom
before insert or update of catalog_item_id, quantity, selected_uom, conversion_factor
on public.order_items
for each row execute function public.snapshot_sellertray_order_item_uom();
