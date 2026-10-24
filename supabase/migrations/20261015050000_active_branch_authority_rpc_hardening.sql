begin;

-- Active Branch authority is a policy/server primitive. Authenticated RLS must
-- bind identity to auth.uid() instead of exposing an arbitrary-user helper over
-- PostgREST RPC.
create or replace function public.sellertray_current_user_can_access_branch(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    public.sellertray_user_can_access_branch(
      p_tenant_id,
      p_branch_id,
      (select auth.uid())
    ),
    false
  );
$$;

revoke all on function public.sellertray_current_user_can_access_branch(uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_current_user_can_access_branch(uuid,uuid)
  to authenticated;

revoke all on function public.sellertray_user_can_access_branch(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_access_branch(uuid,uuid,uuid)
  to service_role;

-- Direct order writes remain governed by active Branch authority, but the RLS
-- boundary now derives the actor from the authenticated session itself.
drop policy if exists orders_insert_member on public.orders;
create policy orders_insert_member
on public.orders
for insert to authenticated
with check (
  public.sellertray_current_user_can_access_branch(
    orders.tenant_id,
    orders.branch_id
  )
);

drop policy if exists orders_update_member on public.orders;
create policy orders_update_member
on public.orders
for update to authenticated
using (
  public.sellertray_current_user_can_access_branch(
    orders.tenant_id,
    orders.branch_id
  )
)
with check (
  public.sellertray_current_user_can_access_branch(
    orders.tenant_id,
    orders.branch_id
  )
);

drop policy if exists order_items_insert_member on public.order_items;
create policy order_items_insert_member
on public.order_items
for insert to authenticated
with check (
  exists (
    select 1
    from public.orders o
    where o.tenant_id=order_items.tenant_id
      and o.id=order_items.order_id
      and public.sellertray_current_user_can_access_branch(
        o.tenant_id,
        o.branch_id
      )
  )
);

drop policy if exists order_items_update_member on public.order_items;
create policy order_items_update_member
on public.order_items
for update to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id=order_items.tenant_id
      and o.id=order_items.order_id
      and public.sellertray_current_user_can_access_branch(
        o.tenant_id,
        o.branch_id
      )
  )
)
with check (
  exists (
    select 1
    from public.orders o
    where o.tenant_id=order_items.tenant_id
      and o.id=order_items.order_id
      and public.sellertray_current_user_can_access_branch(
        o.tenant_id,
        o.branch_id
      )
  )
);

drop policy if exists order_items_delete_member on public.order_items;
create policy order_items_delete_member
on public.order_items
for delete to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id=order_items.tenant_id
      and o.id=order_items.order_id
      and public.sellertray_current_user_can_access_branch(
        o.tenant_id,
        o.branch_id
      )
  )
);

commit;
