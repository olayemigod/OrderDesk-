-- SellerTray shared inventory foundation.
-- One quantity truth lives in Stock UOM. Alternate UOMs are transaction
-- snapshots only. This slice intentionally does not auto-post sales yet;
-- checkout/payment will call the governed movement command in a later slice.

create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  code text not null check (nullif(btrim(code), '') is not null),
  name text not null check (nullif(btrim(name), '') is not null),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  constraint stock_locations_branch_same_tenant
    foreign key (tenant_id, branch_id)
    references public.branches(tenant_id, id)
    on delete cascade
);

create unique index stock_locations_branch_code_unique
  on public.stock_locations (tenant_id, branch_id, lower(btrim(code)));
create unique index stock_locations_one_default_per_branch
  on public.stock_locations (tenant_id, branch_id)
  where is_default;
create index stock_locations_tenant_branch_active_idx
  on public.stock_locations (tenant_id, branch_id, is_active, name);

insert into public.stock_locations (
  tenant_id, branch_id, code, name, is_default, is_active
)
select b.tenant_id, b.id, 'MAIN', 'Main Stock', true, true
from public.branches b
where not exists (
  select 1
  from public.stock_locations sl
  where sl.tenant_id = b.tenant_id
    and sl.branch_id = b.id
);

create or replace function public.ensure_sellertray_default_stock_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.stock_locations sl
    where sl.tenant_id = new.tenant_id
      and sl.branch_id = new.id
  ) then
    insert into public.stock_locations (
      tenant_id, branch_id, code, name, is_default, is_active
    ) values (
      new.tenant_id, new.id, 'MAIN', 'Main Stock', true, true
    );
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_sellertray_default_stock_location()
  from public, anon, authenticated;

drop trigger if exists ensure_sellertray_default_stock_location on public.branches;
create trigger ensure_sellertray_default_stock_location
after insert on public.branches
for each row execute function public.ensure_sellertray_default_stock_location();

alter table public.stock_locations enable row level security;
revoke all on table public.stock_locations from anon, authenticated;
grant select on table public.stock_locations to authenticated;
grant all on table public.stock_locations to service_role;

create policy stock_locations_select_branch_member
on public.stock_locations
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = stock_locations.tenant_id
      and tm.user_id = (select auth.uid())
      and (
        tm.role in ('owner', 'manager')
        or exists (
          select 1
          from public.branch_user_access bua
          where bua.tenant_id = stock_locations.tenant_id
            and bua.branch_id = stock_locations.branch_id
            and bua.user_id = (select auth.uid())
            and bua.can_operate = true
        )
        or (
          tm.role = 'staff'
          and exists (
            select 1
            from public.branches b
            where b.tenant_id = stock_locations.tenant_id
              and b.id = stock_locations.branch_id
              and b.is_default = true
          )
          and not exists (
            select 1
            from public.branch_user_access any_bua
            where any_bua.tenant_id = stock_locations.tenant_id
              and any_bua.user_id = (select auth.uid())
          )
        )
      )
  )
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  stock_location_id uuid not null,
  catalog_item_id uuid not null,
  movement_type text not null,
  quantity_delta numeric(18,6) not null check (quantity_delta <> 0),
  stock_uom text not null check (nullif(btrim(stock_uom), '') is not null),
  source_uom text not null check (nullif(btrim(source_uom), '') is not null),
  source_quantity numeric(18,6) not null check (source_quantity > 0),
  conversion_factor numeric(18,6) not null check (conversion_factor > 0),
  reference_type text not null check (nullif(btrim(reference_type), '') is not null),
  reference_id text not null check (nullif(btrim(reference_id), '') is not null),
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  business_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  reason text,
  reversal_of_movement_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint inventory_movements_branch_same_tenant
    foreign key (tenant_id, branch_id)
    references public.branches(tenant_id, id)
    on delete restrict,
  constraint inventory_movements_location_same_branch
    foreign key (tenant_id, branch_id, stock_location_id)
    references public.stock_locations(tenant_id, branch_id, id)
    on delete restrict,
  constraint inventory_movements_item_same_tenant
    foreign key (tenant_id, catalog_item_id)
    references public.catalog_items(tenant_id, id)
    on delete restrict,
  constraint inventory_movements_reversal_same_tenant
    foreign key (tenant_id, reversal_of_movement_id)
    references public.inventory_movements(tenant_id, id)
    on delete restrict,
  constraint inventory_movements_type_check
    check (movement_type in (
      'opening',
      'sale',
      'sale_return',
      'purchase_receipt',
      'adjustment',
      'count_reconciliation',
      'transfer_out',
      'transfer_in',
      'damaged',
      'expired',
      'reversal'
    )),
  constraint inventory_movements_sign_check
    check (
      (movement_type in ('sale', 'transfer_out', 'damaged', 'expired') and quantity_delta < 0)
      or (movement_type in ('opening', 'sale_return', 'purchase_receipt', 'transfer_in') and quantity_delta > 0)
      or (movement_type in ('adjustment', 'count_reconciliation', 'reversal'))
    )
);

create unique index inventory_movements_idempotency_unique
  on public.inventory_movements (tenant_id, idempotency_key);
create unique index inventory_movements_one_reversal_unique
  on public.inventory_movements (tenant_id, reversal_of_movement_id)
  where reversal_of_movement_id is not null;
create index inventory_movements_branch_item_time_idx
  on public.inventory_movements (
    tenant_id, branch_id, catalog_item_id, business_at desc, created_at desc
  );
create index inventory_movements_location_item_time_idx
  on public.inventory_movements (
    tenant_id, stock_location_id, catalog_item_id, business_at desc, created_at desc
  );
create index inventory_movements_reference_idx
  on public.inventory_movements (tenant_id, reference_type, reference_id);

alter table public.inventory_movements enable row level security;
revoke all on table public.inventory_movements from anon, authenticated;
grant select on table public.inventory_movements to authenticated;
grant all on table public.inventory_movements to service_role;

create policy inventory_movements_select_branch_member
on public.inventory_movements
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = inventory_movements.tenant_id
      and tm.user_id = (select auth.uid())
      and (
        tm.role in ('owner', 'manager')
        or exists (
          select 1
          from public.branch_user_access bua
          where bua.tenant_id = inventory_movements.tenant_id
            and bua.branch_id = inventory_movements.branch_id
            and bua.user_id = (select auth.uid())
            and bua.can_operate = true
        )
        or (
          tm.role = 'staff'
          and exists (
            select 1
            from public.branches b
            where b.tenant_id = inventory_movements.tenant_id
              and b.id = inventory_movements.branch_id
              and b.is_default = true
          )
          and not exists (
            select 1
            from public.branch_user_access any_bua
            where any_bua.tenant_id = inventory_movements.tenant_id
              and any_bua.user_id = (select auth.uid())
          )
        )
      )
  )
);

create or replace function public.prevent_sellertray_inventory_movement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Inventory movements are immutable; post a correcting movement instead'
    using errcode = '55000';
end;
$$;

revoke all on function public.prevent_sellertray_inventory_movement_mutation()
  from public, anon, authenticated;

drop trigger if exists prevent_sellertray_inventory_movement_update on public.inventory_movements;
create trigger prevent_sellertray_inventory_movement_update
before update on public.inventory_movements
for each row execute function public.prevent_sellertray_inventory_movement_mutation();

drop trigger if exists prevent_sellertray_inventory_movement_delete on public.inventory_movements;
create trigger prevent_sellertray_inventory_movement_delete
before delete on public.inventory_movements
for each row execute function public.prevent_sellertray_inventory_movement_mutation();

create or replace function public.record_sellertray_inventory_movement(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_stock_location_id uuid,
  p_catalog_item_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_source_uom text,
  p_source_quantity numeric,
  p_conversion_factor numeric,
  p_reference_type text,
  p_reference_id text,
  p_idempotency_key text,
  p_business_at timestamptz,
  p_actor_user_id uuid,
  p_reason text,
  p_metadata jsonb,
  p_reversal_of_movement_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_stock_uom text;
  v_existing public.inventory_movements%rowtype;
  v_movement_id uuid;
  v_source_uom text;
  v_reference_type text;
  v_reference_id text;
  v_idempotency_key text;
begin
  v_source_uom := nullif(btrim(coalesce(p_source_uom, '')), '');
  v_reference_type := nullif(btrim(coalesce(p_reference_type, '')), '');
  v_reference_id := nullif(btrim(coalesce(p_reference_id, '')), '');
  v_idempotency_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');

  if p_tenant_id is null or p_branch_id is null or p_stock_location_id is null or p_catalog_item_id is null then
    raise exception 'Business, branch, stock location and product are required'
      using errcode = '22023';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Stock movement quantity must not be zero' using errcode = '22023';
  end if;
  if p_source_quantity is null or p_source_quantity <= 0 then
    raise exception 'Source quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_conversion_factor is null or p_conversion_factor <= 0 then
    raise exception 'Conversion factor must be greater than zero' using errcode = '22023';
  end if;
  if v_source_uom is null or v_reference_type is null or v_reference_id is null or v_idempotency_key is null then
    raise exception 'Source unit, reference and idempotency key are required' using errcode = '22023';
  end if;

  select ci.stock_uom into v_stock_uom
  from public.catalog_items ci
  where ci.tenant_id = p_tenant_id
    and ci.id = p_catalog_item_id;

  if v_stock_uom is null then
    raise exception 'Product does not belong to this business' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.stock_locations sl
    where sl.tenant_id = p_tenant_id
      and sl.branch_id = p_branch_id
      and sl.id = p_stock_location_id
      and sl.is_active = true
  ) then
    raise exception 'Stock location is unavailable for this branch' using errcode = '23514';
  end if;

  if round(abs(p_quantity_delta)::numeric, 6)
     <> round((p_source_quantity * p_conversion_factor)::numeric, 6) then
    raise exception 'Stock UOM quantity does not match source quantity and conversion factor'
      using errcode = '23514';
  end if;

  if lower(v_source_uom) = lower(v_stock_uom) and p_conversion_factor <> 1 then
    raise exception 'Stock UOM conversion factor must be 1' using errcode = '23514';
  end if;

  if p_movement_type in ('sale', 'transfer_out', 'damaged', 'expired') and p_quantity_delta >= 0 then
    raise exception 'This movement type must reduce stock' using errcode = '23514';
  end if;
  if p_movement_type in ('opening', 'sale_return', 'purchase_receipt', 'transfer_in') and p_quantity_delta <= 0 then
    raise exception 'This movement type must increase stock' using errcode = '23514';
  end if;

  select * into v_existing
  from public.inventory_movements im
  where im.tenant_id = p_tenant_id
    and im.idempotency_key = v_idempotency_key;

  if found then
    if v_existing.branch_id <> p_branch_id
       or v_existing.stock_location_id <> p_stock_location_id
       or v_existing.catalog_item_id <> p_catalog_item_id
       or v_existing.movement_type <> p_movement_type
       or v_existing.quantity_delta <> p_quantity_delta
       or lower(v_existing.source_uom) <> lower(v_source_uom)
       or v_existing.source_quantity <> p_source_quantity
       or v_existing.conversion_factor <> p_conversion_factor
       or v_existing.reference_type <> v_reference_type
       or v_existing.reference_id <> v_reference_id
       or v_existing.reversal_of_movement_id is distinct from p_reversal_of_movement_id then
      raise exception 'Idempotency key is already used for a different inventory movement'
        using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  if p_reversal_of_movement_id is not null and not exists (
    select 1
    from public.inventory_movements original
    where original.tenant_id = p_tenant_id
      and original.id = p_reversal_of_movement_id
      and original.catalog_item_id = p_catalog_item_id
      and original.branch_id = p_branch_id
      and original.stock_location_id = p_stock_location_id
      and original.quantity_delta = -p_quantity_delta
  ) then
    raise exception 'Reversal must exactly offset an existing movement for the same stock position'
      using errcode = '23514';
  end if;

  insert into public.inventory_movements (
    tenant_id,
    branch_id,
    stock_location_id,
    catalog_item_id,
    movement_type,
    quantity_delta,
    stock_uom,
    source_uom,
    source_quantity,
    conversion_factor,
    reference_type,
    reference_id,
    idempotency_key,
    business_at,
    actor_user_id,
    reason,
    reversal_of_movement_id,
    metadata
  ) values (
    p_tenant_id,
    p_branch_id,
    p_stock_location_id,
    p_catalog_item_id,
    p_movement_type,
    p_quantity_delta,
    v_stock_uom,
    v_source_uom,
    p_source_quantity,
    p_conversion_factor,
    v_reference_type,
    v_reference_id,
    v_idempotency_key,
    coalesce(p_business_at, now()),
    p_actor_user_id,
    nullif(btrim(coalesce(p_reason, '')), ''),
    p_reversal_of_movement_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

revoke all on function public.record_sellertray_inventory_movement(
  uuid, uuid, uuid, uuid, text, numeric, text, numeric, numeric,
  text, text, text, timestamptz, uuid, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.record_sellertray_inventory_movement(
  uuid, uuid, uuid, uuid, text, numeric, text, numeric, numeric,
  text, text, text, timestamptz, uuid, text, jsonb, uuid
) to service_role;

create or replace function public.get_sellertray_branch_stock(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table (
  catalog_item_id uuid,
  item_name text,
  sku text,
  category text,
  stock_uom text,
  quantity_on_hand numeric,
  last_movement_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ci.id as catalog_item_id,
    ci.name as item_name,
    ci.sku,
    ci.category,
    ci.stock_uom,
    coalesce(sum(im.quantity_delta), 0)::numeric as quantity_on_hand,
    max(im.business_at) as last_movement_at
  from public.catalog_items ci
  left join public.inventory_movements im
    on im.tenant_id = ci.tenant_id
   and im.catalog_item_id = ci.id
   and im.branch_id = p_branch_id
  where ci.tenant_id = p_tenant_id
    and ci.is_active = true
    and exists (
      select 1
      from public.branches b
      where b.tenant_id = p_tenant_id
        and b.id = p_branch_id
        and b.is_active = true
    )
  group by ci.id, ci.name, ci.sku, ci.category, ci.stock_uom
  order by ci.name asc;
$$;

revoke all on function public.get_sellertray_branch_stock(uuid, uuid)
  from public, anon;
grant execute on function public.get_sellertray_branch_stock(uuid, uuid)
  to authenticated, service_role;

create or replace function public.get_sellertray_stock_movements(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_catalog_item_id uuid default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  catalog_item_id uuid,
  item_name text,
  movement_type text,
  quantity_delta numeric,
  stock_uom text,
  source_uom text,
  source_quantity numeric,
  conversion_factor numeric,
  reference_type text,
  reference_id text,
  business_at timestamptz,
  reason text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    im.id,
    im.catalog_item_id,
    ci.name,
    im.movement_type,
    im.quantity_delta,
    im.stock_uom,
    im.source_uom,
    im.source_quantity,
    im.conversion_factor,
    im.reference_type,
    im.reference_id,
    im.business_at,
    im.reason,
    im.created_at
  from public.inventory_movements im
  join public.catalog_items ci
    on ci.tenant_id = im.tenant_id
   and ci.id = im.catalog_item_id
  where im.tenant_id = p_tenant_id
    and im.branch_id = p_branch_id
    and (p_catalog_item_id is null or im.catalog_item_id = p_catalog_item_id)
  order by im.business_at desc, im.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.get_sellertray_stock_movements(uuid, uuid, uuid, integer)
  from public, anon;
grant execute on function public.get_sellertray_stock_movements(uuid, uuid, uuid, integer)
  to authenticated, service_role;
