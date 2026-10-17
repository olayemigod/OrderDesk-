-- SellerTray inventory read hardening.
-- Explicitly fail closed for inaccessible branches instead of making hidden
-- movements look like a legitimate zero-stock result.

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
  with branch_access as (
    select 1
    where current_user = 'postgres'
       or (select auth.role()) = 'service_role'
       or exists (
         select 1
         from public.tenant_members tm
         where tm.tenant_id = p_tenant_id
           and tm.user_id = (select auth.uid())
           and (
             tm.role in ('owner', 'manager')
             or exists (
               select 1
               from public.branch_user_access bua
               where bua.tenant_id = p_tenant_id
                 and bua.branch_id = p_branch_id
                 and bua.user_id = (select auth.uid())
                 and bua.can_operate = true
             )
             or (
               tm.role = 'staff'
               and exists (
                 select 1
                 from public.branches b
                 where b.tenant_id = p_tenant_id
                   and b.id = p_branch_id
                   and b.is_default = true
                   and b.is_active = true
               )
               and not exists (
                 select 1
                 from public.branch_user_access any_bua
                 where any_bua.tenant_id = p_tenant_id
                   and any_bua.user_id = (select auth.uid())
               )
             )
           )
       )
  )
  select
    ci.id as catalog_item_id,
    ci.name as item_name,
    ci.sku,
    ci.category,
    ci.stock_uom,
    coalesce(sum(im.quantity_delta), 0)::numeric as quantity_on_hand,
    max(im.business_at) as last_movement_at
  from branch_access access
  cross join public.catalog_items ci
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
  with branch_access as (
    select 1
    where current_user = 'postgres'
       or (select auth.role()) = 'service_role'
       or exists (
         select 1
         from public.tenant_members tm
         where tm.tenant_id = p_tenant_id
           and tm.user_id = (select auth.uid())
           and (
             tm.role in ('owner', 'manager')
             or exists (
               select 1
               from public.branch_user_access bua
               where bua.tenant_id = p_tenant_id
                 and bua.branch_id = p_branch_id
                 and bua.user_id = (select auth.uid())
                 and bua.can_operate = true
             )
             or (
               tm.role = 'staff'
               and exists (
                 select 1
                 from public.branches b
                 where b.tenant_id = p_tenant_id
                   and b.id = p_branch_id
                   and b.is_default = true
                   and b.is_active = true
               )
               and not exists (
                 select 1
                 from public.branch_user_access any_bua
                 where any_bua.tenant_id = p_tenant_id
                   and any_bua.user_id = (select auth.uid())
               )
             )
           )
       )
  )
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
  from branch_access access
  cross join public.inventory_movements im
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
