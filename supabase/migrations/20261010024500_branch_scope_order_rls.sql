begin;

-- Branch is a server-side security boundary, not only a mobile filter. Keep the
-- existing table/column privileges intact while constraining every direct order
-- and order-item operation to the caller's effective Branch access.
drop policy if exists orders_select_member on public.orders;
create policy orders_select_member
on public.orders
for select
to authenticated
using (
  public.sellertray_user_can_access_branch(
    orders.tenant_id,
    orders.branch_id,
    (select auth.uid())
  )
);

drop policy if exists orders_insert_member on public.orders;
create policy orders_insert_member
on public.orders
for insert
to authenticated
with check (
  public.sellertray_user_can_access_branch(
    orders.tenant_id,
    orders.branch_id,
    (select auth.uid())
  )
);

drop policy if exists orders_update_member on public.orders;
create policy orders_update_member
on public.orders
for update
to authenticated
using (
  public.sellertray_user_can_access_branch(
    orders.tenant_id,
    orders.branch_id,
    (select auth.uid())
  )
)
with check (
  public.sellertray_user_can_access_branch(
    orders.tenant_id,
    orders.branch_id,
    (select auth.uid())
  )
);

drop policy if exists order_items_select_member on public.order_items;
create policy order_items_select_member
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_items.tenant_id
      and o.id = order_items.order_id
      and public.sellertray_user_can_access_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
);

drop policy if exists order_items_insert_member on public.order_items;
create policy order_items_insert_member
on public.order_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_items.tenant_id
      and o.id = order_items.order_id
      and public.sellertray_user_can_access_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
);

drop policy if exists order_items_update_member on public.order_items;
create policy order_items_update_member
on public.order_items
for update
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_items.tenant_id
      and o.id = order_items.order_id
      and public.sellertray_user_can_access_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
)
with check (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_items.tenant_id
      and o.id = order_items.order_id
      and public.sellertray_user_can_access_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
);

drop policy if exists order_items_delete_member on public.order_items;
create policy order_items_delete_member
on public.order_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_items.tenant_id
      and o.id = order_items.order_id
      and public.sellertray_user_can_access_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
);

commit;
